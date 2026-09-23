// Service worker del Odontograma 3D de Fassiara.
// Objetivo: que la aplicación abra y funcione en el sillón aunque se caiga el internet.
// Estrategia: la página y las librerías se sirven de caché y se refrescan en segundo plano;
// los modelos 3D (grandes y que no cambian) se guardan la primera vez que se usan.

const VERSION = 'fassiara-odontograma-v2';
const ESENCIALES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './dientes_posiciones.json',
  './dientes_superiores_posiciones.json',
  './dientes_temporales_inferiores.json',
  './dientes_temporales_superiores.json',
  './raices_inferior.json',
  './raices_superior.json',
  './raices_temporal_inferior.json',
  './raices_temporal_superior.json',
  './fuentes/Inter-400.woff2',
  './fuentes/Inter-500.woff2',
  './fuentes/Inter-600.woff2',
  './fuentes/Inter-700.woff2',
  './fuentes/CormorantGaramond-500.woff2',
  './fuentes/CormorantGaramond-600.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(ESENCIALES).catch(() => { /* si alguno falla, se cachea al usarlo */ }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const esModelo = /\.(glb|json|woff2)$/.test(url.pathname);
  const esLibreria = /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|gstatic\.com/.test(url.host);

  // Modelos y librerías: primero la caché (no cambian y pesan)
  if (esModelo || esLibreria) {
    e.respondWith(
      caches.match(req).then(guardado => guardado || fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copia = res.clone();
          caches.open(VERSION).then(c => c.put(req, copia));
        }
        return res;
      }).catch(() => guardado))
    );
    return;
  }

  // Página y resto: se intenta la red y, si no hay, se sirve lo guardado
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok && url.origin === self.location.origin) {
        const copia = res.clone();
        caches.open(VERSION).then(c => c.put(req, copia));
      }
      return res;
    }).catch(() => caches.match(req).then(g => g || caches.match('./index.html')))
  );
});
