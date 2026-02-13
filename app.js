// CONFIGURACIÓN GLOBAL
const TABLET_CONFIG = {
    id: 'TABLET_01',
    location: 'PTRN01'
    // apiUrl ya no se usa - Supabase se configura en supabase-config.js
};

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
    
    // Status
    connectionStatus: document.getElementById('connectionStatus'),
    currentTime: document.getElementById('currentTime'),
    tabletId: document.getElementById('tabletId'),
    footerTabletId: document.getElementById('footerTabletId'),
    locationId: document.getElementById('locationId')
};

// INICIALIZAR APLICACIÓN
document.addEventListener('DOMContentLoaded', function() {
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
        const methods = ['canvas', 'direct', 'enhanced'];
        
        while (appState.scanning && !appState.processing) {
            attempts++;
            const currentMethod = methods[methodIndex % methods.length];
            
            try {
                let result = null;
                
                switch (currentMethod) {
                    case 'canvas':
                        result = await scanFromCanvas(codeReader, videoElement);
                        break;
                    case 'direct':
                        result = await scanDirect(codeReader);
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
                const seconds = Math.floor(attempts / 20);
                updateStatus(`Escaneando... ${seconds}s (método: ${currentMethod})`, 'info');
            }
            
            // Pausa mínima
            await new Promise(resolve => setTimeout(resolve, 30));
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

// ✅ MÉTODO 1: Escaneo desde Canvas
async function scanFromCanvas(codeReader, videoElement) {
    const canvas = elements.canvasElement;
    const context = canvas.getContext('2d');
    
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    
    // Dibujar sin espejo para detección
    context.drawImage(videoElement, 0, 0);
    
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    return await codeReader.decodeFromImageData(imageData);
}

// ✅ MÉTODO 2: Escaneo Directo
async function scanDirect(codeReader) {
    return await codeReader.decodeOnceFromVideoDevice();
}

// ✅ MÉTODO 3: Escaneo con Mejoras de Imagen
async function scanEnhanced(codeReader, videoElement) {
    const canvas = elements.canvasElement;
    const context = canvas.getContext('2d');
    
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    
    // Dibujar imagen original
    context.drawImage(videoElement, 0, 0);
    
    // ✅ MEJORAS DE IMAGEN PARA MEJOR DETECCIÓN
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Aumentar contraste
    for (let i = 0; i < data.length; i += 4) {
        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const factor = brightness > 128 ? 1.2 : 0.8;
        
        data[i] = Math.min(255, data[i] * factor);     // R
        data[i + 1] = Math.min(255, data[i + 1] * factor); // G
        data[i + 2] = Math.min(255, data[i + 2] * factor); // B
    }
    
    context.putImageData(imageData, 0, 0);
    const enhancedImageData = context.getImageData(0, 0, canvas.width, canvas.height);
    
    return await codeReader.decodeFromImageData(enhancedImageData);
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
                    const seconds = Math.floor(attempts / 50);
                    updateStatus(`Detector nativo escaneando... ${seconds}s`, 'info');
                }
                
            } catch (error) {
                // Continuar escaneando
                if (attempts % 200 === 0) {
                    console.log(`🔍 Escaneo nativo en progreso... intento ${attempts}`);
                }
            }
            
            // ✅ INTERVALO ULTRA-RÁPIDO PARA DETECTOR NATIVO
            await new Promise(resolve => setTimeout(resolve, 20)); // 20ms = 50fps
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
        const validation = await SupabaseAPI.validateQR(code);

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

        // Countdown visual 3, 2, 1
        for (let i = 3; i >= 1; i--) {
            updateStatus(`📸 Tomando foto en ${i}...`, 'warning');
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        updateStatus('📸 ¡SONRÍE!', 'info');

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

        // Capturar foto
        const fotoBase64 = await capturePhoto();

        updateStatus('Guardando registro...', 'info');

        // NUEVO: Crear registro con Supabase
        const result = await SupabaseAPI.createRegistro(
            empleado.id,
            tipoDetectado,
            code,
            TABLET_CONFIG.id,
            bloqueId,
            fotoBase64
        );

        hideLoading();

        if (result.success) {
            showSuccess(
                tipoDetectado === 'ENTRADA' ? '¡BIENVENIDO!' : '¡HASTA LUEGO!',
                tipoDetectado === 'ENTRADA' ? 'Entrada registrada' : 'Salida registrada',
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

        // Auto-reload después de 3 segundos
        setTimeout(() => {
            location.reload();
        }, 3000);
    }
}

// COUNTDOWN PARA FOTO
async function startPhotoCountdown(registroResult) {
    try {
        const cameraSection = elements.cameraSection;
        const videoElement = elements.videoElement;

        if (cameraSection) {
            cameraSection.style.display = 'block';
        }

        if (videoElement) {
            videoElement.style.display = 'block';
        }

        if (!appState.stream || !videoElement.srcObject) {
            await initializeCamera();
        }

        // Mostrar pantalla de confirmación
        const confirmed = await showPhotoConfirmation();

        if (!confirmed) {
            console.log('❌ Usuario canceló la foto');
            if (cameraSection) cameraSection.style.display = 'none';
            return;
        }

        for (let i = 3; i >= 1; i--) {
            updateStatus(`📸 Tomando foto en ${i}...`, 'warning');

            const statusElement = document.querySelector('.status-message');
            if (statusElement) {
                statusElement.style.fontSize = '2em';
                statusElement.style.fontWeight = 'bold';
                statusElement.style.color = '#ff6b6b';
                statusElement.style.animation = 'pulse 0.5s ease-in-out';
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        updateStatus('📸 ¡SONRÍE! Tomando foto...', 'info');

        // Flash effect
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

        // Añadir CSS para la animación flash
        const style = document.createElement('style');
        style.textContent = `
            @keyframes flash {
                0% { opacity: 0; }
                50% { opacity: 0.8; }
                100% { opacity: 0; }
            }
        `;
        document.head.appendChild(style);

        document.body.appendChild(flashOverlay);
        setTimeout(() => flashOverlay.remove(), 300);

        const fotoBase64 = await capturePhoto();

        const response = await fetch(`${TABLET_CONFIG.apiUrl}/registros/foto`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Tablet-Auth': 'true'
            },
            body: JSON.stringify({
                registro_id: registroResult.data.registro_id,
                foto_registro: fotoBase64
            })
        });

        if (response.ok) {
            updateStatus('✅ Foto capturada exitosamente', 'success');
        } else {
            updateStatus('⚠️ Error al guardar foto', 'warning');
        }

        setTimeout(() => {
            if (cameraSection) cameraSection.style.display = 'none';
        }, 1000);

    } catch (error) {
        console.error('Error en countdown foto:', error);
        updateStatus('⚠️ Error al capturar foto', 'error');
    }
}

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
async function capturePhoto() {
    return new Promise((resolve) => {
        const canvas = elements.canvasElement;
        const video = elements.videoElement;
        
        if (!canvas || !video) {
            resolve(null);
            return;
        }
        
        const context = canvas.getContext('2d');
        
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        // Aplicar espejo para cámara frontal
        context.save();
        context.scale(-1, 1);
        context.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
        context.restore();
        
        canvas.toBlob((blob) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        }, 'image/jpeg', 0.8);
    });
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
                <strong>${empleado.nombre}</strong><br>
                <span style="color: #6b7280;">ID: ${empleado.empleado_id}</span>
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
    
    setTimeout(() => {
        location.reload();
    }, 3000);
}

function updateStatus(message, type = 'info') {
    console.log(`📱 Status [${type}]: ${message}`);
    
    if (elements.messageTitle) {
        elements.messageTitle.textContent = type === 'error' ? 'Error' : 'Sistema';
    }
    if (elements.messageText) {
        elements.messageText.textContent = message;
    }
    
    if (elements.messageIcon) {
        elements.messageIcon.textContent = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
    }
    
    if (elements.messageSection) {
        elements.messageSection.style.display = 'flex';
        
        if (type !== 'error') {
            setTimeout(() => {
                elements.messageSection.style.display = 'none';
            }, 2000);
        }
    }
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

function handleVisibilityChange() {
    if (document.hidden) {
        if (appState.scanning) {
            stopScanning();
        }
    } else {
        if (appState.currentMode && !appState.scanning) {
            startZXingScanning();
        }
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
