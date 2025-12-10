/**
 * ACTUALIZACIONES PARA APP.JS - USO DE SUPABASE
 *
 * Reemplazar las funciones indicadas en App.js con estas versiones
 * que usan Supabase directamente en lugar del backend Express
 */

// ============================================================
// 1. ACTUALIZAR initializeApp() - Agregar inicialización de Supabase
// ============================================================
function initializeApp() {
    if (!verificarAuth()) return;

    console.log('🚀 Inicializando sistema checador...');

    // NUEVO: Inicializar Supabase
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

// ============================================================
// 2. REEMPLAZAR processQRCode() - Nueva versión con Supabase
// ============================================================
async function processQRCode(qrCode) {
    try {
        console.log('🔍 Procesando código QR:', qrCode);

        showLoading();

        // NUEVO: Validar QR con Supabase
        const validation = await SupabaseAPI.validateQR(qrCode);

        if (!validation.success) {
            hideLoading();
            showError('Código inválido', validation.message);
            return;
        }

        const { empleado, tipoRegistro, bloqueId } = validation;

        console.log('✅ QR válido:', {
            empleado: `${empleado.nombre} ${empleado.apellido}`,
            tipo: tipoRegistro,
            bloque: bloqueId
        });

        // Capturar foto
        const fotoBase64 = await capturarFoto();

        // NUEVO: Crear registro con Supabase
        const result = await SupabaseAPI.createRegistro(
            empleado.id,
            tipoRegistro,
            qrCode,
            TABLET_CONFIG.id,
            bloqueId,
            fotoBase64
        );

        hideLoading();

        if (result.success) {
            showSuccess(
                'Registro exitoso',
                `${tipoRegistro} registrada correctamente`,
                {
                    codigo_empleado: empleado.codigo_empleado,
                    nombre: empleado.nombre,
                    apellido: empleado.apellido,
                    foto_perfil: empleado.foto_perfil
                }
            );
        } else {
            showError('Error de registro', result.message);
        }

    } catch (error) {
        console.error('❌ Error procesando QR:', error);
        hideLoading();
        showError('Error de conexión', 'No se pudo procesar el código QR');
    } finally {
        // Reiniciar escaneo después de 3 segundos
        setTimeout(() => {
            if (appState.scanning) {
                startScanning(appState.currentMode);
            }
        }, 3000);
    }
}

// ============================================================
// 3. REEMPLAZAR startHealthCheck() - Health check con Supabase
// ============================================================
async function startHealthCheck() {
    async function checkHealth() {
        try {
            const isConnected = await SupabaseAPI.healthCheck();

            if (isConnected) {
                appState.connected = true;
                appState.lastPing = new Date();
                elements.connectionStatus.classList.add('connected');
                elements.connectionStatus.classList.remove('disconnected');
            } else {
                appState.connected = false;
                elements.connectionStatus.classList.remove('connected');
                elements.connectionStatus.classList.add('disconnected');
                console.warn('⚠️  Sin conexión a Supabase');
            }
        } catch (error) {
            appState.connected = false;
            elements.connectionStatus.classList.remove('connected');
            elements.connectionStatus.classList.add('disconnected');
            console.error('❌ Error en health check:', error);
        }
    }

    // Check inicial
    await checkHealth();

    // Check cada 30 segundos
    setInterval(checkHealth, 30000);
}

// ============================================================
// 4. ACTUALIZAR CONFIGURACIÓN - Ya no necesitamos apiUrl
// ============================================================
const TABLET_CONFIG = {
    id: 'TABLET_01',
    location: 'PTRN01',
    // apiUrl ya no se usa - Supabase se configura en supabase-config.js
};

// ============================================================
// NOTAS DE IMPLEMENTACIÓN:
// ============================================================
/*
1. Copiar estas funciones en App.js reemplazando las originales
2. Actualizar TABLET_CONFIG eliminando apiUrl
3. Las funciones capturarFoto(), showSuccess(), showError(), showLoading(), hideLoading()
   se mantienen igual
4. La librería de Supabase se carga desde el CDN en Index.html
5. supabase-config.js maneja toda la lógica de conexión con Supabase
*/
