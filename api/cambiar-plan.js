// api/cambiar-plan.js — Cambio de plan real para una cuenta ya suscripta (Corte M)
// ---------------------------------------------------------------------------------------------
// QUE HACE
//   Hasta el Corte M, "cambiar de plan" no existia: api/suscribir.js siempre armaba una
//   suscripcion NUEVA, sin mirar si ya habia una activa (ver el freno agregado en el mismo
//   Corte para cortar ese riesgo mientras esto no existia). Este archivo es el cambio de
//   plan de verdad, sobre la MISMA suscripcion:
//
//   UPGRADE (plan nuevo > plan actual) — Decision de Javier (encargo 115 AG, bloque 4.2):
//     Mercado Pago:    PUT /preapproval/:id con el monto nuevo. Eso solo rige para el
//                       PROXIMO cobro automatico -- no cobra la diferencia ahora. Aun asi,
//                       Javier eligio otorgar el credito del plan nuevo de inmediato
//                       (cambiar_plan_credito_inmediato, sin esperar a que ese cobro mayor
//                       se efectivice). vence NO se toca -- ver la nota en CORTE_M_MIGRACION.sql.
//     Lemon Squeezy:    PATCH /subscriptions/:id con variant_id nuevo e invoice_immediately:
//                       true -- LS SI cobra la diferencia prorrateada al toque. El credito
//                       se otorga solo, por el webhook normal (subscription_payment_success
//                       con billing_reason != 'initial'), sin llamar a ninguna funcion nueva
//                       desde aca: es el mismo camino que ya usa una renovacion cualquiera.
//
//   DOWNGRADE (plan nuevo < plan actual) — mismo bloque del encargo:
//     No se toca la pasarela todavia. Se anota perfiles.plan_pendiente (programar_downgrade)
//     y api/comm-cron.js lo aplica de verdad el dia que el ciclo ya pagado (vence) se cumple.
//
// LO QUE ESTE ARCHIVO NO HACE
//   No cambia de pasarela (Mercado Pago <-> Lemon Squeezy): el catalogo tiene un plan por
//   pasarela distinto (variant_id vs preapproval), cambiar de pasarela a mitad de suscripcion
//   es en la practica dar de baja y volver a alta, fuera de alcance de "cambiar de plan".
//   No admite pasar a 'gratis' -- eso es cancelar la suscripcion (circuito distinto, ver
//   bloque 4.4 del encargo), no un cambio de plan.
//
// VARIABLES DE ENTORNO
//   MP_ACCESS_TOKEN · LEMONSQUEEZY_API_KEY · SUPABASE_URL · SUPABASE_SECRET_KEY   (ya cargadas)

import { PLANES } from './catalogo.js';
import { pasarelaDe } from '../lib/pasarela.js';

// Mismo orden que nivel_plan() en Postgres (gratis=0, profesional=1, estudio=2, magister=3).
// Si se agrega un plan nuevo hay que tocar los dos lugares -- mismo aviso que ya tiene
// catalogo.js sobre creditos_de()/nivel_plan().
const NIVEL = { profesional: 1, estudio: 2, magister: 3 };

const registrar = (o) => console.log(JSON.stringify({ evento: 'cambiar_plan', ...o }));

async function identificar(token) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const clave = process.env.SUPABASE_SECRET_KEY;
  const r = await fetch(base + '/auth/v1/user', {
    headers: { apikey: clave, Authorization: 'Bearer ' + token },
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d && d.id ? { id: d.id } : null;
}

async function rpc(nombre, cuerpo, SB_URL, SERVICE_KEY) {
  const r = await fetch(SB_URL + '/rest/v1/rpc/' + nombre, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) throw new Error('rpc ' + nombre + ' devolvio ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const d = await r.json();
  return Array.isArray(d) ? d[0] : d;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Metodo no permitido.' } });
  }

  const SB_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SB_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: { message: 'Falta configuracion en el servidor.' } });
  }

  const cabecera = String(req.headers['authorization'] || '');
  const sesion = cabecera.toLowerCase().startsWith('bearer ') ? cabecera.slice(7).trim() : '';
  if (!sesion) {
    return res.status(401).json({ error: { message: 'Inicia sesion para cambiar de plan.', codigo: 'sin_sesion' } });
  }

  let usuario;
  try { usuario = await identificar(sesion); } catch (e) {
    return res.status(503).json({ error: { message: 'El servicio no esta disponible. Volve a intentar.' } });
  }
  if (!usuario) {
    return res.status(401).json({ error: { message: 'Sesion vencida. Volve a iniciar sesion.', codigo: 'sesion_invalida' } });
  }

  let cuerpo = req.body;
  if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; } }
  const pedido = String((cuerpo && cuerpo.plan) || '').toLowerCase();
  const planNuevo = PLANES[pedido];
  if (!planNuevo || !NIVEL[pedido]) {
    return res.status(400).json({ error: { message: 'Plan invalido. Elegí profesional, estudio o magister.' } });
  }

  // --- Estado actual de la cuenta ---
  let perfil;
  try {
    const r = await fetch(
      SB_URL + '/rest/v1/perfiles?id=eq.' + usuario.id + '&select=plan,suscripcion,estado,vence',
      { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } }
    );
    const filas = r.ok ? await r.json().catch(() => []) : [];
    perfil = filas && filas[0];
  } catch (e) {
    return res.status(503).json({ error: { message: 'No se pudo leer tu cuenta. Volve a intentar.' } });
  }
  if (!perfil) {
    return res.status(404).json({ error: { message: 'No se encontró tu cuenta.' } });
  }
  if (!perfil.suscripcion || !NIVEL[perfil.plan] || !['activo', 'gracia'].includes(perfil.estado)) {
    return res.status(409).json({
      error: { message: 'No tenés un plan pago activo para cambiar. Elegí un plan desde cero.', codigo: 'sin_suscripcion_activa' },
    });
  }
  if (perfil.plan === pedido) {
    return res.status(409).json({ error: { message: 'Ya estás en ese plan.', codigo: 'mismo_plan' } });
  }

  const pasarela = await pasarelaDe(usuario.id, SB_URL, SERVICE_KEY).catch(() => null);
  if (!pasarela) {
    registrar({ error: 'pasarela_no_reconocida', perfil: usuario.id.slice(0, 8) });
    return res.status(409).json({
      error: { message: 'No pudimos identificar tu forma de pago. Escribinos a contacto@comprenderai.com.', codigo: 'pasarela_desconocida' },
    });
  }

  const esUpgrade = NIVEL[pedido] > NIVEL[perfil.plan];

  // ---------- DOWNGRADE: se programa, no se toca la pasarela todavia ----------
  if (!esUpgrade) {
    try {
      const r = await rpc('programar_downgrade', { p_perfil: usuario.id, p_plan_nuevo: pedido }, SB_URL, SERVICE_KEY);
      if (!r || !r.ok) {
        registrar({ accion: 'downgrade_rechazado', perfil: usuario.id.slice(0, 8), motivo: r && r.motivo });
        return res.status(409).json({ error: { message: 'No se pudo programar el cambio de plan.', codigo: r && r.motivo } });
      }
      registrar({ accion: 'downgrade_programado', perfil: usuario.id.slice(0, 8), plan_pendiente: pedido, vence: r.vence });
      return res.status(200).json({ ok: true, aplicado: 'programado', plan_pendiente: pedido, vence: r.vence });
    } catch (e) {
      registrar({ error: 'fallo_programar_downgrade', detalle: String((e && e.message) || e) });
      return res.status(502).json({ error: { message: 'No se pudo programar el cambio de plan. Volve a intentar.' } });
    }
  }

  // ---------- UPGRADE ----------
  if (pasarela === 'mercadopago') {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) return res.status(500).json({ error: { message: 'Falta configuracion en el servidor.' } });
    try {
      const rPut = await fetch('https://api.mercadopago.com/preapproval/' + perfil.suscripcion, {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ reason: planNuevo.titulo, auto_recurring: { transaction_amount: planNuevo.monto } }),
      });
      if (!rPut.ok) {
        const detalle = await rPut.json().catch(() => ({}));
        registrar({ error: 'MP RECHAZO EL CAMBIO', estado: rPut.status, detalle: JSON.stringify(detalle).slice(0, 400) });
        return res.status(502).json({ error: { message: 'No se pudo actualizar la suscripción en Mercado Pago. Volve a intentar.' } });
      }
    } catch (e) {
      registrar({ error: 'FALLO CONTACTANDO MP', detalle: String((e && e.message) || e) });
      return res.status(502).json({ error: { message: 'No se pudo contactar a Mercado Pago.' } });
    }

    try {
      const r = await rpc('cambiar_plan_credito_inmediato',
        { p_perfil: usuario.id, p_plan_nuevo: pedido, p_direccion: 'upgrade', p_pasarela: 'mercadopago' },
        SB_URL, SERVICE_KEY);
      registrar({ accion: 'upgrade_inmediato', perfil: usuario.id.slice(0, 8), plan: pedido, saldo: r && r.saldo });
      return res.status(200).json({ ok: true, aplicado: 'inmediato', plan: pedido, saldo: r && r.saldo });
    } catch (e) {
      // La pasarela YA se actualizo -- si esto falla, el proximo cobro va a llegar con el
      // monto nuevo y planPorMonto() lo va a reconocer igual (ver api/pago.js), autocorrigiendo
      // el credito en la proxima renovacion aunque el otorgamiento inmediato haya fallado acá.
      registrar({ error: 'fallo_acreditar_upgrade_tras_mp_ok', perfil: usuario.id.slice(0, 8), detalle: String((e && e.message) || e) });
      return res.status(502).json({
        error: { message: 'Tu plan se actualizó en Mercado Pago pero no pudimos acreditar los créditos todavía. Escribinos a contacto@comprenderai.com si no se resuelve solo.' },
      });
    }
  }

  // pasarela === 'lemonsqueezy'
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: 'Falta configuracion en el servidor.' } });
  if (!planNuevo.ls_variant_id) {
    return res.status(500).json({ error: { message: 'Ese plan no está disponible para pago internacional todavía.' } });
  }
  try {
    const rPatch = await fetch('https://api.lemonsqueezy.com/v1/subscriptions/' + perfil.suscripcion, {
      method: 'PATCH',
      headers: {
        Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        data: {
          type: 'subscriptions', id: String(perfil.suscripcion),
          attributes: { variant_id: planNuevo.ls_variant_id, invoice_immediately: true },
        },
      }),
    });
    if (!rPatch.ok) {
      const detalle = await rPatch.text().catch(() => '');
      registrar({ error: 'LS RECHAZO EL CAMBIO', estado: rPatch.status, detalle: detalle.slice(0, 400) });
      return res.status(502).json({ error: { message: 'No se pudo actualizar la suscripción en Lemon Squeezy. Volve a intentar.' } });
    }
  } catch (e) {
    registrar({ error: 'FALLO CONTACTANDO LS', detalle: String((e && e.message) || e) });
    return res.status(502).json({ error: { message: 'No se pudo contactar a Lemon Squeezy.' } });
  }

  // El credito se otorga solo: LS factura la diferencia ya (invoice_immediately) y eso
  // dispara subscription_payment_success con billing_reason != 'initial' -- api/lemonsqueezy.js
  // ya reconoce ese webhook y llama a activar() con el plan nuevo (planPorVariante), sin
  // ningun cambio ahi. No se llama a cambiar_plan_credito_inmediato desde aca: hacerlo
  // otorgaria el credito DOS veces (una acá, otra cuando el webhook real llegue).
  registrar({ accion: 'upgrade_facturando', perfil: usuario.id.slice(0, 8), plan: pedido });
  return res.status(200).json({
    ok: true, aplicado: 'facturando_diferencia',
    mensaje: 'Estamos procesando el cobro de la diferencia. Tu plan se actualiza apenas se confirme, normalmente en segundos.',
  });
}
