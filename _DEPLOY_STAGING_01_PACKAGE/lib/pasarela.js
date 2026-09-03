// lib/pasarela.js — Reconoce por que pasarela paga un perfil (Corte M)
// ---------------------------------------------------------------------------------------------
// POR QUE EXISTE
//   lib/cuenta.js (Corte K/L) ya resuelve esto en linea, mirando el prefijo del ultimo
//   pago_externo de un perfil ('ls_' = Lemon Squeezy, sin prefijo = Mercado Pago). El Corte M
//   necesita exactamente lo mismo en api/cambiar-plan.js y en el cron -- en vez de copiar el
//   fragmento una tercera vez, se extrae aca. lib/cuenta.js NO se tocó: sigue con su propia
//   copia en linea, funcionando igual que antes, para no arriesgar el flujo ya probado de
//   eliminarCuentaCompleta() por un cambio que no le hacia falta.
//
// LIMITE CONOCIDO (el mismo que ya tenia lib/cuenta.js)
//   Si un perfil nunca tuvo ningun pago real todavia (pagos vacio), esto devuelve null -- no
//   hay forma de saber la pasarela sin al menos un pago_externo registrado. api/cambiar-plan.js
//   trata ese caso como "sin pasarela reconocible", y no deja cambiar de plan (solo se puede
//   cambiar una suscripcion que ya se sabe donde vive).

export async function pasarelaDe(perfilId, SB_URL, SERVICE_KEY) {
  const r = await fetch(
    SB_URL + '/rest/v1/pagos?perfil=eq.' + perfilId + '&select=pago_externo&order=momento.desc&limit=1',
    { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } }
  );
  const filas = r.ok ? await r.json().catch(() => []) : [];
  const pagoExterno = filas && filas[0] && filas[0].pago_externo;
  if (!pagoExterno) return null;
  return String(pagoExterno).indexOf('ls_') === 0 ? 'lemonsqueezy' : 'mercadopago';
}
