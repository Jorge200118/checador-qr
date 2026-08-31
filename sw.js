// Service Worker para Sistema Checador QR
const CACHE_NAME = 'checador-qr-v2'; // v2: bloqueo de horario (Fase 1-A)
const urlsToCache = [
    '/',
    '/app.js',
    '/supabase-config.js',
    '/bloqueo-horario.js',
    '/styles.css',
    '/manifest.json'
];

// Instalación del Service Worker
self.addEventListener('install', (event) => {
    console.log('📱 Service Worker instalando...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('📱 Cache abierto');
                return cache.addAll(urlsToCache);
            })
            .catch((error) => {
                console.log('📱 Error cacheando:', error);
            })
    );
    self.skipWaiting();
});

// Activación del Service Worker
self.addEventListener('activate', (event) => {
    console.log('📱 Service Worker activado');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('📱 Eliminando cache viejo:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    event.waitUntil(self.clients.claim());
});

// Interceptar peticiones de red
self.addEventListener('fetch', (event) => {
    // Solo cachear requests GET
    if (event.request.method === 'GET') {
        event.respondWith(
            caches.match(event.request)
                .then((response) => {
                    // Cache hit - devolver respuesta
                    if (response) {
                        return response;
                    }

                    // IMPORTANTE: Clone the request. A request is a stream and
                    // can only be consumed once.
                    const fetchRequest = event.request.clone();

                    return fetch(fetchRequest).then((response) => {
                        // Check if we received a valid response
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        // IMPORTANTE: Clone the response. A response is a stream
                        // and because we want the browser to consume the response
                        // as well as the cache consuming the response, we need
                        // to clone it so we have two streams.
                        const responseToCache = response.clone();

                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(event.request, responseToCache);
                            });

                        return response;
                    }).catch(() => {
                        console.log('📱 Offline - no se pudo obtener:', event.request.url);
                        // Podrías devolver una página offline aquí
                        return new Response('Offline', {
                            status: 200,
                            statusText: 'OK',
                            headers: new Headers({
                                'Content-Type': 'text/plain'
                            })
                        });
                    });
                })
        );
    }
});

// Escuchar mensajes del cliente
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

console.log('📱 Service Worker cargado correctamente');