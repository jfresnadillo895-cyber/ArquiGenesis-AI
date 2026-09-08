// lib/vr1-core-sandbox-engine.mjs
//
// 122.30: este archivo pasa a ser un re-export de compatibilidad. El motor real
// vive ahora en el módulo canónico de producción lib/epistemic-ledger.mjs (§5 del
// contrato 122.30). El archivo histórico no se borra -- lib/vr1-core-sandbox-bridge.mjs
// y su banco de pruebas de laboratorio certificado siguen importando desde acá sin
// ningún cambio de ruta ni de comportamiento observable.
export * from './epistemic-ledger.mjs';
