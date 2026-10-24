// Mi Alimentacion - service worker minimo (trasladado de Mis Gastos).
// Solo permite instalar la aplicacion. No guarda menus, registros,
// pesos ni respuestas del servicio: todo se pide siempre a internet.
const VERSION_AL = 'al-v4-1';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', function (e) {
  // Solo la propia pagina; nunca las consultas al servicio de Google.
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).catch(function () {
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" ' +
      'content="width=device-width,initial-scale=1"><body style="font-family:' +
      'system-ui;background:#F8F7F2;color:#2F5540;padding:32px;text-align:center">' +
      '<h2>Sin conexión</h2><p>Mi Alimentación necesita internet para mantener sus datos sincronizados.' +
      '</p><button onclick="location.reload()" style="height:48px;padding:0 24px;' +
      'border-radius:14px;border:none;background:#5E8B6E;color:#fff;font-size:16px">' +
      'Reintentar</button></body>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }));
});
