// lib/cuenta.js — Borrado real de una cuenta (extraído en el Corte L)
// ---------------------------------------------------------------------------------------------
// POR QUE EXISTE
//   Hasta el Corte K, los cinco pasos del borrado real vivían adentro de api/eliminar-cuenta.js,
//   que siempre partía de un token de sesión. El Corte L agrega un segundo llamador que NO tiene
//   token: el cron, ejecutando una baja ya programada (perfiles.baja_programada vencida) o una
//   eliminación automática por 24 meses de inactividad. En vez de duplicar los cinco pasos, se
//   extraen acá como una función pura que recibe el id y el email ya resueltos -- a cada
//   llamador (con token o sin token) le toca resolver esos dos datos a su manera, esta función
//   no sabe ni le importa de dónde salieron.
//
// CONTRATO
//   eliminarCuentaCompleta({ id, email, SB_URL, SERVICE_KEY }) -> { ok, motivo?, suscripcion_cancelada }
//   `email` es opcional: si no se tiene, simplemente no se intenta sacar de comm_closed_recipients
//   (paso 5), el resto de los pasos no lo necesita.
//
// MISMO CRITERIO DE BEST-EFFORT QUE EL CORTE K
//   Solo el paso 3 (borrar de Auth) puede hacer fallar la función entera -- sin eso, la cuenta
//   sigue pudiendo iniciar sesión y nada de lo demás tiene sentido. Los pasos 1, 2, 4 y 5 nunca
//   cortan la ejecución: cada uno se registra en los logs si falla, pero el derecho a que la
//   cuenta se borre no puede depender de que la pasarela, o una limpieza secundaria, contesten
//   bien en ese momento puntual.
//
// ORDEN (corregido 05/08, tras confirmar con Javier el esquema real) -- por que organismos se
// borra ANTES que el usuario de Auth, no despues
//   `perfiles_id_fkey` (perfiles.id -> auth.users.id) resultó ser `ON DELETE CASCADE`: borrar
//   el usuario de Auth borra la fila de perfiles solo, en el mismo instante. El comportamiento
//   de `organismos_perfil_fkey` (organismos.perfil -> perfiles.id) sigue sin confirmarse. Si esa
//   FK no fuera CASCADE/SET NULL, la cascada de perfiles fallaría en el momento de borrar Auth
//   mientras todavía existan organismos que la referencien -- y esa falla ocurriría ANTES de
//   llegar a un eventual paso "borrar organismos" si ese paso viniera después. Por eso ahora los
//   organismos se borran primero: para cuando se borra el usuario de Auth (y esa cascada corre),
//   ya no queda ningún organismo que pueda bloquearla, sin importar lo que diga esa segunda FK.
//   El DELETE explícito de perfiles que sigue después queda como red de seguridad inofensiva
//   (afecta 0 filas si la cascada ya la borró, que es el caso normal).
//
// VARIABLES DE ENTORNO QUE USA (ya cargadas en Vercel)
//   MP_ACCESS_TOKEN, LEMONSQUEEZY_API_KEY (para el paso 1)

export async function eliminarCuentaCompleta({ id, email, SB_URL, SERVICE_KEY }) {
  let suscripcionCancelada = null;   // null = no tenia suscripcion activa que cancelar

  // 1. Cancelar una suscripcion activa ANTES de borrar nada (Corte K -- evita el cobro indebido).
  try {
    const rPerfil = await fetch(
      SB_URL + '/rest/v1/perfiles?id=eq.' + id + '&select=suscripcion',
      { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } }
    );
    const filas = rPerfil.ok ? await rPerfil.json().catch(() => []) : [];
    const suscripcion = filas && filas[0] && filas[0].suscripcion;

    if (suscripcion) {
      const rPago = await fetch(
        SB_URL + '/rest/v1/pagos?perfil=eq.' + id + '&select=pago_externo&order=momento.desc&limit=1',
        { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } }
      );
      const pagos = rPago.ok ? await rPago.json().catch(() => []) : [];
      const esLemonSqueezy = !!(pagos && pagos[0] && String(pagos[0].pago_externo || '').indexOf('ls_') === 0);

      if (esLemonSqueezy) {
        const LS_KEY = process.env.LEMONSQUEEZY_API_KEY;
        if (LS_KEY) {
          const rCancelar = await fetch('https://api.lemonsqueezy.com/v1/subscriptions/' + suscripcion, {
            method: 'DELETE',
            headers: { Accept: 'application/vnd.api+json', Authorization: 'Bearer ' + LS_KEY },
          });
          suscripcionCancelada = rCancelar.ok;
          if (!rCancelar.ok) console.error('eliminarCuentaCompleta: fallo cancelar suscripcion Lemon Squeezy', id, suscripcion, rCancelar.status);
        } else {
          suscripcionCancelada = false;
          console.error('eliminarCuentaCompleta: falta LEMONSQUEEZY_API_KEY, no se pudo cancelar', id, suscripcion);
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
          if (!rCancelar.ok) console.error('eliminarCuentaCompleta: fallo cancelar suscripcion Mercado Pago', id, suscripcion, rCancelar.status);
        } else {
          suscripcionCancelada = false;
          console.error('eliminarCuentaCompleta: falta MP_ACCESS_TOKEN, no se pudo cancelar', id, suscripcion);
        }
      }
    }
  } catch (e) {
    suscripcionCancelada = false;
    console.error('eliminarCuentaCompleta: excepcion cancelando suscripcion', id, String((e && e.message) || e));
  }

  // 2. Organismos -- ANTES que Auth (ver nota de orden en la cabecera del archivo). No se
  //    confia en el ON DELETE de organismos.perfil (nunca verificado); borrandolos acá, el
  //    resultado es correcto sin importar que diga esa FK, y la cascada de perfiles del paso 3
  //    no tiene nada que se lo bloquee.
  try {
    const rOrganismos = await fetch(SB_URL + '/rest/v1/organismos?perfil=eq.' + id, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY }
    });
    if (!rOrganismos.ok) console.error('eliminarCuentaCompleta: fallo el borrado de organismos (antes de tocar Auth)', id, rOrganismos.status);
  } catch (e) {
    console.error('eliminarCuentaCompleta: fallo el borrado de organismos (antes de tocar Auth)', id, e);
  }

  // 3. Borrar el usuario de Auth. El unico paso que puede hacer fallar todo lo demas. Cascada
  //    confirmada (05/08): perfiles_id_fkey es ON DELETE CASCADE, asi que esto borra la fila
  //    de perfiles solo, en el mismo instante -- el paso 4 queda como red de seguridad.
  try {
    const rBorrar = await fetch(SB_URL + '/auth/v1/admin/users/' + id, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY }
    });
    if (!rBorrar.ok) {
      const detalle = await rBorrar.json().catch(() => ({}));
      return { ok: false, motivo: 'fallo_borrado_auth', detalle, suscripcion_cancelada: suscripcionCancelada };
    }
  } catch (e) {
    return { ok: false, motivo: 'fallo_borrado_auth', suscripcion_cancelada: suscripcionCancelada };
  }

  // 4. perfiles -- red de seguridad inofensiva: perfiles_id_fkey (ON DELETE CASCADE) ya la
  //    borró sola en el paso 3. Esto afecta 0 filas en el caso normal; se deja por si algún día
  //    esa FK cambiara de comportamiento.
  try {
    const rLimpiar = await fetch(SB_URL + '/rest/v1/perfiles?id=eq.' + id, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY }
    });
    if (!rLimpiar.ok) console.error('eliminarCuentaCompleta: se borró Auth pero falló la limpieza de perfiles', id, rLimpiar.status);
  } catch (e) {
    console.error('eliminarCuentaCompleta: se borró Auth pero falló la limpieza de perfiles', id, e);
  }

  // 5. comm_closed_recipients -- solo si se tiene el email resuelto.
  if (email) {
    try {
      const rDestinatario = await fetch(
        SB_URL + '/rest/v1/comm_closed_recipients?canal=eq.email&email=eq.' + encodeURIComponent(String(email).toLowerCase()),
        { method: 'DELETE', headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } }
      );
      if (!rDestinatario.ok) console.error('eliminarCuentaCompleta: se borró la cuenta pero falló sacar el email de comm_closed_recipients', id, rDestinatario.status);
    } catch (e) {
      console.error('eliminarCuentaCompleta: se borró la cuenta pero falló sacar el email de comm_closed_recipients', id, e);
    }
  }

  return { ok: true, suscripcion_cancelada: suscripcionCancelada };
}
