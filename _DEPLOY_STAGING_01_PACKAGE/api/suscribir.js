// api/suscribir.js — Alta nueva O cambio de plan, para el usuario en sesión
// ---------------------------------------------------------------------------------------------
// QUE HACE
//   1. Verifica la sesión de Supabase (el mismo token que usa el proxy).
//   2. Mira si la cuenta YA tiene una suscripción paga activa/en gracia.
//      - Si NO tiene: alta nueva -- crea un preapproval en Mercado Pago con
//        external_reference = id del usuario, devuelve el init_point (checkout).
//      - Si SÍ tiene: cambio de plan sobre la MISMA suscripcion (Corte M, absorbido acá el
//        05/08 -- ver la nota de "LIMITE DE FUNCIONES" más abajo). Upgrade o downgrade según
//        corresponda, en la pasarela que ya se sabe que usa (lib/pasarela.js).
//
// LIMITE DE FUNCIONES DE VERCEL (Hobby, 05/08)
//   Este archivo absorbió lo que hasta hoy vivía en api/cambiar-plan.js. No fue una decisión de
//   diseño -- el plan Hobby de Vercel tope a 12 Funciones Serverless por deployment, y agregar
//   cambiar-plan.js + cancelar-downgrade.js como archivos nuevos llevó el conteo a 14, rompiendo
//   el deploy. En vez de sumar planes/infraestructura sin que Javier lo decida, se consolidó: la
//   MISMA logica de cambiar-plan.js (que sigue intacta) ahora vive acá, servida bajo la MISMA
//   URL que ya usaba el alta nueva -- el cliente (candado.txt) ya no tiene que elegir a qué
//   endpoint llamar; este archivo decide solo, mirando el estado real de la cuenta.
//
// CONTRATO (dos formas de respuesta posibles, mismo endpoint)
//   Alta nueva:      200 { url, suscripcion }                        -- el cliente redirige
//   Cambio de plan:  200 { ok:true, aplicado:'inmediato'|'facturando_diferencia'|'programado', ... }
//   Error:           4xx/5xx { error: { message, codigo? } }
//
// POR QUE DEL LADO DEL SERVIDOR
//   El precio y el plan NO pueden venir del navegador: cualquiera podría pedir
//   Estudio por $1. El cliente manda sólo cuál plan quiere; el monto lo pone el
//   servidor desde catalogo.js.
//
// VARIABLES DE ENTORNO
//   MP_ACCESS_TOKEN · LEMONSQUEEZY_API_KEY · SUPABASE_URL · SUPABASE_SECRET_KEY   (ya cargadas)

import { PLANES, planContratable } from './catalogo.js';
import { pasarelaDe } from '../lib/pasarela.js';

const MP = 'https://api.mercadopago.com';
const VUELTA = 'https://app.comprenderai.com/?suscripcion=ok';

// Mismo orden que nivel_plan() en Postgres (gratis=0, profesional=1, estudio=2, magister=3).
const NIVEL = { profesional: 1, estudio: 2, magister: 3 };

const registrar = (o) => console.log(JSON.stringify({ evento: 'suscribir', ...o }));

async function identificar(token) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const clave = process.env.SUPABASE_SECRET_KEY;
  const r = await fetch(base + '/auth/v1/user', {
    headers: { apikey: clave, Authorization: 'Bearer ' + token },
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d && d.id ? { id: d.id, correo: d.email || '' } : null;
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

// ---------- Cambio de plan sobre una suscripcion existente (ex api/cambiar-plan.js) ----------
async function cambiarPlan(usuario, pedido, perfil, SB_URL, SERVICE_KEY, res) {
  const planNuevo = PLANES[pedido];
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
      const rPut = await fetch(MP + '/preapproval/' + perfil.suscripcion, {
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

  // El credito lo otorga el webhook normal (subscription_payment_success, billing_reason
  // != 'initial') -- ya reconocido por api/lemonsqueezy.js sin ningun cambio ahi. No se llama
  // a cambiar_plan_credito_inmediato desde aca: lo acreditaria dos veces.
  registrar({ accion: 'upgrade_facturando', perfil: usuario.id.slice(0, 8), plan: pedido });
  return res.status(200).json({
    ok: true, aplicado: 'facturando_diferencia',
    mensaje: 'Estamos procesando el cobro de la diferencia. Tu plan se actualiza apenas se confirme, normalmente en segundos.',
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Metodo no permitido.' } });
  }

  const SB_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!process.env.MP_ACCESS_TOKEN || !SB_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: { message: 'Falta configuracion en el servidor.' } });
  }

  // --- Sesión ---
  const cabecera = String(req.headers['authorization'] || '');
  const sesion = cabecera.toLowerCase().startsWith('bearer ') ? cabecera.slice(7).trim() : '';
  if (!sesion) {
    return res.status(401).json({ error: { message: 'Inicia sesion para suscribirte.', codigo: 'sin_sesion' } });
  }

  let usuario;
  try {
    usuario = await identificar(sesion);
  } catch (e) {
    return res.status(503).json({ error: { message: 'El servicio no esta disponible. Volve a intentar.' } });
  }
  if (!usuario) {
    return res.status(401).json({ error: { message: 'Sesion vencida. Volve a iniciar sesion.', codigo: 'sesion_invalida' } });
  }

  // --- Plan pedido ---
  let cuerpo = req.body;
  if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; } }
  const pedido = String((cuerpo && cuerpo.plan) || '').toLowerCase();
  // PLAN-C2A (26/08): un solo contrato de error para los tres casos que ya no deben poder
  // contratarse -- identificador desconocido, o un plan que existe en el catálogo pero ya no
  // es contratable (estudio/magister, retirados de la oferta pública, conservados sólo para
  // reconocer suscripciones y perfiles legacy). planContratable() ya cubre ambos casos (false
  // tanto si PLANES[pedido] no existe como si existe con contratable:false) -- ni un POST
  // directo a este endpoint puede armar una alta o un cambio de plan hacia Estudio/Magister.
  if (!planContratable(pedido)) {
    return res.status(400).json({
      error: { message: 'Ese plan no está disponible para contratación.', codigo: 'plan_no_contratable' },
    });
  }
  const plan = PLANES[pedido];

  // --- ¿Alta nueva o cambio de plan? Depende del estado real de la cuenta. ---
  let perfil = null;
  try {
    const rPerfil = await fetch(
      SB_URL + '/rest/v1/perfiles?id=eq.' + usuario.id + '&select=plan,suscripcion,estado',
      { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } }
    );
    const filas = rPerfil.ok ? await rPerfil.json().catch(() => []) : [];
    perfil = filas && filas[0];
  } catch (e) {
    registrar({ aviso: 'no se pudo leer el perfil antes de decidir alta/cambio, se trata como alta nueva', detalle: String((e && e.message) || e) });
  }

  const yaSuscripto = !!(perfil && perfil.suscripcion && perfil.plan !== 'gratis' && NIVEL[perfil.plan] &&
    (perfil.estado === 'activo' || perfil.estado === 'gracia'));

  if (yaSuscripto) {
    return cambiarPlan(usuario, pedido, perfil, SB_URL, SERVICE_KEY, res);
  }

  // --- Alta nueva: crear la suscripción en Mercado Pago ---
  // Sobre payer_email: lo sacamos el 24/07 porque con credenciales de prueba, si
  // el correo coincidía con la cuenta que cobra, el checkout se trababa. Pero el
  // 25/07 la API pasó a EXIGIRLO (rechaza con "payer_email is required"). Volvió,
  // entonces. Con vendedor real esto no da problema: el pagador puede ser
  // cualquier correo real. Lo que ata el pago al usuario sigue siendo
  // external_reference, no el correo.
  try {
    const r = await fetch(MP + '/preapproval', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.MP_ACCESS_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: plan.titulo,
        external_reference: usuario.id,      // ← lo que ata todo
        payer_email: usuario.correo,
        back_url: VUELTA,
        status: 'pending',
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: plan.monto,
          currency_id: 'ARS',
        },
      }),
    });

    const d = await r.json();

    if (!r.ok || !d.init_point) {
      registrar({ error: 'MP RECHAZO LA SUSCRIPCION', estado: r.status, detalle: JSON.stringify(d).slice(0, 400) });
      return res.status(502).json({
        error: { message: 'No se pudo iniciar la suscripcion. Volve a intentar en unos minutos.' },
      });
    }

    registrar({ accion: 'creada', perfil: usuario.id.slice(0, 8), plan: pedido, suscripcion: d.id });

    return res.status(200).json({ url: d.init_point, suscripcion: d.id });

  } catch (e) {
    registrar({ error: 'FALLO CREANDO', detalle: String((e && e.message) || e) });
    return res.status(502).json({ error: { message: 'No se pudo contactar a Mercado Pago.' } });
  }
}
