// lib/comm-emitir.js — Puente entre productores reales y el sistema de comunicaciones (Corte F)
// ---------------------------------------------------------------------------------------------
// QUE ES
//   La UNICA funcion que un modulo productor real (pago.js, lemonsqueezy.js, organismos.js)
//   llama para convertir "algo paso de verdad" en un acontecimiento del sistema
//   comunicacional. Documento maestro, 5.3: "los modulos productores solo declaran
//   acontecimientos mediante contratos comunes. No conocen proveedores, credenciales,
//   plantillas concretas ni estados externos" -- ningun productor sabe que existe Brevo,
//   Corte D, webhooks, ni siquiera que la entrega es via bandeja. Solo declara QUE paso.
//
// POR QUE VIVE FUERA DE api/ (en /lib, no en /api)
//   Vercel Hobby cuenta como "funcion serverless" cada archivo que hay directamente dentro
//   de api/ -- lo confirma catalogo.js, que no exporta ningun handler y sin embargo contaba
//   para el limite de 12 (fue una de las razones por las que Corte D tuvo que consolidar
//   nueve archivos en uno). Este archivo NO es un endpoint -- es una libreria que importan
//   otros archivos de api/. Si viviera dentro de api/, gastaria un cupo de funcion sin
//   necesidad.
//
// AISLAMIENTO (documento maestro, banco de aceptacion del Corte F)
//   emitirYNotificar() NUNCA lanza una excepcion hacia quien la llama. Un fallo del sistema
//   comunicacional (Supabase caido, RPC con error, lo que sea) no puede tirar abajo un pago
//   real ni el guardado de un organismo real -- eso seria peor que no tener el aviso. Todo
//   el cuerpo esta en un try/catch que solo registra en los logs.
//
// COMO USARLO (desde un api/*.js que ya tiene SB_URL y SERVICE_KEY)
//   import { emitirYNotificar } from '../lib/comm-emitir.js';
//   await emitirYNotificar({
//     SB_URL, SERVICE_KEY,
//     organizationId: perfil, purposeId: 'plan_activado', type: 'plan.activado',
//     producer: 'pago_mercadopago', payload: { plan, dias: 30 },
//     titulo: 'Tu plan quedo activo', resumen: `Tu plan ${plan} esta activo.`,
//   });
//
// QUE HACE ADENTRO (los mismos pasos que ya usa api/comm.js, en el mismo orden)
//   1. comm_ingresar_evento   -- si es "cuarentena" o "repetido", no hay nada mas que hacer.
//   2. comm_evaluar_decision  -- si no es AUTHORIZED (DENIED/HELD/DISCARDED), correcto no
//      seguir: es exactamente el caso de aceptacion "no envio".
//   3. comm_preparar_entrega  -- aplica preferencias/consentimiento/suspensiones/notBefore/
//      dependencia/presion (Cortes C, D, E). Si queda "retenido", tampoco se sigue --
//      vuelve a intentarse solo con el barrido diario (Corte E) cuando corresponda.
//   4. comm_entregar_bandeja  -- solo si "listo": crea la entrada visible y cierra el trabajo.
//
// DESACTIVACION INDEPENDIENTE
//   No hace falta tocar este archivo ni ningun api/*.js para apagar un modulo: alcanza con
//   `update comm_purposes set vigente=false where id='plan_activado'` (o el que sea) en
//   Supabase -- comm_evaluar_decision ya lo respeta desde el Corte A.

async function rpc(nombre, cuerpo, SB_URL, SERVICE_KEY) {
  const r = await fetch(SB_URL + '/rest/v1/rpc/' + nombre, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) throw new Error('rpc ' + nombre + ' devolvio ' + r.status + ' ' + (await r.text()).slice(0, 300));
  const d = await r.json();
  return Array.isArray(d) ? d[0] : d;
}

const registrar = (o) => console.log(JSON.stringify({ evento: 'comm_emitir', ...o }));

export async function emitirYNotificar({
  SB_URL, SERVICE_KEY, organizationId, purposeId, type, producer, payload,
  titulo, resumen, accionRequerida, venceEn, canal, eventId, occurredAt,
}) {
  try {
    if (!SB_URL || !SERVICE_KEY || !organizationId || !purposeId) {
      registrar({ error: 'faltan_datos_obligatorios', purposeId });
      return { emitido: false, motivo: 'faltan_datos_obligatorios' };
    }

    const evId = eventId || (globalThis.crypto && globalThis.crypto.randomUUID
      ? globalThis.crypto.randomUUID()
      : 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2));

    const ing = await rpc('comm_ingresar_evento', {
      p_event_id: evId, p_version: 1, p_type: type || purposeId, p_producer: producer || 'desconocido',
      p_organization_id: organizationId, p_purpose_id: purposeId,
      p_occurred_at: occurredAt || new Date().toISOString(), p_payload: payload || {},
    }, SB_URL, SERVICE_KEY);

    if (!ing || ing.estado !== 'registrado') {
      registrar({ accion: ing ? ing.estado : 'sin_respuesta', purposeId, organization: String(organizationId).slice(0, 8) });
      return { emitido: false, motivo: ing ? ing.estado : 'sin_respuesta' };
    }

    const dec = await rpc('comm_evaluar_decision', { p_event_id: evId }, SB_URL, SERVICE_KEY);
    if (!dec || dec.resultado !== 'AUTHORIZED') {
      // caso de aceptacion "no envio": una finalidad denegada/descartada/retenida no
      // sigue de largo -- es lo correcto, no un error.
      registrar({ accion: 'no_autorizado', resultado: dec ? dec.resultado : null, purposeId, organization: String(organizationId).slice(0, 8) });
      return { emitido: false, motivo: dec ? dec.resultado : 'sin_decision' };
    }

    const prep = await rpc('comm_preparar_entrega', {
      p_job_id: dec.job_id, p_organization_id: organizationId, p_canal: canal || 'inapp',
    }, SB_URL, SERVICE_KEY);
    if (!prep || prep.estado !== 'listo') {
      registrar({ accion: 'retenido', motivo: prep ? prep.motivo : null, job_id: dec.job_id, purposeId, organization: String(organizationId).slice(0, 8) });
      return { emitido: false, motivo: prep ? prep.motivo : 'sin_preparar', job_id: dec.job_id };
    }

    const entrega = await rpc('comm_entregar_bandeja', {
      p_job_id: dec.job_id, p_organization_id: organizationId,
      p_titulo: titulo || purposeId, p_resumen: resumen || null,
      p_accion_requerida: !!accionRequerida, p_vence_en: venceEn || null,
    }, SB_URL, SERVICE_KEY);

    registrar({
      accion: entrega && entrega.ok ? 'entregado' : 'fallo_entrega', motivo: entrega ? entrega.motivo : null,
      job_id: dec.job_id, entry_id: entrega ? entrega.entry_id : null, purposeId, organization: String(organizationId).slice(0, 8),
    });
    return { emitido: !!(entrega && entrega.ok), job_id: dec.job_id, entry_id: entrega ? entrega.entry_id : null };

  } catch (e) {
    // aislamiento: se registra, nunca se propaga. Un fallo aca no puede tirar abajo
    // al productor real que llamo (un pago, un guardado de organismo, etc.).
    registrar({ error: 'fallo_aislado', purposeId, detalle: String((e && e.message) || e) });
    return { emitido: false, motivo: 'error_aislado' };
  }
}
