// api/lemonsqueezy.js — Adaptador internacional (Corte B.6), Lemon Squeezy como Merchant of Record
// ---------------------------------------------------------------------------------------------
// QUE HACE
//   Recibe los webhooks de Lemon Squeezy, verifica su firma, y traduce sus eventos a las MISMAS
//   funciones internas que ya usa Mercado Pago: activar() / cancelar() / marcar_gracia() /
//   pausar() / reanudar(). Ningun estado ni identificador propio de Lemon Squeezy entra al
//   dominio interno -- coincide con §7.1/§7.3 del documento maestro: "ninguna regla comercial
//   central debe depender directamente de nombres, estados o identificadores propios de un
//   proveedor". Este archivo es el unico lugar que conoce el vocabulario de Lemon Squeezy.
//
// POR QUE SE VUELVE A CONSULTAR LA API (igual que pago.js con Mercado Pago)
//   La firma certifica que el aviso vino de Lemon Squeezy, pero antes de actuar se pide el
//   objeto actualizado con la API (Bearer token, que solo tenemos nosotros) y se actua sobre
//   esa respuesta. Cuesta un llamado de red mas; evita actuar sobre un payload que, aunque
//   firmado, podria quedar desactualizado si dos webhooks llegan fuera de orden.
//
// IDENTIDAD: COMO SE SABE DE QUIEN ES LA SUSCRIPCION
//   Lemon Squeezy no conoce el uuid de perfiles. Por eso el checkout tiene que armarse siempre
//   con el dato personalizado `checkout[custom][perfil]` = el uuid de la cuenta (ver "Passing
//   Custom Data" en la documentacion de Lemon Squeezy). Ese dato vuelve en TODOS los webhooks
//   de Order, Subscription y License Key relacionados, dentro de `meta.custom_data.perfil`.
//   Sin ese dato en el checkout, el webhook llega sin forma de saber a que cuenta corresponde
//   -- se registra como huerfano y no se procesa (mismo criterio que "PAGO SIN
//   external_reference" en pago.js).
//
// EVENTOS QUE SE ATIENDEN Y A DONDE VAN
//   subscription_created            -> activar() -- primera acreditacion del ciclo
//   subscription_payment_success    -> activar() -- cada renovacion exitosa vuelve a acreditar
//   subscription_payment_recovered  -> activar() -- se recupero un cobro que habia fallado
//   subscription_payment_failed     -> marcar_gracia(5) -- mismo plazo que ya usa Mercado Pago
//   subscription_cancelled          -> cancelar() -- sigue activa hasta ends_at, sin renovar
//   subscription_paused             -> pausar() -- nuevo (03/08): hace real el estado 'pausada'
//                                       que reservar() ya reconocia pero que nadie asignaba
//   subscription_unpaused           -> reanudar()
//   subscription_resumed            -> reanudar() -- se deshizo una cancelacion antes de ends_at
//   subscription_expired            -> no se toca nada aca: se deja que caducar() (cron diario)
//                                       la baje a gratis, igual tolerancia que Mercado Pago hoy
//   subscription_updated, order_*, subscription_payment_refunded, license_key_*
//                                    -> se registran pero no accionan (ver "LO QUE FALTA")
//
// LO QUE FALTA (a proposito, mismo alcance que el adaptador de Mercado Pago hoy)
//   No hay manejo de reembolso/contracargo todavia (order_refunded, subscription_payment_
//   refunded): se registran en el log para revision manual. pago.js tampoco lo tiene resuelto
//   para Mercado Pago -- es la misma brecha en los dos adaptadores, no una carencia nueva de
//   este. Cuando se resuelva, deberia resolverse para ambos con la misma funcion interna.
//
// VARIABLES DE ENTORNO EN VERCEL (nuevas)
//   LEMONSQUEEZY_API_KEY          token de API (Settings -> API en el dashboard de LS)
//   LEMONSQUEEZY_WEBHOOK_SECRET   el secreto que elijas al crear el webhook en LS
//   SUPABASE_URL / SUPABASE_SECRET_KEY   (ya cargadas, se reusan)
//
// LO QUE FALTA COMPLETAR ANTES DE QUE ESTO FUNCIONE DE VERDAD
//   1. Crear los 3 productos/variantes en Lemon Squeezy (Profesional/Estudio/Magister) y
//      completar `ls_variant_id` en catalogo.js con los ids reales.
//   2. Configurar el webhook en el dashboard de Lemon Squeezy apuntando a
//      https://app.comprenderai.com/api/lemonsqueezy, eventos: subscription_created,
//      subscription_updated, subscription_cancelled, subscription_resumed,
//      subscription_expired, subscription_paused, subscription_unpaused,
//      subscription_payment_success, subscription_payment_failed,
//      subscription_payment_recovered, subscription_payment_refunded, order_refunded.
//   3. El boton "Suscribirme" para el mercado internacional todavia no esta armado -- depende
//      de los variant_id del punto 1. Queda para el proximo paso, ya con esos datos.
//
// SIEMPRE RESPONDE 200 (salvo firma invalida) -- mismo motivo que pago.js: devolver error hace
// que Lemon Squeezy reintente en bucle algo que no se va a arreglar solo.
//
// FORMATO DE FUNCION: "Web standard" (Request/Response), no (req,res) como el resto de api/*.js
//   Se probo primero con el (req,res) clasico + `config.api.bodyParser=false`, pensado para leer
//   el cuerpo crudo a mano (imprescindible para el HMAC: hay que hashear los bytes exactos que
//   mando Lemon Squeezy, no una version ya interpretada). En la prueba real (03/08) la firma
//   nunca coincidio -- la documentacion actual de Vercel ya no describe esa via para /api y en
//   cambio recomienda `await request.text()` sobre un Request estandar para este caso puntual.
//   Por eso ESTE archivo exporta `POST(request)` en vez de `export default function(req,res)`;
//   es la unica excepcion en el proyecto, y es asi porque este es el unico endpoint que necesita
//   el cuerpo crudo byte a byte para verificar una firma.

import crypto from 'crypto';
import { planPorVariante } from './catalogo.js';

const LS_API = 'https://api.lemonsqueezy.com/v1';

const registrar = (o) => console.log(JSON.stringify({ evento: 'lemonsqueezy', ...o }));

function firmaValida(crudo, cabecera, secreto) {
  if (!secreto) return null;               // null = no configurado todavia
  if (!cabecera) return false;
  const hmac = crypto.createHmac('sha256', secreto);
  const digest = Buffer.from(hmac.update(crudo).digest('hex'), 'utf8');
  const firma = Buffer.from(cabecera, 'utf8');
  return digest.length === firma.length && crypto.timingSafeEqual(digest, firma);
}

async function lsGet(ruta, token) {
  const r = await fetch(LS_API + ruta, {
    headers: {
      Accept: 'application/vnd.api+json',
      Authorization: 'Bearer ' + token,
    },
  });
  if (!r.ok) throw new Error('lemonsqueezy ' + ruta + ' devolvio ' + r.status);
  return r.json();
}

async function rpc(nombre, cuerpo) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const clave = process.env.SUPABASE_SECRET_KEY;
  const r = await fetch(base + '/rest/v1/rpc/' + nombre, {
    method: 'POST',
    headers: { apikey: clave, Authorization: 'Bearer ' + clave, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) throw new Error('rpc ' + nombre + ' devolvio ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const d = await r.json();
  return Array.isArray(d) ? d[0] : d;
}

export async function POST(request) {
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  const secreto = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

  // request.text() da los bytes exactos del cuerpo -- imprescindible para que el HMAC
  // calculado aca coincida con el que mando Lemon Squeezy. Ver nota de cabecera del archivo.
  const crudo = await request.text();
  const cabeceraFirma = request.headers.get('x-signature') || '';

  const ok = firmaValida(crudo, cabeceraFirma, secreto);
  if (ok === false) {
    registrar({ error: 'FIRMA INVALIDA', ip: request.headers.get('x-forwarded-for') || '' });
    return Response.json({ error: 'Firma invalida.' }, { status: 401 });
  }
  if (ok === null) {
    registrar({ aviso: 'SIN LEMONSQUEEZY_WEBHOOK_SECRET — notificacion sin verificar' });
  }

  let cuerpo;
  try { cuerpo = JSON.parse(crudo); } catch (e) {
    registrar({ error: 'cuerpo no es JSON valido' });
    return Response.json({ ok: true });
  }

  const evento = String((cuerpo.meta && cuerpo.meta.event_name) || '');
  const perfil = (cuerpo.meta && cuerpo.meta.custom_data && cuerpo.meta.custom_data.perfil) || null;
  const tipoDato = (cuerpo.data && cuerpo.data.type) || '';
  const idDato = (cuerpo.data && cuerpo.data.id) || '';

  registrar({ accion: 'recibido', evento: evento || '(sin evento)', tipoDato, idDato, tienePerfil: !!perfil });

  if (!evento) { registrar({ aviso: 'sin event_name' }); return Response.json({ ok: true }); }

  if (!perfil) {
    // Sin custom_data.perfil no hay forma de saber a que cuenta corresponde -- mismo
    // criterio que "PAGO SIN external_reference" en pago.js: se registra, no se procesa.
    registrar({ error: 'WEBHOOK SIN perfil (custom_data)', evento, idDato });
    return Response.json({ ok: true });
  }

  try {
    // Eventos de suscripcion: siempre conviene volver a pedir el objeto actual, no fiarse
    // del payload aunque este firmado (ver comentario de cabecera del archivo).
    const esEventoSuscripcion = evento.indexOf('subscription_') === 0 && evento !== 'subscription_payment_refunded';
    const esEventoPago = evento === 'subscription_payment_success'
                      || evento === 'subscription_payment_failed'
                      || evento === 'subscription_payment_recovered';

    if (esEventoPago) {
      // Estos webhooks traen un Subscription Invoice, no la Subscription en si -- hay que
      // volver a pedir la Subscription con su subscription_id para saber la variante/plan.
      const invoiceId = idDato;
      const subId = cuerpo.data && cuerpo.data.attributes && cuerpo.data.attributes.subscription_id;
      if (!apiKey) throw new Error('falta LEMONSQUEEZY_API_KEY');
      const subResp = await lsGet('/subscriptions/' + subId, apiKey);
      const sub = subResp.data.attributes;
      const plan = planPorVariante(sub.variant_id);

      if (evento === 'subscription_payment_failed') {
        const r = await rpc('marcar_gracia', { p_perfil: perfil, p_dias: 5 });
        registrar({ accion: 'gracia', perfil: String(perfil).slice(0, 8), vence: r?.vence, subId });
      } else {
        // payment_success o payment_recovered: renovacion exitosa, se vuelve a acreditar.
        if (!plan) {
          registrar({ error: 'VARIANTE NO RECONOCIDA', variant_id: sub.variant_id, perfil: String(perfil).slice(0, 8) });
          return Response.json({ ok: true });
        }
        const r = await rpc('activar', {
          p_perfil: perfil, p_plan: plan,
          p_suscripcion: String(subId), p_pago_externo: 'ls_inv_' + invoiceId,
          p_monto: null, p_moneda: 'USD', p_dias: 30, p_bruto: cuerpo,
        });
        registrar({
          accion: r?.repetido ? 'repetido' : 'activado', perfil: String(perfil).slice(0, 8),
          plan, saldo: r?.saldo, invoiceId, evento,
        });
      }
      return Response.json({ ok: true });
    }

    if (esEventoSuscripcion) {
      if (!apiKey) throw new Error('falta LEMONSQUEEZY_API_KEY');
      const subResp = await lsGet('/subscriptions/' + idDato, apiKey);
      const sub = subResp.data.attributes;
      const plan = planPorVariante(sub.variant_id);

      if (evento === 'subscription_created') {
        if (!plan) {
          registrar({ error: 'VARIANTE NO RECONOCIDA', variant_id: sub.variant_id, perfil: String(perfil).slice(0, 8) });
          return Response.json({ ok: true });
        }
        const r = await rpc('activar', {
          p_perfil: perfil, p_plan: plan,
          p_suscripcion: String(idDato), p_pago_externo: 'ls_sub_' + idDato,
          p_monto: null, p_moneda: 'USD', p_dias: 30, p_bruto: cuerpo,
        });
        registrar({ accion: r?.repetido ? 'repetido' : 'activado', perfil: String(perfil).slice(0, 8), plan, saldo: r?.saldo });

      } else if (evento === 'subscription_cancelled') {
        const r = await rpc('cancelar', { p_perfil: perfil });
        registrar({ accion: 'cancelada', perfil: String(perfil).slice(0, 8), estado: r?.estado });

      } else if (evento === 'subscription_paused') {
        const r = await rpc('pausar', { p_perfil: perfil });
        registrar({ accion: 'pausada', perfil: String(perfil).slice(0, 8), estado: r?.estado });

      } else if (evento === 'subscription_unpaused' || evento === 'subscription_resumed') {
        const r = await rpc('reanudar', { p_perfil: perfil });
        registrar({ accion: 'reanudada', perfil: String(perfil).slice(0, 8), estado: r?.estado });

      } else if (evento === 'subscription_expired') {
        // No se toca nada: caducar() (cron diario) la baja a gratis cuando corresponda,
        // misma tolerancia que Mercado Pago hoy. Se registra para tener el rastro.
        registrar({ accion: 'expirada_sin_accion_inmediata', perfil: String(perfil).slice(0, 8) });

      } else {
        // subscription_updated y cualquier otro: catch-all informativo, sin accion.
        registrar({ accion: 'suscripcion_estado_sin_accion', evento, estado: sub.status, perfil: String(perfil).slice(0, 8) });
      }
      return Response.json({ ok: true });
    }

    // order_refunded, subscription_payment_refunded, license_key_*, etc.: se registran para
    // revision manual. Ver "LO QUE FALTA" en la cabecera del archivo.
    registrar({ aviso: 'evento sin manejo automatico todavia', evento, perfil: String(perfil).slice(0, 8) });
    return Response.json({ ok: true });

  } catch (e) {
    registrar({ error: 'FALLO PROCESANDO', evento, detalle: String((e && e.message) || e) });
    return Response.json({ ok: false });
  }
}
