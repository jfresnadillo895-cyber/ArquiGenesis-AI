// api/catalogo.js — Catálogo comercial: única fuente de verdad de precios por plan
// ---------------------------------------------------------------------------------------------
// POR QUE EXISTE
//   Hasta el 01/08, suscribir.js tenía su propia copia de los precios y pago.js su propia
//   copia de los umbrales para reconocerlos. El 29/07 un precio de prueba en suscribir.js
//   sin su umbral correspondiente en pago.js dejó un pago aprobado sin acreditar. El mismo
//   patrón volvió a aparecer con Magister, esta vez en la base de datos. Este archivo no
//   elimina el riesgo del todo (la base sigue siendo aparte, ver nota abajo) pero sí elimina
//   la duplicación entre suscribir.js y pago.js: los dos importan de acá.
//
// COMO SE USA
//   suscribir.js:  import { PLANES } from './catalogo.js';         (para armar el cobro)
//   pago.js:       import { planPorMonto } from './catalogo.js';   (para reconocer el pago)
//   Además funciona como endpoint propio: GET /api/catalogo devuelve la lista en JSON,
//   pensado para el día que la pantalla de planes deje de tener los precios hardcodeados
//   en candado.txt y los pida acá en vez de repetirlos. Ese cambio queda para más adelante;
//   por ahora candado.txt sigue con su propia copia de la parte visual (nombre, lema, qué
//   incluye) — la clave es que el NÚMERO que se cobra y el NÚMERO que se reconoce ya no
//   puedan desincronizarse entre sí.
//
// LO QUE ESTE ARCHIVO NO CONTROLA
//   Los créditos que efectivamente se otorgan salen de creditos_de() en Postgres, no de acá.
//   El campo `creditos` de abajo es informativo (para mostrar, y para chequear a ojo que
//   coincida) — si se cambia un plan, revisar TAMBIÉN creditos_de() y nivel_plan() en la base.
//   No hay forma de que un archivo JS y una función SQL se mantengan sincronizados solos sin
//   agregar una llamada en vivo entre los dos; por ahora se mantiene a mano, con este
//   comentario como recordatorio en el único lugar donde se define el precio.

export const PLANES = {
  profesional: {
    id: 'profesional',
    nombre: 'Profesional',
    titulo: 'Comprender · Profesional',   // "reason" que ve el comprador en Mercado Pago
    monto: 30000,      // ARS, lo que se cobra
    umbral: 20000,     // ARS, minimo para reconocer este plan en un webhook
    creditos: 1800,    // informativo -- la fuente real es creditos_de() en Postgres
  },
  estudio: {
    id: 'estudio',
    nombre: 'Pro · Estudio',
    titulo: 'Comprender · Estudio',
    monto: 80000,
    umbral: 60000,
    creditos: 4500,
  },
  magister: {
    id: 'magister',
    nombre: 'Magister',
    titulo: 'Comprender · Magister',
    monto: 160000,
    umbral: 120000,
    creditos: 9000,
  },
};

// Reconoce el plan por el monto cobrado -- es lo unico que Mercado Pago garantiza en
// todos los tipos de aviso. Se ordena de mayor a menor umbral y gana el primero que
// el monto alcanza, para que un monto grande nunca caiga en el umbral de un plan menor.
export function planPorMonto(monto) {
  const m = Number(monto) || 0;
  const ordenado = Object.values(PLANES).sort((a, b) => b.umbral - a.umbral);
  for (const p of ordenado) if (m >= p.umbral) return p.id;
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: { message: 'Metodo no permitido.' } });
  }
  const publico = Object.values(PLANES).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    precio_ars: p.monto,
    creditos: p.creditos,
  }));
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json({ planes: publico });
}
