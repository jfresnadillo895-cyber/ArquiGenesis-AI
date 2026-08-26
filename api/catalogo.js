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

// PLAN-C2A (26/08): separa "existe en el catálogo" de "se puede contratar". La oferta pública
// nueva tiene un único plan pago (profesional); estudio/magister siguen existiendo tal cual
// (mismo precio, mismos ids de Lemon Squeezy, mismos umbrales) porque hacen falta para reconocer
// webhooks y perfiles legacy -- pero contratable:false los saca de la oferta y del checkout
// nuevo sin borrar ni renombrar nada. Ver planContratable() más abajo.
export const PLANES = {
  profesional: {
    id: 'profesional',
    nombre: 'Profesional',
    titulo: 'Comprender · Profesional',   // "reason" que ve el comprador en Mercado Pago
    // PLAN-C2B (26/08): precio único de Profesional convergido a USD 25 / ARS 39.000. umbral
    // se deja sin tocar (20000) -- 39000 lo sigue superando con margen, no hace falta moverlo
    // para reconocer el webhook. ls_variant_id/ls_checkout_uuid NO se tocan: son el ID de un
    // producto real en Lemon Squeezy, no un numero que este archivo pueda decidir por su cuenta.
    // Si Javier reutiliza el MISMO producto/variant y le cambia el precio en el dashboard de
    // Lemon, esto queda correcto tal cual esta. Si en cambio crea un producto NUEVO a USD 25,
    // hay que reemplazar estos dos valores por los que de el nuevo producto -- no inventarlos.
    monto: 39000,      // ARS, lo que se cobra
    umbral: 20000,     // ARS, minimo para reconocer este plan en un webhook
    creditos: 1800,    // informativo -- la fuente real es creditos_de() en Postgres
    ls_variant_id: 2018880,   // Lemon Squeezy, LIVE MODE (cargado 14/08, reemplaza el de test) -- para RECONOCER el plan en el webhook
    ls_checkout_uuid: '6ad9844e-ca2b-4b50-bac8-310d516c1abd',   // LIVE MODE -- para ARMAR el link de checkout (distinto del variant_id)
    ls_precio_usd: 25,        // USD/mes, mercado internacional (PLAN-C2B, 26/08 -- antes 19)
    contratable: true,
  },
  estudio: {
    id: 'estudio',
    nombre: 'Pro · Estudio',
    titulo: 'Pro · Estudio',
    monto: 80000,
    umbral: 60000,
    creditos: 4500,
    ls_variant_id: 2018881,   // LIVE MODE (cargado 14/08, reemplaza el de test)
    ls_checkout_uuid: '5c6710b6-12ae-4997-8d51-f0736b316bb1',   // LIVE MODE
    ls_precio_usd: 49,
    contratable: false,   // PLAN-C2A (26/08): retirado de la oferta pública, sigue existiendo para reconocer legacy
  },
  magister: {
    id: 'magister',
    nombre: 'Magister',
    titulo: 'Comprender · Magister',
    monto: 160000,
    umbral: 120000,
    creditos: 9000,
    ls_variant_id: 1977959,
    ls_checkout_uuid: '7ac80877-1dfb-4ccd-b52c-162956f064d7',
    ls_precio_usd: 79,
    contratable: false,   // ya estaba en pausa/fuera de comercialización desde antes (17/08)
  },
};

// PLAN-C2A (26/08): única fuente de verdad de "se puede contratar hoy". No filtra
// planPorVariante()/planPorMonto() -- esas reconocen cobros/webhooks ya existentes de
// cualquier plan del catálogo, contratable o no; sólo el endpoint público y el armado de
// checkouts nuevos deben mirar este flag.
export function planContratable(planId) {
  const p = PLANES[planId];
  return !!(p && p.contratable);
}

// Arma el link de checkout de Lemon Squeezy para un plan, con el perfil como dato
// personalizado -- es lo que va a usar el futuro boton "Suscribirme" internacional.
// PLAN-C2A (26/08): null también si el plan no es contratable -- evita armar un checkout
// nuevo de Estudio/Magister aunque alguien conozca su ls_checkout_uuid.
export function checkoutLemonSqueezy(planId, perfilId) {
  const p = PLANES[planId];
  if (!p || !p.ls_checkout_uuid || !p.contratable) return null;
  return 'https://' + LS_STORE + '.lemonsqueezy.com/checkout/buy/' + p.ls_checkout_uuid +
    '?checkout[custom][perfil]=' + encodeURIComponent(perfilId);
}
const LS_STORE = 'comprenderai';   // subdominio de la tienda en Lemon Squeezy

// Reconoce el plan por la variante de Lemon Squeezy -- el equivalente de
// planPorMonto() para el adaptador internacional (api/lemonsqueezy.js).
// Cada variante corresponde a un plan y no cambia; no hace falta ordenar
// por umbral como con el monto de Mercado Pago.
export function planPorVariante(variantId) {
  const v = String(variantId);
  for (const p of Object.values(PLANES)) {
    if (p.ls_variant_id != null && String(p.ls_variant_id) === v) return p.id;
  }
  return null;
}

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
  // PLAN-C2A (26/08): sólo se publica lo contratable -- Estudio y Magister (precios, créditos,
  // uuid de checkout incluidos) dejan de exponerse acá. planPorVariante()/planPorMonto() siguen
  // recorriendo el catálogo completo para reconocer webhooks; esto es sólo lo que ve el público.
  const publico = Object.values(PLANES)
    .filter((p) => p.contratable)
    .map((p) => ({
      id: p.id,
      nombre: p.nombre,
      precio_ars: p.monto,
      creditos: p.creditos,
      precio_usd: p.ls_precio_usd,           // Corte B.6 -- para el link "Pagar en USD"
      ls_checkout_uuid: p.ls_checkout_uuid,  // idem -- arma el link de checkout de Lemon Squeezy
    }));
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json({ planes: publico });
}
