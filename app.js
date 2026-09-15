// CONFIGURACIÓN GLOBAL
// OJO: esta es la version de PRODUCCION, la de las 8 sucursales, y NO trae
// reconocimiento facial.
//
// El id tiene que quedarse en TABLET_01: es la etiqueta con la que las 8
// sucursales llevan guardando sus checadas. La tableta en prueba usa otro
// (MOCHIS_PRUEBA) justo para no perderse entre estas.
const TABLET_CONFIG = {
    id: 'TABLET_01',
    location: 'PTRN01'
    // apiUrl ya no se usa - Supabase se configura en supabase-config.js
};

// Cada cuanto se revisa la camara buscando un QR. Ver el comentario largo en
// startNativeScanning: mas seguido no encuentra el QR mas rapido, solo calienta
// la tableta.
const ESCANEO_INTERVALO_MS = 66;

// Cuanto se queda en pantalla el mensaje de "¡BIENVENIDO!" si la persona no le
// da a Continuar. Tres segundos era muy poco: alguien que voltea tantito ya no
// alcanza a ver si su checada quedo.
const MENSAJE_MS = 6000;

// El rechazo se queda mas tiempo: hay que leerlo y entenderlo, no solo verlo.
const MENSAJE_RECHAZO_MS = 10000;

// A que tamano se guarda la foto de la checada.
//
// La camara da 1920x1080 y asi se venia guardando: 170 KB. En la tableta esa
// subida tardo 13,982 ms (medido el 2026-09-02), o sea 12 KB/s — la conexion de
// esa sucursal esta para revisarse aparte, pero de este lado no hay por que
// mandar el doble de lo necesario.
//
// A 1280 pesa la mitad y NO cambia el reconocimiento: la misma foto dio 0.605 a
// 1920 y 0.599 a 1280. Las caras siguen saliendo de 170 a 270 px, muy por
// encima de los 112 que necesita el modelo.
const FOTO_ANCHO_MAXIMO = 1280;
const FOTO_CALIDAD = 0.8;

// Cronometro de la checada. Siempre escribe en la consola; si la direccion trae
// ?tiempos=1 tambien los pinta en pantalla, que es la unica forma comoda de
// medir en una tableta a la que no se le puede abrir la consola.
const MOSTRAR_TIEMPOS = location.search.includes('tiempos=1');
let _tiempos = {};
function marcarTiempo(etapa, desde) {
    const ms = Math.round(performance.now() - desde);
    _tiempos[etapa] = ms;
    console.log(`⏱️ ${etapa}: ${ms}ms`);
    return performance.now();
}

// CÓDIGOS VÁLIDOS PARA LOGIN
const CODIGOS_VALIDOS = ['1810'];

// ESTADO DE LA APLICACIÓN
let appState = {
    authenticated: false,
    currentMode: null,
    scanning: false,
    processing: false,
    connected: true,
    lastPing: new Date(),
    stream: null,
    zxingReader: null,
    currentView: 'main'
};

// ELEMENTOS DOM
const elements = {
    // Auth
    authSection: document.getElementById('authSection'),
    authForm: document.getElementById('authForm'),
    accessCode: document.getElementById('accessCode'),
    
    // Main
    mainContent: document.getElementById('mainContent'),
    btnEntrada: document.getElementById('btnEntrada'),
    btnSalida: document.getElementById('btnSalida'),
    btnCancelScan: document.getElementById('btnCancelScan'),
    
    // Camera
    cameraPanel: document.getElementById('cameraPanel'),
    cameraSection: document.getElementById('cameraPanel'),
    videoElement: document.getElementById('videoElement'),
    canvasElement: document.getElementById('canvasElement'),
    
    // Messages
    messageSection: document.getElementById('messageSection'),
    loadingSection: document.getElementById('loadingSection'),
    messageIcon: document.getElementById('messageIcon'),
    messageTitle: document.getElementById('messageTitle'),
    messageText: document.getElementById('messageText'),
    employeeInfo: document.getElementById('employeeInfo'),
    messageCloseBtn: document.getElementById('messageCloseBtn'),
    cameraStatus: document.getElementById('cameraStatus'),
    cameraAviso: document.getElementById('cameraAviso'),
    footerVersion: document.getElementById('footerVersion'),
    
    // Status
    connectionStatus: document.getElementById('connectionStatus'),
    currentTime: document.getElementById('currentTime'),
    tabletId: document.getElementById('tabletId'),
    footerTabletId: document.getElementById('footerTabletId'),
    locationId: document.getElementById('locationId')
};

// El service worker existia desde hace tiempo pero NADIE lo registraba: el
// archivo estaba ahi y el navegador nunca lo cargo. Por eso los 67 MB de
// modelos se volvian a bajar, aunque el codigo dijera lo contrario.
//
// Se registra despues de que cargo la pagina para no pelearle el ancho de banda
// a la camara, y si falla se sigue sin el: es una mejora de velocidad, no un
// requisito para checar.
function registrarServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log('📱 Service Worker registrado'))
            .catch(e => console.warn('📱 No se pudo registrar el Service Worker:', e));
    });
}
registrarServiceWorker();

// QUE VERSION DEL CODIGO TRAE ESTA TABLETA, Y QUE SE ACTUALICE SOLA.
//
// Antes cada checada terminaba en location.reload(), asi que la tableta agarraba
// el codigo nuevo sin que nadie hiciera nada. Al quitar esa recarga —porque se
// comia la subida de la foto— se perdio ese efecto de lado: ahora la tableta se
// queda TODO EL DIA con el codigo que cargo en la mañana. Probando un arreglo,
// eso se vuelve adivinar si lo que falla es el arreglo o es la tableta.
//
// Cada 5 minutos se pregunta si hay version nueva, y solo se recarga cuando NO
// hay nadie checando ni ningun mensaje en pantalla.
const VIGILAR_VERSION_MS = 5 * 60 * 1000;
let _versionCargada = null;

// Se vigilan TODOS los archivos que deciden algo, no solo app.js. Vigilar uno
// solo tenia un hueco caro: un cambio a la validacion de la checada vive en
// supabase-config.js y bloqueo-horario.js, asi que se desplegaba, app.js no
// cambiaba, la tableta nunca se enteraba y seguia corriendo la regla vieja hasta
// que alguien la recargara a mano.
const ARCHIVOS_VIGILADOS = ['app.js', 'supabase-config.js', 'bloqueo-horario.js'];

async function etagDe(archivo) {
    try {
        const r = await fetch(archivo, { method: 'HEAD', cache: 'no-store' });
        return r.headers.get('etag') || r.headers.get('last-modified');
    } catch (e) {
        return null;
    }
}

// La huella de lo publicado: los ETag de todos los vigilados, pegados. Si
// cualquiera falta se devuelve null y no se recarga nada, que es el mismo
// criterio de siempre para cuando no hay red.
async function versionPublicada() {
    const etags = await Promise.all(ARCHIVOS_VIGILADOS.map(etagDe));
    if (etags.some(e => !e)) return null;
    return etags.join('|');
}

function tabletaOcupada() {
    if (typeof appState !== 'undefined' && appState.processing) return true;
    const panel = elements.messageSection;
    return !!(panel && panel.style.display && panel.style.display !== 'none');
}

async function vigilarVersion() {
    _versionCargada = await versionPublicada();
    if (elements.footerVersion && _versionCargada) {
        // Del ETag se toma el PRINCIPIO, no el final: Netlify le pega un "-ssl"
        // a todos, asi que la cola es igual en todas las versiones y no serviria
        // para distinguir nada. La comparacion de aqui abajo si usa el ETag
        // completo.
        const hash = _versionCargada.replace(/"/g, '').split('-')[0];
        elements.footerVersion.textContent = 'v' + hash.slice(0, 6);
    }
    console.log('📦 Versión del código:', _versionCargada);
    if (!_versionCargada) return;

    setInterval(async () => {
        if (tabletaOcupada()) return;
        const publicada = await versionPublicada();
        if (publicada && publicada !== _versionCargada) {
            console.log('📦 Hay versión nueva; se recarga la tableta');
            location.reload();
        }
    }, VIGILAR_VERSION_MS);
}

// INICIALIZAR APLICACIÓN
document.addEventListener('DOMContentLoaded', function() {
    vigilarVersion();
    initializeApp();
});

function initializeApp() {
    if (!verificarAuth()) return;

    console.log('🚀 Inicializando sistema checador...');

    // Inicializar Supabase
    if (!initSupabase()) {
        console.error('❌ Error: No se pudo inicializar Supabase');
        showError('Error de configuración', 'No se pudo conectar con la base de datos');
        return;
    }

    // Los switches se leen sin esperar: si tardan o fallan, la tableta arranca
    // igual y todo se comporta con los valores por omision.
    if (typeof cargarSwitches === 'function') cargarSwitches();

    // Configurar tablet
    setupTablet();

    // Configurar eventos
    setupEventListeners();

    // Verificar autenticación
    checkAuthentication();

    // Inicializar cámara
    initializeCamera();

    // Verificar conexión
    startHealthCheck();

    // Actualizar hora
    updateTime();
    setInterval(updateTime, 1000);

    // Prevenir que se duerma la pantalla
    preventSleep();

    // Los modelos de rostro se bajan AHORA, con la tableta recien prendida y sin
    // nadie esperando. Son 57 MB entre el modelo y el runtime: antes se pedian
    // al validar el QR, con la persona ya parada enfrente, y esa primera checada
    // del dia se llevaba todo el rato de la descarga. Van en el hueco libre del
    // navegador para no estorbarle a la camara ni al escaneo.
    if (typeof dcCargarDetector === 'function') {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => dcCargarDetector(), { timeout: 8000 });
        } else {
            setTimeout(() => dcCargarDetector(), 2000);
        }
    }
    if (typeof vrCalentarAlArrancar === 'function') vrCalentarAlArrancar();

    console.log('✅ Sistema inicializado correctamente');
}

function setupTablet() {
    elements.tabletId.textContent = TABLET_CONFIG.id;
    elements.footerTabletId.textContent = TABLET_CONFIG.id;
    elements.locationId.textContent = TABLET_CONFIG.location;
    document.title = `Checador QR - ${TABLET_CONFIG.id}`;

    // ✅ DETECCIÓN ESPECÍFICA DE RESOLUCIÓN
    const width = window.innerWidth;
    const height = window.innerHeight;

    console.log(`📐 Resolución detectada: ${width}x${height}`);

    // Agregar clase específica para 1340x800
    if (width >= 1280 && width <= 1400 && height >= 750 && height <= 850) {
        document.body.classList.add('resolution-1340x800');
        console.log('✅ Aplicando estilos para resolución 1340x800');
    }

    // Configurar modo kiosco si es posible
    if (document.documentElement.requestFullscreen) {
        document.addEventListener('click', function() {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(console.warn);
            }
        }, { once: true });
    }
}
function setupEventListeners() {
    // Formulario de autenticación
    if (elements.authForm) {
        elements.authForm.addEventListener('submit', handleAuth);
    }
    
    // Botones de acción
    if (elements.btnEntrada) {
        elements.btnEntrada.addEventListener('click', () => selectMode());
    }
    if (elements.btnSalida) {
        elements.btnSalida.addEventListener('click', () => selectMode());
    }
    if (elements.btnCancelScan) {
        elements.btnCancelScan.addEventListener('click', cancelScan);
    }
    
    // Cerrar mensajes
    if (elements.messageCloseBtn) {
        elements.messageCloseBtn.addEventListener('click', hideMessage);
    }
    
    // Eventos de teclado para accesibilidad
    document.addEventListener('keydown', handleKeyPress);
    
    // Eventos de visibilidad para pausar/reanudar cámara
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Eventos táctiles para tablets
    document.addEventListener('touchstart', handleTouch, { passive: true });
    
    // Prevenir zoom en inputs
    document.addEventListener('touchstart', function(event) {
        if (event.touches.length > 1) {
            event.preventDefault();
        }
    });
    
    let lastTouchEnd = 0;
    document.addEventListener('touchend', function(event) {
        const now = (new Date()).getTime();
        if (now - lastTouchEnd <= 300) {
            event.preventDefault();
        }
        lastTouchEnd = now;
    });
}

// VERIFICAR AUTENTICACIÓN
function verificarAuth() {
    const auth = localStorage.getItem('tablet_auth');
    if (auth !== 'true') {
        return true; // Para pruebas, permitir acceso sin login
    }
    return true;
}

function checkAuthentication() {
    showMainContent();
    // Iniciar escaneo automáticamente sin esperar a que toquen los botones
    setTimeout(() => {
        initAutoScanning();
    }, 500);
}

function handleAuth(e) {
    e.preventDefault();

    const code = elements.accessCode.value.trim();

    if (CODIGOS_VALIDOS.includes(code)) {
        localStorage.setItem('tablet_auth', 'true');
        appState.authenticated = true;
        showMainContent();
        elements.accessCode.value = '';
    } else {
        showAuthError('Código de acceso incorrecto');
        elements.accessCode.value = '';
        elements.accessCode.focus();
    }
}

function showAuthSection() {
    if (elements.authSection) {
        elements.authSection.style.display = 'flex';
    }
    if (elements.mainContent) {
        elements.mainContent.style.display = 'none';
    }
    if (elements.accessCode) {
        elements.accessCode.focus();
    }
}

function showMainContent() {
    if (elements.authSection) {
        elements.authSection.style.display = 'none';
    }
    if (elements.mainContent) {
        elements.mainContent.style.display = 'flex';
    }
}

function showAuthError(message) {
    if (elements.accessCode) {
        elements.accessCode.style.borderColor = '#ef4444';
        setTimeout(() => {
            elements.accessCode.style.borderColor = '#e5e7eb';
        }, 3000);
    }
}

// CARGAR ZXING DINÁMICAMENTE
async function loadZXing() {
    return new Promise((resolve, reject) => {
        if (typeof ZXing !== 'undefined') {
            console.log('✅ ZXing ya está disponible');
            resolve(true);
            return;
        }
        
        console.log('📦 Cargando ZXing...');
        
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/@zxing/library@latest/umd/index.min.js';
        script.crossOrigin = 'anonymous';
        
        script.onload = () => {
            console.log('✅ ZXing cargado correctamente');
            setTimeout(() => {
                if (typeof ZXing !== 'undefined') {
                    resolve(true);
                } else {
                    reject(new Error('ZXing no se inicializó correctamente'));
                }
            }, 500);
        };
        
        script.onerror = () => {
            console.error('❌ Error cargando ZXing');
            reject(new Error('No se pudo cargar ZXing'));
        };
        
        document.head.appendChild(script);
    });
}

// INICIALIZAR CÁMARA
// REEMPLAZAR initializeCamera para usar detector nativo:
async function initializeCamera() {
    try {
        console.log('📱 Solicitando permisos de cámara...');
        
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Tu navegador no soporta acceso a cámara');
        }
        
        // ✅ INICIALIZAR DETECTOR NATIVO PRIMERO
        const hasNativeDetector = await initializeBarcodeDetector();
        
        // Configurar cámara con máxima resolución
        await setupCamera();
        
        // Configurar ZXing como fallback
        if (!hasNativeDetector) {
            await setupZXingScanner();
        }
        
        console.log('✅ Cámara inicializada correctamente');
        console.log(`📡 Detector nativo: ${hasNativeDetector ? 'SÍ' : 'NO'}`);
        
    } catch (error) {
        console.error('❌ Error de cámara:', error);
        updateStatus(`❌ Error: ${error.message}`, 'error');
    }
}

// ✅ FUNCIÓN SEPARADA PARA CONFIGURAR CÁMARA
async function setupCamera() {
    const videoElement = elements.videoElement;
    
    // ✅ CONFIGURACIÓN ULTRA-ALTA RESOLUCIÓN PARA MEJOR DETECCIÓN
    const configs = [
        {
            facingMode: "user",
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            frameRate: { ideal: 60, min: 30 } // ✅ FPS ALTO PARA DETECTOR NATIVO
        },
        {
            facingMode: "user",
            width: { ideal: 1280, min: 800 },
            height: { ideal: 720, min: 600 },
            frameRate: { ideal: 30, min: 20 }
        }
    ];
    
    let stream;
    for (const config of configs) {
        try {
            console.log('🔍 Intentando configuración:', config);
            stream = await navigator.mediaDevices.getUserMedia({ video: config });
            break;
        } catch (error) {
            console.warn('⚠️ Configuración falló:', error.message);
        }
    }
    
    if (!stream) {
        throw new Error('No se pudo acceder a la cámara');
    }
    
    videoElement.srcObject = stream;
    appState.stream = stream;
    
    return new Promise((resolve, reject) => {
        videoElement.onloadedmetadata = () => {
            videoElement.play().then(() => {
                // Espejo para cámara frontal
                videoElement.style.transform = 'scaleX(-1)';
                
                console.log(`📏 Resolución: ${videoElement.videoWidth}x${videoElement.videoHeight}`);
                resolve(true);
            }).catch(reject);
        };
        
        videoElement.onerror = reject;
    });
}

// CONFIGURAR ZXING SCANNER
// REEMPLAZAR completamente setupZXingScanner en app.js:
async function setupZXingScanner() {
    console.log('🔍 Configurando ZXing ultra-optimizado para QR...');
    
    const videoElement = elements.videoElement;
    if (!videoElement) {
        throw new Error('Elemento video no encontrado');
    }

    try {
        await loadZXing();
        console.log('✅ ZXing disponible, configurando...');
        
        // ✅ CREAR LECTOR CON CONFIGURACIÓN MÁXIMA
        const codeReader = new ZXing.BrowserQRCodeReader();
        
        // ✅ HINTS ULTRA-AGRESIVOS PARA QR
        const hints = new Map();
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.QR_CODE]);
        hints.set(ZXing.DecodeHintType.CHARACTER_SET, 'UTF-8');
        hints.set(ZXing.DecodeHintType.PURE_BARCODE, false); // Permitir QR con ruido
        hints.set(ZXing.DecodeHintType.ASSUME_GS1, false);
        codeReader.hints = hints;
        
        console.log('📱 Configurando cámara con máxima resolución...');
        
        // ✅ CONFIGURACIÓN ULTRA-ALTA RESOLUCIÓN
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: "user",
                    width: { ideal: 1920, min: 1280 },
                    height: { ideal: 1080, min: 720 },
                    frameRate: { ideal: 30, min: 15 },
                    focusMode: "continuous", // Enfoque continuo
                    exposureMode: "continuous", // Exposición continua
                    whiteBalanceMode: "continuous" // Balance de blancos continuo
                }
            });
        } catch (error) {
            console.warn('⚠️ Configuración ideal falló, intentando básica:', error.message);
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: "user",
                    width: { ideal: 1280, min: 640 },
                    height: { ideal: 720, min: 480 }
                }
            });
        }
        
        videoElement.srcObject = stream;
        
        return new Promise((resolve, reject) => {
            videoElement.onloadedmetadata = () => {
                console.log('✅ Video metadata cargada');
                console.log(`📏 Resolución: ${videoElement.videoWidth}x${videoElement.videoHeight}`);
                
                videoElement.play().then(() => {
                    console.log('✅ Video reproduciendo');
                    
                    // Aplicar espejo
                    videoElement.style.transform = 'scaleX(-1)';
                    
                    appState.zxingReader = codeReader;
                    appState.stream = stream;
                    appState.scanning = false;
                    
                    console.log('✅ ZXing ultra-optimizado listo');
                    resolve(true);
                }).catch(reject);
            };
            
            videoElement.onerror = reject;
        });
        
    } catch (error) {
        console.error('❌ Error configurando ZXing:', error);
        throw error;
    }
}

// INICIAR ESCANEO AUTOMÁTICO
function initAutoScanning() {
    if (appState.scanning || appState.processing) return;

    console.log('🚀 Iniciando escaneo automático - Tipo se detectará del QR');

    // Actualizar UI - mostrar ambos botones en estado "escaneando"
    document.querySelectorAll('.action-btn').forEach(btn => {
        btn.classList.add('scanning');
    });

    // ✅ USAR DETECTOR NATIVO SI ESTÁ DISPONIBLE
    if (appState.barcodeDetector) {
        console.log('🚀 Usando detector nativo');
        startNativeScanning();
    } else {
        console.log('🔄 Usando ZXing');
        const waitForScanner = setInterval(() => {
            if (appState.zxingReader && elements.videoElement) {
                clearInterval(waitForScanner);
                startZXingScanning();
            }
        }, 100);

        setTimeout(() => clearInterval(waitForScanner), 5000);
    }
}

// SELECCIÓN DE MODO (por si aún tocan los botones)
function selectMode() {
    if (appState.processing) return;
    initAutoScanning();
}
// INICIAR ESCANEO ZXING
// REEMPLAZAR startZXingScanning con versión multi-método:
function startZXingScanning() {
    if (appState.scanning || appState.processing) return;
    
    console.log('🔍 Iniciando escaneo multi-método...');
    appState.scanning = true;
    
    const cameraSection = elements.cameraSection;
    const videoElement = elements.videoElement;
    
    if (cameraSection) cameraSection.style.display = 'block';
    if (videoElement) videoElement.style.display = 'block';
    if (elements.btnCancelScan) elements.btnCancelScan.style.display = 'block';
    
    const codeReader = appState.zxingReader;
    if (!codeReader || !videoElement) {
        console.error('❌ Scanner o video no disponibles');
        return;
    }
    
    // ✅ ESCANEO CON MÚLTIPLES MÉTODOS SIMULTÁNEOS
    const scanWithMultipleMethods = async () => {
        let attempts = 0;
        let methodIndex = 0;
        // Iba tambien un metodo 'direct', que llamaba a
        // decodeOnceFromVideoDevice(): esa funcion de ZXing PIDE OTRA CAMARA
        // cada vez, y no contesta hasta que ve un QR. O sea que abria camaras
        // que nadie cerraba y ademas dejaba el ciclo detenido esperandola. Se
        // quito: los otros dos leen del cuadro que ya tenemos.
        const methods = ['canvas', 'enhanced'];
        
        while (appState.scanning && !appState.processing) {
            attempts++;
            const currentMethod = methods[methodIndex % methods.length];
            
            try {
                let result = null;
                
                switch (currentMethod) {
                    case 'canvas':
                        result = await scanFromCanvas(codeReader, videoElement);
                        break;
                    case 'enhanced':
                        result = await scanEnhanced(codeReader, videoElement);
                        break;
                }
                
                if (result && result.text) {
                    console.log(`🎯 QR DETECTADO con método ${currentMethod}:`, result.text);
                    
                    if (navigator.vibrate) {
                        navigator.vibrate([300, 100, 300]);
                    }
                    
                    handleQRDetected(result.text);
                    return;
                }
                
            } catch (error) {
                // Continuar con siguiente método
            }
            
            // Cambiar método cada 10 intentos
            if (attempts % 10 === 0) {
                methodIndex++;
                console.log(`🔄 Cambiando a método: ${methods[methodIndex % methods.length]}`);
            }
            
            // Status cada 50 intentos
            if (attempts % 50 === 0) {
                const seconds = Math.round(attempts * ESCANEO_INTERVALO_MS / 1000);
                updateStatus(`Escaneando... ${seconds}s (método: ${currentMethod})`, 'info');
            }
            
            await new Promise(resolve => setTimeout(resolve, ESCANEO_INTERVALO_MS));
        }
    };
    
    scanWithMultipleMethods().catch(error => {
        console.error('❌ Error en escaneo multi-método:', error);
        appState.scanning = false;
        setTimeout(() => {
            if (appState.currentMode && !appState.processing) {
                startZXingScanning();
            }
        }, 1000);
    });
    
    updateStatus('Posiciona el QR claramente frente a la cámara', 'info');
}

// Ancho al que se reduce el cuadro para buscar el QR con ZXing.
//
// La camara da 1920x1080 = 2 millones de pixeles por cuadro. Un QR de 300 px en
// pantalla se lee igual de bien a la mitad de resolucion, y a 960 de ancho son
// cuatro veces menos pixeles que recorrer — en JavaScript, varias veces por
// segundo. Esto solo aplica a las tabletas sin detector nativo.
const ESCANEO_ANCHO = 960;

// Deja el cuadro actual en el canvas, reducido, y devuelve sus pixeles.
function cuadroReducido(videoElement) {
    const canvas = elements.canvasElement;
    const context = canvas.getContext('2d', { willReadFrequently: true });

    const escala = Math.min(1, ESCANEO_ANCHO / (videoElement.videoWidth || ESCANEO_ANCHO));
    canvas.width = Math.round(videoElement.videoWidth * escala);
    canvas.height = Math.round(videoElement.videoHeight * escala);

    // Sin espejo: el QR se lee del cuadro tal cual sale de la camara.
    context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    return context.getImageData(0, 0, canvas.width, canvas.height);
}

// ✅ MÉTODO 1: Escaneo desde Canvas
async function scanFromCanvas(codeReader, videoElement) {
    return await codeReader.decodeFromImageData(cuadroReducido(videoElement));
}

// ✅ MÉTODO 2: Escaneo con Mejoras de Imagen
async function scanEnhanced(codeReader, videoElement) {
    const imageData = cuadroReducido(videoElement);
    const data = imageData.data;

    // Aumentar contraste
    for (let i = 0; i < data.length; i += 4) {
        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const factor = brightness > 128 ? 1.2 : 0.8;

        data[i] = Math.min(255, data[i] * factor);     // R
        data[i + 1] = Math.min(255, data[i + 1] * factor); // G
        data[i + 2] = Math.min(255, data[i + 2] * factor); // B
    }

    // Se le pasan los pixeles ya corregidos. Antes se devolvian al canvas y se
    // volvian a leer, dos copias de la imagen completa para nada.
    return await codeReader.decodeFromImageData(imageData);
}
// REEMPLAZAR completamente la función de escaneo con BarcodeDetector nativo:
async function initializeBarcodeDetector() {
    console.log('🔍 Inicializando detector nativo de códigos de barras...');
    
    try {
        // ✅ VERIFICAR SI BARCODE DETECTOR ESTÁ DISPONIBLE
        if ('BarcodeDetector' in window) {
            const barcodeDetector = new BarcodeDetector({
                formats: ['qr_code']
            });
            
            console.log('✅ BarcodeDetector nativo disponible');
            appState.barcodeDetector = barcodeDetector;
            return true;
        } else {
            console.log('⚠️ BarcodeDetector no disponible, usando ZXing como fallback');
            return false;
        }
    } catch (error) {
        console.error('❌ Error inicializando BarcodeDetector:', error);
        return false;
    }
}

// ✅ NUEVA FUNCIÓN DE ESCANEO NATIVO MÁS POTENTE
function startNativeScanning() {
    if (appState.scanning || appState.processing) return;
    
    console.log('🔍 Iniciando escaneo nativo ultra-rápido...');
    appState.scanning = true;
    
    const cameraSection = elements.cameraSection;
    const videoElement = elements.videoElement;
    
    if (cameraSection) cameraSection.style.display = 'block';
    if (videoElement) videoElement.style.display = 'block';
    if (elements.btnCancelScan) elements.btnCancelScan.style.display = 'block';
    
    const detector = appState.barcodeDetector;
    if (!detector || !videoElement) {
        console.error('❌ Detector nativo o video no disponibles');
        // Fallback a ZXing
        startZXingScanning();
        return;
    }
    
    // ✅ ESCANEO NATIVO ULTRA-RÁPIDO
    const scanNatively = async () => {
        let attempts = 0;
        
        while (appState.scanning && !appState.processing) {
            try {
                attempts++;
                
                // ✅ DETECTAR DIRECTAMENTE DEL VIDEO
                const barcodes = await detector.detect(videoElement);
                
                if (barcodes && barcodes.length > 0) {
                    const qrCode = barcodes[0];
                    console.log(`🎯 QR NATIVO DETECTADO en intento ${attempts}:`, qrCode.rawValue);
                    
                    if (navigator.vibrate) {
                        navigator.vibrate([200, 100, 200, 100, 300]);
                    }
                    
                    handleQRDetected(qrCode.rawValue);
                    return;
                }
                
                // Status cada 100 intentos
                if (attempts % 100 === 0) {
                    const seconds = Math.round(attempts * ESCANEO_INTERVALO_MS / 1000);
                    updateStatus(`Detector nativo escaneando... ${seconds}s`, 'info');
                }
                
            } catch (error) {
                // Continuar escaneando
                if (attempts % 200 === 0) {
                    console.log(`🔍 Escaneo nativo en progreso... intento ${attempts}`);
                }
            }
            
            // 15 veces por segundo, no 50.
            //
            // La camara entrega 30 cuadros por segundo: a 50 revisiones por
            // segundo se estaba analizando el MISMO cuadro dos y tres veces, y
            // cada analisis es sobre una imagen de 1920x1080. Nadie acerca y
            // quita un QR en menos de un segundo, asi que a 15 por segundo
            // quedan 15 oportunidades donde antes habia 50 — y la tableta deja
            // de gastar el triple de procesador todo el dia, que es lo que la
            // ponia lenta y caliente.
            await new Promise(resolve => setTimeout(resolve, ESCANEO_INTERVALO_MS));
        }
    };
    
    scanNatively().catch(error => {
        console.error('❌ Error en escaneo nativo:', error);
        console.log('🔄 Cambiando a ZXing como fallback...');
        appState.scanning = false;
        startZXingScanning(); // Fallback a ZXing
    });
    
    updateStatus('Detector nativo activo - Acerca el QR a la cámara', 'info');
}
// CANCELAR ESCANEO
function cancelScan() {
    appState.scanning = false;
    appState.currentMode = null;
    
    if (elements.btnCancelScan) {
        elements.btnCancelScan.style.display = 'none';
    }
    
    document.querySelectorAll('.action-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    if (appState.zxingReader) {
        try {
            appState.zxingReader.reset();
        } catch (e) {
            console.warn('Advertencia al resetear ZXing:', e);
        }
    }
    
    showSection('main');
    console.log('❌ Escaneo cancelado');
}

// DETENER ESCANEO
function stopScanning() {
    console.log('⏹️ Deteniendo escaneo...');
    appState.scanning = false;
    
    if (appState.zxingReader) {
        try {
            appState.zxingReader.reset();
        } catch (e) {
            console.warn('Advertencia al resetear ZXing:', e);
        }
    }
    
    updateStatus('Escaneo detenido', 'info');
}

// MANEJAR QR DETECTADO
async function handleQRDetected(code) {
    if (appState.processing) return;

    console.log('📱 QR detectado:', code);
    appState.processing = true;

    // Se limpia el mensaje del anterior: el escaner sigue vivo detras de el, asi
    // que el que sigue puede llegar con la pantalla del compañero todavia arriba.
    hideMessage();

    // Detener scanner
    appState.scanning = false;

    // Mostrar loading
    showLoading();

    try {
        // ✅ DETECTAR AUTOMÁTICAMENTE EL TIPO DE QR
        let tipoRegistro = appState.currentMode;

        if (code.includes('ENTRADA')) {
            tipoRegistro = 'ENTRADA';
            console.log('🔍 QR de ENTRADA detectado automáticamente');
        } else if (code.includes('SALIDA')) {
            tipoRegistro = 'SALIDA';
            console.log('🔍 QR de SALIDA detectado automáticamente');
        }

        appState.currentMode = tipoRegistro;
        console.log('🎯 Tipo de registro:', tipoRegistro);
        console.log('📤 Procesando con Supabase...');

        // NUEVO: Validar QR con Supabase
        _tiempos = {};
        const arrancoElQR = performance.now();
        const validation = await SupabaseAPI.validateQR(code);
        marcarTiempo('validar el QR', arrancoElQR);

        if (!validation.success) {
            hideLoading();
            showError('Código inválido', validation.message);
            appState.processing = false;
            return;
        }

        const { empleado, tipoRegistro: tipoDetectado, bloqueId } = validation;

        console.log('✅ QR válido:', {
            empleado: `${empleado.nombre} ${empleado.apellido}`,
            tipo: tipoDetectado,
            bloque: bloqueId
        });

        hideLoading();

        // Los modelos ya se bajaron al arrancar la tableta. Aqui solo se pide la
        // cara de referencia de ESTA persona, que son unos kilobytes, mientras
        // lee la confirmacion.
        if (typeof vrCalentar === 'function') vrCalentar(empleado.id);

        // Mostrar confirmación de foto
        const confirmed = await showPhotoConfirmation();

        if (!confirmed) {
            console.log('❌ Usuario canceló la foto');
            appState.processing = false;
            return;
        }

        // Countdown y captura de foto
        showLoading();
        updateStatus('Preparando cámara...', 'info');

        const arrancoLaFoto = performance.now();
        let reloj = arrancoLaFoto;

        // Encuadrar, tomar la foto y comprobar que la cara sea de quien dice el
        // QR. Se intenta varias veces porque una toma mala no debe costarle la
        // checada a nadie.
        const cfgRostro = (typeof vrConfig === 'function')
            ? await vrConfig() : { intentos_maximos: 1, modo: 'REGISTRA' };

        // ¿La cara puede impedir la checada? Solo en BLOQUEA. Y solo entonces
        // tiene sentido reintentar: hacer que alguien repita la foto por una
        // medicion que de todos modos no lo va a rechazar es puro estorbo.
        const rostroDetiene = (typeof vrDetiene === 'function') && vrDetiene(cfgRostro);
        const maxIntentos = rostroDetiene ? Math.max(1, cfgRostro.intentos_maximos || 1) : 1;

        // ¿Se niega la checada si nadie se paró frente a la cámara? Es aparte de
        // BLOQUEA: "¿hay alguien ahí?" no es la misma pregunta que "¿eres tú?".
        const exigeRostro = (typeof vrExigeRostro === 'function')
            && (typeof dcNadieSeParo === 'function')
            && (typeof vrHayCara === 'function')
            && vrExigeRostro(cfgRostro);

        let caraLista = { hubo: false, motivo: 'apagado', cara: null };
        let foto = null;
        let ultimoLienzo = null;
        let subida = Promise.resolve(null);
        let rostro = { concluyente: false, bloquea: false, parecido: null, motivo: 'apagado' };
        let nadieSeParo = false;

        for (let intento = 1; intento <= maxIntentos; intento++) {
            // Esperar a que la persona este de verdad frente a la camara. En
            // agosto, 18% de las checadas guardaron una foto sin ninguna cara —
            // el techo, un pasillo, una nuca — y esas no prueban quien checo.
            // FUERA LA CORTINA: durante el encuadre no se esta procesando
            // nada, se esta esperando a la PERSONA, y para acomodarse tiene que
            // verse en la camara. "Procesando registro..." es una cortina negra
            // a pantalla completa que tapa la camara Y la tira donde salen
            // "Colocate frente a la camara" y "Acercate un poco mas".
            //
            // Esto lo rompi yo al mover los avisos del panel a la tira: en el
            // panel se veian por encima de la cortina; en la tira quedaron
            // debajo. Resultado: 12 segundos mirando un "cargando" sin saber
            // que habia que pararse enfrente. Vuelve al tomar la foto.
            hideLoading();

            caraLista = { hubo: false, motivo: 'apagado', cara: null };
            if (typeof dcEsperarCara === 'function' &&
                (typeof switchActivo !== 'function' || switchActivo('cara_obligatoria'))) {
                caraLista = await dcEsperarCara(elements.videoElement, (mensaje) => {
                    guiar(`👤 ${mensaje}`);
                });
            }

            // Con la cara ya encuadrada NO hay cuenta: el encuadre ya espero a
            // cuatro cuadros seguidos con la persona bien puesta, o sea que ya
            // esta viendo a la camara y ya vio el "¡Listo! No te muevas".
            // Contarle otro segundo encima es un segundo de nada.
            //
            // Sin detector si se cuenta, porque ahi nadie le aviso.
            const cuenta = caraLista.hubo ? 0 : 3;
            // Si no se vio a nadie, esta cuenta es su ultima oportunidad de
            // aparecer en la foto: el mensaje tiene que decirle que hacer, no
            // solo cuanto falta.
            const urge = !caraLista.hubo && (typeof dcNadieSeParo === 'function')
                && dcNadieSeParo(caraLista);
            for (let i = cuenta; i >= 1; i--) {
                guiar(urge
                    ? `👤 Colócate frente a la cámara — foto en ${i}...`
                    : `📸 Tomando foto en ${i}...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            guiar('📸 ¡SONRÍE!');

            // Efecto de flash
            const flashOverlay = document.createElement('div');
            flashOverlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: white;
                opacity: 0.8;
                z-index: 9999;
                pointer-events: none;
                animation: flash 0.3s ease-out;
            `;
            document.body.appendChild(flashOverlay);
            setTimeout(() => flashOverlay.remove(), 300);

            reloj = marcarTiempo('encuadre', reloj);
            const lienzo = dibujarCuadro();
            ultimoLienzo = lienzo;
            reloj = marcarTiempo('tomar la foto', reloj);

            // Ya con la foto tomada si hay algo que procesar, y la persona ya no
            // necesita verse.
            showLoading();

            // Comprimir y subir arrancan YA y siguen solas. La foto se va a
            // necesitar pase lo que pase —si la checada se guarda va en el
            // registro, si se rechaza va como evidencia— y no depende en nada
            // de lo que diga el rostro. En serie eran tres esperas seguidas con
            // la persona parada enfrente.
            subida = lienzoAJpeg(lienzo).then(b => {
                foto = b;
                if (b) console.log(`📸 Foto: ${Math.round(b.size / 1024)} KB`);
                return b ? SupabaseAPI.uploadFoto(empleado.id, b) : null;
            }).catch(e => { console.error('No se pudo subir la foto:', e); return null; });

            // NADIE SE PARO FRENTE A LA CAMARA.
            //
            // De aqui salio: probando el 3-sep se levanto el QR desde lejos, con
            // la cara fuera del cuadro, y la checada QUEDO REGISTRADA — con una
            // foto de la pared y sin un solo renglon en intentos_checada que
            // dijera que el rostro nunca se reviso. Era la forma mas facil de
            // entrar: mas facil que usar el QR de otro, que eso si se bloquea.
            //
            // PERO EL ENCUADRE NO PUEDE SER EL QUE DECIDA. Su opinion se cierra
            // varios segundos ANTES del flash, y en esos segundos alguien puede
            // llegar. Paso de verdad en la segunda prueba: el encuadre dijo "no
            // hay nadie", la foto salio con la cara enorme y bien iluminada, y
            // aun asi se rechazo. Un rechazo con la cara en la foto es
            // indefendible: la foto es lo que se guarda y lo que se enseñaria en
            // un reclamo.
            //
            // Asi que la foto manda. `vrHayCara` devuelve null si no se pudo
            // mirar (sin malla, error) y entonces no se rechaza a nadie: no
            // saber no es lo mismo que no haber nadie.
            if (exigeRostro && dcNadieSeParo(caraLista)) {
                const hayCara = await vrHayCara(lienzo);
                reloj = marcarTiempo('mirar la foto', reloj);
                if (hayCara === false) {
                    nadieSeParo = true;
                    break;
                }
                console.log('👤 El encuadre no vio a nadie, pero la foto sí:',
                            hayCara === null ? 'no se pudo mirar' : 'hay cara');
            }

            // En REGISTRA no se mide aqui: la medicion va DESPUES de guardar la
            // checada, con la persona ya caminando. Medido en tableta, la
            // primera medicion del dia se llevaba 10 segundos, y ese rato lo
            // estaba pagando quien venia llegando para nada.
            if (!rostroDetiene) break;

            // Comparar contra la cara de referencia de QUIEN ESCANEO EL QR. Una
            // sola comparacion: por eso los empleados que se parecen entre si no
            // estorban aqui.
            //
            // Se le pasa la FOTO, no el video: la foto va en espejo y asi se
            // armaron las referencias. Y se le pasa la caja del encuadre para
            // que no vaya a medir a otro que ande en el cuadro.
            // Sobre el lienzo, no sobre el JPEG: los pixeles ya estan ahi.
            if (typeof vrVerificar === 'function' && lienzo) {
                rostro = await vrVerificar(lienzo, empleado.id, caraLista.cara);
                reloj = marcarTiempo('verificar el rostro', reloj);
            }

            // Se sale en cuanto coincide, o cuando no hay nada que concluir: no
            // tiene caso hacerlo repetir por algo que no es culpa suya.
            if (!rostro.concluyente || rostro.coincide) break;

            const aviso = vrMensaje(rostro, intento, maxIntentos);
            if (aviso && intento < maxIntentos) {
                guiar(`⚠️ ${aviso}`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // La foto es de una pared, un techo o un pasillo: no prueba quien checo.
        // Se guarda el intento CON la foto —es la evidencia de que no habia
        // nadie— y la checada no.
        if (nadieSeParo) {
            console.warn('👤 Checada rechazada: nadie se paró frente a la cámara');
            _tiempos.total_sin_contar_a_la_persona = Math.round(performance.now() - arrancoLaFoto)
                + (_tiempos['validar el QR'] || 0);
            await SupabaseAPI.guardarIntentoRostro(
                empleado, { parecido: null }, tipoDetectado, 'SIN_ROSTRO',
                await subida, { ..._tiempos });
            hideLoading();
            limpiarAviso();
            // El mensaje dice QUE HACER. "No se detecto rostro" no le sirve a
            // nadie; "colocate frente a la camara" se obedece.
            showError('No se vio tu rostro',
                      'Colócate frente a la cámara y vuelve a escanear tu QR.');
            return;
        }

        // Si la cara no coincidio y la config manda bloquear, la checada no se
        // guarda — pero el intento SI, con su hora y su puntaje. Esa leccion ya
        // se pago una vez: cuando el bloqueo por horario empezo a rechazar, se
        // perdieron los retardos que Direccion queria cobrar.
        if (rostro.bloquea) {
            console.warn('🧬 Checada rechazada por rostro:', rostro.parecido);
            // CON la foto: es la unica forma de revisar despues si el rechazo
            // estuvo bien. Se espera rechazar cerca del 7% de las checadas.
            _tiempos.total_sin_contar_a_la_persona = Math.round(performance.now() - arrancoLaFoto)
                + (_tiempos['validar el QR'] || 0);
            await SupabaseAPI.guardarIntentoRostro(
                empleado, rostro, tipoDetectado, 'ROSTRO_NO_COINCIDE',
                await subida, { ..._tiempos });
            hideLoading();
            limpiarAviso();
            showError('No se confirmó tu rostro',
                      'La foto no coincide con tu expediente. Repórtalo con tu jefe.');
            return;
        }

        // Se anota COINCIDA O NO. Si solo se guardara lo que falla, no quedaria
        // forma de distinguir "coincidio" de "nunca corrio", y esa diferencia es
        // justo lo que hay que medir antes de encender el bloqueo.
        const anotarRostro = (r) => {
            if (!r.concluyente) {
                console.log('🧬 No se pudo medir el rostro:', r.motivo);
                // Antes esto se iba en silencio, y ese silencio fue justo lo que
                // escondio el hueco de la foto sin cara: la checada pasaba y no
                // quedaba rastro de que el rostro nunca se reviso. Si la tableta
                // esta rechazando gente, hay que poder ver tambien cuantas veces
                // NO pudo opinar, y por que.
                if (rostroDetiene) {
                    SupabaseAPI.guardarIntentoRostro(empleado, { parecido: null },
                        tipoDetectado, `ROSTRO_NO_MEDIDO: ${r.motivo}`, null, { ..._tiempos });
                }
                return;
            }
            console.log('🧬 Rostro medido:', r.parecido, r.coincide ? '(coincide)' : '(NO coincide)');
            SupabaseAPI.guardarIntentoRostro(empleado, r, tipoDetectado,
                r.coincide ? 'ROSTRO_OK' : 'ROSTRO_MEDIDO', null, { ..._tiempos });
        };
        if (rostroDetiene) anotarRostro(rostro);

        updateStatus('Guardando registro...', 'info');
        reloj = performance.now();

        // El registro se guarda YA, SIN esperar a que suba la foto.
        //
        // Medido en la tableta el 2026-09-02: subir la foto se lleva 13,982 ms
        // contra 522 del reconocimiento y 774 del encuadre. TODA la lentitud
        // que se sentia era esto, y la persona no tiene por que verla: su
        // checada ya quedo. La foto se le pega despues con un update.
        const result = await SupabaseAPI.createRegistro(
            empleado.id,
            tipoDetectado,
            code,
            TABLET_CONFIG.id,
            bloqueId,
            null
        );

        marcarTiempo('guardar la checada', reloj);

        // La foto alcanza al registro cuando termine de subir. Si no llega, se
        // pierde la foto —no la checada.
        if (result.success && result.data) {
            subida
                .then(url => url && SupabaseAPI.adjuntarFoto(result.data.id, url))
                .then(() => console.log(`⏱️ la foto acabo de subir a los ${Math.round(performance.now() - arrancoLaFoto)}ms`))
                .catch(e => console.error('La foto no llego al registro:', e));
        }

        // La medicion del rostro, ya con la checada guardada y sin nadie
        // esperandola. En REGISTRA no rechaza a nadie, asi que no hay ninguna
        // razon para que corra antes: que se tome el tiempo que necesite.

        if (!rostroDetiene && typeof vrVerificar === 'function' && ultimoLienzo) {
            const t0 = performance.now();
            vrVerificar(ultimoLienzo, empleado.id, caraLista.cara)
                .then(r => {
                    console.log(`⏱️ verificar el rostro (en segundo plano): ${Math.round(performance.now() - t0)}ms`);
                    anotarRostro(r);
                })
                .catch(e => console.warn('🧬 Falló la medición en segundo plano:', e));
        }

        hideLoading();

        // El total NO cuenta el rato que la persona se tarda en apretar
        // "Tomar foto": ese es tiempo suyo, no del sistema.
        _tiempos.total_sin_contar_a_la_persona = Math.round(performance.now() - arrancoLaFoto)
            + (_tiempos['validar el QR'] || 0);
        const tiempos = MOSTRAR_TIEMPOS
            ? ' ⏱️ ' + Object.entries(_tiempos).map(([k, v]) => `${k} ${v}ms`).join(' · ')
            : '';

        if (result.success) {
            showSuccess(
                tipoDetectado === 'ENTRADA' ? '¡BIENVENIDO!' : '¡HASTA LUEGO!',
                (tipoDetectado === 'ENTRADA' ? 'Entrada registrada' : 'Salida registrada') + tiempos,
                {
                    codigo_empleado: empleado.codigo_empleado,
                    nombre: empleado.nombre,
                    apellido: empleado.apellido,
                    foto_perfil: empleado.foto_perfil
                }
            );
        } else {
            showError('Error', result.message);
        }

    } catch (error) {
        console.error('❌ Error procesando QR:', error);
        hideLoading();
        showError('Error', 'No se pudo conectar');
    } finally {
        appState.processing = false;
        resetMode();
        terminarChecada();
    }
}

// Cierra la checada y deja la tableta lista para el siguiente, SIN recargar.
//
// Antes esto era `setTimeout(() => location.reload(), 3000)`. Recargar era lo
// unico que revivia el escaner —hideMessage solo esconde el mensaje y resetMode
// apaga el escaneo— pero salia caro de tres maneras:
//
//   1. La pantalla se ponia negra un instante en CADA checada. Eso es el
//      parpadeo de la recarga, no una falla de la camara.
//   2. El "¡BIENVENIDO!" se borraba a los 3 segundos aunque la persona no lo
//      hubiera leido, y el boton de Continuar no servia para nada.
//   3. La peor: la foto se sube por detras y tarda hasta 14 segundos en la
//      tableta. Al recargar a los 3, la subida se quedaba a medias. Medido: de
//      las 4 checadas de prueba del 2-sep, UNA se quedo sin foto por esto.
function terminarChecada() {
    limpiarAviso();
    // El escaner vuelve YA, no cuando la persona termine de leer. Son dos cosas
    // distintas: una es lo que ella lee, otra es que la tableta este lista para
    // el que sigue. Esperar a que se cerrara el mensaje dejaba la tableta seis
    // segundos sorda, y con fila eso se siente peor que la recarga que se quito.
    if (!appState.scanning && !appState.processing) initAutoScanning();

    // El mensaje se va solo, o antes si le dan a Continuar.
    esperarCierreDelMensaje(MENSAJE_MS).then(hideMessage);

    // Red de seguridad: si por lo que sea el escaner no arranco, ENTONCES si se
    // recarga. Es lo unico que la recarga hacia bien, y ahora solo ocurre cuando
    // de verdad hace falta y no en cada checada.
    setTimeout(() => {
        if (!appState.scanning && !appState.processing) {
            console.warn('⚠️ El escáner no arrancó solo; se recarga la página');
            location.reload();
        }
    }, 2500);
}

// Espera a que la persona le de a Continuar, o a que se acabe el tiempo.
function esperarCierreDelMensaje(ms) {
    return new Promise((listo) => {
        const btn = elements.messageCloseBtn;
        let terminado = false;
        const cerrar = () => {
            if (terminado) return;
            terminado = true;
            clearTimeout(reloj);
            if (btn) btn.removeEventListener('click', cerrar);
            listo();
        };
        const reloj = setTimeout(cerrar, ms);
        if (btn) btn.addEventListener('click', cerrar);
    });
}

// Aqui vivia startPhotoCountdown: 100 lineas que nadie llamaba desde que el
// registro dejo de crearse antes que la foto. Ademas hablaba con
// TABLET_CONFIG.apiUrl, que ya no existe, asi que ni corriendo habria servido.
// El flujo que si corre esta dentro de handleQRDetected.

// NUEVA FUNCIÓN: Mostrar confirmación de foto
function showPhotoConfirmation() {
    return new Promise((resolve) => {
        // Crear overlay de confirmación
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        `;

        // Crear modal
        const modal = document.createElement('div');
        modal.style.cssText = `
            background: white;
            border-radius: 20px;
            padding: 40px;
            text-align: center;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
            max-width: 500px;
        `;

        // Título
        const title = document.createElement('h2');
        title.textContent = '📸 Foto de Asistencia';
        title.style.cssText = `
            font-size: 28px;
            margin: 0 0 20px 0;
            color: #333;
        `;

        // Mensaje
        const message = document.createElement('p');
        message.textContent = '¿Deseas que te tome la foto ahora?';
        message.style.cssText = `
            font-size: 18px;
            color: #666;
            margin: 0 0 30px 0;
        `;

        // Contenedor de botones
        const buttonsContainer = document.createElement('div');
        buttonsContainer.style.cssText = `
            display: flex;
            gap: 15px;
            justify-content: center;
        `;

        // Botón Sí
        const btnYes = document.createElement('button');
        btnYes.textContent = '✓ SÍ, TOMAR FOTO';
        btnYes.style.cssText = `
            background: #10b981;
            color: white;
            border: none;
            padding: 15px 40px;
            font-size: 16px;
            font-weight: bold;
            border-radius: 10px;
            cursor: pointer;
            transition: background 0.3s;
        `;
        btnYes.onmouseover = () => btnYes.style.background = '#059669';
        btnYes.onmouseout = () => btnYes.style.background = '#10b981';
        btnYes.onclick = () => {
            overlay.remove();
            resolve(true);
        };

        // Botón No
        const btnNo = document.createElement('button');
        btnNo.textContent = '✕ CANCELAR';
        btnNo.style.cssText = `
            background: #ef4444;
            color: white;
            border: none;
            padding: 15px 40px;
            font-size: 16px;
            font-weight: bold;
            border-radius: 10px;
            cursor: pointer;
            transition: background 0.3s;
        `;
        btnNo.onmouseover = () => btnNo.style.background = '#dc2626';
        btnNo.onmouseout = () => btnNo.style.background = '#ef4444';
        btnNo.onclick = () => {
            overlay.remove();
            resolve(false);
        };

        buttonsContainer.appendChild(btnYes);
        buttonsContainer.appendChild(btnNo);

        modal.appendChild(title);
        modal.appendChild(message);
        modal.appendChild(buttonsContainer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    });
}

// CAPTURAR FOTO
// Dibuja el cuadro actual, ya espejeado, en su propio lienzo y lo devuelve.
//
// Se separo de capturePhoto para que la verificacion del rostro trabaje sobre
// los PIXELES, no sobre el JPEG: antes se comprimia la imagen, se subia, y
// luego vrVerificar la volvia a descomprimir para mirarla. Comprimir y
// descomprimir 1920x1080 no es gratis en una tableta, y era tiempo que la
// persona pagaba parada enfrente.
//
// Lienzo NUEVO en cada toma, a proposito. Reusando uno solo, el segundo intento
// lo redibujaba mientras el JPEG del primero todavia se estaba comprimiendo, y
// se subia la foto equivocada. Pasa una vez por checada: no vale la pena
// ahorrarse la memoria a cambio de esa carrera.
function dibujarCuadro() {
    const video = elements.videoElement;
    if (!video || !video.videoWidth) return null;

    const escala = Math.min(1, FOTO_ANCHO_MAXIMO / video.videoWidth);
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(video.videoWidth * escala);
    lienzo.height = Math.round(video.videoHeight * escala);

    const ctx = lienzo.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    // Espejo, como se ve en pantalla y como se guardan todas las fotos.
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -lienzo.width, 0, lienzo.width, lienzo.height);
    ctx.restore();
    return lienzo;
}

// El JPEG de ese lienzo, que es lo que se sube.
function lienzoAJpeg(lienzo) {
    return new Promise((resolve) => {
        if (!lienzo) { resolve(null); return; }
        lienzo.toBlob(resolve, 'image/jpeg', FOTO_CALIDAD);
    });
}

// Devuelve un Blob, no una cadena base64.
//
// Antes devolvia base64: el canvas hacia el JPEG, un FileReader lo pasaba a
// texto (33% mas grande) y uploadFoto lo volvia a convertir a bytes con un ciclo
// de JavaScript sobre cada uno de los ~350,000 bytes de la foto. Todo eso, en el
// momento exacto en que la persona esta parada esperando a que se guarde su
// checada. El Blob que sale del canvas es justo lo que Storage quiere recibir.
async function capturePhoto() {
    return lienzoAJpeg(dibujarCuadro());
}

function resetMode() {
    appState.currentMode = null;
    appState.scanning = false;
    
    if (elements.btnCancelScan) {
        elements.btnCancelScan.style.display = 'none';
    }
    
    document.querySelectorAll('.action-btn').forEach(btn => {
        btn.classList.remove('active');
    });
}

// MENSAJES Y UI
function showLoading() {
    if (elements.loadingSection) {
        elements.loadingSection.style.display = 'flex';
    }
}

function hideLoading() {
    if (elements.loadingSection) {
        elements.loadingSection.style.display = 'none';
    }
}

function showSuccess(title, message, empleado) {
    if (elements.messageIcon) {
        elements.messageIcon.className = 'message-icon success';
        elements.messageIcon.innerHTML = '✓';
    }
    if (elements.messageTitle) {
        elements.messageTitle.textContent = title;
    }
    if (elements.messageText) {
        elements.messageText.textContent = message;
    }
    
    if (empleado && elements.employeeInfo) {
        elements.employeeInfo.innerHTML = `
            <div style="margin-top: 1rem; padding: 1rem; background: #f0fdf4; border-radius: 8px;">
                <strong>${[empleado.nombre, empleado.apellido].filter(Boolean).join(' ')}</strong><br>
                <span style="color: #6b7280;">No. ${empleado.codigo_empleado || '—'}</span>
            </div>
        `;
    } else if (elements.employeeInfo) {
        elements.employeeInfo.innerHTML = '';
    }
    
    if (elements.messageSection) {
        elements.messageSection.style.display = 'flex';
    }
}

function showError(title, message) {
    if (elements.messageIcon) {
        elements.messageIcon.className = 'message-icon error';
        elements.messageIcon.innerHTML = '✕';
    }
    if (elements.messageTitle) {
        elements.messageTitle.textContent = title;
    }
    if (elements.messageText) {
        elements.messageText.textContent = message;
    }
    if (elements.employeeInfo) {
        elements.employeeInfo.innerHTML = '';
    }
    
    if (elements.messageSection) {
        elements.messageSection.style.display = 'flex';
    }
}

function hideMessage() {
    if (elements.messageSection) {
        elements.messageSection.style.display = 'none';
    }
}

function showSection(section) {
    // Ocultar todas las secciones
    if (elements.cameraSection) {
        elements.cameraSection.style.display = 'none';
    }
    if (elements.messageSection) {
        elements.messageSection.style.display = 'none';
    }
    if (elements.loadingSection) {
        elements.loadingSection.style.display = 'none';
    }
    
    // Mostrar sección solicitada
    switch (section) {
        case 'camera':
            if (elements.cameraSection) {
                elements.cameraSection.style.display = 'block';
            }
            break;
        case 'message':
            if (elements.messageSection) {
                elements.messageSection.style.display = 'flex';
            }
            break;
        case 'loading':
            if (elements.loadingSection) {
                elements.loadingSection.style.display = 'flex';
            }
            break;
        case 'main':
        default:
            // Mostrar pantalla principal
            break;
    }
}

function showEmployeeError(title, errorMessage) {
    console.log('🚫 Mostrando error de empleado:', errorMessage);
    
    if (elements.cameraSection) {
        elements.cameraSection.style.display = 'none';
    }
    
    if (elements.messageSection) {
        elements.messageSection.style.display = 'flex';
        elements.messageSection.className = 'message-section active error';
    }
    
    if (elements.messageIcon) {
        elements.messageIcon.innerHTML = '🚫';
    }
    
    if (elements.messageTitle) {
        elements.messageTitle.textContent = title;
        elements.messageTitle.style.color = '#dc3545';
        elements.messageTitle.style.fontSize = '2em';
    }
    
    if (elements.messageText) {
        elements.messageText.innerHTML = `
            <div style="background: #f8d7da; border: 2px solid #dc3545; border-radius: 15px; padding: 25px; margin: 20px 0;">
                <h2 style="color: #721c24; margin: 0 0 15px 0; text-align: center;">⚠️ ACCESO DENEGADO ⚠️</h2>
                <p style="color: #721c24; font-size: 18px; margin: 0; text-align: center; font-weight: bold;">
                    ${errorMessage}
                </p>
                <hr style="border: 1px solid #dc3545; margin: 15px 0;">
                <p style="color: #721c24; font-size: 14px; margin: 0; text-align: center;">
                    <i class="fas fa-info-circle"></i> Contacta a tu supervisor si necesitas ayuda
                </p>
            </div>
        `;
    }
    
    if (elements.employeeInfo) {
        elements.employeeInfo.innerHTML = '';
    }
    
    if (navigator.vibrate) {
        navigator.vibrate([300, 100, 300, 100, 500]);
    }

    // Este es el mensaje MAS importante de todos: a la persona le acaban de negar
    // la checada y tiene que entender por que y a que hora cerro su entrada. Con
    // tres segundos no alcanzaba ni a leerlo.
    //
    // Aqui si se recarga: esta pantalla esconde la camara y le cambia las clases
    // y los colores al panel, asi que recargar es la forma segura de dejar todo
    // como estaba. Y un rechazo es raro —cerca del 2%—, no algo de cada checada.
    esperarCierreDelMensaje(MENSAJE_RECHAZO_MS).then(() => location.reload());
}

// Los avisos del proceso: "Colócate frente a la cámara", "Tomando foto",
// "Guardando registro". Van en la tira de abajo de la camara.
//
// ANTES USABAN EL PANEL DE MENSAJES, y eso causaba los dos problemas que se
// reportaron desde las tabletas:
//
//   1. LA PANTALLA NEGRA. Ese panel es `position: fixed` a pantalla completa con
//      fondo negro al 80%. Cada aviso tiraba una cortina negra encima de la
//      camara, justo cuando se le esta pidiendo a la persona que se acomode en
//      ella. Y como los avisos van uno tras otro, la pantalla parpadeaba.
//   2. EL MENSAJE QUE SE BORRA SOLO "a veces". Cada aviso programaba esconder el
//      panel a los 2 segundos, y ese temporizador NO se cancelaba. Si el
//      "¡BIENVENIDO!" aparecia dentro de esos 2 segundos, un temporizador
//      huerfano del aviso anterior se lo llevaba. Era intermitente porque
//      dependia de cuanto habia tardado el guardado.
//
// Un aviso de proceso es una pista, no un resultado. No tapa nada y no se borra
// solo: se queda hasta el siguiente aviso.
function updateStatus(message, type = 'info') {
    console.log(`📱 Status [${type}]: ${message}`);
    const tira = elements.cameraStatus;
    if (tira) tira.textContent = message;
}

// LO QUE LA PERSONA TIENE QUE HACER, ENCIMA DEL VIDEO.
//
// Se reporto no haber visto "Colócate frente a la cámara" estando en pantalla:
// la tira gris queda DEBAJO de la camara, y quien se esta acomodando se esta
// mirando EN la camara. Asi que la instruccion va encima del video.
//
// Solo para el encuadre y la foto. La cháchara del escaner ("Escaneando... 7s",
// cada segundo) sigue en la tira: encima del video seria un letrero permanente
// tapando a todo el mundo.
function guiar(mensaje) {
    updateStatus(mensaje, 'warning');
    const encima = elements.cameraAviso;
    if (encima) {
        encima.textContent = mensaje;
        encima.style.display = mensaje ? 'block' : 'none';
    }
}

function limpiarAviso() {
    if (elements.cameraAviso) elements.cameraAviso.style.display = 'none';
}

// UTILIDADES
function updateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('es-MX', {
        hour: '2-digit',
        minute: '2-digit'
    });
    if (elements.currentTime) {
        elements.currentTime.textContent = timeString;
    }
}

async function startHealthCheck() {
    const checkHealth = async () => {
        try {
            // NUEVO: Health check con Supabase
            const isConnected = await SupabaseAPI.healthCheck();

            if (isConnected) {
                updateConnectionStatus(true);
                appState.lastPing = new Date();
            } else {
                updateConnectionStatus(false);
            }
        } catch (error) {
            updateConnectionStatus(false);
            console.warn('⚠️ Health check failed:', error.message);
        }
    };

    checkHealth();
    setInterval(checkHealth, 30000);
}

function updateConnectionStatus(isOnline) {
    appState.connected = isOnline;
    
    if (elements.connectionStatus) {
        if (isOnline) {
            elements.connectionStatus.style.background = '#10b981';
        } else {
            elements.connectionStatus.style.background = '#ef4444';
        }
    }
}

function preventSleep() {
    let wakeLock = null;
    
    const requestWakeLock = async () => {
        try {
            if ('wakeLock' in navigator) {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log('🔒 Wake lock activado');
                
                wakeLock.addEventListener('release', () => {
                    console.log('🔓 Wake lock liberado');
                });
            }
        } catch (error) {
            console.warn('⚠️ No se pudo activar wake lock:', error);
        }
    };
    
    requestWakeLock();
    
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && !wakeLock) {
            requestWakeLock();
        }
    });
}

function handleKeyPress(event) {
    if (appState.processing) return;
    
    switch (event.key) {
        case '1':
        case 'e':
        case 'E':
            selectMode();
            break;
        case '2':
        case 's':
        case 'S':
            selectMode();
            break;
        case 'Escape':
            cancelScan();
            break;
        case 'F5':
            event.preventDefault();
            location.reload();
            break;
    }
}

// Cuando la tableta se duerme y despierta.
//
// Antes esto llamaba a startZXingScanning —el lector LENTO, aunque la tableta
// tuviera el nativo— y solo si habia un modo activo, que la checada anterior ya
// habia borrado. O sea que despues de checar, si la pantalla se dormia, el
// escaner no volvia y la tableta se quedaba muerta hasta que alguien la picara.
function handleVisibilityChange() {
    if (document.hidden) {
        if (appState.scanning) stopScanning();
        return;
    }
    if (appState.processing || appState.scanning) return;

    // Al volver, la camara puede haberse soltado. Se revisa antes de escanear.
    const video = elements.videoElement;
    const camaraViva = appState.stream && video && video.videoWidth > 0;
    if (camaraViva) {
        initAutoScanning();
    } else {
        initializeCamera().then(() => initAutoScanning());
    }
}

function handleTouch(event) {
    if (event.touches.length > 1) {
        event.preventDefault();
    }
}

// Manejo de errores globales
window.addEventListener('error', function(event) {
    console.error('💥 Error global:', event.error);
    
    if (!appState.processing) {
        showError('Error del sistema', 'La aplicación se reiniciará automáticamente');
        setTimeout(() => {
            location.reload();
        }, 3000);
    }
});

// Exportar funciones para testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        TABLET_CONFIG,
        appState,
        selectMode,
        updateConnectionStatus
    };
}

console.log('📱 App.js cargado - Sistema Checador QR');
