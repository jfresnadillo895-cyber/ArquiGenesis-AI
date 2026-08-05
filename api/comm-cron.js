// api/comm-cron.js — Barrido diario del sistema de comunicaciones (Vercel Cron)
// ---------------------------------------------------------------------------------------------
// POR QUE EXISTE
//   El Corte A definio comm_expirar_vencidos() y comm_recuperar_abandonados() como las
//   funciones que limpian trabajos vencidos y recuperan trabajos abandonados en PROCESSING --
//   pero hasta el Corte D nada las llamaba: no habia ningun cron conectado a ellas. Sin este
//   archivo, un trabajo que queda en PROCESSING porque Brevo nunca contesto (ni exito ni
//   webhook) se queda ahi para siempre, y un trabajo vencido nunca pasa a EXPIRED.
//
//   Este archivo las conecta, y ademas corre la reconciliacion propia del Corte D:
//   comm_marcar_intentos_inciertos_por_abandono() ANTES de comm_recuperar_abandonados(), para
//   que el intento de entrega quede marcado "incierto" (silencio del proveedor) en vez de
//   quedar para siempre en "enviando"/"enviado" sin ninguna explicacion.
//
//   Corte E agrego comm_barrer_programados(): reintenta CREATED/HELD cuyo notBefore ya
//   llego (o que estaban esperando una dependencia, una suspension, o la presion del
//   destinatario) -- es lo que hace que "programacion persistente" funcione sin que nadie
//   tenga que volver a pedirlo a mano.
//
// QUE NO HACE (a proposito) — sigue valiendo para los primeros cuatro pasos
//   Los pasos 1 a 4 (vencidos, barrido, inciertos, abandonados) no disparan envios nuevos:
//   solo deciden si un trabajo YA PUEDE avanzar a READY, nunca lo mandan por Brevo. Ese
//   limite es a proposito para el barrido GENERAL, que puede tocar cualquier finalidad y
//   cualquier volumen: automatizar ese envio en si mismo queda para cuando el plan de
//   Vercel permita mas de una corrida de cron por dia (ver nota del Corte D).
//
// EXCEPCION — PASO 5 (Corte I): organismos pendientes SI envia de verdad
//   A diferencia de los otros cuatro, este paso llama a emitirYEnviarCorreo() y manda
//   correo real via Brevo. Se acepta la excepcion porque el volumen es acotado (un aviso
//   por organismo inactivo, como mucho dos por ciclo) y porque una corrida diaria alcanza
//   de sobra para este caso puntual -- no es la misma situacion que motivo dejar el
//   despacho general fuera de este archivo. La proteccion de fondo (comm_closed_recipients,
//   Corte D) sigue intacta: mientras un destinatario real no este en esa lista, el envio se
//   rechaza solo, sin llegar a Brevo.
//
// PASO 6 (Corte J): horizonte de continuidad -- misma excepcion, tono distinto
//   Un organismo que ya completo una etapa (tiene al menos un hito) se GRADUA de la via
//   "pendiente" del paso 5 (ver CORTE_J_MIGRACION.sql, seccion 3: comm_detectar_organismos_
//   pendientes() excluye desde ahora cualquier organismo con hitos) -- de ahi en mas solo
//   puede recibir este otro aviso, nunca el de "quedo pendiente". Un solo envio, nunca un
//   segundo: reconocer un cierre es distinto de recordar una deuda, y repetirlo lo convierte
//   en presion -- exactamente lo que Javier pidio evitar (04/08).
//
// PASO 7 (Corte L): ejecutar bajas de cuenta ya programadas
//   api/eliminar-cuenta.js ya no borra al instante: marca perfiles.baja_programada = ahora+7
//   dias (periodo de seguridad, §7.4 del Compendio). Este paso busca las que ya vencieron sin
//   haberse revocado (api/cancelar-baja.js) y ejecuta el borrado real con eliminarCuentaCompleta
//   (lib/cuenta.js) -- la misma logica de cinco pasos que uso el Corte K, ahora compartida.
//
// PASO 8 (Corte L): avisos y baja por 24 meses de inactividad
//   comm_detectar_cuentas_inactivas() (CORTE_L_MIGRACION.sql) devuelve, por cuenta, que accion
//   corresponde: 'aviso_30' o 'aviso_7' (mandar el correo real, mismo mecanismo de siempre) o
//   'eliminar' (ya se avisaron las dos veces y se cumplieron los 24 meses: ejecutar el borrado
//   real, igual que el paso 7). Acotado a plan='gratis' -- ver la nota de alcance en la cabecera
//   de CORTE_L_MIGRACION.sql: una cuenta que sigue pagando no se borra por "inactividad".
//
// PASO 9 (Corte L): limpieza de conversacion vencida (12 meses)
//   limpiar_conversaciones_vencidas() borra SOLO datos.borrador (la conversacion cruda) de los
//   organismos sin actividad hace mas de 12 meses -- la ficha, los principios, los hitos y el
//   horizonte (la memoria destilada) no se tocan. No dispara ningun correo, es sola limpieza.
//
// LIMITE DEL PLAN HOBBY DE VERCEL
//   Igual que api/latido.js: una corrida por dia como maximo. Para reconciliar timeouts de
//   arrendamiento (5 minutos, ver comm_transicionar_job) alcanza sobrado -- lo que importa es
//   que nada quede colgado para siempre, no la velocidad de la reconciliacion.
//
// COMO SE ACTIVA
//   1. Este archivo en api/comm-cron.js
//   2. La entrada correspondiente en vercel.json (`/api/comm-cron`, corrida diaria)
//   3. Opcional pero recomendado: la misma variable CRON_SECRET que ya usa api/latido.js

import { emitirYEnviarCorreo, obtenerEmailUsuario } from '../lib/comm-emitir.js';
import { eliminarCuentaCompleta } from '../lib/cuenta.js';
import { pasarelaDe } from '../lib/pasarela.js';
import { PLANES } from './catalogo.js';

const registrar = (o) => console.log(JSON.stringify({ evento: 'comm_cron', ...o }));

async function rpc(nombre, url, clave, parametros) {
  const r = await fetch(url + '/rest/v1/rpc/' + nombre, {
    method: 'POST',
    headers: { apikey: clave, Authorization: 'Bearer ' + clave, 'content-type': 'application/json' },
    body: JSON.stringify(parametros || {}),   // Corte M: parametros opcional -- todas las
                                               // llamadas anteriores seguian mandando '{}' via
                                               // el default, ningun llamador existente cambia
  });
  if (!r.ok) throw new Error(nombre + ' devolvio ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

// Corte L: el cron no tiene el token de nadie -- resuelve el email por Admin API a partir
// del id, para poder sacarlo de comm_closed_recipients (paso 5 de eliminarCuentaCompleta).
async function emailPorId(id, url, clave) {
  const r = await fetch(url + '/auth/v1/admin/users/' + id, {
    headers: { apikey: clave, Authorization: 'Bearer ' + clave },
  });
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  return d && d.email ? d.email : null;
}

export default async function handler(req, res) {
  const secreto = process.env.CRON_SECRET;
  if (secreto) {
    const cabecera = String(req.headers['authorization'] || '');
    if (cabecera !== 'Bearer ' + secreto) {
      return res.status(401).json({ error: 'No autorizado.' });
    }
  }

  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const clave = process.env.SUPABASE_SECRET_KEY;
  if (!url || !clave) {
    return res.status(500).json({ ok: false, error: 'Falta SUPABASE_URL o SUPABASE_SECRET_KEY.' });
  }

  const resultado = { evento: 'comm_cron' };
  let huboError = false;

  // orden importa en las cuatro:
  //  1. expirar vencidos ANTES de barrer -- un trabajo vencido no tiene que
  //     re-evaluarse como si siguiera vigente (Corte E: "vencidos no se recuperan").
  //  2. barrer programados -- reintenta CREATED/HELD cuyo notBefore ya llego.
  //  3. marcar inciertos ANTES de recuperar abandonados -- para que el intento de
  //     entrega quede con el motivo correcto (timeout, no rebote/error real).
  //  4. recuperar abandonados -- Corte A, mueve el trabajo a FAILED_RETRYABLE.
  try {
    resultado.trabajos_vencidos = await rpc('comm_expirar_vencidos', url, clave);
  } catch (e) {
    huboError = true;
    resultado.error_vencidos = String((e && e.message) || e);
  }

  try {
    resultado.trabajos_barridos = await rpc('comm_barrer_programados', url, clave);
  } catch (e) {
    huboError = true;
    resultado.error_barrido = String((e && e.message) || e);
  }

  try {
    resultado.intentos_marcados_inciertos = await rpc('comm_marcar_intentos_inciertos_por_abandono', url, clave);
  } catch (e) {
    huboError = true;
    resultado.error_inciertos = String((e && e.message) || e);
  }

  try {
    resultado.trabajos_recuperados = await rpc('comm_recuperar_abandonados', url, clave);
  } catch (e) {
    huboError = true;
    resultado.error_recuperar = String((e && e.message) || e);
  }

  // 5. Corte I — organismos pendientes: el unico paso de este archivo que SI dispara
  //    un envio real (los otros cuatro solo reconcilian estado). Se aisla fila por fila:
  //    que un organismo falle (email no resuelto, Brevo caido, lo que sea) no puede
  //    tirar abajo la reconciliacion de los otros cuatro pasos ni el resto de la lista.
  try {
    const candidatos = await rpc('comm_detectar_organismos_pendientes', url, clave);
    const lista = Array.isArray(candidatos) ? candidatos : [];
    let enviados = 0, omitidos = 0, fallidos = 0;

    for (const fila of lista) {
      try {
        const email = await obtenerEmailUsuario(fila.perfil, url, clave);
        if (!email) { omitidos++; continue; }

        // ficha.proximos viaja como string "item 1;;item 2" (ver nota de formato en
        // CORTE_I_MIGRACION.sql) -- se separa aca, no antes, para que el resto del
        // recorrido (payload, dedup en comm_events) siga guardando el string tal cual.
        const items = (typeof fila.proximos === 'string' ? fila.proximos : '')
          .split(';;').map((t) => t.trim()).filter(Boolean);
        if (!items.length) { omitidos++; continue; }

        // Copy revisado con Javier (05/08): evitar lenguaje de deuda/error ("sin resolver"),
        // orientar a continuar, y el boton lleva directo al organismo puntual -- no al
        // panel general -- via el deep link que index.html ya sabe leer (?organismo=<id>).
        const nombreOrg = fila.nombre || 'tu organismo';
        const lineas = items.map((t) => '<li>' + String(t) + '</li>').join('');
        const asunto = `Tu análisis de "${nombreOrg}" quedó pendiente`;
        const linkOrganismo = 'https://app.comprenderai.com/?organismo=' + encodeURIComponent(fila.organismo_id);
        const contenido =
          '<p>Hola,</p>' +
          `<p>Tu análisis de <strong>${nombreOrg}</strong> quedó pendiente. Estos son los puntos que todavía necesitan atención:</p>` +
          `<ul>${lineas}</ul>` +
          '<p>Podés retomarlo cuando quieras. Todo lo que avanzaste sigue guardado.</p>' +
          `<p><a href="${linkOrganismo}">Continuar el análisis</a></p>` +
          '<p style="color:#888;font-size:12px">Comprender AI<br>Producto de ARQUIGÉNESIS</p>';

        const r = await emitirYEnviarCorreo({
          SB_URL: url, SERVICE_KEY: clave,
          organizationId: fila.perfil, purposeId: 'organismo_pendiente', type: 'organismo.pendiente',
          producer: 'organismos_pendientes',
          payload: { organismo_id: fila.organismo_id, proximos: fila.proximos },
          destinatario: email, asunto, contenidoHtml: contenido,
        });
        if (r && r.enviado) enviados++; else omitidos++;
      } catch (eFila) {
        fallidos++;
        registrar({ error: 'fallo_fila_organismo_pendiente', organismo_id: fila && fila.organismo_id, detalle: String((eFila && eFila.message) || eFila) });
      }
    }

    resultado.organismos_pendientes = { candidatos: lista.length, enviados, omitidos, fallidos };
  } catch (e) {
    huboError = true;
    resultado.error_organismos_pendientes = String((e && e.message) || e);
  }

  // 6. Corte J — horizonte de continuidad: mismo patron de aislamiento fila por fila
  //    que el paso 5. Tono de reconocimiento, no de urgencia -- ver nota arriba.
  try {
    const candidatos = await rpc('comm_detectar_horizontes_pendientes', url, clave);
    const lista = Array.isArray(candidatos) ? candidatos : [];
    let enviados = 0, omitidos = 0, fallidos = 0;

    for (const fila of lista) {
      try {
        const email = await obtenerEmailUsuario(fila.perfil, url, clave);
        if (!email) { omitidos++; continue; }

        // fila.horizonte viaja como el objeto jsonb tal cual lo guarda index.html
        // (aplicarPropuesta) -- no se reinterpreta aca, solo se lee.
        const h = fila.horizonte && typeof fila.horizonte === 'object' ? fila.horizonte : {};
        if (!h.observar && !h.pregunta) { omitidos++; continue; }

        const nombreOrg = fila.nombre || 'tu organismo';
        const etapa = fila.etapa || 'una etapa';
        const linkOrganismo = 'https://app.comprenderai.com/?organismo=' + encodeURIComponent(fila.organismo_id);

        // Tono de reconocimiento (no de deuda ni urgencia): primero el cierre, despues
        // la invitacion a lo que se abrio -- nunca mezclados, igual que en la UI
        // (cardCierreEtapa antes de cardHorizonte). El horizonte se muestra completo
        // (decision de Javier: gratis la comprension, el plan paga la profundizacion),
        // asi que el correo no recorta preguntas detras de un paywall.
        const puntos = [];
        if (h.observar) puntos.push('<li><strong>Qué observar:</strong> ' + String(h.observar) + '</li>');
        if (h.pregunta) puntos.push('<li><strong>Nueva pregunta:</strong> ' + String(h.pregunta) + '</li>');
        if (h.relacion) puntos.push('<li><strong>Relación a profundizar:</strong> ' + String(h.relacion) + '</li>');

        const asunto = `Tu análisis de "${nombreOrg}" completó una etapa`;
        const contenido =
          '<p>Hola,</p>' +
          `<p>Tu análisis de <strong>${nombreOrg}</strong> llegó a un cierre: completaste "${etapa}".</p>` +
          '<p>A partir de ahí se abrió esto para seguir mirando:</p>' +
          `<ul>${puntos.join('')}</ul>` +
          '<p>Podés verlo completo cuando quieras. Nada se pierde ni se vence.</p>' +
          `<p><a href="${linkOrganismo}">Ver qué sigue</a></p>` +
          '<p style="color:#888;font-size:12px">Comprender AI<br>Producto de ARQUIGÉNESIS</p>';

        const r = await emitirYEnviarCorreo({
          SB_URL: url, SERVICE_KEY: clave,
          organizationId: fila.perfil, purposeId: 'organismo_horizonte', type: 'organismo.horizonte',
          producer: 'organismos_horizonte',
          payload: { organismo_id: fila.organismo_id, etapa: fila.etapa },
          destinatario: email, asunto, contenidoHtml: contenido,
        });
        if (r && r.enviado) enviados++; else omitidos++;
      } catch (eFila) {
        fallidos++;
        registrar({ error: 'fallo_fila_organismo_horizonte', organismo_id: fila && fila.organismo_id, detalle: String((eFila && eFila.message) || eFila) });
      }
    }

    resultado.organismos_horizonte = { candidatos: lista.length, enviados, omitidos, fallidos };
  } catch (e) {
    huboError = true;
    resultado.error_organismos_horizonte = String((e && e.message) || e);
  }

  // 7. Corte L — ejecutar bajas de cuenta ya programadas (periodo de 7 dias cumplido).
  try {
    const rVencidas = await fetch(
      url + '/rest/v1/perfiles?baja_programada=not.is.null&baja_programada=lte.' +
        encodeURIComponent(new Date().toISOString()) + '&select=id',
      { headers: { apikey: clave, Authorization: 'Bearer ' + clave } }
    );
    if (!rVencidas.ok) throw new Error('listar bajas_programadas devolvio ' + rVencidas.status);
    const lista = await rVencidas.json();
    let ejecutadas = 0, fallidas = 0;

    for (const fila of lista) {
      try {
        const email = await emailPorId(fila.id, url, clave);
        const r = await eliminarCuentaCompleta({ id: fila.id, email, SB_URL: url, SERVICE_KEY: clave });
        if (r.ok) ejecutadas++; else { fallidas++; registrar({ error: 'fallo_baja_programada', perfil: fila.id, motivo: r.motivo }); }
      } catch (eFila) {
        fallidas++;
        registrar({ error: 'fallo_fila_baja_programada', perfil: fila && fila.id, detalle: String((eFila && eFila.message) || eFila) });
      }
    }

    resultado.bajas_programadas = { candidatos: lista.length, ejecutadas, fallidas };
  } catch (e) {
    huboError = true;
    resultado.error_bajas_programadas = String((e && e.message) || e);
  }

  // 8. Corte L — cuentas inactivas: avisos a los 30/7 dias antes de los 24 meses, y la
  //    eliminacion real cuando ya se avisaron las dos veces y el plazo se cumplio.
  try {
    const candidatos = await rpc('comm_detectar_cuentas_inactivas', url, clave);
    const lista = Array.isArray(candidatos) ? candidatos : [];
    let avisos = 0, eliminadas = 0, omitidos = 0, fallidos = 0;

    for (const fila of lista) {
      try {
        if (fila.accion === 'eliminar') {
          const email = await emailPorId(fila.perfil, url, clave);
          const r = await eliminarCuentaCompleta({ id: fila.perfil, email, SB_URL: url, SERVICE_KEY: clave });
          if (r.ok) eliminadas++; else { fallidos++; registrar({ error: 'fallo_eliminar_cuenta_inactiva', perfil: fila.perfil, motivo: r.motivo }); }
          continue;
        }

        // aviso_30 / aviso_7: correo real, mismo mecanismo que organismos_pendientes/horizonte.
        const email = await obtenerEmailUsuario(fila.perfil, url, clave);
        if (!email) { omitidos++; continue; }

        const esUltimoAviso = fila.accion === 'aviso_7';
        const asunto = esUltimoAviso
          ? 'Tu cuenta de Comprender AI se elimina en 7 días por inactividad'
          : 'Tu cuenta de Comprender AI lleva mucho tiempo inactiva';
        const contenido =
          '<p>Hola,</p>' +
          `<p>Tu cuenta no tuvo actividad en casi dos años. ${esUltimoAviso ? 'En 7 días' : 'En 30 días'}, si seguís sin volver, se eliminará junto con los organismos guardados.</p>` +
          '<p>Para conservarla alcanza con ingresar y usarla con normalidad.</p>' +
          '<p><a href="https://app.comprenderai.com/">Ingresar a Comprender AI</a></p>' +
          '<p style="color:#888;font-size:12px">Comprender AI<br>Producto de ARQUIGÉNESIS</p>';

        const r = await emitirYEnviarCorreo({
          SB_URL: url, SERVICE_KEY: clave,
          organizationId: fila.perfil, purposeId: 'cuenta_inactiva_aviso', type: 'cuenta.inactiva_aviso',
          producer: 'cuentas_inactivas',
          payload: { tipo: fila.accion },
          destinatario: email, asunto, contenidoHtml: contenido,
        });
        if (r && r.enviado) avisos++; else omitidos++;
      } catch (eFila) {
        fallidos++;
        registrar({ error: 'fallo_fila_cuenta_inactiva', perfil: fila && fila.perfil, detalle: String((eFila && eFila.message) || eFila) });
      }
    }

    resultado.cuentas_inactivas = { candidatos: lista.length, avisos, eliminadas, omitidos, fallidos };
  } catch (e) {
    huboError = true;
    resultado.error_cuentas_inactivas = String((e && e.message) || e);
  }

  // 9. Corte L — limpieza de conversacion vencida (12 meses). No dispara correo, es limpieza pura.
  try {
    resultado.conversaciones_limpiadas = await rpc('limpiar_conversaciones_vencidas', url, clave);
  } catch (e) {
    huboError = true;
    resultado.error_conversaciones_limpiadas = String((e && e.message) || e);
  }

  // 10. Corte M — aplicar downgrades de plan ya vencidos (Encargo 115 AG, bloque 4.2).
  //     api/cambiar-plan.js solo ANOTA perfiles.plan_pendiente cuando el pedido es bajar de
  //     plan -- no toca la pasarela en ese momento (la baja no debe retirar de inmediato
  //     prestaciones ya pagadas). Este paso es el que de verdad la aplica, el dia que vence
  //     se cumple: actualiza el monto/variante en la pasarela para que el PROXIMO cobro ya
  //     sea el del plan nuevo, y acredita el plan nuevo en la base en el mismo momento --
  //     sin esperar a que un webhook de renovacion llegue (podria no coincidir exacto con
  //     nuestro `vence`), mismo criterio que el credito inmediato del upgrade.
  try {
    const candidatos = await rpc('comm_detectar_downgrades_vencidos', url, clave);
    const lista = Array.isArray(candidatos) ? candidatos : [];
    let aplicados = 0, fallidos = 0;

    for (const fila of lista) {
      try {
        const planNuevo = PLANES[fila.plan_pendiente];
        if (!planNuevo) { fallidos++; registrar({ error: 'downgrade_plan_pendiente_invalido', perfil: fila.perfil, plan_pendiente: fila.plan_pendiente }); continue; }

        const pasarela = await pasarelaDe(fila.perfil, url, clave);
        if (!pasarela) { fallidos++; registrar({ error: 'downgrade_pasarela_no_reconocida', perfil: fila.perfil }); continue; }

        if (pasarela === 'mercadopago') {
          const token = process.env.MP_ACCESS_TOKEN;
          if (!token) throw new Error('falta MP_ACCESS_TOKEN');
          const rPut = await fetch('https://api.mercadopago.com/preapproval/' + fila.suscripcion, {
            method: 'PUT',
            headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
            body: JSON.stringify({ reason: planNuevo.titulo, auto_recurring: { transaction_amount: planNuevo.monto } }),
          });
          if (!rPut.ok) throw new Error('mercadopago PUT preapproval devolvio ' + rPut.status);
        } else {
          const apiKey = process.env.LEMONSQUEEZY_API_KEY;
          if (!apiKey) throw new Error('falta LEMONSQUEEZY_API_KEY');
          if (!planNuevo.ls_variant_id) throw new Error('plan sin ls_variant_id: ' + fila.plan_pendiente);
          const rPatch = await fetch('https://api.lemonsqueezy.com/v1/subscriptions/' + fila.suscripcion, {
            method: 'PATCH',
            headers: {
              Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json',
              Authorization: 'Bearer ' + apiKey,
            },
            body: JSON.stringify({
              data: {
                type: 'subscriptions', id: String(fila.suscripcion),
                // invoice_immediately:false a proposito -- el downgrade no debe generar un
                // cobro extra hoy, el cambio de monto rige desde la proxima factura sola.
                attributes: { variant_id: planNuevo.ls_variant_id, invoice_immediately: false },
              },
            }),
          });
          if (!rPatch.ok) throw new Error('lemonsqueezy PATCH subscription devolvio ' + rPatch.status);
        }

        await rpc('cambiar_plan_credito_inmediato', url, clave, {
          p_perfil: fila.perfil, p_plan_nuevo: fila.plan_pendiente, p_direccion: 'downgrade', p_pasarela: pasarela,
        });
        aplicados++;
      } catch (eFila) {
        fallidos++;
        registrar({ error: 'fallo_fila_downgrade', perfil: fila && fila.perfil, detalle: String((eFila && eFila.message) || eFila) });
      }
    }

    resultado.downgrades_aplicados = { candidatos: lista.length, aplicados, fallidos };
  } catch (e) {
    huboError = true;
    resultado.error_downgrades = String((e && e.message) || e);
  }

  // 11. Corte W — limpieza de solicitudes_legales_intentos vencidos (90 dias). La migracion
  //     del Corte W (05/08) ya creo limpiar_intentos_solicitudes_vencidos() y decia en su
  //     comentario que se iba a conectar aca -- nunca se agrego el llamado. Se agrega ahora,
  //     de paso, al tocar este archivo para el Corte X (mismo criterio de aislamiento que el
  //     resto: no dispara correo, no puede tirar abajo nada mas).
  try {
    resultado.intentos_solicitudes_limpiados = await rpc('limpiar_intentos_solicitudes_vencidos', url, clave);
  } catch (e) {
    huboError = true;
    resultado.error_intentos_solicitudes_limpiados = String((e && e.message) || e);
  }

  // 12. Corte X — limpieza de comm_events vencidos segun la politica de retencion por
  //     categoria (evidencia legal: 5 anios: decision de Javier 05/08 -- telemetria
  //     operativa: 180 dias -- pruebas internas: 30 dias). No dispara correo, es limpieza
  //     pura. Ver CORTE_X_POLITICA_COMM_EVENTS.md.
  try {
    resultado.comm_events_limpiados = await rpc('limpiar_comm_events_vencidos', url, clave);
  } catch (e) {
    huboError = true;
    resultado.error_comm_events_limpiados = String((e && e.message) || e);
  }

  console.log(JSON.stringify(resultado));
  return res.status(huboError ? 503 : 200).json(resultado);
}
