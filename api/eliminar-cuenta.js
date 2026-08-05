// api/eliminar-cuenta.js
// Programa la eliminación de la cuenta propia del usuario que llama -- ya NO borra al instante.
//
// CORTE L (05/08) -- período de seguridad de 7 días (§7.4 del Compendio)
//   Antes (Corte K y anteriores), este endpoint borraba todo en el momento. Desde el Corte L,
//   en cambio, solo marca perfiles.baja_programada = ahora + 7 días. La cuenta sigue funcionando
//   con total normalidad durante ese plazo -- es una decisión deliberada: bloquearla habría
//   significado enseñarle a reservar()/caducar() a reconocer un estado nuevo, para un beneficio
//   marginal (nada grave pasa si alguien sigue usando su cuenta mientras decide si de verdad
//   quiere borrarla). El usuario puede arrepentirse en cualquier momento llamando a
//   POST /api/cancelar-baja (mismo archivo hermano, misma verificación por sesión).
//
//   La baja real, cuando el plazo se cumple sin que se haya revocado, la ejecuta
//   api/comm-cron.js llamando a eliminarCuentaCompleta() (lib/cuenta.js) -- la misma lógica de
//   cinco pasos que antes vivía acá adentro (cancelar suscripción, borrar Auth, organismos,
//   perfiles, comm_closed_recipients), ahora extraída para que el cron también pueda usarla.
//
// Variables de entorno que usa:
//   SUPABASE_URL, SUPABASE_SECRET_KEY
//
// El cliente (candado.txt) llama: POST /api/eliminar-cuenta con Authorization: Bearer <token>

const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

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

  // El id sale de validar el token de quien llama -- nunca de algo que mande el cliente.
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
      res.status(502).json({ error: { message: 'No se pudo programar la eliminación de la cuenta.', codigo: 'fallo_programar' } });
      return;
    }
  } catch (e) {
    res.status(502).json({ error: { message: 'No se pudo programar la eliminación de la cuenta.', codigo: 'fallo_programar' } });
    return;
  }

  res.status(200).json({ ok: true, baja_programada: bajaProgramada });
}
