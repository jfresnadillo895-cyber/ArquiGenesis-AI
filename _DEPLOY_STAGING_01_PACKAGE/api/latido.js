// api/latido.js — Mantiene despierto el proyecto de Supabase (Vercel Cron)
// ---------------------------------------------------------------------------------------------
// POR QUE EXISTE
//   El plan gratuito de Supabase pausa los proyectos que muestran poca actividad en una ventana
//   de 7 dias. Un proyecto pausado responde 540 a todo —base, auth, funciones— y el proxy falla
//   cerrado, como corresponde. Resultado: los tres productos dejan de abrir sin que nadie haya
//   tocado nada, y sin aviso.
//
//   Con el volumen actual eso pasa solo. Este endpoint hace una consulta real a la base una vez
//   por dia y reinicia el contador de inactividad.
//
//   OJO: no alcanza con visitar la URL del proyecto. Supabase mira consultas a la base.
//   Por eso esto lee una tabla de verdad.
//
// COMO SE ACTIVA
//   1. Este archivo en  api/latido.js
//   2. La entrada `crons` en vercel.json (ver abajo)
//   3. Opcional pero recomendado: variable CRON_SECRET en Vercel.
//      Si esta definida, se exige. Si no, el endpoint queda abierto: no hace dano
//      —solo lee— pero cualquiera podria invocarlo.
//
// LIMITES DEL PLAN HOBBY DE VERCEL
//   Una corrida por dia como maximo, y puede llegar en cualquier momento de la hora indicada.
//   Para lo que necesitamos —no pasar de 7 dias— sobra. El cron invoca siempre con GET.

const TABLA = '/rest/v1/modulos?select=id&limit=1';

// El latido aprovecha el viaje diario para caducar las suscripciones vencidas.
// Sin esto, quien cancela se queda con el plan pago para siempre: cancelar() sólo
// marca el estado, y es caducar() quien efectivamente baja a gratis al vencer.
async function caducarVencidos(url, clave) {
  const r = await fetch(url + '/rest/v1/rpc/caducar', {
    method: 'POST',
    headers: { apikey: clave, Authorization: 'Bearer ' + clave, 'content-type': 'application/json' },
    body: '{}',
  });
  if (!r.ok) throw new Error('caducar devolvio ' + r.status);
  return await r.json();
}

export default async function handler(req, res) {
  // Si hay secreto configurado, se exige. Vercel lo manda como Bearer.
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

  const arranque = Date.now();
  try {
    const r = await fetch(url + TABLA, {
      headers: { apikey: clave, Authorization: 'Bearer ' + clave },
    });

    const vivo = r.ok;
    const registro = {
      evento: 'latido',
      estado: r.status,
      vivo: vivo,
      ms: Date.now() - arranque,
    };

    // 540 = proyecto pausado. Queda gritando en los registros de Vercel.
    if (r.status === 540) {
      registro.aviso = 'PROYECTO PAUSADO — hay que restaurarlo desde el panel de Supabase';
    } else if (!vivo) {
      registro.aviso = 'LA BASE NO RESPONDE BIEN';
    }

    // Sólo si la base contestó. Un fallo acá no invalida el latido: son tareas
    // distintas y la primera ya cumplió su objetivo.
    if (vivo) {
      try {
        registro.caducados = await caducarVencidos(url, clave);
      } catch (e) {
        registro.aviso_caducar = String((e && e.message) || e);
      }
    }
    console.log(JSON.stringify(registro));

    return res.status(vivo ? 200 : 503).json(registro);
  } catch (e) {
    const registro = {
      evento: 'latido',
      vivo: false,
      aviso: 'LA BASE NO RESPONDE',
      detalle: String((e && e.message) || e),
      ms: Date.now() - arranque,
    };
    console.error(JSON.stringify(registro));
    return res.status(503).json(registro);
  }
}
