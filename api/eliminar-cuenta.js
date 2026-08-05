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
// El comportamiento ON DELETE de organismos.perfil -> perfiles.id NUNCA se verifico (no aparece
// documentado en ningun archivo del proyecto). Por eso, desde la Resolucion de Criterio Legal
// (05/08), este endpoint deja de confiar en cualquier cascada de la base para organismos: los
// borra el mismo, a mano, ANTES de tocar perfiles (paso 4). Asi el resultado es correcto sin
// importar lo que diga esa FK -- Javier igual puede confirmarla con la consulta que quedo
// anotada en la auditoria, pero ya no es un bloqueante para que este endpoint funcione bien.
//
// CORTE K (05/08) -- dos gaps reales que senalo la Resolucion de Criterio Legal:
//   1. Cobro indebido: si la cuenta tenia una suscripcion activa (Mercado Pago o Lemon Squeezy)
//      y se borraba sin avisarle a la pasarela, el proximo cobro seguia intentandose contra una
//      cuenta que ya no existe. Paso 1 de abajo cancela esa suscripcion ANTES de borrar nada.
//   2. comm_closed_recipients (CORTE_I_PARCHE_DESTINATARIOS.sql) guarda el email real de la
//      cuenta para poder mandarle correo real -- si la cuenta se borra, ese email tiene que
//      salir de ahi tambien. Paso 5 de abajo lo hace.
//   Ninguno de los dos pasos nuevos puede bloquear el borrado en si: el derecho a eliminar la
//   cuenta no depende de que la pasarela conteste bien o de que la limpieza extra funcione --
//   ambos son best-effort, con su resultado informado en la respuesta para que quede rastro.
//
// Variables de entorno que usa (ya cargadas en Vercel):
//   SUPABASE_URL, SUPABASE_SECRET_KEY
//   MP_ACCESS_TOKEN            (para cancelar una suscripcion activa de Mercado Pago)
//   LEMONSQUEEZY_API_KEY       (para cancelar una suscripcion activa de Lemon Squeezy)
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
  const email = usuario && usuario.email;
  if (!id) {
    res.status(401).json({ error: { message: 'Sesión inválida.', codigo: 'sesion_invalida' } });
    return;
  }

  // 1. Corte K -- cancelar una suscripcion activa ANTES de borrar nada. Best-effort: si esto
  //    falla (pasarela caida, id vencido, lo que sea), NO corta el borrado -- el derecho a
  //    eliminar la cuenta no puede depender de que la pasarela conteste bien. Pero se informa
  //    en la respuesta final para que quede rastro y, si hace falta, se resuelva a mano.
  let suscripcionCancelada = null;   // null = no tenia suscripcion activa que cancelar
  try {
    const rPerfil = await fetch(
      SB_URL + '/rest/v1/perfiles?id=eq.' + id + '&select=suscripcion',
      { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } }
    );
    const filas = rPerfil.ok ? await rPerfil.json().catch(function () { return []; }) : [];
    const suscripcion = filas && filas[0] && filas[0].suscripcion;

    if (suscripcion) {
      // Que pasarela es: perfiles.suscripcion no distingue una de otra, pero pagos.pago_externo
      // si -- Lemon Squeezy siempre lo guarda con el prefijo 'ls_' (ver api/lemonsqueezy.js),
      // Mercado Pago nunca. El pago mas reciente de esta cuenta alcanza para saberlo.
      const rPago = await fetch(
        SB_URL + '/rest/v1/pagos?perfil=eq.' + id + '&select=pago_externo&order=momento.desc&limit=1',
        { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } }
      );
      const pagos = rPago.ok ? await rPago.json().catch(function () { return []; }) : [];
      const esLemonSqueezy = !!(pagos && pagos[0] && String(pagos[0].pago_externo || '').indexOf('ls_') === 0);

      if (esLemonSqueezy) {
        const LS_KEY = process.env.LEMONSQUEEZY_API_KEY;
        if (LS_KEY) {
          const rCancelar = await fetch('https://api.lemonsqueezy.com/v1/subscriptions/' + suscripcion, {
            method: 'DELETE',
            headers: { Accept: 'application/vnd.api+json', Authorization: 'Bearer ' + LS_KEY },
          });
          suscripcionCancelada = rCancelar.ok;
          if (!rCancelar.ok) console.error('eliminar-cuenta: fallo cancelar suscripcion Lemon Squeezy', id, suscripcion, rCancelar.status);
        } else {
          suscripcionCancelada = false;
          console.error('eliminar-cuenta: falta LEMONSQUEEZY_API_KEY, no se pudo cancelar', id, suscripcion);
        }
      } else {
        const MP_TOKEN = process.env.MP_ACCESS_TOKEN;
        if (MP_TOKEN) {
          const rCancelar = await fetch('https://api.mercadopago.com/preapproval/' + suscripcion, {
            method: 'PUT',
            headers: { Authorization: 'Bearer ' + MP_TOKEN, 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'cancelled' }),
          });
          suscripcionCancelada = rCancelar.ok;
          if (!rCancelar.ok) console.error('eliminar-cuenta: fallo cancelar suscripcion Mercado Pago', id, suscripcion, rCancelar.status);
        } else {
          suscripcionCancelada = false;
          console.error('eliminar-cuenta: falta MP_ACCESS_TOKEN, no se pudo cancelar', id, suscripcion);
        }
      }
    }
  } catch (e) {
    suscripcionCancelada = false;
    console.error('eliminar-cuenta: excepcion cancelando suscripcion', id, String((e && e.message) || e));
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

  // 3. Corte K -- borrar los organismos de esta cuenta a mano, ANTES de tocar perfiles. No se
  //    confia en el comportamiento ON DELETE de organismos.perfil (nunca verificado, ver nota
  //    de cabecera): borrandolos explicitamente aca, el resultado es correcto sin importar lo
  //    que diga esa FK, y ademas cumple lo que el boton "eliminar organismo" del cliente todavia
  //    no cumple por si solo (hoy es local-only, ver index.html). Best-effort, mismo criterio
  //    que el resto: la cuenta ya esta borrada de Auth, un fallo aca no corta la respuesta.
  try {
    const rOrganismos = await fetch(SB_URL + '/rest/v1/organismos?perfil=eq.' + id, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY }
    });
    if (!rOrganismos.ok) {
      console.error('eliminar-cuenta: se borró el usuario de Auth pero falló el borrado de organismos', id, rOrganismos.status);
    }
  } catch (e) {
    console.error('eliminar-cuenta: se borró el usuario de Auth pero falló el borrado de organismos', id, e);
  }

  // 4. Limpieza de perfiles -- no tiene FK hacia auth.users, así que no se borra sola.
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

  // 5. Corte K -- sacar el email de comm_closed_recipients (CORTE_I_PARCHE_DESTINATARIOS.sql lo
  //    agrego solo, al crear la cuenta, para poder mandarle correo real). Si la cuenta se borra,
  //    ese email no tiene por que seguir habilitado para recibir nada. Best-effort, mismo criterio.
  if (email) {
    try {
      const rDestinatario = await fetch(
        SB_URL + '/rest/v1/comm_closed_recipients?canal=eq.email&email=eq.' + encodeURIComponent(String(email).toLowerCase()),
        { method: 'DELETE', headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } }
      );
      if (!rDestinatario.ok) {
        console.error('eliminar-cuenta: se borró la cuenta pero falló sacar el email de comm_closed_recipients', id, rDestinatario.status);
      }
    } catch (e) {
      console.error('eliminar-cuenta: se borró la cuenta pero falló sacar el email de comm_closed_recipients', id, e);
    }
  }

  res.status(200).json({ ok: true, suscripcion_cancelada: suscripcionCancelada });
}
