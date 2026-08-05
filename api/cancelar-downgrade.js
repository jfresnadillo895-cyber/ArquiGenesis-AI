// api/cancelar-downgrade.js — Revoca un cambio de plan hacia abajo ya programado (Corte M)
// ---------------------------------------------------------------------------------------------
// QUE HACE
//   Pone perfiles.plan_pendiente = null para la cuenta de quien llama. Es el otro lado de
//   api/cambiar-plan.js cuando el cambio pedido es un downgrade: ese endpoint programa la baja
//   de plan para cuando venza el ciclo pagado; este la cancela mientras no se haya aplicado
//   todavía. Después de que api/comm-cron.js la aplica de verdad (cambiar_plan_credito_
//   inmediato), plan_pendiente ya vuelve a null solo -- no queda nada que revocar.
//   Mismo patrón exacto que api/cancelar-baja.js (Corte L).
//
// Variables de entorno: SUPABASE_URL, SUPABASE_SECRET_KEY (ya cargadas)
// El cliente llama: POST /api/cancelar-downgrade con Authorization: Bearer <token>

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
    const r = await fetch(SB_URL + '/rest/v1/rpc/cancelar_downgrade_pendiente', {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ p_perfil: id }),
    });
    if (!r.ok) {
      res.status(502).json({ error: { message: 'No se pudo cancelar el cambio de plan.', codigo: 'fallo_cancelar' } });
      return;
    }
    const d = await r.json().catch(() => null);
    const fila = Array.isArray(d) ? d[0] : d;
    if (!fila || !fila.ok) {
      res.status(404).json({ error: { message: 'No había ningún cambio de plan pendiente.', codigo: 'sin_pendiente' } });
      return;
    }
    res.status(200).json({ ok: true, plan: fila.plan });
  } catch (e) {
    res.status(502).json({ error: { message: 'No se pudo cancelar el cambio de plan.', codigo: 'fallo_cancelar' } });
  }
}
