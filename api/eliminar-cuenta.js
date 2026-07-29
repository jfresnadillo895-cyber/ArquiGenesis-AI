// api/eliminar-cuenta.js
// Borra la cuenta propia del usuario que llama. Vive en el servidor porque el borrado real
// (la Admin API de Supabase) necesita la clave de servicio, que nunca puede viajar al navegador.
//
// VERIFICADO CONTRA EL ESQUEMA REAL (29/07), consultando information_schema en vivo:
//   consumo.perfil  -> perfiles.id  ON DELETE CASCADE   (se borra solo)
//   pagos.perfil    -> perfiles.id  ON DELETE SET NULL  (el historial de pagos se conserva,
//                                                         sin usuario asociado -- correcto para
//                                                         no perder registros contables)
//   perfiles.id     NO tiene foreign key hacia auth.users -- nada la borra en cascada al
//                                                         eliminar el usuario de Auth.
// Por eso este endpoint borra el usuario de Auth y DESPUES borra la fila de perfiles a mano
// (paso 3). El orden importa: si el paso 3 fallara, queda una fila de perfiles huérfana --
// inofensiva, nadie puede autenticarse contra ella -- en vez de una cuenta de Auth viva sin
// perfil, que sería peor (el usuario podría entrar pero todo lo que dependa de perfiles
// rompería).
//
// Variables de entorno que usa (ya cargadas en Vercel según Continuidad v10):
//   SUPABASE_URL, SUPABASE_SECRET_KEY
//
// El cliente (candado.txt v6) llama: POST /api/eliminar-cuenta con Authorization: Bearer <token>

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

  // 1. El id sale de validar el token de quien llama -- nunca de algo que mande el cliente.
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

  // 2. Borra el usuario de Auth con la Admin API. Es el paso que efectivamente cierra la
  //    cuenta: sin sesión nueva posible desde acá en adelante.
  try {
    const rBorrar = await fetch(SB_URL + '/auth/v1/admin/users/' + id, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY }
    });
    if (!rBorrar.ok) {
      const detalle = await rBorrar.json().catch(function () { return {}; });
      res.status(502).json({ error: { message: 'No se pudo eliminar la cuenta.', codigo: 'fallo_borrado', detalle: detalle } });
      return;
    }
  } catch (e) {
    res.status(502).json({ error: { message: 'No se pudo eliminar la cuenta.', codigo: 'fallo_borrado' } });
    return;
  }

  // 3. Limpieza de perfiles -- no tiene FK hacia auth.users, así que no se borra sola.
  //    consumo cascada desde acá; pagos queda con perfil=NULL, como corresponde.
  //    Best-effort: la cuenta ya está borrada de Auth (lo que importa para el usuario),
  //    así que un fallo acá no corta la respuesta -- pero sí queda en los logs de Vercel.
  try {
    const rLimpiar = await fetch(SB_URL + '/rest/v1/perfiles?id=eq.' + id, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY }
    });
    if (!rLimpiar.ok) {
      console.error('eliminar-cuenta: se borró el usuario de Auth pero falló la limpieza de perfiles', id, rLimpiar.status);
    }
  } catch (e) {
    console.error('eliminar-cuenta: se borró el usuario de Auth pero falló la limpieza de perfiles', id, e);
  }

  res.status(200).json({ ok: true });
}
