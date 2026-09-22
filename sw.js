// Service Worker del checador.
//
// Tiene dos trabajos distintos y por eso hay dos caches:
//
//   checador-app-vN   el codigo de la app. Se sirve de RED PRIMERO, para que un
//                     cambio llegue a la tableta el mismo dia. La version sube
//                     con cada cambio y la anterior se borra.
//
//   checador-modelos  los modelos y librerias de CDN. 67 MB que NO cambian y
//                     que NO llevan version: sobreviven a cada actualizacion de
//                     codigo, porque re-bajarlos cuesta minutos en el wifi de
//                     una sucursal.
//
// POR QUE ESTO IMPORTA
// --------------------
// La deteccion y la verificacion de rostro le agregaron 67 MB a la tableta:
//   sface_2021dec.onnx                 36.90 MB   <- el servidor manda no-cache
//   ort-wasm-simd-threaded.jsep.wasm   20.29 MB
//   vision_wasm_internal.wasm           8.99 MB
//   blaze_face_short_range.tflite       0.22 MB   <- caduca cada hora
//
// Supabase Storage sirve sus archivos publicos con Cache-Control: no-cache, asi
// que el navegador revalida el modelo cada vez; y 37 MB en un solo archivo es
// mas de lo que Chrome guarda en el disco de una tableta, asi que en la practica
// se re-descargaba completo. Aqui se guarda a proposito y no se vuelve a pedir.
//
// Y LO QUE NUNCA SE TOCA
// ----------------------
// Las llamadas a la base (REST, storage de fotos) pasan derecho. Una checada
// jamas debe contestarse desde un cache.

const VERSION = 'v8';
const CACHE_APP = `checador-app-${VERSION}`;
const CACHE_MODELOS = 'checador-modelos';   // a proposito SIN version

const ARCHIVOS_APP = [
    '/',
    '/app.js',
    '/supabase-config.js',
    '/bloqueo-horario.js',
    '/voz.js',
    '/deteccion-cara.js',
    '/verificacion-rostro.js',
    '/styles.css',
    '/manifest.json'
];

// Pesados, inmutables y con la version en la URL (o modelos que no cambian).
// Se guardan para siempre.
function esModelo(url) {
    return url.includes('/storage/v1/object/public/modelos/')
        || url.includes('onnxruntime-web@')
        || url.includes('tasks-vision@')
        || url.includes('mediapipe-models/')
        || url.includes('@zxing/library@');
}

// Todo lo que sea hablar con la base de datos. Nunca se cachea ni se intercepta.
function esBaseDeDatos(url) {
    return url.includes('/rest/v1/')
        || url.includes('/auth/v1/')
        || url.includes('/realtime/v1/')
        || (url.includes('/storage/v1/') && !url.includes('/modelos/'));
}

self.addEventListener('install', (event) => {
    console.log('📱 Service Worker instalando', VERSION);
    // Uno por uno, NO con addAll.
    //
    // addAll es todo o nada: si UN archivo da 404, falla completo y la app se
    // queda sin cachear NADA. Eso importa justo el dia que se sube un archivo
    // nuevo —como los dos del rostro— porque entre que se publica el sw.js que
    // ya lo lista y que el archivo llega al sitio, hay una ventana en la que
    // cualquier tableta que instale el SW se quedaria sin cache.
    //
    // Asi, lo que si esta se guarda y lo que falta se intenta en la siguiente
    // instalacion. Peor es quedarse sin cache: son 8 sucursales, una de ellas
    // con 12 KB/s medidos.
    event.waitUntil(
        caches.open(CACHE_APP).then(cache =>
            Promise.all(ARCHIVOS_APP.map(archivo =>
                cache.add(archivo).catch(e =>
                    console.log(`📱 No se pudo cachear ${archivo}:`, e.message))
            ))
        ).catch(error => console.log('📱 Error cacheando la app:', error))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('📱 Service Worker activado', VERSION);
    event.waitUntil(
        caches.keys().then(nombres => Promise.all(
            nombres.map(nombre => {
                // El cache de modelos se conserva pase lo que pase: son 67 MB
                // que no tienen por que volver a bajarse porque cambio app.js.
                if (nombre === CACHE_APP || nombre === CACHE_MODELOS) return null;
                console.log('📱 Eliminando cache viejo:', nombre);
                return caches.delete(nombre);
            })
        )).then(() => self.clients.claim())
    );
});

// Guardar sin que una falla de cuota tumbe la peticion.
async function guardar(nombreCache, request, response) {
    try {
        const cache = await caches.open(nombreCache);
        await cache.put(request, response);
    } catch (e) {
        console.log('📱 No se pudo guardar en cache:', request.url, e);
    }
}

// Modelos: del cache si esta, y si no de la red guardandolo.
async function modeloPrimeroDelCache(request) {
    const guardado = await caches.match(request, { cacheName: CACHE_MODELOS });
    if (guardado) return guardado;

    const respuesta = await fetch(request);
    if (respuesta && (respuesta.ok || respuesta.type === 'opaque')) {
        await guardar(CACHE_MODELOS, request, respuesta.clone());
    }
    return respuesta;
}

// Codigo de la app: de la red, y el cache solo como red de seguridad. Al reves
// de como estaba, que era la razon por la que las tabletas seguian corriendo
// codigo viejo.
async function redPrimero(request) {
    try {
        const respuesta = await fetch(request);
        if (respuesta && respuesta.ok && respuesta.type === 'basic') {
            await guardar(CACHE_APP, request, respuesta.clone());
        }
        return respuesta;
    } catch (e) {
        const guardado = await caches.match(request, { cacheName: CACHE_APP });
        if (guardado) return guardado;
        return new Response('Sin conexión', {
            status: 503,
            headers: new Headers({ 'Content-Type': 'text/plain' })
        });
    }
}

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = event.request.url;

    // La base de datos pasa derecho: sin cache y sin intermediarios.
    if (esBaseDeDatos(url)) return;

    if (esModelo(url)) {
        event.respondWith(modeloPrimeroDelCache(event.request));
        return;
    }

    if (new URL(url).origin === self.location.origin) {
        event.respondWith(redPrimero(event.request));
    }
    // Cualquier otra cosa de fuera se deja al navegador.
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

console.log('📱 Service Worker cargado', VERSION);
