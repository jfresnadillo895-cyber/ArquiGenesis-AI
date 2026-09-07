// api/pago.js — Recibe las notificaciones de Mercado Pago y acredita en la base
// ---------------------------------------------------------------------------------------------
// QUE HACE
//   1. Verifica que la notificacion venga REALMENTE de Mercado Pago (firma HMAC).
//   2. Vuelve a consultarle a Mercado Pago el estado real del recurso.
//   3. Si el pago esta aprobado, activa el plan y repone los creditos.
//
// POR QUE EL PASO 2 NO SE SALTEA
//   La notificacion trae poco mas que un ID. Confiar en su contenido seria confiar en
//   datos que llegan de afuera. Se consulta la API con el Access Token —que solo tenemos
//   nosotros— y se cree en esa respuesta, no en el aviso.
//
// IDEMPOTENCIA
//   Mercado Pago REINTENTA las notificaciones. La misma puede llegar tres veces.
//   La proteccion no esta aca sino en la base: `pagos.pago_externo` es UNIQUE y
//   activar() devuelve repetido=true sin reponer. Aca solo se registra.
//
// VARIABLES DE ENTORNO EN VERCEL
//   MP_ACCESS_TOKEN    APP_USR-...   (secreto · empezar con el de PRUEBA)
//   MP_WEBHOOK_SECRET  la clave de firma que da el panel al configurar el webhook
//   SUPABASE_URL / SUPABASE_SECRET_KEY   (ya cargadas)
//
// URL A CONFIGURAR EN MERCADO PAGO
//   https://app.comprenderai.com/api/pago
//   Topicos: payments · subscription_preapproval · subscription_authorized_payment
//
// SIEMPRE RESPONDE 200
//   Salvo firma invalida. Si devolvemos error, Mercado Pago reintenta en bucle por algo
//   que no se va a arreglar solo. Los problemas se registran y se miran en los logs.
//
// UMBRALES · CATALOGO CENTRALIZADO (01/08)
//   planPorMonto() ya no vive acá: se importa de ./catalogo.js, el mismo archivo que usa
//   api/suscribir.js para armar el cobro. Antes cada uno tenía su propia copia -- el 29/07
//   un precio de prueba en suscribir.js sin su umbral correspondiente acá dejó un pago
//   aprobado sin acreditar (quedaba registrado como "MONTO NO RECONOCIDO"). Con un solo
//   archivo de por medio, esa desincronización ya no es posible entre estos dos.

import crypto from 'crypto';
import { planPorMonto } from './catalogo.js';
import { emitirYNotificar } from '../lib/comm-emitir.js';

const MP = 'https://api.mercadopago.com';

const registrar = (o) => console.log(JSON.stringify({ evento: 'pago', ...o }));

// --- Firma ---------------------------------------------------------------------
// manifiesto: id:{data.id};request-id:{x-request-id};ts:{ts};
// HMAC-SHA256 con el secreto, en hexadecimal, comparado contra v1.
function firmaValida(req, secreto) {
  if (!secreto) return null;                 // null = no configurado
  const cabecera = String(req.headers['x-signature'] || '');
  const pedido   = String(req.headers['x-request-id'] || '');
  if (!cabecera) return false;

  let ts = '', v1 = '';
  for (const parte of cabecera.split(',')) {
    const i = parte.indexOf('=');
    if (i === -1) continue;
    const k = parte.slice(0, i).trim();
    const v = parte.slice(i + 1).trim();
    if (k === 'ts') ts = v;
    else if (k === 'v1') v1 = v;
  }
  if (!ts || !v1) return false;

  const q = req.query || {};
  let id = String(q['data.id'] || q.id || '');
  if (/^[a-zA-Z0-9]+$/.test(id)) id = id.toLowerCase();   // lo pide la documentacion

  const manifiesto = `id:${id};request-id:${pedido};ts:${ts};`;
  const propia = crypto.createHmac('sha256', secreto).update(manifiesto).digest('hex');

  // Comparacion de tiempo constante: comparar con === filtra por tiempo de respuesta.
  const a = Buffer.from(propia, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function mpGet(ruta, token) {
  const r = await fetch(MP + ruta, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('mercadopago ' + ruta + ' devolvio ' + r.status);
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Metodo no permitido.' });
  }

  const token = process.env.MP_ACCESS_TOKEN;
  const secreto = process.env.MP_WEBHOOK_SECRET;
  if (!token) {
    registrar({ error: 'falta MP_ACCESS_TOKEN' });
    return res.status(200).json({ ok: false });
  }

  // --- 1 · Firma ---
  const ok = firmaValida(req, secreto);
  if (ok === false) {
    registrar({ error: 'FIRMA INVALIDA', ip: req.headers['x-forwarded-for'] || '' });
    return res.status(401).json({ error: 'Firma invalida.' });
  }
  if (ok === null) {
    // Sin secreto configurado no se puede verificar. Se deja pasar para poder
    // probar, pero grita: en produccion esto NO debe quedar asi.
    registrar({ aviso: 'SIN MP_WEBHOOK_SECRET — notificacion sin verificar' });
  }

  let cuerpo = req.body;
  if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; } }
  cuerpo = cuerpo || {};

  const tipo = String(cuerpo.type || cuerpo.topic || req.query.type || req.query.topic || '');
  const id   = String((cuerpo.data && cuerpo.data.id) || req.query['data.id'] || req.query.id || '');

  // Se registra TODA notificacion al entrar, antes de procesar. Si algo falla
  // despues, al menos consta que llego. Un aviso invisible no se puede depurar.
  registrar({ accion: 'recibido', tipo: tipo || '(sin tipo)', id: id || '(sin id)' });

  if (!id) { registrar({ aviso: 'aviso sin id', tipo }); return res.status(200).json({ ok: true }); }

  try {
    // --- 2 · Preguntarle a Mercado Pago que paso de verdad ---
    let suscripcionId = null, monto = null, moneda = 'ARS', aprobado = false, rechazado = false, reembolsado = false, bruto = null;

    if (tipo === 'subscription_authorized_payment' || tipo === 'authorized_payment') {
      const a = await mpGet('/authorized_payments/' + id, token);
      bruto = a;
      suscripcionId = a.preapproval_id || null;
      monto = a.transaction_amount;
      aprobado  = a.status === 'processed' || a.payment?.status === 'approved';
      rechazado = a.status === 'recycling' || a.payment?.status === 'rejected';

    } else if (tipo === 'payment') {
      const p = await mpGet('/v1/payments/' + id, token);
      bruto = p;
      suscripcionId = p.metadata?.preapproval_id || null;
      monto = p.transaction_amount;
      moneda = p.currency_id || 'ARS';
      aprobado    = p.status === 'approved';
      rechazado   = p.status === 'rejected';
      reembolsado = p.status === 'refunded' || p.status === 'charged_back';

    } else if (tipo === 'subscription_preapproval' || tipo === 'preapproval') {
      const s = await mpGet('/preapproval/' + id, token);
      bruto = s;
      suscripcionId = s.id;
      monto = s.auto_recurring?.transaction_amount;
      moneda = s.auto_recurring?.currency_id || 'ARS';

      // La suscripcion recien autorizada todavia no cobro: el cobro llega
      // por subscription_authorized_payment. Aca solo interesa la baja.
      if (s.status === 'cancelled' || s.status === 'paused') {
        const perfil = s.external_reference;
        if (perfil) {
          const r = await rpc('cancelar', { p_perfil: perfil });
          registrar({ accion: 'cancelada', perfil: String(perfil).slice(0, 8), estado: r?.estado });
        } else {
          registrar({ accion: 'cancelada_sin_perfil', suscripcion: s.id, estado: s.status });
        }
        return res.status(200).json({ ok: true });
      }
      // Todo otro estado se registra igual. Ningun camino sale en silencio:
      // un aviso que no deja rastro es un aviso que no se puede depurar.
      registrar({
        accion: 'suscripcion_estado', estado: s.status, suscripcion: s.id,
        perfil: String(s.external_reference || '').slice(0, 8), monto,
      });
      return res.status(200).json({ ok: true });

    } else {
      registrar({ aviso: 'tipo ignorado', tipo });
      return res.status(200).json({ ok: true });
    }

    // --- Quien es ---
    let perfil = bruto?.external_reference || null;
    if (!perfil && suscripcionId) {
      const s = await mpGet('/preapproval/' + suscripcionId, token);
      perfil = s.external_reference || null;
      if (monto == null) monto = s.auto_recurring?.transaction_amount;
    }
    if (!perfil) {
      registrar({ error: 'PAGO SIN external_reference', tipo, id, monto });
      return res.status(200).json({ ok: true });
    }

    // --- 3 · Acreditar ---
    if (aprobado) {
      const plan = planPorMonto(monto);
      if (!plan) {
        registrar({ error: 'MONTO NO RECONOCIDO', monto, perfil: String(perfil).slice(0, 8) });
        return res.status(200).json({ ok: true });
      }
      const r = await rpc('activar', {
        p_perfil: perfil, p_plan: plan, p_suscripcion: suscripcionId,
        p_pago_externo: String(id), p_monto: monto, p_moneda: moneda,
        p_dias: 30, p_bruto: bruto,
      });
      registrar({
        accion: r?.repetido ? 'repetido' : 'activado',
        perfil: String(perfil).slice(0, 8), plan, monto, saldo: r?.saldo,
      });

      // Corte F: aviso real por la bandeja interna -- "plan_activado" es la misma
      // finalidad sin importar la pasarela (Mercado Pago o Lemon Squeezy). Aislado
      // (emitirYNotificar nunca lanza) -- si esto falla, el pago YA se acredito
      // arriba, nada se deshace por esto. Se espera (await) antes de responder:
      // en una funcion serverless, lo que no se espera puede cortarse a mitad de
      // camino en cuanto el handler termina -- "fire and forget" no es seguro aca.
      await emitirYNotificar({
        SB_URL: process.env.SUPABASE_URL, SERVICE_KEY: process.env.SUPABASE_SECRET_KEY,
        organizationId: perfil, purposeId: 'plan_activado', type: 'plan.activado',
        producer: 'pago_mercadopago', payload: { plan, dias: 30 },
        titulo: 'Tu plan quedó activo', resumen: `Tu plan ${plan} está activo.`,
      });

    } else if (rechazado) {
      const r = await rpc('marcar_gracia', { p_perfil: perfil, p_dias: 5 });
      registrar({ accion: 'gracia', perfil: String(perfil).slice(0, 8), vence: r?.vence });

    } else if (reembolsado) {
      // Reembolso o contracargo (Corte B.6+, 03/08): baja a gratis de una, sin intentar
      // calcular cuanto del credito ya se consumio -- activar() reemplaza el saldo entero,
      // asi que no hay forma de descontar "solo la parte reembolsada" con precision. Javier
      // se ocupa de escribirle a la persona por fuera de esto. Misma funcion que usa el
      // adaptador de Lemon Squeezy, para que un reembolso se trate igual sin importar la
      // pasarela (parte de §7.1: ninguna regla comercial depende de una pasarela puntual).
      const r = await rpc('reembolsar', { p_perfil: perfil, p_pago_externo: String(id), p_bruto: bruto });
      registrar({
        accion: 'reembolsado', perfil: String(perfil).slice(0, 8),
        plan_previo: r?.plan_previo, saldo_previo: r?.saldo_previo,
      });

    } else {
      registrar({ accion: 'pendiente', tipo, id });
    }

    return res.status(200).json({ ok: true });

  } catch (e) {
    // 200 igual: si devolvemos error, Mercado Pago reintenta en bucle.
    registrar({ error: 'FALLO PROCESANDO', tipo, id, detalle: String((e && e.message) || e) });
    return res.status(200).json({ ok: false });
  }
}
