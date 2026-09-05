// api/cuenta.js — Programar/cancelar una eliminación de cuenta, y cancelar un downgrade
// programado, para el usuario en sesión
// ---------------------------------------------------------------------------------------------
// LIMITE DE FUNCIONES DE VERCEL (Hobby, 05/08)
//   Este archivo absorbe lo que hasta hoy vivía en tres archivos separados:
//   api/eliminar-cuenta.js, api/cancelar-baja.js y api/cancelar-downgrade.js. No fue una
//   decisión de diseño -- el plan Hobby de Vercel tope a 12 Funciones Serverless por
//   deployment, y el proyecto ya estaba justo en ese límite antes del Corte M; agregar dos
//   endpoints nuevos lo rompió (14 funciones). Se consolidó bajo UNA URL con una acción
//   explícita en el cuerpo, en vez de sumar infraestructura sin que Javier lo decida.
//   La lógica de cada acción es la MISMA que tenían los archivos originales -- ningún
//   comportamiento cambió, solo la forma de invocarlo.
//
// CONTRATO
//   POST /api/cuenta   Authorization: Bearer <token>   body: { accion }
//   accion:
//     'eliminar'            (default si no se manda body -- compatibilidad con el llamador
//                             actual de candado.txt, que hoy no manda body) -- programa
//                             perfiles.baja_programada = ahora + 7 días (Corte L, §7.4).
//     'cancelar_baja'        revierte una eliminación programada (baja_programada = null).
//     'cancelar_downgrade'   revierte un cambio de plan hacia abajo ya programado
//                             (perfiles.plan_pendiente = null, Corte M).
//
// Variables de entorno: SUPABASE_URL, SUPABASE_SECRET_KEY (ya cargadas)

import { emitirYEnviarCorreo, obtenerEmailUsuario } from '../lib/comm-emitir.js';
import { localeDe, biLocale, fechaLocal, htmlFirma } from '../lib/i18n-server.js';

const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

async function identificarUsuario(SB_URL, SERVICE_KEY, token) {
  const r = await fetch(SB_URL + '/auth/v1/user', {
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + token }
  });
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  return d && d.id ? d.id : null;
}

// ---------- accion: eliminar (ex api/eliminar-cuenta.js) ----------
async function accionEliminar(id, SB_URL, SERVICE_KEY, res, locale) {
  const bajaProgramada = new Date(Date.now() + SIETE_DIAS_MS).toISOString();
  try {
    const r = await fetch(SB_URL + '/rest/v1/perfiles?id=eq.' + id, {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY,
        'content-type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({ baja_programada: bajaProgramada }),
    });
    if (!r.ok) {
      res.status(502).json({ error: { message: biLocale(locale, 'No se pudo programar la eliminación de la cuenta.', 'The account deletion could not be scheduled.'), codigo: 'fallo_programar' } });
      return;
    }
  } catch (e) {
    res.status(502).json({ error: { message: biLocale(locale, 'No se pudo programar la eliminación de la cuenta.', 'The account deletion could not be scheduled.'), codigo: 'fallo_programar' } });
    return;
  }

  // Corte P (Encargo 115 AG, bloque 4.5): §10 "Constancia" de los Términos promete confirmar
  // por correo al PROGRAMAR la eliminación, con la fecha. Best-effort -- si el correo falla,
  // la baja ya quedó programada igual (emitirYEnviarCorreo nunca lanza, ver lib/comm-emitir.js).
  try {
    const email = await obtenerEmailUsuario(id, SB_URL, SERVICE_KEY);
    if (email) {
      const fecha = fechaLocal(bajaProgramada, locale, { day: 'numeric', month: 'long', year: 'numeric' });
      await emitirYEnviarCorreo({
        SB_URL, SERVICE_KEY, organizationId: id, purposeId: 'cuenta_baja_programada', type: 'cuenta.baja_programada',
        producer: 'cuenta', payload: { baja_programada: bajaProgramada },
        destinatario: email,
        asunto: biLocale(locale, 'Tu cuenta de Comprender AI va a eliminarse el ' + fecha, 'Your Comprender AI account will be deleted on ' + fecha),
        contenidoHtml: biLocale(locale,
          '<p>Hola,</p>' +
          '<p>Programamos la eliminación de tu cuenta para el <strong>' + fecha + '</strong>. Hasta ese momento, tu cuenta sigue funcionando con normalidad.</p>' +
          '<p>Si te arrepentís, podés cancelar esto en cualquier momento antes de esa fecha, desde el panel de tu cuenta.</p>',
          '<p>Hello,</p>' +
          '<p>We scheduled your account for deletion on <strong>' + fecha + '</strong>. Until then, your account will continue to work normally.</p>' +
          '<p>If you change your mind, you can cancel this at any time before that date from your account panel.</p>'
        ) + htmlFirma(locale),
      });
    }
  } catch (e) {
    // aislado a proposito -- ver el comentario de arriba.
  }

  res.status(200).json({ ok: true, baja_programada: bajaProgramada });
}

// ---------- accion: cancelar_baja (ex api/cancelar-baja.js) ----------
async function accionCancelarBaja(id, SB_URL, SERVICE_KEY, res, locale) {
  try {
    const r = await fetch(SB_URL + '/rest/v1/perfiles?id=eq.' + id, {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY,
        'content-type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({ baja_programada: null }),
    });
    if (!r.ok) {
      res.status(502).json({ error: { message: biLocale(locale, 'No se pudo cancelar la eliminación.', 'The account deletion could not be canceled.'), codigo: 'fallo_cancelar' } });
      return;
    }
  } catch (e) {
    res.status(502).json({ error: { message: biLocale(locale, 'No se pudo cancelar la eliminación.', 'The account deletion could not be canceled.'), codigo: 'fallo_cancelar' } });
    return;
  }

  // Cierre técnico legal, Corte V (bloque 2): programar y ejecutar la eliminación ya tenían
  // confirmación por correo desde el Corte P -- revocar no tenía ninguna. Best-effort, aislado
  // (mismo criterio que el resto de emitirYEnviarCorreo en este archivo).
  try {
    const email = await obtenerEmailUsuario(id, SB_URL, SERVICE_KEY);
    if (email) {
      await emitirYEnviarCorreo({
        SB_URL, SERVICE_KEY, organizationId: id, purposeId: 'cuenta_baja_cancelada', type: 'cuenta.baja_cancelada',
        producer: 'cuenta', payload: {},
        destinatario: email,
        asunto: biLocale(locale, 'Cancelamos la eliminación de tu cuenta de Comprender AI', 'We canceled the deletion of your Comprender AI account'),
        contenidoHtml: biLocale(locale,
          '<p>Hola,</p><p>Confirmamos que cancelamos la eliminación programada de tu cuenta. Tu cuenta sigue activa con normalidad.</p>',
          '<p>Hello,</p><p>We confirm that the scheduled deletion of your account has been canceled. Your account remains active.</p>'
        ) + htmlFirma(locale),
      });
    }
  } catch (e) {
    // aislado a proposito -- ver la nota de arriba.
  }

  res.status(200).json({ ok: true });
}

// ---------- accion: cancelar_downgrade (ex api/cancelar-downgrade.js) ----------
async function accionCancelarDowngrade(id, SB_URL, SERVICE_KEY, res, locale) {
  try {
    const r = await fetch(SB_URL + '/rest/v1/rpc/cancelar_downgrade_pendiente', {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ p_perfil: id }),
    });
    if (!r.ok) {
      res.status(502).json({ error: { message: biLocale(locale, 'No se pudo cancelar el cambio de plan.', 'The plan change could not be canceled.'), codigo: 'fallo_cancelar' } });
      return;
    }
    const d = await r.json().catch(() => null);
    const fila = Array.isArray(d) ? d[0] : d;
    if (!fila || !fila.ok) {
      res.status(404).json({ error: { message: biLocale(locale, 'No había ningún cambio de plan pendiente.', 'There was no pending plan change.'), codigo: 'sin_pendiente' } });
      return;
    }
    res.status(200).json({ ok: true, plan: fila.plan });
  } catch (e) {
    res.status(502).json({ error: { message: biLocale(locale, 'No se pudo cancelar el cambio de plan.', 'The plan change could not be canceled.'), codigo: 'fallo_cancelar' } });
  }
}

export default async function handler(req, res) {
  const locale = localeDe(req);
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: biLocale(locale, 'Método no permitido', 'Method not allowed'), codigo: 'metodo_invalido' } });
    return;
  }

  const encabezado = req.headers.authorization || '';
  const token = encabezado.indexOf('Bearer ') === 0 ? encabezado.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: { message: biLocale(locale, 'Falta la sesión.', 'Missing session.'), codigo: 'sin_sesion' } });
    return;
  }

  const SB_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SB_URL || !SERVICE_KEY) {
    res.status(500).json({ error: { message: biLocale(locale, 'Falta configuración del servidor.', 'Server configuration is incomplete.'), codigo: 'sin_config' } });
    return;
  }

  const id = await identificarUsuario(SB_URL, SERVICE_KEY, token).catch(() => null);
  if (!id) {
    res.status(401).json({ error: { message: biLocale(locale, 'Sesión inválida.', 'Invalid session.'), codigo: 'sesion_invalida' } });
    return;
  }

  let cuerpo = req.body;
  if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; } }
  // 'eliminar' por default: el llamador actual de candado.txt para este caso no manda body
  // (mandaba solo Authorization) -- se mantiene ese comportamiento sin exigirle un cambio.
  const accion = String((cuerpo && cuerpo.accion) || 'eliminar');

  if (accion === 'eliminar') return accionEliminar(id, SB_URL, SERVICE_KEY, res, locale);
  if (accion === 'cancelar_baja') return accionCancelarBaja(id, SB_URL, SERVICE_KEY, res, locale);
  if (accion === 'cancelar_downgrade') return accionCancelarDowngrade(id, SB_URL, SERVICE_KEY, res, locale);

  res.status(400).json({ error: { message: biLocale(locale, 'Acción inválida.', 'Invalid action.'), codigo: 'accion_invalida' } });
}
