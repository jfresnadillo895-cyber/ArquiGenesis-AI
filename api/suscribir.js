// api/suscribir.js — Crea una suscripción en Mercado Pago para el usuario en sesión
// ---------------------------------------------------------------------------------------------
// QUE HACE
//   1. Verifica la sesión de Supabase (el mismo token que usa el proxy).
//   2. Crea un preapproval en Mercado Pago con external_reference = id del usuario.
//   3. Devuelve el init_point, que es la URL del checkout.
//
// POR QUE DEL LADO DEL SERVIDOR
//   El precio y el plan NO pueden venir del navegador: cualquiera podría pedir
//   Estudio por $1. El cliente manda sólo cuál plan quiere; el monto lo pone el
//   servidor desde la tabla de acá abajo.
//
// EL external_reference ES LA PIEZA CLAVE
//   Ata la suscripción de Mercado Pago con el usuario de Supabase. Sin eso llega
//   un pago y no sabemos de quién es. api/pago.js lo lee para saber a quién acreditar.
//
// PRECIOS · fijados al dólar BNA venta $1.515 del 22/07/2026
//   Se revisan a mano cuando el tipo de cambio se despegue. Cambiar acá Y en los
//   planes ya creados en Mercado Pago (las suscripciones activas mantienen su monto).
//
// VARIABLES DE ENTORNO
//   MP_ACCESS_TOKEN · SUPABASE_URL · SUPABASE_SECRET_KEY   (ya cargadas)

const MP = 'https://api.mercadopago.com';
const VUELTA = 'https://app.comprenderai.com/?suscripcion=ok';

const PLANES = {
  // ═══════════════════════════════════════════════════════════════════════════
  //  PRUEBA · 25/07 · Profesional a $100 para verificar el circuito real.
  //  RESTAURAR A 30000 apenas la prueba pase. Estudio queda en su precio real.
  //  ═══════════════════════════════════════════════════════════════════════════
  profesional: { monto: 100, titulo: 'Comprender · Profesional (PRUEBA)' },
  estudio:     { monto: 80000, titulo: 'Comprender · Estudio' },
};

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Metodo no permitido.' } });
  }

  const token = process.env.MP_ACCESS_TOKEN;
  if (!token || !process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
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
  const plan = PLANES[pedido];
  if (!plan) {
    return res.status(400).json({ error: { message: 'Plan invalido.' } });
  }

  // --- Crear la suscripción ---
  // Sobre payer_email: lo sacamos el 24/07 porque con credenciales de prueba, si
  // el correo coincidía con la cuenta que cobra, el checkout se trababa. Pero el
  // 25/07 la API pasó a EXIGIRLO (rechaza con "payer_email is required"). Volvió,
  // entonces. Con vendedor real esto no da problema: el pagador puede ser
  // cualquier correo real. Lo que ata el pago al usuario sigue siendo
  // external_reference, no el correo.
  // La identidad de quien paga la resuelve Mercado Pago; a quién acreditamos lo
  // resuelve external_reference, que es lo único que necesitamos controlar.
  try {
    const r = await fetch(MP + '/preapproval', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: plan.titulo,
        external_reference: usuario.id,      // ← lo que ata todo
        // payer_email volvió a ser obligatorio en la API de Mercado Pago (25/07).
        // Se usa el correo de la sesión. Para el pago de prueba a uno mismo está
        // bien; en producción es el correo con el que la persona inició sesión.
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
