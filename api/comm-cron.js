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

const registrar = (o) => console.log(JSON.stringify({ evento: 'comm_cron', ...o }));

async function rpc(nombre, url, clave) {
  const r = await fetch(url + '/rest/v1/rpc/' + nombre, {
    method: 'POST',
    headers: { apikey: clave, Authorization: 'Bearer ' + clave, 'content-type': 'application/json' },
    body: '{}',
  });
  if (!r.ok) throw new Error(nombre + ' devolvio ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
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

        const nombreOrg = fila.nombre || 'tu organismo';
        const lineas = items.map((t) => '<li>' + String(t) + '</li>').join('');
        const asunto = `"${nombreOrg}" quedó con algo pendiente`;
        const contenido =
          '<p>Hola,</p>' +
          `<p>Tu organismo <strong>${nombreOrg}</strong> quedó con esto sin resolver:</p>` +
          `<ul>${lineas}</ul>` +
          '<p><a href="https://app.comprenderai.com">Volver a Comprender AI</a></p>';

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

  console.log(JSON.stringify(resultado));
  return res.status(huboError ? 503 : 200).json(resultado);
}
