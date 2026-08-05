// api/cancelar-baja.js — Revoca una eliminación de cuenta programada (Corte L)
// ---------------------------------------------------------------------------------------------
// QUE HACE
//   Pone perfiles.baja_programada = null para la cuenta de quien llama. Es el otro lado de
//   api/eliminar-cuenta.js: ese endpoint programa la baja para dentro de 7 días; este la
//   cancela mientras el plazo no se haya cumplido todavía. Después de que api/comm-cron.js
//   ejecuta la baja real (ver lib/cuenta.js), ya no hay nada que revocar -- la cuenta no existe.
//
// Variables de entorno: SUPABASE_URL, SUPABASE_SECRET_KEY (ya cargadas)
// El cliente (candado.txt) llama: POST /api/cancelar-baja con Authorization: Bearer <token>

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Método no permitido', codigo: 'metodo_invalido' } });
    return;
  }

  const encabezado = req.headers.authorization || '';
  const token = encabezado.indexOf('Bearer ') === 0 ? encabezado.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: { message: 'Falta la sesión.', codigo: 'sin_sesion' } });
    return;
  }

  const SB_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SB_URL || !SERVICE_KEY) {
    res.status(500).json({ error: { message: 'Falta configuración del servidor.', codigo: 'sin_config' } });
    return;
  }

  let usuario;
  try {
    const rUsuario = await fetch(SB_URL + '/auth/v1/user', {
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + token }
    });
    if (!rUsuario.ok) {
      res.status(401).json({ error: { message: 'Sesión inválida.', codigo: 'sesion_invalida' } });
      return;
    }
    usuario = await rUsuario.json();
  } catch (e) {
    res.status(502).json({ error: { message: 'No se pudo validar la sesión.', codigo: 'error_validacion' } });
    return;
  }

  const id = usuario && usuario.id;
  if (!id) {
    res.status(401).json({ error: { message: 'Sesión inválida.', codigo: 'sesion_invalida' } });
    return;
  }

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
      res.status(502).json({ error: { message: 'No se pudo cancelar la eliminación.', codigo: 'fallo_cancelar' } });
      return;
    }
  } catch (e) {
    res.status(502).json({ error: { message: 'No se pudo cancelar la eliminación.', codigo: 'fallo_cancelar' } });
    return;
  }

  res.status(200).json({ ok: true });
}
