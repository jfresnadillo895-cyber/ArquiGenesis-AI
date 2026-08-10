/* Service worker minimo (10/08) -- existe solo para que Chrome reconozca la pagina como
   "instalable de verdad" y habilite el boton "Instalar la app" con un toque (beforeinstallprompt
   necesita un service worker con manejador de fetch registrado). A proposito NO cachea nada:
   cada pedido va directo a la red, asi nunca sirve una version vieja del codigo despues de un
   deploy -- ese era justamente el riesgo que se queria evitar al no sumar uno antes. */
self.addEventListener('install', function(e){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(e){
  e.respondWith(fetch(e.request));
});
