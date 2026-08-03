// api/comm-cron.js — Barrido diario del sistema de comunicaciones (Vercel Cron)
// ---------------------------------------------------------------------------------------------
// POR QUE EXISTE
//   El Corte A definio comm_expirar_vencidos() y comm_recuperar_abandonados() como las
//   funciones que limpian trabajos vencidos y recuperan trabajos abandonados en PROCESSING --
//   pero hasta el Corte D nada las llamaba: no habia ningun cron conectado a ellas. Sin este
//   archivo, un trabajo que queda en PROCESSING porque Brevo nunca contesto (ni exito ni
//   webhook) se queda ahi para siempre, y un trabajo vencido nunca pasa a EXPIRED.
//
//   Este archivo las conecta, y ademas corre la reconciliacion propia del Corte D:
//   comm_marcar_intentos_inciertos_por_abandono() ANTES de comm_recuperar_abandonados(), para
//   que el intento de entrega quede marcado "incierto" (silencio del proveedor) en vez de
//   quedar para siempre en "enviando"/"enviado" sin ninguna explicacion.
//
// QUE NO HACE (a proposito)
//   No dispara envios nuevos. "Despachar" un trabajo (recurso=jobs, accion=despachar en
//   api/comm.js) es una accion explicita, bajo demanda -- programar envios automaticos es
//   scope del Corte E ("programacion"), no de este cron. Este archivo solo reconcilia lo
//   que ya se intento, no inicia nada.
//
// LIMITE DEL PLAN HOBBY DE VERCEL
//   Igual que api/latido.js: una corrida por dia como maximo. Para reconciliar timeouts de
//   arrendamiento (5 minutos, ver comm_transicionar_job) alcanza sobrado -- lo que importa es
//   que nada quede colgado para siempre, no la velocidad de la reconciliacion.
//
// COMO SE ACTIVA
//   1. Este archivo en api/comm-cron.js
//   2. La entrada correspondiente en vercel.json (`/api/comm-cron`, corrida diaria)
//   3. Opcional pero recomendado: la misma variable CRON_SECRET que ya usa api/latido.js

const registrar = (o) => console.log(JSON.stringify({ evento: 'comm_cron', ...o }));

async function rpc(nombre, url, clave) {
  const r = await fetch(url + '/rest/v1/rpc/' + nombre, {
    method: 'POST',
    headers: { apikey: clave, Authorization: 'Bearer ' + clave, 'content-type': 'application/json' },
    body: '{}',
  });
  if (!r.ok) throw new Error(nombre + ' devolvio ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

export default async function handler(req, res) {
  const secreto = process.env.CRON_SECRET;
  if (secreto) {
    const cabecera = String(req.headers['authorization'] || '');
    if (cabecera !== 'Bearer ' + secreto) {
      return res.status(401).json({ error: 'No autorizado.' });
    }
  }

  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const clave = process.env.SUPABASE_SECRET_KEY;
  if (!url || !clave) {
    return res.status(500).json({ ok: false, error: 'Falta SUPABASE_URL o SUPABASE_SECRET_KEY.' });
  }

  const resultado = { evento: 'comm_cron' };
  let huboError = false;

  // orden importa: se marca "incierto" el motivo ANTES de que comm_recuperar_abandonados()
  // mueva el trabajo, para que quede registrado que fue timeout y no un rebote/error real.
  try {
    resultado.intentos_marcados_inciertos = await rpc('comm_marcar_intentos_inciertos_por_abandono', url, clave);
  } catch (e) {
    huboError = true;
    resultado.error_inciertos = String((e && e.message) || e);
  }

  try {
    resultado.trabajos_recuperados = await rpc('comm_recuperar_abandonados', url, clave);
  } catch (e) {
    huboError = true;
    resultado.error_recuperar = String((e && e.message) || e);
  }

  try {
    resultado.trabajos_vencidos = await rpc('comm_expirar_vencidos', url, clave);
  } catch (e) {
    huboError = true;
    resultado.error_vencidos = String((e && e.message) || e);
  }

  console.log(JSON.stringify(resultado));
  return res.status(huboError ? 503 : 200).json(resultado);
}
