// ================================
// ADMIN.JS - PANEL ADMINISTRATIVO SISTEMA CHECADOR QR
// Versión 3.0 - Código limpio y organizado
// ================================

// ================================
// CONFIGURACIÓN GLOBAL
// ================================
const ADMIN_CONFIG = {
    apiUrl: 'https://checador-qr.ngrok.app/api',
    refreshInterval: 30000,
    autoLogoutTime: 3600000,
    maxFileSize: 5 * 1024 * 1024,
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp']
};

// ================================
// HELPERS DE ZONA HORARIA - MAZATLÁN (UTC-7)
// ================================
/**
 * Convertir string de fecha a Date object en zona horaria de Mazatlán
 * Supabase guarda en UTC, aquí convertimos a hora local de Mazatlán
 */
function getMazatlanTime(dateString) {
    // Crear fecha desde string UTC
    const date = new Date(dateString);
    // Retornar el objeto Date que JavaScript manejará en la zona horaria local del navegador
    return date;
}

// ================================
// HELPER PARA URLs DE FOTOS DE SUPABASE
// ================================
/**
 * Construir URL completa de foto desde Supabase Storage
 * Si ya es una URL completa, la retorna tal cual
 * Si es solo un nombre de archivo, construye la URL pública completa
 */
function getSupabaseFotoUrl(fotoPath, bucket = 'empleados-fotos') {
    if (!fotoPath) return null;

    // Si ya es una URL completa, retornarla
    if (fotoPath.startsWith('http://') || fotoPath.startsWith('https://')) {
        return fotoPath;
    }

    const SUPABASE_URL = 'https://uqncsqstpcynjxnjhrqu.supabase.co';

    // Si la ruta empieza con /uploads/fotos/, extraer solo el nombre del archivo
    if (fotoPath.startsWith('/uploads/fotos/')) {
        const fileName = fotoPath.replace('/uploads/fotos/', '');
        return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${fileName}`;
    }

    // Si es solo el nombre del archivo, construir URL completa
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${fotoPath}`;
}
// ================================
// ESTADO DE LA APLICACIÓN
// ================================
let adminState = {
    currentSection: 'dashboard',
    selectedEmployee: null,
    selectedHorario: null,
    dashboardData: {},
    employeesData: [],
    horariosData: [],
    registrosData: [],
    filters: {},
    pagination: { page: 1, limit: 20 },
    lastActivity: new Date(),
    refreshTimer: null
};

// ================================
// ELEMENTOS DOM
// ================================
const elements = {
    navItems: document.querySelectorAll('.nav-item'),
    sections: document.querySelectorAll('.content-section'),
    pageTitle: document.getElementById('pageTitle'),
    
    // Dashboard
    empleadosPresentes: document.getElementById('empleadosPresentes'),
    registrosHoy: document.getElementById('registrosHoy'),
    llegadasTarde: document.getElementById('llegadasTarde'),
    tabletsActivas: document.getElementById('tabletsActivas'),
    
    // Tablas
    empleadosPresentesTable: document.getElementById('empleadosPresentesTable'),
    ultimosRegistrosTable: document.getElementById('ultimosRegistrosTable'),
    empleadosTable: document.getElementById('empleadosTable'),
    horariosTable: document.getElementById('horariosTable'),
    registrosTable: document.getElementById('registrosTable'),
    
    // Modals
    modalEmpleado: document.getElementById('modalEmpleado'),
    formEmpleado: document.getElementById('formEmpleado'),
    
    // Filters
    searchEmpleados: document.getElementById('searchEmpleados'),
    filterHorario: document.getElementById('filterHorario'),
    filterEstado: document.getElementById('filterEstado'),
    fechaInicio: document.getElementById('fechaInicio'),
    fechaFin: document.getElementById('fechaFin')
};

// ================================
// INICIALIZACIÓN
// ================================
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(initializeAdmin, 100);
});

async function initializeAdmin() {
    console.log('🚀 Inicializando panel administrativo...');

    try {
        // Inicializar Supabase
        if (!initSupabase()) {
            console.error('❌ Error: No se pudo inicializar Supabase');
            showAlert('Error de configuración', 'No se pudo conectar con la base de datos', 'error');
            return;
        }

        setupNavigation();
        setupEventListeners();
        window.addEventListener('error', handleGlobalError);
        handleMissingImages();

        await loadInitialData();
        
        startAutoRefresh();
        setupAutoLogout();
        
        // Agregar estilos y configurar reportes
        addRequiredStyles();
        setupReportesSection();
        
        console.log('✅ Panel administrativo inicializado');
        
    } catch (error) {
        console.error('❌ Error inicializando admin:', error);
        showAlert('Error', 'No se pudo inicializar el panel administrativo', 'error');
    } finally {
        setTimeout(killAllSpinners, 500);
    }
}

// ================================
// NAVEGACIÓN
// ================================
function setupNavigation() {
    elements.navItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const section = this.querySelector('a').dataset.section;
            if (section) {
                navigateToSection(section);
            }
        });
    });
}

function navigateToSection(section) {
    // Actualizar navegación
    elements.navItems.forEach(item => {
        item.classList.remove('active');
        if (item.querySelector('a').dataset.section === section) {
            item.classList.add('active');
        }
    });
    
    // Mostrar sección
    elements.sections.forEach(sec => {
        sec.classList.remove('active');
        if (sec.id === section) {
            sec.classList.add('active');
        }
    });
    
    // Actualizar título
    const titles = {
        dashboard: 'Dashboard',
        empleados: 'Gestión de Empleados',
        horarios: 'Gestión de Horarios',
        registros: 'Registros de Asistencia',
        reportes: 'Reportes y Estadísticas',
        configuracion: 'Configuración del Sistema'
    };
    
    if (elements.pageTitle) {
        elements.pageTitle.textContent = titles[section] || section;
    }
    
    adminState.currentSection = section;
    loadSectionData(section);
}

// ================================
// EVENTOS
// ================================
function setupEventListeners() {
    // Botones principales
    document.getElementById('btnNuevoEmpleado')?.addEventListener('click', () => openEmployeeModal());
    document.getElementById('btnNuevoHorario')?.addEventListener('click', () => openHorarioModal());
    
    // Filtros
    elements.searchEmpleados?.addEventListener('input', debounce(filterEmployees, 300));
    elements.filterHorario?.addEventListener('change', filterEmployees);
    elements.filterEstado?.addEventListener('change', filterEmployees);
    
    // Fechas
    elements.fechaInicio?.addEventListener('change', updateDateFilters);
    elements.fechaFin?.addEventListener('change', updateDateFilters);
    
    // Modales
    document.querySelectorAll('.close').forEach(btn => {
        btn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            if (modal) closeModal(modal.id);
        });
    });
    
    // Cerrar modal al hacer click fuera
    window.addEventListener('click', function(e) {
        if (e.target.classList.contains('modal')) {
            closeModal(e.target.id);
        }
    });
    
    // Preview de foto
    document.getElementById('empFoto')?.addEventListener('change', handlePhotoPreview);
    
    // Activity tracking
    ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(event => {
        document.addEventListener(event, updateLastActivity);
    });
}

// ================================
// CARGA DE DATOS
// ================================
async function loadInitialData() {
    showLoading('Cargando datos iniciales...');
    
    try {
        const results = await Promise.allSettled([
            loadDashboardData(),
            loadEmployees(),
            loadHorarios(),
            loadRecentRegistros()
        ]);
        
        results.forEach((result, index) => {
            const names = ['Dashboard', 'Empleados', 'Horarios', 'Registros'];
            if (result.status === 'rejected') {
                console.warn(`⚠️ Error cargando ${names[index]}:`, result.reason);
            } else {
                console.log(`✅ ${names[index]} cargado correctamente`);
            }
        });
        
        if (adminState.horariosData.length > 0) populateHorarioSelects();
        if (adminState.employeesData.length > 0) populateEmployeeSelects();
        
    } catch (error) {
        console.error('❌ Error cargando datos:', error);
        showAlert('Error', 'No se pudieron cargar algunos datos', 'warning');
    } finally {
        hideLoading();
        setTimeout(killAllSpinners, 500);
    }
}

async function loadDashboardData() {
    try {
        console.log('📊 Iniciando carga del dashboard...');

        document.querySelectorAll('.stat-number').forEach(el => {
            if (el) el.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size: 14px;"></i>';
        });

        // NUEVO: Usar Supabase API
        const result = await SupabaseAPI.getDashboardEstadisticas();
        console.log('📊 Respuesta de Supabase:', result);

        if (result.success && result.data) {
            updateDashboardStats(result.data);

            // Cargar tablas adicionales
            try {
                const empleadosData = await SupabaseAPI.getEmpleadosPresentes();
                if (empleadosData.success) {
                    updateEmpleadosPresentesTable(empleadosData.data || []);
                }
            } catch (e) {
                console.warn('⚠️ No se pudieron cargar empleados presentes');
            }

            try {
                const registrosData = await SupabaseAPI.getRegistrosRecientes();
                if (registrosData.success) {
                    updateUltimosRegistrosTable(registrosData.data || []);
                }
            } catch (e) {
                console.warn('⚠️ No se pudieron cargar registros recientes');
            }

        } else {
            throw new Error(result.message || 'No se recibieron datos válidos');
        }

        console.log('✅ Dashboard cargado correctamente');

    } catch (error) {
        console.error('❌ Error cargando dashboard:', error);

        updateDashboardStats({
            empleados_presentes: 0,
            registros_hoy: 0,
            tardanzas: 0,
            tablets_activas: 0
        });

    } finally {
        setTimeout(killAllSpinners, 500);
    }
}

async function loadEmployees() {
    try {
        // NUEVO: Usar Supabase API
        const data = await SupabaseAPI.getEmpleados();

        if (data.success) {
            // Transformar datos para incluir horario_nombre
            adminState.employeesData = (data.data || []).map(emp => ({
                ...emp,
                horario_nombre: emp.horario?.nombre || null,
                horario_id: emp.horario?.id || emp.horario_id
            }));
            renderEmployeesTable();
        }
    } catch (error) {
        console.error('Error loading employees:', error);
        adminState.employeesData = [];
    }
}

async function loadHorarios() {
    try {
        // NUEVO: Usar Supabase API
        const data = await SupabaseAPI.getHorarios();

        if (data.success) {
            adminState.horariosData = data.data || [];
            renderHorariosTable();
        }
    } catch (error) {
        console.error('Error loading horarios:', error);
        adminState.horariosData = [];
    }
}

async function loadRecentRegistros() {
    try {
        // NUEVO: Usar Supabase API
        const data = await SupabaseAPI.getRegistrosToday(50);

        if (data.success) {
            adminState.registrosData = data.data || data.registros || [];

            // Si estamos en la sección de registros, usar la función avanzada
            if (adminState.currentSection === 'registros') {
                renderRegistrosTableAdvanced();
            } else {
                renderRegistrosTableAdvanced();
            }
        }
    } catch (error) {
        console.error('Error loading registros:', error);
        adminState.registrosData = [];
    }
}

// ================================
// FUNCIONES DE SECCIONES
// ================================
async function loadSectionData(section) {
    console.log(`Cargando datos para sección: ${section}`);
    
    switch(section) {
        case 'dashboard':
            loadDashboardData();
            break;
        case 'empleados':
            loadEmployees();
            break;
        case 'horarios':
            loadHorarios();
            break;
        case 'registros':
            await loadRegistrosData();
            setupRegistrosFilters();
            setupRegistrosPagination();
            break;
        case 'reportes':
            console.log('Cargando sección de reportes...');
            setTimeout(renderEstadisticasConDatosReales, 500);
            break;
        case 'configuracion':
            console.log('Sección de configuración (en desarrollo)');
            break;
        default:
            console.log(`Sección no reconocida: ${section}`);
    }
}

// ================================
// SECCIÓN DE REGISTROS AVANZADA
// ================================

// Cargar datos específicos para registros
async function loadRegistrosData() {
    try {
        console.log('📊 Cargando datos de registros...');
        
        // Cargar registros
        await loadRecentRegistros();
        
        // Cargar empleados para el filtro
        await loadEmpleadosForFilter();
        
        // Establecer fechas por defecto
        setDefaultDates();
        
        // Actualizar estadísticas
        updateRegistrosStats();
        
    } catch (error) {
        console.error('❌ Error cargando datos de registros:', error);
    }
}

// Cargar empleados para el filtro
async function loadEmpleadosForFilter() {
    try {
        // NUEVO: Usar Supabase API
        const data = await SupabaseAPI.getEmpleados();
        
        if (data.success && data.data) {
            const selectEmpleado = document.getElementById('filterEmpleado');
            if (selectEmpleado) {
                // Limpiar opciones existentes (excepto la primera)
                selectEmpleado.innerHTML = '<option value="">TODOS LOS EMPLEADOS</option>';
                
                // Agregar empleados activos
                data.data
                    .filter(emp => emp.activo)
                    .forEach(empleado => {
                        const option = document.createElement('option');
                        option.value = empleado.id;
                        option.textContent = `${empleado.nombre} ${empleado.apellido_paterno || ''} ${empleado.apellido_materno || ''}`.trim();
                        selectEmpleado.appendChild(option);
                    });
                
                console.log('✅ Empleados cargados en filtro:', data.data.length);
            }
        }
    } catch (error) {
        console.error('❌ Error cargando empleados para filtro:', error);
    }
}

// Establecer fechas por defecto
function setDefaultDates() {
    const hoy = new Date();
    const fechaInicio = document.getElementById('fechaInicio');
    const fechaFin = document.getElementById('fechaFin');
    const periodoActual = document.getElementById('periodoActual');
    
    if (fechaInicio) {
        fechaInicio.value = hoy.toISOString().split('T')[0];
    }
    if (fechaFin) {
        fechaFin.value = hoy.toISOString().split('T')[0];
    }
    if (periodoActual) {
        const fechaFormateada = hoy.toLocaleDateString('es-MX');
        periodoActual.textContent = `${fechaFormateada} - ${fechaFormateada}`;
    }
}

// Función mejorada para renderizar la tabla de registros
function renderRegistrosTableAdvanced() {
    const tbody = document.querySelector('#registrosTable tbody');
    if (!tbody) {
        console.warn('⚠️ No se encontró tbody de registros');
        return;
    }
    
    const registros = adminState.registrosData || [];
    
    if (registros.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" style="text-align: center; color: #6b7280; padding: 40px;">
                    <i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 10px; opacity: 0.3;"></i><br>
                    No hay registros para mostrar<br>
                    <small>Intenta ajustar los filtros o el rango de fechas</small>
                </td>
            </tr>
        `;
        return;
    }
    
    // Agrupar registros por empleado y fecha
    const registrosAgrupados = agruparRegistrosPorEmpleadoYFecha(registros);
    
    tbody.innerHTML = registrosAgrupados.map(grupo => `
        <tr>
            <td>
                <input type="checkbox" name="registro-select" value="${grupo.empleado_id}">
            </td>
            <td>
                <div class="empleado-info">
                    <div class="empleado-avatar">
                        ${getInitials(grupo.empleado_nombre)}
                    </div>
                    <div class="empleado-details">
                        <div class="empleado-nombre">${grupo.empleado_nombre}</div>
                        <div class="empleado-codigo">${grupo.empleado_codigo || 'Sin código'}</div>
                    </div>
                </div>
            </td>
            <td>
                <span class="fecha-badge">${formatDateBadge(grupo.fecha)}</span>
            </td>
            <td>
                ${renderHoraBadge(grupo.entrada)}
            </td>
            <td>
                ${renderHoraBadge(grupo.salida)}
            </td>
            <td>
                <span class="horas-trabajadas">${calcularHorasTrabajadasGrupo(grupo)}</span>
            </td>
            <td>
                <div class="horas-objetivo">
                    <i class="fas fa-clock" style="color: #3b82f6; font-size: 12px;"></i>
                    <span>${grupo.horas_objetivo || '8:00'}</span>
                </div>
            </td>
            <td>
                <span class="estatus-badge ${getEstatusClassAdvanced(grupo.estatus)}">
                    ${grupo.estatus}
                </span>
            </td>
            <td>
                <span class="tablet-info">${grupo.tablet_id || 'N/A'}</span>
            </td>
            <td>
                ${grupo.foto_url ?
                    `<img src="${getSupabaseFotoUrl(grupo.foto_url, 'registros-fotos')}" class="foto-thumbnail" onclick="verFotoCompleta('${getSupabaseFotoUrl(grupo.foto_url, 'registros-fotos')}')" alt="Foto registro">` :
                    '<span style="color: #9ca3af; font-size: 12px;">Sin foto</span>'
                }
            </td>
            <td style="text-align: center;">
                <button onclick="verTodasFotos(${grupo.empleado_id}, '${grupo.fecha}', '${grupo.empleado_nombre}')" 
                        style="background: #17a2b8; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 11px;">
                    📸 Ver todas
                </button>
            </td>

            <td>
                <div class="acciones-cell">
                    <button class="btn-accion editar" onclick="editarRegistro(${grupo.entrada?.id || grupo.salida?.id})" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-accion eliminar" onclick="eliminarRegistro(${grupo.entrada?.id || grupo.salida?.id})" title="Eliminar">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
    
    // Actualizar información de paginación
    updatePaginationInfo(registrosAgrupados.length);
}

// Agrupar registros por empleado y fecha
function agruparRegistrosPorEmpleadoYFecha(registros) {
    const grupos = new Map();

    // Agrupar registros por empleado y fecha
    registros.forEach(registro => {
        const fechaMazatlan = getMazatlanTime(registro.fecha_hora);
        const fecha = fechaMazatlan.toDateString();
        const key = `${registro.empleado_id}-${fecha}`;

        if (!grupos.has(key)) {
            grupos.set(key, {
                empleado_id: registro.empleado_id,
                empleado_nombre: registro.empleado_nombre,
                empleado_codigo: registro.empleado_codigo,
                fecha: fecha,
                registros: [],  // Array de todos los registros del día
                tablet_id: registro.tablet_id,
                foto_url: registro.foto_registro,
                horas_objetivo: '8:00'
            });
        }

        const grupo = grupos.get(key);
        grupo.registros.push(registro);
    });

    // Procesar cada grupo para calcular horas correctamente
    return Array.from(grupos.values()).map(grupo => {
        const registrosOrdenados = grupo.registros.sort((a, b) =>
            getMazatlanTime(a.fecha_hora) - getMazatlanTime(b.fecha_hora)
        );

        // Emparejar entrada-salida consecutivos
        let entradaPendiente = null;
        let totalMinutos = 0;
        const pares = [];

        for (let i = 0; i < registrosOrdenados.length; i++) {
            const registro = registrosOrdenados[i];

            if (registro.tipo_registro === 'ENTRADA') {
                entradaPendiente = registro;
            } else if (registro.tipo_registro === 'SALIDA' && entradaPendiente) {
                // Calcular diferencia entre entrada y salida
                const entrada = new Date(entradaPendiente.fecha_hora);
                const salida = new Date(registro.fecha_hora);
                const minutos = Math.floor((salida - entrada) / (1000 * 60));

                totalMinutos += minutos;
                pares.push({
                    entrada: entradaPendiente,
                    salida: registro,
                    minutos: minutos
                });

                entradaPendiente = null;
            }
        }

        // Convertir minutos totales a formato horas
        const horas = Math.floor(totalMinutos / 60);
        const minutos = totalMinutos % 60;
        const horasFormato = `${horas}h ${minutos.toString().padStart(2, '0')}m`;

        // Determinar estatus
        let estatus = 'SIN REGISTRO';
        if (pares.length > 0) {
            estatus = 'COMPLETO';    // Al menos un par entrada-salida
        } else if (registrosOrdenados.length > 0) {
            estatus = 'INCOMPLETO';  // Hay registros pero sin pares (solo entrada o solo salida)
        }

        const entradaRegistro = registrosOrdenados.find(r => r.tipo_registro === 'ENTRADA');
        const salidaRegistro = [...registrosOrdenados].reverse().find(r => r.tipo_registro === 'SALIDA');

        // DEBUG
        if (grupo.empleado_nombre && (entradaRegistro || salidaRegistro)) {
            console.log(`[${grupo.empleado_nombre}] ENTRADA:`, entradaRegistro?.fecha_hora, 'SALIDA:', salidaRegistro?.fecha_hora);
        }

        return {
            ...grupo,
            entrada: entradaRegistro,
            salida: salidaRegistro,
            horas_trabajadas: horasFormato,
            minutos_totales: totalMinutos,
            pares_entrada_salida: pares,
            estatus: estatus
        };
    });
}

// Funciones auxiliares para registros avanzados
function getInitials(nombre) {
    if (!nombre) return '??';
    return nombre.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function formatDateBadge(fecha) {
    const date = new Date(fecha);
    return date.toLocaleDateString('es-MX', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function renderHoraBadgeAdvanced(registro, tipoColumna) {
    if (!registro) {
        return '<span class="hora-badge sin-registro">--:--</span>';
    }

    const horaMazatlan = getMazatlanTime(registro.fecha_hora);
    const hora = horaMazatlan.toLocaleTimeString('en-US', { timeZone: 'America/Mazatlan',
        hour: '2-digit',
        minute: '2-digit'
    });

    // Usar el tipo de columna para determinar si es tardanza
    const esTardanza = tipoColumna === 'ENTRADA' &&
                      horaMazatlan.getHours() > 8;

    const claseExtra = esTardanza ? ' tardanza' : '';
    return `<span class="hora-badge${claseExtra}">${hora}</span>`;
}

function renderHoraBadge(registro) {
    if (!registro) {
        return '<span class="hora-badge sin-registro">--:--</span>';
    }

    const horaMazatlan = getMazatlanTime(registro.fecha_hora);
    const hora = horaMazatlan.toLocaleTimeString('en-US', { timeZone: 'America/Mazatlan',
        hour: '2-digit',
        minute: '2-digit'
    });

    // Determinar si es tardanza solo si es ENTRADA y después de las 8 AM
    const esTardanza = registro.tipo_registro === 'ENTRADA' &&
                      horaMazatlan.getHours() > 8;

    const claseExtra = esTardanza ? ' tardanza' : '';
    return `<span class="hora-badge${claseExtra}">${hora}</span>`;
}

function calcularHorasTrabajadasGrupo(grupo) {
    // Usar el nuevo campo que calcula correctamente los pares entrada-salida
    return grupo.horas_trabajadas || '0h 00m';
}

function getEstatusClassAdvanced(estatus) {
    const clases = {
        'COMPLETO': 'completo',
        'INCOMPLETO': 'incompleto',
        'SIN REGISTRO': 'sin-registro'
    };
    return clases[estatus] || 'sin-registro';
}

// Función actualizada para filtrar registros (CORREGIDA PARA TU SISTEMA)
async function filtrarRegistros() {
    const fechaInicio = document.getElementById('fechaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const empleadoId = document.getElementById('filterEmpleado').value;
    const tipo = document.getElementById('filterTipo').value;
    const sucursal = document.getElementById('filterSucursal').value;
    const puesto = document.getElementById('filterPuesto').value;
    
    try {
        showLoading('Filtrando registros...');
        
        // Construir URL con parámetros
        const params = new URLSearchParams();
        if (fechaInicio) params.append('fechaInicio', fechaInicio);
        if (fechaFin) params.append('fechaFin', fechaFin);
        if (empleadoId) params.append('empleadoId', empleadoId);
        if (tipo) params.append('tipo', tipo);
        if (sucursal) params.append('sucursal', sucursal);
        if (puesto) params.append('puesto', puesto);
        
        // Usar tu endpoint actual de registros
        const url = `/api/registros${params.toString() ? '?' + params.toString() : ''}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            // Actualizar estado global (usar tu variable global existente)
            adminState.registrosData = data.registros;
            adminState.currentPage = 1;
            
            // Actualizar período mostrado
            const periodoElement = document.getElementById('periodoActual');
            if (periodoElement) {
                if (fechaInicio && fechaFin) {
                    const fechaInicioFormatted = formatearFechaCorta(fechaInicio);
                    const fechaFinFormatted = formatearFechaCorta(fechaFin);
                    periodoElement.textContent = `${fechaInicioFormatted} - ${fechaFinFormatted}`;
                } else {
                    periodoElement.textContent = 'Todos los registros';
                }
            }
            
            // Actualizar estadísticas
            actualizarEstadisticasRegistros(data.registros);
            
            // Usar tu función existente para renderizar
           renderRegistrosTableAdvanced();
            
            console.log(`Filtros aplicados: ${data.registros.length} registros encontrados`);
        } else {
            showError('Error al filtrar registros: ' + data.message);
        }
        
    } catch (error) {
        console.error('Error al filtrar registros:', error);
        showError('Error al filtrar registros');
    } finally {
        hideLoading();
    }
}

// Actualizar estadísticas de registros
function updateRegistrosStats() {
    const registros = adminState.registrosData || [];
    
    // Calcular estadísticas
    const registrosSinCheck = registros.filter(r => !r.tipo_registro || r.tipo_registro === '').length;
    const hrsExtra = 0; // Por implementar
    const totalRegistros = registros.length;
    
    // Actualizar elementos
    const elements = {
        registrosSinCheck: document.getElementById('registrosSinCheck'),
        hrsExtra: document.getElementById('hrsExtra'),
        totalRegistros: document.getElementById('totalRegistros')
    };
    
    if (elements.registrosSinCheck) elements.registrosSinCheck.textContent = registrosSinCheck;
    if (elements.hrsExtra) elements.hrsExtra.textContent = hrsExtra;
    if (elements.totalRegistros) elements.totalRegistros.textContent = totalRegistros;
}

// Configurar filtros de registros
function setupRegistrosFilters() {
    // Event listeners para filtros automáticos
    const fechaInicio = document.getElementById('fechaInicio');
    const fechaFin = document.getElementById('fechaFin');
    
    if (fechaInicio && fechaFin) {
        fechaInicio.addEventListener('change', () => {
            if (fechaFin.value && fechaInicio.value > fechaFin.value) {
                fechaFin.value = fechaInicio.value;
            }
        });
        
        fechaFin.addEventListener('change', () => {
            if (fechaInicio.value && fechaFin.value < fechaInicio.value) {
                fechaInicio.value = fechaFin.value;
            }
        });
    }
}
// Función para descargar faltas por RANGO de fechas
async function obtenerEmpleadosSinEntradaRango() {
    const fechaInicio = document.getElementById('fecha-inicio-faltas').value;
    const fechaFin = document.getElementById('fecha-fin-faltas').value;

    if (!fechaInicio || !fechaFin) {
        alert('⚠️ Selecciona fecha de inicio y fin');
        return;
    }

    if (fechaInicio > fechaFin) {
        alert('⚠️ La fecha de inicio debe ser menor que la fecha fin');
        return;
    }

    try {
        const button = event.target;
        const originalText = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';

        console.log(`📅 Consultando faltas desde ${fechaInicio} hasta ${fechaFin}`);

        // Obtener todos los empleados activos
        const empleadosResult = await SupabaseAPI.getEmpleados();
        if (!empleadosResult.success) {
            throw new Error('Error obteniendo empleados');
        }

        const empleadosActivos = empleadosResult.data.filter(emp => emp.activo);
        console.log(`👥 Empleados activos: ${empleadosActivos.length}`);

        // Obtener todos los registros del rango
        const registrosResult = await SupabaseAPI.getRegistrosByFecha(fechaInicio, fechaFin);
        if (!registrosResult.success) {
            throw new Error('Error obteniendo registros');
        }

        const registros = registrosResult.data;
        console.log(`📊 Registros obtenidos: ${registros.length}`);

        // Generar todas las fechas del rango
        const fechas = generarRangoFechas(fechaInicio, fechaFin);
        const todasLasFaltas = [];

        // Buscar faltas por cada fecha
        for (let i = 0; i < fechas.length; i++) {
            const fecha = fechas[i];
            button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Analizando ${fecha} (${i + 1}/${fechas.length})`;

            // Filtrar registros de esta fecha
            const registrosFecha = registros.filter(reg => {
                const regFecha = new Date(reg.fecha_hora).toISOString().split('T')[0];
                return regFecha === fecha && reg.tipo_registro === 'ENTRADA';
            });

            // IDs de empleados que SÍ registraron entrada
            const empleadosConEntrada = new Set(registrosFecha.map(reg => reg.empleado_id));

            // Empleados que NO registraron entrada (faltas)
            const faltasDia = empleadosActivos.filter(emp => !empleadosConEntrada.has(emp.id));

            // Agregar fecha a cada falta
            faltasDia.forEach(emp => {
                todasLasFaltas.push({
                    fecha_falta: fecha,
                    codigo_empleado: emp.codigo_empleado,
                    nombre_completo: `${emp.nombre} ${emp.apellido}`,
                    sucursal: emp.sucursal,
                    puesto: emp.puesto,
                    horario_nombre: emp.horario_nombre || 'Sin horario',
                    observacion: 'Sin registro de entrada'
                });
            });
        }

        console.log(`📊 Total faltas encontradas: ${todasLasFaltas.length}`);

        if (todasLasFaltas.length === 0) {
            alert('✅ No se encontraron faltas en el rango de fechas seleccionado');
        } else {
            descargarExcelFaltasRango(todasLasFaltas, fechaInicio, fechaFin);
        }

        button.disabled = false;
        button.innerHTML = originalText;

    } catch (error) {
        console.error('Error:', error);
        alert('❌ Error al consultar faltas: ' + error.message);

        const button = event.target;
        if (button) {
            button.disabled = false;
            button.innerHTML = '📥 Descargar Rango';
        }
    }
}

function generarRangoFechas(fechaInicio, fechaFin) {
    const fechas = [];
    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);
    
    for (let fecha = new Date(inicio); fecha <= fin; fecha.setDate(fecha.getDate() + 1)) {
        fechas.push(fecha.toISOString().split('T')[0]);
    }
    
    return fechas;
}

function descargarExcelFaltasRango(empleados, fechaInicio, fechaFin) {
    console.log('📥 Generando Excel de faltas por rango...');
    
    // Crear contenido CSV
    let csvContent = '\ufeff'; // BOM para UTF-8
    
    // HEADERS
    csvContent += 'REPORTE DE FALTAS POR RANGO DE FECHAS\n';
    csvContent += `Período: ${fechaInicio} al ${fechaFin}\n`;
    csvContent += `Total faltas encontradas: ${empleados.length}\n`;
    csvContent += `Generado: ${new Date().toLocaleString()}\n\n`;
    
    // HEADERS DE TABLA
    csvContent += 'Fecha,Código,Empleado,Sucursal,Puesto,Horario,Observación\n';
    
    // AGRUPAR por fecha para mejor organización
    const faltasPorFecha = {};
    empleados.forEach(empleado => {
        if (!faltasPorFecha[empleado.fecha_falta]) {
            faltasPorFecha[empleado.fecha_falta] = [];
        }
        faltasPorFecha[empleado.fecha_falta].push(empleado);
    });
    
    // ORDENAR fechas
    const fechasOrdenadas = Object.keys(faltasPorFecha).sort();
    
    // DATOS ORGANIZADOS por fecha
    fechasOrdenadas.forEach(fecha => {
        faltasPorFecha[fecha].forEach(empleado => {
            csvContent += `"${empleado.fecha_falta}",`;
            csvContent += `"${empleado.codigo_empleado}",`;
            csvContent += `"${empleado.nombre_completo}",`;
            csvContent += `"${empleado.sucursal || ''}",`;
            csvContent += `"${empleado.puesto || ''}",`;
            csvContent += `"${empleado.horario_nombre}",`;
            csvContent += `"${empleado.observacion}"\n`;
        });
    });
    
    // RESUMEN por fecha al final
    csvContent += '\n\nRESUMEN POR FECHA:\n';
    csvContent += 'Fecha,Cantidad Faltas\n';
    fechasOrdenadas.forEach(fecha => {
        csvContent += `"${fecha}",${faltasPorFecha[fecha].length}\n`;
    });

    // CREAR y DESCARGAR archivo
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    const totalDias = fechasOrdenadas.length;
    const nombreArchivo = `Faltas_${fechaInicio}_al_${fechaFin}_${empleados.length}_faltas_${totalDias}_dias.csv`;
    
    link.setAttribute('href', url);
    link.setAttribute('download', nombreArchivo);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    console.log('✅ Excel de rango descargado');
    alert(`📥 Excel descargado: ${empleados.length} faltas en ${totalDias} días`);
}
async function verTodasFotos(empleadoId, fecha, nombre) {
    try {
        console.log(`📸 Consultando fotos: empleado ${empleadoId}, fecha ${fecha}`);

        // NUEVO: Usar Supabase API
        const result = await SupabaseAPI.getFotosRegistro(empleadoId, fecha);

        if (result.success && result.data.length > 0) {
            mostrarModalFotosReales(result.data, result.empleado, fecha);
        } else {
            alert(`📸 No hay fotos para ${nombre} el ${fecha}`);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('❌ Error al consultar fotos');
    }
}

function mostrarModalFotosReales(fotos, empleado, fecha) {
    // Eliminar modal anterior si existe
    const modalAnterior = document.getElementById('modal-fotos-reales');
    if (modalAnterior) {
        modalAnterior.remove();
    }

    // Crear modal
    const modal = document.createElement('div');
    modal.id = 'modal-fotos-reales';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.9);
        z-index: 10000;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 20px;
    `;

    modal.innerHTML = `
        <div style="
            background: white;
            border-radius: 10px;
            max-width: 90%;
            max-height: 90%;
            overflow-y: auto;
            position: relative;
        ">
            <!-- HEADER -->
            <div style="background: #17a2b8; color: white; padding: 20px; border-radius: 10px 10px 0 0; position: sticky; top: 0;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h2 style="margin: 0;">📸 ${empleado.nombre} - ${fecha}</h2>
                        <p style="margin: 5px 0 0 0; opacity: 0.9;">
                            Código: ${empleado.codigo} • ${fotos.length} foto(s)
                        </p>
                    </div>
                    <button class="btn-cerrar-modal" 
                            style="background: rgba(255,255,255,0.2); color: white; border: 1px solid white; width: 40px; height: 40px; border-radius: 50%; cursor: pointer; font-size: 20px;">
                        ×
                    </button>
                </div>
            </div>

            <!-- GALERÍA -->
            <div style="padding: 20px;">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
                    ${fotos.map((foto, index) => {
                        const rutaFoto = getSupabaseFotoUrl(foto.foto_url || foto.foto_registro, 'registros-fotos') || '';
                        return `
                        <div style="border: 1px solid #dee2e6; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                            <!-- Info del registro -->
                            <div style="background: #f8f9fa; padding: 12px; border-bottom: 1px solid #dee2e6;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                                    <span style="font-weight: bold; color: #495057; font-size: 14px;">Registro #${index + 1}</span>
                                    <span style="background: ${foto.tipo_registro === 'ENTRADA' ? '#28a745' : '#dc3545'}; color: white; padding: 2px 6px; border-radius: 10px; font-size: 11px; font-weight: bold;">
                                        ${foto.tipo_registro}
                                    </span>
                                </div>
                                <div style="font-size: 12px; color: #6c757d;">
                                   🕐 ${getMazatlanTime(foto.fecha_hora).toLocaleTimeString('en-US', { timeZone: 'America/Mazatlan' })}<br>
                                    🖥️ Tablet: ${foto.tablet_id || 'N/A'}
                                </div>
                            </div>
                            
                            <!-- FOTO REAL -->
                            <div style="text-align: center; padding: 15px; background: white;">
                                <img src="${rutaFoto}" 
                                     alt="Foto ${foto.tipo_registro}"
                                     style="max-width: 100%; height: 200px; object-fit: cover; border-radius: 5px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.1);"
                                     onclick="window.open('${rutaFoto}', '_blank')"
                                     title="Click para ver en tamaño completo"
                                     onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                                <div style="display: none; padding: 40px; background: #f8f9fa; color: #6c757d; font-style: italic;">
                                    Foto no disponible
                                </div>
                                <div style="margin-top: 10px;">
                                    <button onclick="window.open('${rutaFoto}', '_blank')"
                                            style="background: #007bff; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 11px; margin-right: 5px;">
                                        🔍 Ampliar
                                    </button>
                                    <button onclick="descargarFotoIndividual('${rutaFoto}', '${empleado.codigo}_${foto.tipo_registro}_${getMazatlanTime(foto.fecha_hora).getHours()}${getMazatlanTime(foto.fecha_hora).getMinutes().toString().padStart(2, '0')}')"
                                            style="background: #28a745; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 11px;">
                                        📥 Descargar
                                    </button>
                                </div>
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <!-- FOOTER -->
            <div style="background: #f8f9fa; padding: 15px; text-align: center; border-top: 1px solid #dee2e6; border-radius: 0 0 10px 10px;">
                <button class="btn-cerrar-modal-footer" 
                        style="background: #6c757d; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
                    🔙 Cerrar
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // AGREGAR EVENT LISTENERS DESPUÉS DE CREAR EL DOM
    const btnCerrarHeader = modal.querySelector('.btn-cerrar-modal');
    const btnCerrarFooter = modal.querySelector('.btn-cerrar-modal-footer');
    
    if (btnCerrarHeader) {
        btnCerrarHeader.addEventListener('click', cerrarModalFotosReales);
    }
    
    if (btnCerrarFooter) {
        btnCerrarFooter.addEventListener('click', cerrarModalFotosReales);
    }

    // Cerrar con click fuera del modal
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            cerrarModalFotosReales();
        }
    });

    // Cerrar con ESC
    const handleEscape = function(e) {
        if (e.key === 'Escape') {
            cerrarModalFotosReales();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
}

function cerrarModalFotosReales() {
    const modal = document.getElementById('modal-fotos-reales');
    if (modal) {
        modal.remove();
    }
}
function descargarFotoIndividual(rutaFoto, nombreArchivo) {
    const link = document.createElement('a');
    link.href = rutaFoto;
    link.download = nombreArchivo + '.jpg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
// Configurar paginación
function setupRegistrosPagination() {
    // Por implementar paginación completa
    console.log('Configurando paginación de registros...');
}

// Funciones adicionales para registros
function updatePaginationInfo(totalItems) {
    const paginationInfo = document.getElementById('paginationInfo');
    if (paginationInfo) {
        paginationInfo.textContent = `Mostrando registros del 1 al ${Math.min(10, totalItems)} de un total de ${totalItems}`;
    }
}

function reloadRegistros() {
    loadRecentRegistros();
}

function verFotoCompleta(url) {
    // Implementar modal para ver foto completa
    console.log('Ver foto:', url);
    window.open(url, '_blank', 'width=600,height=600');
}

function editarRegistro(id) {
    console.log('Editar registro:', id);
    showAlert('Info', 'Función de edición en desarrollo', 'info');
}

function eliminarRegistro(id) {
    if (confirm('¿Estás seguro de eliminar este registro?')) {
        console.log('Eliminar registro:', id);
        showAlert('Info', 'Función de eliminación en desarrollo', 'info');
    }
}

function imprimirRegistros() {
    console.log('Imprimiendo registros...');
    window.print();
}

function configurarColumnas() {
    console.log('Configurar columnas...');
    showAlert('Info', 'Función de configuración de columnas en desarrollo', 'info');
}

function cambiarPagina(direccion) {
    console.log('Cambiar página:', direccion);
    showAlert('Info', 'Paginación en desarrollo', 'info');
}

function toggleSelectAll() {
    const selectAll = document.getElementById('selectAllRegistros');
    const checkboxes = document.querySelectorAll('input[name="registro-select"]');
    
    checkboxes.forEach(checkbox => {
        checkbox.checked = selectAll.checked;
    });
}

// ================================
// ACTUALIZACIÓN DE ESTADÍSTICAS
// ================================
function updateDashboardStats(stats) {
    console.log('📊 Actualizando stats dashboard:', stats);
    
    if (!stats || typeof stats !== 'object') {
        console.warn('⚠️ Stats inválidos, usando valores por defecto');
        stats = {};
    }
    
    const valores = {
        presentes: parseInt(stats.empleadosPresentes || stats.empleados_presentes || 0),
        registros: parseInt(stats.registrosHoy || stats.registros_hoy?.total_registros || stats.registros_hoy || 0) || 0,
        tardanzas: parseInt(stats.llegadasTarde || stats.tardanzas || stats.llegadas_tarde || 0),
        tablets: parseInt(stats.tabletsActivas || stats.tablets_activas || 0)
    };
    
    const elementos = {
        presentes: elements.empleadosPresentes,
        registros: elements.registrosHoy,
        tardanzas: elements.llegadasTarde,
        tablets: elements.tabletsActivas
    };
    
    Object.keys(elementos).forEach(key => {
        const elemento = elementos[key];
        if (elemento) {
            elemento.textContent = valores[key];
            console.log(`📈 ${key}: ${valores[key] || 0}`);
        }
    });
    
    // Backup con selectores alternativos
    if (!elementos.presentes) {
        const el = document.querySelector('[data-stat="presentes"] .stat-number, .stat-card:nth-child(1) .stat-number');
        if (el) el.textContent = valores.presentes;
    }
    if (!elementos.registros) {
        const el = document.querySelector('[data-stat="registros"] .stat-number, .stat-card:nth-child(2) .stat-number');
        if (el) el.textContent = valores.registros;
    }
    if (!elementos.tardanzas) {
        const el = document.querySelector('[data-stat="tardanzas"] .stat-number, .stat-card:nth-child(3) .stat-number');
        if (el) el.textContent = valores.tardanzas;
    }
    if (!elementos.tablets) {
        const el = document.querySelector('[data-stat="tablets"] .stat-number, .stat-card:nth-child(4) .stat-number');
        if (el) el.textContent = valores.tablets;
    }
    
    setTimeout(() => {
        document.querySelectorAll('.stat-number').forEach(el => {
            if (el.textContent.includes('[object') || el.textContent.includes('undefined') || el.textContent === '') {
                el.textContent = '0';
            }
        });
    }, 100);
}

function updateEmpleadosPresentesTable(empleados) {
    const tbody = elements.empleadosPresentesTable?.querySelector('tbody');
    if (!tbody) {
        console.warn('⚠️ No se encontró tabla de empleados presentes');
        return;
    }
    
    if (!empleados || empleados.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; color: #6b7280; padding: 20px;">
                    No hay empleados presentes hoy
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = empleados.map(emp => {
        const horaEntrada = emp.hora_entrada ?
            getMazatlanTime(emp.hora_entrada).toLocaleTimeString('en-US', { timeZone: 'America/Mazatlan',
                hour: '2-digit',
                minute: '2-digit'
            }) : 'N/A';
            
        const horaSalidaEsperada = emp.hora_salida_esperada || 'N/A';
        
        const estadoClass = {
            'PRESENTE': 'badge-success',
            'COMPLETO': 'badge-info',
            'AUSENTE': 'badge-warning'
        }[emp.estado] || 'badge-secondary';
        
        const fotoUrl = getSupabaseFotoUrl(emp.foto_perfil) || '/assets/default-avatar.png';

        return `
            <tr>
                <td>
                    <div class="employee-info">
                        <img src="${fotoUrl}"
                             alt="${emp.nombre_completo || 'Empleado'}"
                             class="employee-avatar"
                             onerror="this.src='data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="#666"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>')}'">
                        <div>
                            <strong>${emp.nombre_completo || 'Sin nombre'}</strong>
                            <small>${emp.codigo_empleado || 'Sin código'}</small>
                        </div>
                    </div>
                </td>
                <td>${horaEntrada}</td>
                <td>${horaSalidaEsperada}</td>
                <td><span class="badge ${estadoClass}">${emp.estado || 'AUSENTE'}</span></td>
            </tr>
        `;
    }).join('');
}

function updateUltimosRegistrosTable(registros) {
    const tbody = elements.ultimosRegistrosTable?.querySelector('tbody');
    if (!tbody) {
        console.warn('⚠️ No se encontró tabla de últimos registros');
        return;
    }
    
    if (!registros || registros.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; color: #6b7280; padding: 20px;">
                    No hay registros recientes
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = registros.map(reg => {
        const hora = reg.fecha_hora ?
            getMazatlanTime(reg.fecha_hora).toLocaleTimeString('en-US', { timeZone: 'America/Mazatlan',
                hour: '2-digit',
                minute: '2-digit'
            }) : 'N/A';
        
        const tipoClass = reg.tipo_registro === 'ENTRADA' ? 'badge-success' : 'badge-info';
        
        return `
            <tr>
                <td>${hora}</td>
                <td>${reg.empleado_nombre || 'N/A'}</td>
                <td><span class="badge ${tipoClass}">${reg.tipo_registro || 'N/A'}</span></td>
                <td>${reg.tablet_id || 'N/A'}</td>
            </tr>
        `;
    }).join('');
}

// ================================
// RENDERIZADO DE TABLAS
// ================================
function renderEmployeesTable() {
    const tbody = elements.empleadosTable?.querySelector('tbody');
    if (!tbody) return;
    
    const filteredEmployees = applyEmployeeFilters();
    
    if (filteredEmployees.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; color: #6b7280; padding: 20px;">
                    No hay empleados para mostrar
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = filteredEmployees.map(emp => {
        const fotoUrl = getSupabaseFotoUrl(emp.foto_perfil) || '/assets/default-avatar.png';

        return `
        <tr data-id="${emp.id}">
            <td>
                <img src="${fotoUrl}"
                    alt="${emp.nombre || 'Empleado'}"
                    class="employee-photo"
                    style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;"
                    onerror="this.src='data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="#666"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>')}'">
            </td>
            <td>${emp.codigo_empleado || 'N/A'}</td>
            <td>${(emp.nombre || '') + ' ' + (emp.apellido || '')}</td>
            <td>
                <span class="badge-sucursal" style="background: #3b82f6; color: white; padding: 3px 8px; border-radius: 12px; font-size: 11px;">
                    ${emp.sucursal || 'Sin asignar'}
                </span>
            </td>
            <td>
                <span class="badge-puesto" style="background: #10b981; color: white; padding: 3px 8px; border-radius: 12px; font-size: 11px;">
                    ${emp.puesto || 'Sin asignar'}
                </span>
            </td>
            <td>${emp.horario_nombre || 'Sin asignar'}</td>
            <td>
                <span class="status-badge status-${emp.activo ? 'activo' : 'inactivo'}">
                    ${emp.activo ? 'Activo' : 'Inactivo'}
                </span>
            </td>
            <td>${formatDate(emp.fecha_alta)}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-sm btn-primary" onclick="editEmployee(${emp.id})" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="viewEmployeeQR(${emp.id})" title="Ver QR">
                        <i class="fas fa-qrcode"></i>
                    </button>
                    <button class="btn btn-sm btn-warning" onclick="toggleEmployeeStatus(${emp.id})" title="Cambiar estado">
                        <i class="fas fa-power-off"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteEmployee(${emp.id})" title="Eliminar">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

// Función para formatear horas bonitas
function formatearHoraBonita(horaString) {
    if (!horaString) return 'N/A';

    try {
        // Si ya es una hora en formato HH:MM:SS o HH:MM, extraerla directamente
        if (typeof horaString === 'string' && horaString.includes(':')) {
            const partes = horaString.split(':');
            const hora = parseInt(partes[0]);
            const minuto = partes[1];

            // Convertir a formato 12 horas
            const periodo = hora >= 12 ? 'PM' : 'AM';
            const hora12 = hora === 0 ? 12 : (hora > 12 ? hora - 12 : hora);

            return `${hora12}:${minuto} ${periodo}`;
        }

        // Si es un timestamp completo
        const fecha = new Date(horaString);
        if (!isNaN(fecha.getTime())) {
            return fecha.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
            });
        }

        return 'N/A';
    } catch (error) {
        console.error('Error formateando hora:', error);
        return 'N/A';
    }
}
// Función para obtener ícono por descripción de bloque
function obtenerIconoBloque(descripcion) {
    const desc = (descripcion || '').toLowerCase();
    
    if (desc.includes('mañana') || desc.includes('manana')) return '🌅';
    if (desc.includes('tarde')) return '🌇';
    if (desc.includes('noche')) return '🌙';
    if (desc.includes('completo') || desc.includes('corrido')) return '⏰';
    if (desc.includes('turno 1') || desc.includes('bloque 1')) return '🌅';
    if (desc.includes('turno 2') || desc.includes('bloque 2')) return '🌇';
    
    return '⏱️'; // Ícono por defecto
}

function renderHorariosTable() {
    const tbody = elements.horariosTable?.querySelector('tbody');
    if (!tbody) return;
    
    if (adminState.horariosData.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; color: #6b7280; padding: 20px;">
                    No hay horarios para mostrar
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = adminState.horariosData.map(horario => `
        <tr data-id="${horario.id}">
            <td>${horario.nombre || 'Sin nombre'}</td>
            <td>${horario.descripcion || 'Sin descripción'}</td>
            <td>
                <div class="bloques-info">
                    ${horario.bloques?.map((bloque, index) => {
                        const horaEntrada = formatearHoraBonita(bloque.hora_entrada);
                        const horaSalida = formatearHoraBonita(bloque.hora_salida);
                        const icono = obtenerIconoBloque(bloque.descripcion);
                        
                        return `
                            <div class="bloque-item-display" style="margin-bottom: 4px;">
                                <span class="bloque-badge" style="
                                    background: linear-gradient(135deg, #3b82f6, #1d4ed8);
                                    color: white;
                                    padding: 4px 8px;
                                    border-radius: 6px;
                                    font-size: 12px;
                                    font-weight: 500;
                                    display: inline-flex;
                                    align-items: center;
                                    gap: 4px;
                                ">
                                    ${icono} ${bloque.descripcion || `Bloque ${index + 1}`}: 
                                    <strong>${horaEntrada} - ${horaSalida}</strong>
                                </span>
                            </div>
                        `;
                    }).join('') || '<span style="color: #6b7280; font-style: italic;">Sin bloques</span>'}
                </div>
            </td>
            <td>
                <span class="empleados-count" style="
                    background: ${horario.empleados_count > 0 ? '#10b981' : '#6b7280'};
                    color: white;
                    padding: 4px 8px;
                    border-radius: 12px;
                    font-size: 12px;
                    font-weight: bold;
                ">
                    ${horario.empleados_count || 0}
                </span>
            </td>
            <td>
                <span class="status-badge status-${horario.activo ? 'activo' : 'inactivo'}">
                    ${horario.activo ? 'Activo' : 'Inactivo'}
                </span>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-sm btn-primary" onclick="editHorario(${horario.id})" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-warning" onclick="toggleHorarioStatus(${horario.id})" title="Cambiar estado">
                        <i class="fas fa-power-off"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteHorario(${horario.id})" title="Eliminar">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

// Tabla de registros básica (para dashboard)
function renderRegistrosTable() {
    const tbody = elements.registrosTable?.querySelector('tbody');
    if (!tbody) return;
    
    if (adminState.registrosData.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; color: #6b7280; padding: 20px;">
                    No hay registros para mostrar
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = adminState.registrosData.map(reg => `
        <tr data-id="${reg.id}">
            <td>${formatDateTime(reg.fecha_hora)}</td>
            <td>${reg.empleado_nombre || 'N/A'}</td>
            <td>
                <span class="status-badge status-${(reg.tipo_registro || '').toLowerCase()}">
                    ${reg.tipo_registro || 'N/A'}
                </span>
            </td>
            <td>${reg.bloque_descripcion || 'N/A'}</td>
            <td>${reg.tablet_id || 'N/A'}</td>
            <td>
                ${reg.foto_registro ?
                    `<button class="btn btn-sm btn-secondary" onclick="viewPhoto('${getSupabaseFotoUrl(reg.foto_registro, 'registros-fotos')}')" title="Ver foto">
                        <i class="fas fa-image"></i>
                    </button>` :
                    'Sin foto'
                }
            </td>
        </tr>
    `).join('');
}

// ================================
// GESTIÓN DE EMPLEADOS
// ================================
function openEmployeeModal(employeeId = null) {
    adminState.selectedEmployee = employeeId;
    
    const modal = elements.modalEmpleado;
    const title = document.getElementById('modalEmpleadoTitle');
    
    if (employeeId) {
        if (title) title.textContent = 'Editar Empleado';
        loadEmployeeData(employeeId);
    } else {
        if (title) title.textContent = 'Nuevo Empleado';
        if (elements.formEmpleado) elements.formEmpleado.reset();
        clearPhotoPreview();
    }
    
    openModal('modalEmpleado');
}

async function loadEmployeeData(employeeId) {
    try {
        showLoading('Cargando datos del empleado...');

        // Usar Supabase API
        const data = await SupabaseAPI.getEmpleadoById(employeeId);

        if (data.success) {
            const emp = data.data;

            const setFieldValue = (id, value) => {
                const field = document.getElementById(id);
                if (field) field.value = value || '';
            };

            setFieldValue('empCodigo', emp.codigo_empleado);
            setFieldValue('empNombre', emp.nombre);
            setFieldValue('empApellido', emp.apellido);
            setFieldValue('empHorario', emp.horario_id);
            setFieldValue('empSucursal', emp.sucursal);
            setFieldValue('empPuesto', emp.puesto);

            const checkbox = document.getElementById('empTrabajaDomingo');
            if (checkbox) checkbox.checked = emp.trabaja_domingo || false;

            if (emp.foto_perfil) {
                showPhotoPreview(getSupabaseFotoUrl(emp.foto_perfil));
            }

            adminState.selectedEmployee = emp;
        } else {
            showAlert('Error', data.message || 'No se pudo cargar el empleado', 'error');
        }
    } catch (error) {
        console.error('Error loading employee:', error);
        showAlert('Error', 'Error de conexión: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}


// ================================
// AUTOCOMPLETAR EMPLEADOS EN FILTROS
// ================================

// Variables globales para empleados
let empleadosData = [];
let selectedEmpleadoId = null;

// Función para cargar empleados para autocompletar
async function cargarEmpleadosAutocompletar() {
    try {
        // NUEVO: Usar Supabase API
        const result = await SupabaseAPI.getEmpleados();
        
        console.log('👥 Empleados result:', result);
        
        // USAR LA ESTRUCTURA CORRECTA
        const empleados = result.data || result || [];
        
        empleadosData = empleados.map(emp => ({
            id: emp.id,
            codigo: emp.codigo_empleado,
            nombre: `${emp.nombre} ${emp.apellido_paterno || emp.apellido} ${emp.apellido_materno || ''}`.trim(),
            sucursal: emp.sucursal || 'Sin asignar',
            puesto: emp.puesto || 'Sin asignar'
        }));
        
        console.log('✅ EmpleadosData preparada:', empleadosData.length);
    } catch (error) {
        console.error('Error cargando empleados:', error);
    }
}
// Función para inicializar el autocompletar
function inicializarAutocompletarEmpleados() {
    const input = document.getElementById('filterEmpleadoBusqueda');
    const suggestions = document.getElementById('empleadosSuggestions');
    const hiddenInput = document.getElementById('filterEmpleado');
    
    if (!input || !suggestions || !hiddenInput) {
        console.error('Elementos de autocompletar no encontrados');
        return;
    }

    // Event listener para input
    input.addEventListener('input', function(e) {
        const query = e.target.value.trim().toLowerCase();
        
        if (query.length < 2) {
            suggestions.style.display = 'none';
            hiddenInput.value = '';
            selectedEmpleadoId = null;
            return;
        }

        // Filtrar empleados
        const filteredEmpleados = empleadosData.filter(emp => 
            emp.nombre.toLowerCase().includes(query) ||
            emp.codigo.toLowerCase().includes(query) ||
            emp.sucursal.toLowerCase().includes(query) ||
            emp.puesto.toLowerCase().includes(query)
        ).slice(0, 10); // Máximo 10 resultados

        mostrarSugerencias(filteredEmpleados, suggestions, input, hiddenInput);
    });

    // Cerrar sugerencias al hacer click fuera
    document.addEventListener('click', function(e) {
        if (!input.contains(e.target) && !suggestions.contains(e.target)) {
            suggestions.style.display = 'none';
        }
    });

    // Manejar teclas
    input.addEventListener('keydown', function(e) {
        const items = suggestions.querySelectorAll('.suggestion-item');
        let selectedIndex = -1;
        
        // Encontrar item seleccionado
        items.forEach((item, index) => {
            if (item.classList.contains('selected')) {
                selectedIndex = index;
            }
        });

        switch(e.key) {
            case 'ArrowDown':
                e.preventDefault();
                selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
                actualizarSeleccionSugerencia(items, selectedIndex);
                break;
            case 'ArrowUp':
                e.preventDefault();
                selectedIndex = Math.max(selectedIndex - 1, -1);
                actualizarSeleccionSugerencia(items, selectedIndex);
                break;
            case 'Enter':
                e.preventDefault();
                if (selectedIndex >= 0 && items[selectedIndex]) {
                    items[selectedIndex].click();
                }
                break;
            case 'Escape':
                suggestions.style.display = 'none';
                break;
        }
    });
}

// Función para mostrar sugerencias
function mostrarSugerencias(empleados, suggestions, input, hiddenInput) {
    if (empleados.length === 0) {
        suggestions.innerHTML = '<div class="suggestion-item no-results">No se encontraron empleados</div>';
        suggestions.style.display = 'block';
        return;
    }

    suggestions.innerHTML = empleados.map(emp => `
        <div class="suggestion-item" data-id="${emp.id}" data-codigo="${emp.codigo}">
            <div class="suggestion-main">
                <strong>${emp.codigo}</strong> - ${emp.nombre}
            </div>
            <div class="suggestion-details">
                <span class="badge badge-sucursal">${emp.sucursal}</span>
                <span class="badge badge-puesto">${emp.puesto}</span>
            </div>
        </div>
    `).join('');

    // Event listeners para cada sugerencia
    suggestions.querySelectorAll('.suggestion-item').forEach(item => {
        if (!item.classList.contains('no-results')) {
            item.addEventListener('click', function() {
                const id = this.dataset.id;
                const codigo = this.dataset.codigo;
                const nombre = this.querySelector('.suggestion-main').textContent;
                
                input.value = nombre;
                hiddenInput.value = id;
                selectedEmpleadoId = id;
                suggestions.style.display = 'none';
                
                // Trigger change event para que otros componentes sepan del cambio
                input.dispatchEvent(new Event('empleadoSelected', { bubbles: true }));
            });
        }
    });

    suggestions.style.display = 'block';
}

// Función para actualizar selección con teclado
function actualizarSeleccionSugerencia(items, selectedIndex) {
    items.forEach(item => item.classList.remove('selected'));
    if (selectedIndex >= 0 && items[selectedIndex]) {
        items[selectedIndex].classList.add('selected');
    }
}

// Función para limpiar filtros
function limpiarFiltros() {
    // Limpiar fechas
    document.getElementById('fechaInicio').value = '';
    document.getElementById('fechaFin').value = '';
    
    // Limpiar empleado
    document.getElementById('filterEmpleadoBusqueda').value = '';
    document.getElementById('filterEmpleado').value = '';
    selectedEmpleadoId = null;
    
    // Limpiar selects
    document.getElementById('filterTipo').value = '';
    document.getElementById('filterSucursal').value = '';
    document.getElementById('filterPuesto').value = '';
    
    // Ocultar sugerencias
    document.getElementById('empleadosSuggestions').style.display = 'none';
    
    // Recargar registros sin filtros
    filtrarRegistros();
}

// Función actualizada para filtrar registros
async function filtrarRegistros() {
    const fechaInicio = document.getElementById('fechaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    
    // VALIDAR FECHAS
    console.log('📅 Fechas originales:', { fechaInicio, fechaFin });
    
    // Si las fechas están mal, usar valores por defecto
    let fechaInicioValid = fechaInicio;
    let fechaFinValid = fechaFin;
    
    if (!fechaInicio || fechaInicio.length < 10 || fechaInicio.startsWith('0002')) {
        fechaInicioValid = new Date().toISOString().split('T')[0];
    }
    
    if (!fechaFin || fechaFin.length < 10 || fechaFin.startsWith('0002')) {
        fechaFinValid = new Date().toISOString().split('T')[0];
    }
    
    console.log('📅 Fechas validadas:', { fechaInicioValid, fechaFinValid });
    
    const empleadoId = document.getElementById('filterEmpleado').value;
    const tipo = document.getElementById('filterTipo').value;
    const sucursal = document.getElementById('filterSucursal').value;
    const puesto = document.getElementById('filterPuesto').value;
    
    try {
        showLoading('Filtrando registros...');

        // NUEVO: Usar Supabase API
        const filtros = {
            empleadoId: empleadoId || null,
            tipo: tipo || null,
            sucursal: sucursal || null,
            puesto: puesto || null
        };

        console.log('🔍 Aplicando filtros:', { fechaInicioValid, fechaFinValid, filtros });

        const data = await SupabaseAPI.getRegistrosByFecha(fechaInicioValid, fechaFinValid, filtros);
        console.log('📊 Respuesta de Supabase:', data);

        if (data.success) {
            // Actualizar estado global - VERIFICAR LA ESTRUCTURA
            adminState.registrosData = data.data || data.registros || data.registros || [];
            adminState.currentPage = 1; // Reiniciar paginación
            
            // Actualizar período mostrado
            const periodoElement = document.getElementById('periodoActual');
            if (periodoElement) {
                if (fechaInicio && fechaFin) {
                    const fechaInicioFormatted = formatearFechaCorta(fechaInicio);
                    const fechaFinFormatted = formatearFechaCorta(fechaFin);
                    periodoElement.textContent = `${fechaInicioFormatted} - ${fechaFinFormatted}`;
                } else {
                    periodoElement.textContent = 'Todos los registros';
                }
            }
            
            // Actualizar estadísticas
            actualizarEstadisticasRegistros(data.registros);
            
            // Renderizar tabla
            renderRegistrosTableAdvanced();
            
            console.log(`Filtros aplicados: ${data.registros.length} registros encontrados`);
            } else {
                showAlert('Error', 'Error al filtrar registros: ' + data.message, 'error'); // ✅ EXISTE
            }
        
    } catch (error) {
        console.error('Error al filtrar registros:', error);
        showAlert('Error', 'Error al filtrar registros', 'error'); // ✅ EXISTE
    } finally {
        hideLoading();
    }
}
// Función para actualizar estadísticas
function actualizarEstadisticasRegistros(registros) {
    // Actualizar contadores en el header
    const totalElement = document.getElementById('totalRegistros');
    if (totalElement) {
        totalElement.textContent = registros.length;
    }
    const sinCheckElement = document.getElementById('registrosSinCheck');
    const hrsExtraElement = document.getElementById('hrsExtra');
    
    if (totalElement) {
        totalElement.textContent = registros.length;
    }
    
    if (sinCheckElement) {
        const sinCheck = registros.filter(r => 
            r.tipo_registro === 'ENTRADA' && 
            !registros.some(s => 
                s.empleado_id === r.empleado_id && 
                s.tipo_registro === 'SALIDA' && 
                formatearFecha(s.fecha_hora) === formatearFecha(r.fecha_hora)
            )
        ).length;
        sinCheckElement.textContent = sinCheck;
    }
    
    if (hrsExtraElement) {
        // Calcular horas extra (simplificado)
        hrsExtraElement.textContent = '0'; // Implementar lógica si necesario
    }
}

// Función para formatear fecha corta
function formatearFechaCorta(fechaStr) {
    if (!fechaStr) return '';
    try {
        const fecha = new Date(fechaStr + 'T00:00:00');
        return fecha.toLocaleDateString('es-MX', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    } catch (error) {
        return fechaStr;
    }
}
// Función para cargar puestos dinámicamente
// Función para cargar puestos dinámicamente (CORREGIDA)
async function cargarPuestosFiltro() {
    try {
        // NUEVO: Usar Supabase API
        const result = await SupabaseAPI.getEmpleados();
        
        console.log('📊 Resultado puestos:', result); // Para debug
        
        // USAR LA ESTRUCTURA CORRECTA
        const empleados = result.data || result || [];
        
        // Extraer puestos únicos
        const puestos = [...new Set(empleados
            .map(emp => emp.puesto)
            .filter(puesto => puesto && puesto.trim() !== ''))
        ].sort();
        
        const select = document.getElementById('filterPuesto');
        if (select) {
            // Mantener opción "TODOS"
            const currentValue = select.value;
            select.innerHTML = '<option value="">TODOS LOS PUESTOS</option>';
            
            puestos.forEach(puesto => {
                const option = document.createElement('option');
                option.value = puesto;
                option.textContent = puesto;
                select.appendChild(option);
            });
            
            // Restaurar valor seleccionado
            if (currentValue) {
                select.value = currentValue;
            }
            
            console.log('✅ Puestos cargados:', puestos.length);
        }
    } catch (error) {
        console.error('Error cargando puestos:', error);
    }
}
// Inicializar cuando se carga la página
document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('filterEmpleadoBusqueda')) {
        cargarEmpleadosAutocompletar().then(() => {
            inicializarAutocompletarEmpleados();
        });
        cargarPuestosFiltro();
    }
});

// Llamar también cuando se cambia a la sección de registros
function initRegistrosSection() {
    cargarEmpleadosAutocompletar().then(() => {
        inicializarAutocompletarEmpleados();
    });
    cargarPuestosFiltro();
}

async function guardarEmpleado() {
    try {
        const form = elements.formEmpleado || document.querySelector('#modalEmpleado form');
        if (!form) {
            showAlert('Error', 'No se encontró el formulario', 'error');
            return;
        }

        const getFieldValue = (id) => {
            const field = document.getElementById(id);
            return field ? field.value.trim() : '';
        };

        const codigo = getFieldValue('empCodigo');
        const nombre = getFieldValue('empNombre');
        const apellido = getFieldValue('empApellido');
        const horario_id = getFieldValue('empHorario');
        const sucursal = getFieldValue('empSucursal');
        const puesto = getFieldValue('empPuesto');

        if (!codigo || !nombre || !apellido) {
            showAlert('Error', 'Código, nombre y apellido son obligatorios', 'error');
            return;
        }

        showLoading('Guardando empleado...');

        const trabajaDomingos = document.getElementById('empTrabajaDomingo')?.checked || false;

        // Procesar foto si hay
        let fotoBase64 = null;
        const fotoInput = document.getElementById('empFoto');
        if (fotoInput && fotoInput.files[0]) {
            fotoBase64 = await convertirImagenABase64(fotoInput.files[0]);
        }

        const empleadoData = {
            codigo_empleado: codigo,
            nombre: nombre,
            apellido: apellido,
            horario_id: horario_id || null,
            sucursal: sucursal || null,
            puesto: puesto || null,
            trabaja_domingo: trabajaDomingos,
            activo: true
        };

        const empleadoId = adminState.selectedEmployee?.id;
        const isEditing = !!empleadoId;

        let result;
        if (isEditing) {
            result = await SupabaseAPI.updateEmpleado(empleadoId, empleadoData, fotoBase64);
        } else {
            result = await SupabaseAPI.createEmpleado(empleadoData, fotoBase64);
        }

        if (result.success) {
            showAlert('Éxito',
                isEditing ? 'Empleado actualizado correctamente' : 'Empleado creado correctamente',
                'success'
            );

            closeModal('modalEmpleado');
            await loadEmployees();

            form.reset();
            clearPhotoPreview();
            adminState.selectedEmployee = null;

        } else {
            showAlert('Error', result.message || 'Error al guardar empleado', 'error');
        }

    } catch (error) {
        console.error('Error guardando empleado:', error);
        showAlert('Error', 'Error de conexión: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Helper para convertir imagen a Base64
function convertirImagenABase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function editEmployee(empleadoId) {
    openEmployeeModal(empleadoId);
}

async function viewEmployeeQR(empleadoId) {
    try {
        showLoading('Cargando códigos QR...');
        
        const empleado = adminState.employeesData.find(emp => emp.id === empleadoId);
        if (!empleado) {
            showAlert('Error', 'Empleado no encontrado', 'error');
            return;
        }
        
        mostrarQR(empleadoId, 'entrada');
        
    } catch (error) {
        console.error('Error obteniendo QR:', error);
        showAlert('Error', 'Error obteniendo código QR', 'error');
    } finally {
        hideLoading();
    }
}

async function mostrarQR(empleadoId, tipo = 'entrada') {
    const empleado = adminState.employeesData.find(emp => emp.id === empleadoId);
    if (!empleado) {
        showAlert('Error', 'Empleado no encontrado', 'error');
        return;
    }

    try {
        // Obtener configuración QR del empleado
        const qrConfig = await SupabaseAPI.getQRConfigByEmpleado(empleadoId);
        if (!qrConfig.success) {
            showAlert('Error', 'No se encontró configuración QR para este empleado', 'error');
            return;
        }

        const existingModal = document.getElementById('modalQR');
        if (existingModal) {
            existingModal.remove();
        }

        const modalHTML = `
            <div id="modalQR" class="modal active" style="display: flex;">
                <div class="modal-content" style="max-width: 600px;">
                    <div class="modal-header">
                        <h3>Códigos QR - ${empleado.nombre || ''} ${empleado.apellido || ''}</h3>
                        <span class="close" onclick="closeModal('modalQR')">&times;</span>
                    </div>
                    <div class="modal-body" style="padding: 20px;">
                        <div style="display: flex; gap: 20px; justify-content: center;">
                            <div class="qr-container" style="text-align: center; padding: 15px; border: 2px solid #16a34a; border-radius: 8px;">
                                <h4 style="color: #16a34a; margin: 0 0 10px 0;">🟢 ENTRADA</h4>
                                <div id="qrEntrada" style="display: inline-block;"></div>
                                <div style="margin-top: 10px;">
                                    <button class="btn btn-sm btn-success" onclick="descargarQR('qrEntrada', '${empleado.codigo_empleado}_entrada')">
                                        📥 Descargar
                                    </button>
                                </div>
                            </div>

                            <div class="qr-container" style="text-align: center; padding: 15px; border: 2px solid #dc2626; border-radius: 8px;">
                                <h4 style="color: #dc2626; margin: 0 0 10px 0;">🔴 SALIDA</h4>
                                <div id="qrSalida" style="display: inline-block;"></div>
                                <div style="margin-top: 10px;">
                                    <button class="btn btn-sm btn-danger" onclick="descargarQR('qrSalida', '${empleado.codigo_empleado}_salida')">
                                        📤 Descargar
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div style="margin-top: 20px; text-align: center; border-top: 1px solid #eee; padding-top: 15px;">
                            <p><strong>Empleado:</strong> ${empleado.codigo_empleado || 'N/A'}</p>
                            <p><strong>Nombre:</strong> ${empleado.nombre || ''} ${empleado.apellido || ''}</p>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-primary" onclick="imprimirQRs('${empleado.codigo_empleado}', '${empleado.nombre || ''} ${empleado.apellido || ''}')">
                            🖨️ Imprimir Ambos
                        </button>
                        <button class="btn btn-secondary" onclick="closeModal('modalQR')">Cerrar</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Generar códigos QR
        new QRCode(document.getElementById('qrEntrada'), {
            text: qrConfig.data.qr_entrada,
            width: 200,
            height: 200
        });

        new QRCode(document.getElementById('qrSalida'), {
            text: qrConfig.data.qr_salida,
            width: 200,
            height: 200
        });

    } catch (error) {
        console.error('Error mostrando QR:', error);
        showAlert('Error', 'Error al generar códigos QR', 'error');
    }
}

// Función para descargar un código QR
function descargarQR(containerId, filename) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const canvas = container.querySelector('canvas');
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = `${filename}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

// Función para imprimir ambos códigos QR
function imprimirQRs(codigoEmpleado, nombreEmpleado) {
    const qrEntradaCanvas = document.getElementById('qrEntrada')?.querySelector('canvas');
    const qrSalidaCanvas = document.getElementById('qrSalida')?.querySelector('canvas');

    if (!qrEntradaCanvas || !qrSalidaCanvas) {
        showAlert('Error', 'No se encontraron los códigos QR', 'error');
        return;
    }

    const printWindow = window.open('', '_blank');
    if (printWindow) {
        printWindow.document.write(`
            <html>
                <head>
                    <title>Códigos QR - ${nombreEmpleado}</title>
                    <style>
                        body { text-align: center; font-family: Arial, sans-serif; padding: 20px; }
                        .qr-container { display: inline-block; margin: 20px; padding: 20px; border: 2px solid #ddd; border-radius: 8px; }
                        .qr-entrada { border-color: #16a34a; }
                        .qr-salida { border-color: #dc2626; }
                        img { max-width: 250px; }
                        h2 { margin: 0 0 10px 0; }
                        .entrada { color: #16a34a; }
                        .salida { color: #dc2626; }
                        @media print {
                            body { margin: 0; }
                            .no-print { display: none; }
                        }
                    </style>
                </head>
                <body>
                    <h1>Códigos QR - ${nombreEmpleado}</h1>
                    <p><strong>Código:</strong> ${codigoEmpleado}</p>

                    <div class="qr-container qr-entrada">
                        <h2 class="entrada">🟢 ENTRADA</h2>
                        <img src="${qrEntradaCanvas.toDataURL()}" alt="QR Entrada">
                    </div>

                    <div class="qr-container qr-salida">
                        <h2 class="salida">🔴 SALIDA</h2>
                        <img src="${qrSalidaCanvas.toDataURL()}" alt="QR Salida">
                    </div>

                    <p class="no-print">
                        <button onclick="window.print()">🖨️ Imprimir</button>
                        <button onclick="window.close()">❌ Cerrar</button>
                    </p>
                </body>
            </html>
        `);
        printWindow.document.close();
    }
}

async function toggleEmployeeStatus(empleadoId) {
    const empleado = adminState.employeesData.find(emp => emp.id === empleadoId);
    if (!empleado) {
        showAlert('Error', 'Empleado no encontrado', 'error');
        return;
    }
    
    const newStatus = !empleado.activo;
    const action = newStatus ? 'activar' : 'desactivar';
    
    if (!confirm(`¿Estás seguro de ${action} este empleado?`)) return;
    
    try {
        showLoading(`${action.charAt(0).toUpperCase() + action.slice(1)}ando empleado...`);

        const result = await SupabaseAPI.toggleEmpleadoActivo(empleadoId, newStatus);

        if (result.success) {
            showAlert('Éxito', `Empleado ${action}ado correctamente`, 'success');
            await loadEmployees();
        } else {
            showAlert('Error', result.message || `Error al ${action} empleado`, 'error');
        }

    } catch (error) {
        console.error(`Error ${action}ando empleado:`, error);
        showAlert('Error', 'Error de conexión', 'error');
    } finally {
        hideLoading();
    }
}

async function deleteEmployee(empleadoId) {
    if (!confirm('¿Estás seguro de eliminar este empleado? Esta acción no se puede deshacer.')) return;

    try {
        showLoading('Eliminando empleado...');

        const result = await SupabaseAPI.deleteEmpleado(empleadoId);

        if (result.success) {
            showAlert('Éxito', 'Empleado eliminado correctamente', 'success');
            await loadEmployees();
        } else {
            showAlert('Error', result.message || 'Error eliminando empleado', 'error');
        }

    } catch (error) {
        console.error('Error eliminando empleado:', error);
        showAlert('Error', 'Error de conexión', 'error');
    } finally {
        hideLoading();
    }
}

// ================================
// FILTROS Y BÚSQUEDA
// ================================
function applyEmployeeFilters() {
    let filtered = [...adminState.employeesData];
    
    const search = elements.searchEmpleados?.value?.toLowerCase();
    if (search) {
        filtered = filtered.filter(emp => 
            (emp.nombre || '').toLowerCase().includes(search) ||
            (emp.apellido || '').toLowerCase().includes(search) ||
            (emp.codigo_empleado || '').toLowerCase().includes(search)
        );
    }
    
    const horarioFilter = elements.filterHorario?.value;
    if (horarioFilter) {
        filtered = filtered.filter(emp => emp.horario_id == horarioFilter);
    }
    
    const estadoFilter = elements.filterEstado?.value;
    if (estadoFilter !== '' && estadoFilter !== undefined) {
        filtered = filtered.filter(emp => emp.activo == (estadoFilter === '1'));
    }
    
    return filtered;
}

function filterEmployees() {
    renderEmployeesTable();
}

// ================================
// GESTIÓN DE HORARIOS
// ================================
function openHorarioModal(horarioId = null) {
    console.log('🕒 Abriendo modal para crear horario nuevo');
    
    const modal = document.getElementById('horarioModal');
    const modalTitle = document.getElementById('modalHorarioTitle');
    const horarioForm = document.getElementById('horarioForm');
    const bloquesContainer = document.getElementById('bloquesContainer');
    
    if (!modal || !modalTitle || !horarioForm || !bloquesContainer) {
        createHorarioModalIfNeeded();
    }
    
    // SIEMPRE MODO CREAR
    modalTitle.textContent = 'Crear Nuevo Horario';
    
    // Limpiar formulario
    horarioForm.reset();
    bloquesContainer.innerHTML = '';
    document.getElementById('horarioId').value = '';
    
    // Agregar un bloque por defecto
    agregarBloqueHorario();
    
    // Mostrar modal
    modal.style.display = 'block';
    document.body.classList.add('modal-open');
    
    console.log('✅ Modal de crear horario abierto');
}
// Crear modal dinámicamente si no existe
function createHorarioModalIfNeeded() {
    if (document.getElementById('horarioModal')) return true;
    
    console.log('📝 Creando modal de horario dinámicamente...');
    
    const modalHTML = `
        <div id="horarioModal" class="modal" style="display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.5);">
            <div class="modal-content" style="background: white; margin: 5% auto; padding: 0; width: 80%; max-width: 800px; border-radius: 10px; overflow: hidden;">
                <div class="modal-header" style="background: #3b82f6; color: white; padding: 15px 20px; display: flex; justify-content: space-between; align-items: center;">
                    <h2 id="modalHorarioTitle" style="margin: 0;">Editar Horario</h2>
                    <span class="close" onclick="closeHorarioModal()" style="font-size: 28px; cursor: pointer;">&times;</span>
                </div>
                
                <div class="modal-body" style="padding: 20px;">
                    <form id="horarioForm" onsubmit="saveHorario(event)">
                        <input type="hidden" id="horarioId" name="horario_id">
                        
                        <div style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                            <h3 style="margin: 0 0 15px 0;">Información General</h3>
                            <div style="display: flex; gap: 15px;">
                                <div style="flex: 1;">
                                    <label style="display: block; margin-bottom: 5px; font-weight: bold;">Nombre del Horario *</label>
                                    <input type="text" id="horarioNombre" name="nombre" required 
                                           style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"
                                           placeholder="Ej: Horario Oficina">
                                </div>
                                <div style="flex: 2;">
                                    <label style="display: block; margin-bottom: 5px; font-weight: bold;">Descripción</label>
                                    <input type="text" id="horarioDescripcion" name="descripcion" 
                                           style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"
                                           placeholder="Descripción del horario">
                                </div>
                            </div>
                        </div>
                        
                        <div style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                                <h3 style="margin: 0;">Bloques de Horario</h3>
                                <button type="button" class="btn btn-secondary" onclick="agregarBloqueHorario()" 
                                        style="padding: 8px 15px; background: #6b7280; color: white; border: none; border-radius: 4px; cursor: pointer;">
                                    + Agregar Bloque
                                </button>
                            </div>
                            <div id="bloquesContainer" style="max-height: 400px; overflow-y: auto;">
                                <!-- Los bloques se agregan aquí -->
                            </div>
                        </div>
                        
                        <div style="display: flex; gap: 10px; justify-content: flex-end; padding-top: 15px; border-top: 1px solid #ddd;">
                            <button type="button" onclick="closeHorarioModal()" 
                                    style="padding: 10px 20px; background: #6b7280; color: white; border: none; border-radius: 4px; cursor: pointer;">
                                Cancelar
                            </button>
                            <button type="submit" 
                                    style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;">
                                Guardar Horario
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    console.log('✅ Modal creado dinámicamente');
    return true;
}
async function editHorario(horarioId) {
    openHorarioModal(horarioId);
}
// Función para cerrar el modal
function closeHorarioModal() {
    const modal = document.getElementById('horarioModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.classList.remove('modal-open');
    }
    console.log('✅ Modal cerrado');
}
async function saveHorario(event) {
    event.preventDefault();
    
    try {
        console.log('💾 Guardando horario...');
        
        const formData = new FormData(event.target);
        const horarioId = formData.get('horario_id');
        
        // SIEMPRE CREAR NUEVO HORARIO
        const isEditing = false;
        
        // Recopilar datos básicos
        const horarioData = {
            nombre: formData.get('nombre'),
            descripcion: formData.get('descripcion') || ''
        };
        
        // Recopilar bloques
        const bloques = [];
        const bloquesContainer = document.getElementById('bloquesContainer');
        const bloqueItems = bloquesContainer.querySelectorAll('.bloque-item');
        
        bloqueItems.forEach((item, index) => {
            const descripcion = item.querySelector('[name="bloque_descripcion"]').value;
            const orden = item.querySelector('[name="bloque_orden"]').value;
            const entrada = item.querySelector('[name="bloque_entrada"]').value;
            const salida = item.querySelector('[name="bloque_salida"]').value;
            const tolEntrada = item.querySelector('[name="bloque_tol_entrada"]').value;
            const tolSalida = item.querySelector('[name="bloque_tol_salida"]').value;
            
            if (entrada && salida) {
                bloques.push({
                    orden_bloque: parseInt(orden) || (index + 1),
                    hora_entrada: entrada + ':00',
                    hora_salida: salida + ':00',
                    tolerancia_entrada_min: parseInt(tolEntrada) || 15,
                    tolerancia_salida_min: parseInt(tolSalida) || 15,
                    descripcion: descripcion || `Turno ${index + 1}`
                });
            }
        });
        
        if (bloques.length === 0) {
            showAlert('Error', 'Debe agregar al menos un bloque de horario', 'error');
            return;
        }
        
        horarioData.bloques = bloques;
        
        console.log('📤 Datos a enviar:', horarioData);
        
        showLoading('Creando nuevo horario...');
        
        // SIEMPRE USAR POST PARA CREAR NUEVO
        const response = await fetch(`${ADMIN_CONFIG.apiUrl}/horarios`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(horarioData)
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            closeHorarioModal();
            await loadHorarios();
            
            showAlert('Éxito', 'Horario creado correctamente', 'success');
                
        } else {
            showAlert('Error', result.message || 'Error al guardar horario', 'error');
        }
        
    } catch (error) {
        console.error('❌ Error guardando horario:', error);
        showAlert('Error', 'Error de conexión', 'error');
    } finally {
        hideLoading();
    }
}
// Función para actualizar números de bloques
function actualizarNumerosBloques() {
    const container = document.getElementById('bloquesContainer');
    if (!container) return;
    
    const bloques = container.querySelectorAll('.bloque-item');
    bloques.forEach((bloque, index) => {
        const numero = bloque.querySelector('.bloque-number');
        if (numero) {
            numero.textContent = `Bloque ${index + 1}`;
        }
        bloque.setAttribute('data-bloque', index + 1);
    });
}

// Función para eliminar bloque
function eliminarBloqueHorario(button) {
    const bloqueItem = button.closest('.bloque-item');
    const container = document.getElementById('bloquesContainer');
    
    if (bloqueItem && container.children.length > 1) {
        bloqueItem.remove();
        actualizarNumerosBloques();
    } else {
        showAlert('Advertencia', 'Debe tener al menos un bloque de horario', 'warning');
    }
}

async function toggleHorarioStatus(horarioId) {
    try {
        console.log('🔄 Cambiando estado horario:', horarioId);
        
        const horario = adminState.horariosData.find(h => h.id === horarioId);
        if (!horario) {
            showAlert('Error', 'Horario no encontrado', 'error');
            return;
        }
        
        const nuevoEstado = !horario.activo;
        const accion = nuevoEstado ? 'activar' : 'desactivar';
        
        if (!confirm(`¿Estás seguro de ${accion} este horario?\n\nHorario: ${horario.nombre}`)) {
            return;
        }
        
        showLoading(`${accion === 'activar' ? 'Activando' : 'Desactivando'} horario...`);
        
        const response = await fetch(`${ADMIN_CONFIG.apiUrl}/horarios/${horarioId}/toggle`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            // Actualizar en adminState
            horario.activo = nuevoEstado;
            
            // Recargar la tabla
            await loadHorarios();
            
            showAlert('Éxito', `Horario ${accion === 'activar' ? 'activado' : 'desactivado'} correctamente`, 'success');
            
        } else {
            showAlert('Error', result.message || 'Error al cambiar estado del horario', 'error');
        }
        
    } catch (error) {
        console.error('❌ Error cambiando estado:', error);
        showAlert('Error', 'Error de conexión', 'error');
    } finally {
        hideLoading();
    }
}
async function deleteHorario(horarioId) {
    try {
        console.log('🗑️ Eliminando horario:', horarioId);
        
        const horario = adminState.horariosData.find(h => h.id === horarioId);
        if (!horario) {
            showAlert('Error', 'Horario no encontrado', 'error');
            return;
        }
        
        // Verificar si tiene empleados asignados
        const empleadosResponse = await fetch(`${ADMIN_CONFIG.apiUrl}/horarios/${horarioId}/empleados`);
        const empleadosData = await empleadosResponse.json();
        
        let confirmMessage = `¿Estás seguro de eliminar este horario?\n\nHorario: ${horario.nombre}`;
        
        if (empleadosData.success && empleadosData.count > 0) {
            confirmMessage += `\n\n⚠️ ATENCIÓN: Este horario tiene ${empleadosData.count} empleado(s) asignado(s).\nSi lo eliminas, esos empleados quedarán sin horario asignado.`;
        }
        
        if (!confirm(confirmMessage)) {
            return;
        }
        
        // Confirmación adicional si tiene empleados
        if (empleadosData.success && empleadosData.count > 0) {
            if (!confirm('⚠️ CONFIRMACIÓN FINAL:\n\n¿Realmente quieres eliminar este horario?\nEsta acción no se puede deshacer.')) {
                return;
            }
        }
        
        showLoading('Eliminando horario...');
        
        const response = await fetch(`${ADMIN_CONFIG.apiUrl}/horarios/${horarioId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            // Remover de adminState
            const index = adminState.horariosData.findIndex(h => h.id === horarioId);
            if (index !== -1) {
                adminState.horariosData.splice(index, 1);
            }
            
            // Recargar la tabla
            await loadHorarios();
            
            showAlert('Éxito', 'Horario eliminado correctamente', 'success');
            
        } else {
            showAlert('Error', result.message || 'Error al eliminar horario', 'error');
        }
        
    } catch (error) {
        console.error('❌ Error eliminando horario:', error);
        showAlert('Error', 'Error de conexión', 'error');
    } finally {
        hideLoading();
    }
}
// ================================
// REPORTES Y ESTADÍSTICAS
// ================================
function setupReportesSection() {
    console.log('⚡ Configurando sección de reportes...');
    
    // Configurar función de reportes cuando se entre a la sección
    setTimeout(() => {
        if (adminState.currentSection === 'reportes') {
            renderEstadisticasConDatosReales();
        }
    }, 1000);
}

async function renderEstadisticasConDatosReales() {
    try {
        console.log('📊 Obteniendo estadísticas reales...');
        
        const [registrosRes, empleadosRes] = await Promise.allSettled([
            fetch(`${ADMIN_CONFIG.apiUrl}/registros?limit=100`),
            fetch(`${ADMIN_CONFIG.apiUrl}/empleados`)
        ]);
        
        let registros = { data: [] };
        let empleados = { data: [] };
        
        if (registrosRes.status === 'fulfilled' && registrosRes.value.ok) {
            registros = await registrosRes.value.json();
        }
        
        if (empleadosRes.status === 'fulfilled' && empleadosRes.value.ok) {
            empleados = await empleadosRes.value.json();
        }
        
        console.log('📊 Datos obtenidos:', {
            registros: registros.data?.length || 0,
            empleados: empleados.data?.length || 0
        });
        
        const container = document.querySelector('#estadisticas-content') || 
                         crearContenedorEstadisticas();
        
        if (!container) {
            console.warn('⚠️ No se pudo crear contenedor de estadísticas');
            return;
        }
        
        const totalRegistros = registros.data?.length || 0;
        const totalEmpleados = empleados.data?.length || 0;
        
        // Calcular registros de hoy
        const hoy = getMazatlanTime(new Date()).toDateString();
        const registrosDeHoy = registros.data?.filter(r => {
            const fechaReg = getMazatlanTime(r.fecha_hora).toDateString();
            return fechaReg === hoy;
        }) || [];
        
        // Calcular empleados únicos que registraron hoy
        const empleadosPresentesHoy = new Set(
            registrosDeHoy
                .filter(r => r.tipo_registro === 'ENTRADA')
                .map(r => r.empleado_nombre)
        ).size;
        
        // Calcular tablets activas
        const tabletsActivas = new Set(
            registros.data?.map(r => r.tablet_id) || []
        ).size;
        
        // Top empleados por registros
        const empleadoStats = {};
        registros.data?.forEach(registro => {
            const nombre = registro.empleado_nombre;
            if (!empleadoStats[nombre]) {
                empleadoStats[nombre] = 0;
            }
            empleadoStats[nombre]++;
        });
        
        const topEmpleados = Object.entries(empleadoStats)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 3);
        
        const porcentajeAsistencia = totalEmpleados > 0 ? 
            Math.round((empleadosPresentesHoy / totalEmpleados) * 100) : 0;
        
        container.innerHTML = `
            <div class="stats-card">
                <h4>📊 Resumen Real</h4>
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-number">${totalRegistros}</div>
                        <div class="stat-label">Total Registros</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-number">${totalEmpleados}</div>
                        <div class="stat-label">Empleados</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-number">${porcentajeAsistencia}%</div>
                        <div class="stat-label">Asistencia Hoy</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-number">${tabletsActivas}</div>
                        <div class="stat-label">Tablets Activas</div>
                    </div>
                </div>
            </div>
            
            <div class="stats-card">
                <h4>📅 Actividad de Hoy</h4>
                <div class="today-stats">
                    <p><strong>Total registros:</strong> ${registrosDeHoy.length}</p>
                    <p><strong>Entradas:</strong> ${registrosDeHoy.filter(r => r.tipo_registro === 'ENTRADA').length}</p>
                    <p><strong>Salidas:</strong> ${registrosDeHoy.filter(r => r.tipo_registro === 'SALIDA').length}</p>
                    <p><strong>Empleados presentes:</strong> ${empleadosPresentesHoy}</p>
                </div>
            </div>
            
            <div class="stats-card">
                <h4>🏆 Top Empleados (Total)</h4>
                <div class="top-employees">
                    ${topEmpleados.length > 0 ? topEmpleados.map(([nombre, total], index) => `
                        <div class="employee-rank">
                            <span class="rank">${index + 1}</span>
                            <span class="name">${nombre.split(' ').slice(0, 2).join(' ')}</span>
                            <span class="score">${total}</span>
                        </div>
                    `).join('') : '<p>No hay datos disponibles</p>'}
                </div>
            </div>
            
            ${registrosDeHoy.length > 0 ? `
                <div class="stats-card">
                    <h4>📝 Últimos Registros Hoy</h4>
                    <div class="recent-logs">
                        ${registrosDeHoy.slice(-3).reverse().map(r => `
                            <div style="padding: 5px 0; border-bottom: 1px solid #eee;">
                                <strong>${r.empleado_nombre}</strong><br>
                                <small>${r.tipo_registro} - ${getMazatlanTime(r.fecha_hora).toLocaleTimeString()}</small>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
        `;
        
        console.log('✅ Estadísticas reales renderizadas');
        
    } catch (error) {
        console.error('❌ Error renderizando estadísticas:', error);
    }
}

function crearContenedorEstadisticas() {
    const reportesSection = document.querySelector('#reportes');
    if (!reportesSection) return null;
    
    const existingContainer = reportesSection.querySelector('#estadisticas-content');
    if (existingContainer) return existingContainer;
    
    const estadisticasHTML = `
        <div class="estadisticas-section" style="margin-top: 30px;">
            <h3>📊 Estadísticas del Mes</h3>
            <div id="estadisticas-content"></div>
        </div>
    `;
    
    reportesSection.insertAdjacentHTML('beforeend', estadisticasHTML);
    return reportesSection.querySelector('#estadisticas-content');
}

async function generarReporteAsistencia() {
    try {
        console.log('🔍 Iniciando generación de reporte...');
        
        const fechaInicioInput = document.querySelector('input[type="date"]:first-of-type');
        const fechaFinInput = document.querySelector('input[type="date"]:last-of-type');
        const empleadoSelect = document.querySelector('select');
        
        const fechaInicio = fechaInicioInput?.value;
        const fechaFin = fechaFinInput?.value;
        const empleadoId = empleadoSelect?.value;
        
        const hoy = new Date().toISOString().split('T')[0];
        const haceUnaSemana = new Date();
        haceUnaSemana.setDate(haceUnaSemana.getDate() - 7);
        const fechaHaceUnaSemana = haceUnaSemana.toISOString().split('T')[0];
        const fechaInicioFinal = fechaInicio || fechaHaceUnaSemana;
        const fechaFinFinal = fechaFin || hoy;
        
        console.log('📊 Generando reporte:', {
            fechaInicioFinal,
            fechaFinFinal,
            empleadoId
        });
        
        const params = new URLSearchParams();
        params.append('fecha_inicio', fechaInicioFinal);
        params.append('fecha_fin', fechaFinFinal);
        
        if (empleadoId && empleadoId !== 'todos' && empleadoId !== 'Todos') {
            params.append('empleado_id', empleadoId);
        }
        
        const url = `${ADMIN_CONFIG.apiUrl}/reportes/asistencia?${params}`;
        console.log('🔗 URL del reporte:', url);
        
        const response = await fetch(url);
        const data = await response.json();
        
        console.log('📋 Respuesta del servidor:', data);
        
        if (data.success && data.data && data.data.length > 0) {
            mostrarReporteEnTabla(data.data);
            console.log('✅ Reporte generado con', data.data.length, 'registros');
        } else {
            alert(`No se encontraron registros para el período ${fechaInicioFinal} - ${fechaFinFinal}`);
            console.log('⚠️ Sin registros encontrados');
        }
        
    } catch (error) {
        console.error('❌ Error generando reporte:', error);
        alert('Error generando reporte: ' + error.message);
    }
}

function mostrarReporteEnTabla(datos) {
    let html = `
        <div style="padding: 20px; font-family: Arial; background: white;">
            <h2>📊 Reporte de Asistencia</h2>
            <p><strong>Total de registros:</strong> ${datos.length}</p>
            <table style="width:100%; border-collapse: collapse; border: 1px solid #ccc;">
                <thead style="background: #f5f5f5;">
                    <tr>
                        <th style="border: 1px solid #ccc; padding: 8px;">Fecha/Hora</th>
                        <th style="border: 1px solid #ccc; padding: 8px;">Empleado</th>
                        <th style="border: 1px solid #ccc; padding: 8px;">Código</th>
                        <th style="border: 1px solid #ccc; padding: 8px;">Tipo</th>
                        <th style="border: 1px solid #ccc; padding: 8px;">Tablet</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    datos.forEach(reg => {
        const fecha = getMazatlanTime(reg.fecha_hora).toLocaleString('es-MX');
        const tipoColor = reg.tipo_registro === 'ENTRADA' ? '#22c55e' : '#ef4444';
        
        html += `
            <tr>
                <td style="border: 1px solid #ccc; padding: 8px;">${fecha}</td>
                <td style="border: 1px solid #ccc; padding: 8px;">${reg.empleado_nombre}</td>
                <td style="border: 1px solid #ccc; padding: 8px;">${reg.codigo_empleado}</td>
                <td style="border: 1px solid #ccc; padding: 8px; color: ${tipoColor}; font-weight: bold;">${reg.tipo_registro}</td>
                <td style="border: 1px solid #ccc; padding: 8px;">${reg.tablet_id}</td>
            </tr>
        `;
    });
    
    html += '</tbody></table></div>';
    
    const ventana = window.open('', '_blank', 'width=800,height=600');
    ventana.document.write(`
        <html>
            <head>
                <title>Reporte de Asistencia</title>
                <meta charset="utf-8">
            </head>
            <body>
                ${html}
                <div style="text-align: center; margin: 20px;">
                    <button onclick="window.print()" style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px;">🖨️ Imprimir</button>
                </div>
            </body>
        </html>
    `);
}

function updateDateFilters() {
    const fechaInicio = elements.fechaInicio?.value;
    const fechaFin = elements.fechaFin?.value;
    
    console.log('Filtros de fecha actualizados:', { fechaInicio, fechaFin });
    
    adminState.filters.fechaInicio = fechaInicio;
    adminState.filters.fechaFin = fechaFin;
    
    // Si estamos en la sección de registros, usar la función avanzada
    if (adminState.currentSection === 'registros') {
        renderRegistrosTableAdvanced(); // ← YA ESTÁ BIEN
    } else {
        renderRegistrosTableAdvanced(); // ← Función simple para dashboard
    }
}

// ================================
// UTILIDADES
// ================================
function formatTime(timeString) {
    if (!timeString) return 'N/A';
    try {
        return new Date('1970-01-01T' + timeString + 'Z').toLocaleTimeString('en-US', { timeZone: 'America/Mazatlan',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return 'N/A';
    }
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    try {
        return new Date(dateString).toLocaleDateString('es-MX');
    } catch {
        return 'N/A';
    }
}

function formatDateTime(dateTimeString) {
    if (!dateTimeString) return 'N/A';
    try {
        return new Date(dateTimeString).toLocaleString('es-MX');
    } catch {
        return 'N/A';
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ================================
// MANEJO DE UI
// ================================
function showLoading(mensaje = 'Cargando...') {
    if (typeof mensaje === 'boolean') {
        if (!mensaje) {
            hideLoading();
            return;
        }
        mensaje = 'Cargando...';
    }
    
    hideLoading();
    
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'customLoading';
    loadingDiv.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10001;
    `;
    
    loadingDiv.innerHTML = `
        <div style="background: white; padding: 30px; border-radius: 8px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
            <div style="border: 4px solid #f3f3f3; border-top: 4px solid #2563eb; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 15px;"></div>
            <p style="margin: 0; color: #374151; font-weight: 500;">${mensaje}</p>
        </div>
    `;
    
    document.body.appendChild(loadingDiv);
}

function hideLoading() {
    const loading = document.getElementById('customLoading');
    if (loading) {
        loading.remove();
    }
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
        document.body.style.overflow = '';
        
        if (modalId === 'modalEmpleado') {
            adminState.selectedEmployee = null;
            clearPhotoPreview();
        } else if (modalId === 'modalQR') {
            modal.remove();
        }
    }
}

function showAlert(titulo, mensaje, tipo = 'info') {
    const alertasAnteriores = document.querySelectorAll('.custom-alert');
    alertasAnteriores.forEach(alert => alert.remove());
    
    const tiposClase = {
        'success': 'alert-success',
        'error': 'alert-danger',
        'warning': 'alert-warning',
        'info': 'alert-info'
    };
    
    const iconos = {
        'success': '✅',
        'error': '❌', 
        'warning': '⚠️',
        'info': 'ℹ️'
    };
    
    const colores = {
        'success': '#28a745',
        'error': '#dc3545',
        'warning': '#ffc107',
        'info': '#17a2b8'
    };
    
    const alertDiv = document.createElement('div');
    alertDiv.className = `custom-alert ${tiposClase[tipo] || 'alert-info'}`;
    alertDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        max-width: 400px;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        background: white;
        border-left: 4px solid ${colores[tipo] || colores.info};
        animation: slideIn 0.3s ease;
    `;
    
    alertDiv.innerHTML = `
        <div style="display: flex; align-items: flex-start; gap: 10px;">
            <span style="font-size: 18px;">${iconos[tipo] || 'ℹ️'}</span>
            <div style="flex: 1;">
                <strong style="display: block; margin-bottom: 5px;">${titulo}</strong>
                <p style="margin: 0; color: #666;">${mensaje}</p>
            </div>
            <button onclick="this.parentElement.parentElement.remove()" 
                    style="background: none; border: none; font-size: 18px; cursor: pointer; color: #999; padding: 0; line-height: 1;">×</button>
        </div>
    `;
    
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (alertDiv.parentNode) {
                    alertDiv.remove();
                }
            }, 300);
        }
    }, 5000);
}

// ================================
// MANEJO DE ARCHIVOS
// ================================
function handlePhotoPreview(event) {
    const file = event.target.files[0];
    
    if (!file) {
        clearPhotoPreview();
        return;
    }
    
    if (file.size > ADMIN_CONFIG.maxFileSize) {
        showAlert('Error', 'La imagen es demasiado grande. Máximo 5MB.', 'error');
        event.target.value = '';
        return;
    }
    
    if (!ADMIN_CONFIG.allowedImageTypes.includes(file.type)) {
        showAlert('Error', 'Tipo de archivo no válido. Use JPG, PNG o WebP.', 'error');
        event.target.value = '';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        showPhotoPreview(e.target.result);
    };
    reader.readAsDataURL(file);
}

function showPhotoPreview(src) {
    const preview = document.getElementById('previewFoto');
    if (preview) {
        preview.innerHTML = `<img src="${src}" alt="Preview" style="max-width: 100px; max-height: 100px; border-radius: 8px;">`;
    }
}

function clearPhotoPreview() {
    const preview = document.getElementById('previewFoto');
    if (preview) {
        preview.innerHTML = '';
    }
}

// ================================
// POBLACIÓN DE SELECTORES
// ================================
function populateHorarioSelects() {
    const selects = document.querySelectorAll('select[name="horario_id"], #filterHorario, #empHorario');
    
    selects.forEach(select => {
        const firstOption = select.querySelector('option:first-child');
        const firstOptionText = firstOption ? firstOption.outerHTML : '<option value="">Seleccione un horario</option>';
        
        select.innerHTML = firstOptionText;
        
        adminState.horariosData.forEach(horario => {
            const option = document.createElement('option');
            option.value = horario.id;
            option.textContent = horario.nombre || `Horario ${horario.id}`;
            select.appendChild(option);
        });
    });
}

function populateEmployeeSelects() {
    const selects = document.querySelectorAll('select[data-populate="empleados"]');
    
    selects.forEach(select => {
        const firstOption = select.querySelector('option:first-child');
        const firstOptionText = firstOption ? firstOption.outerHTML : '<option value="">Seleccione un empleado</option>';
        
        select.innerHTML = firstOptionText;
        
        adminState.employeesData.forEach(empleado => {
            const option = document.createElement('option');
            option.value = empleado.id;
            option.textContent = `${empleado.codigo_empleado || ''} - ${empleado.nombre || ''} ${empleado.apellido || ''}`;
            select.appendChild(option);
        });
    });
}

// ================================
// AUTO-REFRESH Y AUTO-LOGOUT
// ================================
function startAutoRefresh() {
    if (adminState.refreshTimer) {
        clearInterval(adminState.refreshTimer);
    }
    
    adminState.refreshTimer = setInterval(() => {
        if (adminState.currentSection === 'dashboard') {
            loadDashboardData();
        }
    }, ADMIN_CONFIG.refreshInterval);
}

function setupAutoLogout() {
    setInterval(() => {
        const timeSinceActivity = Date.now() - adminState.lastActivity;
        
        if (timeSinceActivity > ADMIN_CONFIG.autoLogoutTime) {
            showAlert('Sesión expirada', 'Has sido desconectado por inactividad', 'warning');
        }
    }, 60000);
}

function updateLastActivity() {
    adminState.lastActivity = new Date();
}

// ================================
// REPORTE EJECUTIVO DE PRODUCTIVIDAD
// ================================
async function mostrarReporteEjecutivo() {
    try {
        // Obtener empleados seleccionados
        let empleadosFiltrados = [];
        let fechasSeleccionadas = [];
        const checkboxesMarcados = document.querySelectorAll('input[type="checkbox"]:checked');
        
        checkboxesMarcados.forEach(checkbox => {
            const fila = checkbox.closest('tr');
            const empleadoId = checkbox.value;
            
            if (empleadoId && empleadoId !== '' && empleadoId !== 'on') {
                empleadosFiltrados.push(empleadoId);
                
                // EXTRAER TODAS LAS FECHAS DE LAS FILAS SELECCIONADAS
                const fechaElement = fila.querySelector('.fecha-badge');
                if (fechaElement) {
                    const fechaTexto = fechaElement.textContent.trim();
                    // Convertir "20/11/2025" a "2025-11-20"
                    const partes = fechaTexto.split('/');
                    if (partes.length === 3) {
                        const fechaFormatted = `${partes[2]}-${partes[1]}-${partes[0]}`;
                        fechasSeleccionadas.push(fechaFormatted);
                    }
                }
            }
        });
        
        if (empleadosFiltrados.length === 0) {
            showAlert('Info', 'Selecciona al menos un empleado para generar el reporte', 'warning');
            return;
        }
        
        console.log('📅 Fechas seleccionadas:', fechasSeleccionadas);
        console.log('👤 Empleados seleccionados:', empleadosFiltrados);
        
        // FILTRAR POR EMPLEADOS Y FECHAS ESPECÍFICAS
        const registrosVisibles = adminState.registrosData || [];
        
        const registrosFiltrados = registrosVisibles.filter(registro => {
            const esEmpleadoSeleccionado = empleadosFiltrados.includes(registro.empleado_id?.toString());
            
            // Si tenemos fechas seleccionadas, filtrar también por esas fechas
            if (fechasSeleccionadas.length > 0 && esEmpleadoSeleccionado) {
                const fechaRegistro = getMazatlanTime(registro.fecha_hora).toISOString().split('T')[0];
                return fechasSeleccionadas.includes(fechaRegistro);
            }
            
            return esEmpleadoSeleccionado;
        });
        
        console.log('📊 Registros EXACTOS filtrados:', registrosFiltrados);
        
        // Calcular métricas de TODOS los días seleccionados
        const checkIns = registrosFiltrados.filter(r => r.tipo_registro === 'ENTRADA').length;
        const checkOuts = registrosFiltrados.filter(r => r.tipo_registro === 'SALIDA').length;
        
        // Calcular horas trabajadas de TODOS los días seleccionados
        let totalMinutosTrabajados = 0;
        const diasTrabajados = {};

        // Agrupar TODOS los registros por día (no solo uno)
        registrosFiltrados.forEach(registro => {
            const fechaRegistro = getMazatlanTime(registro.fecha_hora).toISOString().split('T')[0];

            if (!diasTrabajados[fechaRegistro]) {
                diasTrabajados[fechaRegistro] = [];
            }

            // Guardar TODOS los registros del día con su timestamp
            diasTrabajados[fechaRegistro].push({
                tipo: registro.tipo_registro,
                fecha_hora: getMazatlanTime(registro.fecha_hora)
            });
        });

        // Calcular horas por cada día emparejando entrada-salida consecutivos
        Object.keys(diasTrabajados).forEach(fecha => {
            const registrosDia = diasTrabajados[fecha].sort((a, b) => a.fecha_hora - b.fecha_hora);

            let entradaPendiente = null;

            for (let i = 0; i < registrosDia.length; i++) {
                const registro = registrosDia[i];

                if (registro.tipo === 'ENTRADA') {
                    entradaPendiente = registro.fecha_hora;
                } else if (registro.tipo === 'SALIDA' && entradaPendiente) {
                    // Calcular minutos de esta pareja entrada-salida
                    const diferencia = registro.fecha_hora - entradaPendiente;
                    const minutos = Math.floor(diferencia / (1000 * 60));
                    totalMinutosTrabajados += Math.max(0, minutos); // Evitar minutos negativos

                    entradaPendiente = null; // Resetear para la siguiente pareja
                }
            }
        });
        
        const horasLaboradas = Math.floor(totalMinutosTrabajados / 60);
        const minutosLaboradas = totalMinutosTrabajados % 60;
        const formatoLaborado = `${horasLaboradas}:${minutosLaboradas.toString().padStart(2, '0')}`;
        
        const data = {
            registros_check_in: checkIns,
            registros_check_out: checkOuts,
            retardos_tiempo_formato: "00:00",
            retardos_minutos_total: 0,
            total_laborado_formato: formatoLaborado,
            total_laborado_horas: totalMinutosTrabajados / 60,
            fecha_generacion: new Date()
        };
        
        console.log('📊 Datos finales del reporte:', data);
        
        mostrarModalReporteEjecutivo(data);
        
    } catch (error) {
        console.error('Error:', error);
        showAlert('Error', 'Error generando reporte', 'error');
    }
}
function mostrarModalReporteEjecutivo(data) {
    // Eliminar modal anterior si existe
    const modalAnterior = document.getElementById('modalReporteEjecutivo');
    if (modalAnterior) {
        modalAnterior.remove();
    }

    const modalHTML = `
        <div id="modalReporteEjecutivo" class="modal" style="display: flex;">
            <div class="modal-content" style="max-width: 600px; width: 90%; margin: auto;">
                <div class="modal-header">
                    <h2>📊 Reporte ejecutivo de productividad</h2>
                    <span class="close" style="cursor: pointer; font-size: 28px; font-weight: bold; color: #999;">&times;</span>
                </div>
                <div class="modal-body">
                    <!-- Las 4 métricas principales -->
                    <div class="stats-grid-ejecutivo" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 25px;">
                        <!-- Check In -->
                        <div class="stat-card-ejecutivo" style="background: #eff6ff; border: 1px solid #dbeafe; border-radius: 12px; padding: 20px; text-align: center;">
                            <div style="color: #1e40af; font-size: 32px; font-weight: bold; margin-bottom: 8px;">
                                ${data.registros_check_in}
                            </div>
                            <div style="color: #374151; font-size: 14px; font-weight: 500;">
                                Registros Check In
                            </div>
                        </div>
                        
                        <!-- Check Out -->
                        <div class="stat-card-ejecutivo" style="background: #f0f9ff; border: 1px solid #e0f2fe; border-radius: 12px; padding: 20px; text-align: center;">
                            <div style="color: #0284c7; font-size: 32px; font-weight: bold; margin-bottom: 8px;">
                                ${data.registros_check_out}
                            </div>
                            <div style="color: #374151; font-size: 14px; font-weight: 500;">
                                Registros Check Out
                            </div>
                        </div>
                        
                        <!-- Retardos -->
                        <div class="stat-card-ejecutivo" style="background: #fef3c7; border: 1px solid #fde68a; border-radius: 12px; padding: 20px; text-align: center;">
                            <div style="color: #d97706; font-size: 32px; font-weight: bold; margin-bottom: 8px;">
                                ${data.retardos_tiempo_formato}
                            </div>
                            <div style="color: #374151; font-size: 14px; font-weight: 500;">
                                Retardos (SUM)
                            </div>
                        </div>
                        
                        <!-- Total Laborado -->
                        <div class="stat-card-ejecutivo" style="background: #dcfce7; border: 1px solid #bbf7d0; border-radius: 12px; padding: 20px; text-align: center;">
                            <div style="color: #16a34a; font-size: 32px; font-weight: bold; margin-bottom: 8px;">
                                ${data.total_laborado_formato}
                            </div>
                            <div style="color: #374151; font-size: 14px; font-weight: 500;">
                                Total laborado
                            </div>
                        </div>
                    </div>
                    
                    <!-- Información adicional -->
                    <div style="padding: 15px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
                        <h4 style="margin: 0 0 10px 0; color: #374151;">📋 Detalles adicionales</h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 14px;">
                            <div>
                                <strong>Total minutos de retardo:</strong> ${data.retardos_minutos_total} min
                            </div>
                            <div>
                                <strong>Total horas laboradas:</strong> ${data.total_laborado_horas.toFixed(2)} hrs
                            </div>
                        </div>
                        <div style="margin-top: 10px; font-size: 12px; color: #6b7280;">
                            <strong>Generado:</strong> ${new Date(data.fecha_generacion).toLocaleString('es-MX')}
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button id="btnCerrarReporte" class="btn btn-secondary" style="padding: 10px 20px; background: #6b7280; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px;">
                        <i class="fas fa-times"></i> Cerrar
                    </button>
                    <button id="btnImprimirReporte" class="btn btn-primary" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        <i class="fas fa-print"></i> Imprimir
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // AGREGAR EVENT LISTENERS DESPUÉS DE CREAR EL DOM
    const modal = document.getElementById('modalReporteEjecutivo');
    const btnCerrar = document.getElementById('btnCerrarReporte');
    const btnImprimir = document.getElementById('btnImprimirReporte');
    const btnX = modal.querySelector('.close');
    
    // Función para cerrar el modal
    function cerrarModal() {
        if (modal) {
            modal.remove();
        }
    }
    
    // Event listeners múltiples para cerrar
    if (btnCerrar) {
        btnCerrar.addEventListener('click', cerrarModal);
    }
    
    if (btnX) {
        btnX.addEventListener('click', cerrarModal);
    }
    
    if (btnImprimir) {
        btnImprimir.addEventListener('click', imprimirReporteEjecutivo);
    }
    
    // Cerrar con click fuera del modal
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            cerrarModal();
        }
    });
    
    // Cerrar con ESC
    const handleEscape = function(e) {
        if (e.key === 'Escape') {
            cerrarModal();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
}

function formatearFecha(fechaStr) {
    if (!fechaStr) return 'N/A';
    
    try {
        // Si la fecha viene como string de SQL Server, convertir correctamente
        let fecha;
        if (fechaStr.includes('T')) {
            fecha = new Date(fechaStr);
        } else {
            fecha = new Date(fechaStr + 'T00:00:00');
        }
        
        return fecha.toLocaleDateString('es-MX', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch (error) {
        console.log('Error formateando fecha:', fechaStr);
        return fechaStr; // Devolver la fecha original si hay error
    }
}
function imprimirReporteEjecutivo() {
    const modal = document.getElementById('modalReporteEjecutivo');
    const contenido = modal.querySelector('.modal-content').innerHTML;
    
    const ventanaImpresion = window.open('', '_blank');
    ventanaImpresion.document.write(`
        <html>
        <head>
            <title>Reporte Ejecutivo de Productividad</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .stats-grid-ejecutivo { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                .modal-header h2 { text-align: center; margin-bottom: 20px; }
                .close { display: none; }
                .modal-footer { display: none; }
                @media print {
                    body { margin: 0; }
                    .modal-header { border: none; padding-bottom: 20px; }
                }
            </style>
        </head>
        <body>
            ${contenido}
        </body>
        </html>
    `);
    
    ventanaImpresion.document.close();
    setTimeout(() => {
        ventanaImpresion.print();
        ventanaImpresion.close();
    }, 250);
}

// Exportar función global
window.mostrarReporteEjecutivo = mostrarReporteEjecutivo;

// ================================
// MANEJO DE ERRORES E IMÁGENES
// ================================
function handleGlobalError(event) {
    console.error('Error global capturado:', event.error);
    killAllSpinners();
}

function handleMissingImages() {
    document.addEventListener('error', function(e) {
        if (e.target.tagName === 'IMG') {
            if (e.target.src.includes('default-avatar.png') || e.target.src.includes('assets/')) {
                e.target.src = 'data:image/svg+xml,' + encodeURIComponent(`
                    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="#666">
                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                    </svg>
                `);
            }
        }
    }, true);
}

// ================================
// KILLER DE SPINNERS
// ================================
function killAllSpinners() {
    document.querySelectorAll('.fa-spinner, .spinner-border, [class*="spin"]').forEach(el => {
        el.remove();
    });
    
    document.querySelectorAll('.stat-number').forEach(el => {
        if (el.innerHTML.includes('fa-') || 
            el.innerHTML.includes('spinner') || 
            el.innerHTML === '' || 
            el.innerHTML.includes('[object') ||
            el.innerHTML.includes('undefined')) {
            el.innerHTML = '0';
        }
    });
    
    // MODIFICAR ESTA PARTE - No eliminar modales de fotos
    document.querySelectorAll('[style*="position: fixed"]').forEach(el => {
        // NO ELIMINAR si es modal de fotos o tiene ID específico
        if (el.id && (el.id.includes('modal-fotos') || el.id.includes('modalQR'))) {
            return; // No tocar
        }
        
        if (el.style.zIndex > 1000 && 
            (el.style.background || el.innerHTML.includes('loading')) &&
            !el.innerHTML.includes('📸') && // No eliminar si tiene emoji de cámara
            !el.innerHTML.includes('Registro #')) { // No eliminar si tiene texto de registro
            el.remove();
        }
    });
}

// ================================
// ESTILOS CSSmodal.id = 'modal-fotos-reales';

// ================================
function addRequiredStyles() {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .custom-alert { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
        }
        
        .modal.active { 
            display: flex !important; 
            align-items: center; 
            justify-content: center; 
        }
        
        /* Estilos para registros avanzados */
        .empleado-info {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .empleado-avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: #3b82f6;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 12px;
        }
        
        .empleado-details {
            display: flex;
            flex-direction: column;
        }
        
        .empleado-nombre {
            font-weight: 500;
            color: #1f2937;
            font-size: 14px;
        }
        
        .empleado-codigo {
            font-size: 12px;
            color: #6b7280;
        }
        
        .fecha-badge {
            background: #3b82f6;
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
            display: inline-block;
        }
        
        .hora-badge {
            background: #10b981;
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
            display: inline-block;
        }
        
        .hora-badge.tardanza {
            background: #ef4444;
        }
        
        .hora-badge.sin-registro {
            background: #6b7280;
        }
        
        .horas-trabajadas {
            font-weight: 500;
            color: #1f2937;
        }
        
        .horas-objetivo {
            display: flex;
            align-items: center;
            gap: 5px;
            color: #6b7280;
        }
        
        .estatus-badge {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .estatus-badge.completo {
            background: #d1fae5;
            color: #065f46;
        }
        
        .estatus-badge.incompleto {
            background: #fef3c7;
            color: #92400e;
        }
        
        .estatus-badge.sin-registro {
            background: #f3f4f6;
            color: #6b7280;
        }
        
        .tablet-info {
            font-family: monospace;
            font-size: 12px;
            color: #6b7280;
        }
        
        .foto-thumbnail {
            width: 32px;
            height: 32px;
            border-radius: 4px;
            object-fit: cover;
            cursor: pointer;
            border: 1px solid #e5e7eb;
        }
        
        .acciones-cell {
            display: flex;
            gap: 4px;
        }
        
        .btn-accion {
            width: 28px;
            height: 28px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
        }
        
        .btn-accion.editar {
            background: #10b981;
            color: white;
        }
        
        .btn-accion.eliminar {
            background: #ef4444;
            color: white;
        }
        
        .stats-card {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .stats-card h4 {
            margin: 0 0 15px 0;
            color: #333;
            font-size: 16px;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
        }
        
        .stat-item {
            text-align: center;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 6px;
        }
        
        .stat-number {
            font-size: 24px;
            font-weight: bold;
            color: #007bff;
            margin-bottom: 5px;
        }
        
        .stat-label {
            font-size: 12px;
            color: #666;
        }
        
        .employee-rank {
            display: flex;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid #eee;
        }
        
        .employee-rank:last-child {
            border-bottom: none;
        }
        
        .rank {
            width: 25px;
            height: 25px;
            background: #007bff;
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: bold;
            margin-right: 10px;
        }
        
        .name {
            flex: 1;
            font-size: 14px;
        }
        
        .score {
            font-weight: bold;
            color: #28a745;
        }
        
        .today-stats p {
            margin: 8px 0;
            padding: 0;
        }
    `;
    document.head.appendChild(style);
}

// ================================
// AUTO-INICIALIZACIÓN
// ================================
setInterval(killAllSpinners, 3000);

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        setTimeout(killAllSpinners, 1000);
    }
});

window.addEventListener('beforeunload', killAllSpinners);

// ================================
// EXPORTAR FUNCIONES GLOBALES
// ================================
window.refreshDashboard = () => loadDashboardData();
window.openEmployeeModal = openEmployeeModal;
window.guardarEmpleado = guardarEmpleado;
window.editEmployee = editEmployee;
window.viewEmployeeQR = viewEmployeeQR;
window.mostrarQR = mostrarQR;
window.descargarQR = descargarQR;
window.imprimirQRs = imprimirQRs;
window.toggleEmployeeStatus = toggleEmployeeStatus;
window.deleteEmployee = deleteEmployee;
window.editHorario = editHorario;
window.toggleHorarioStatus = toggleHorarioStatus;
window.deleteHorario = deleteHorario;
window.closeModal = closeModal;
window.generarReporteAsistencia = generarReporteAsistencia;

// Funciones específicas para registros avanzados
window.filtrarRegistros = filtrarRegistros;
window.reloadRegistros = reloadRegistros;
window.verFotoCompleta = verFotoCompleta;
window.editarRegistro = editarRegistro;
window.eliminarRegistro = eliminarRegistro;
window.imprimirRegistros = imprimirRegistros;
window.configurarColumnas = configurarColumnas;
window.cambiarPagina = cambiarPagina;
window.toggleSelectAll = toggleSelectAll;

// Función para exportar registros a CSV/Excel
async function exportarRegistros(tipo) {
    if (tipo !== 'excel') {
        showAlert('Info', 'Solo disponible exportación a Excel/CSV', 'info');
        return;
    }

    console.log('📊 Exportando registros a CSV/Excel...');

    try {
        showLoading('Generando archivo Excel...');

        // Obtener fechas del filtro actual
        const fechaInicio = document.getElementById('fechaInicio')?.value ||
                           new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const fechaFin = document.getElementById('fechaFin')?.value ||
                         new Date().toISOString().split('T')[0];

        console.log(`📅 Obteniendo registros desde Supabase: ${fechaInicio} a ${fechaFin}`);

        // Obtener registros desde Supabase
        const result = await SupabaseAPI.getRegistrosByFecha(fechaInicio, fechaFin);

        if (!result.success) {
            throw new Error(result.message || 'Error obteniendo registros');
        }

        const registros = result.data;
        console.log(`✅ ${registros.length} registros obtenidos`);

        if (registros.length === 0) {
            showAlert('Info', 'No hay registros en el período seleccionado', 'info');
            return;
        }

        // ✅ AGRUPAR REGISTROS POR EMPLEADO Y FECHA PARA CALCULAR HORAS
        const registrosPorEmpleadoFecha = {};

        registros.forEach(reg => {
            const fechaHora = new Date(reg.fecha_hora);

            // Obtener fecha en hora LOCAL, no UTC
            const year = fechaHora.getFullYear();
            const month = String(fechaHora.getMonth() + 1).padStart(2, '0');
            const day = String(fechaHora.getDate()).padStart(2, '0');
            const fecha = `${year}-${month}-${day}`;

            const empleadoId = reg.empleado_id;
            const key = `${empleadoId}_${fecha}`;

            if (!registrosPorEmpleadoFecha[key]) {
                registrosPorEmpleadoFecha[key] = {
                    empleado_codigo: reg.empleado_codigo,
                    empleado_nombre: reg.empleado_nombre,
                    sucursal: reg.sucursal,
                    puesto: reg.puesto,
                    fecha: fecha,
                    entradas: [],
                    salidas: []
                };
            }

            if (reg.tipo_registro === 'ENTRADA') {
                registrosPorEmpleadoFecha[key].entradas.push(fechaHora);
            } else if (reg.tipo_registro === 'SALIDA') {
                registrosPorEmpleadoFecha[key].salidas.push(fechaHora);
            }
        });

        // Generar CSV
        let csvContent = '\ufeff'; // BOM para UTF-8

        // Encabezado
        csvContent += 'REPORTE DE ASISTENCIAS CON HORAS TRABAJADAS\n';
        csvContent += `Período: ${fechaInicio} al ${fechaFin}\n`;
        csvContent += `Total empleados-días: ${Object.keys(registrosPorEmpleadoFecha).length}\n`;
        csvContent += `Generado: ${new Date().toLocaleString('es-MX')}\n\n`;

        // Columnas
        csvContent += 'Fecha,Código,Empleado,Sucursal,Puesto,Primera Entrada,Última Salida,Horas Trabajadas\n';

        // Datos agrupados
        Object.values(registrosPorEmpleadoFecha).forEach(grupo => {
            // Ordenar entradas y salidas
            grupo.entradas.sort((a, b) => a - b);
            grupo.salidas.sort((a, b) => a - b);

            const primeraEntrada = grupo.entradas.length > 0
                ? grupo.entradas[0].toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
                : 'N/A';

            const ultimaSalida = grupo.salidas.length > 0
                ? grupo.salidas[grupo.salidas.length - 1].toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
                : 'N/A';

            // Calcular horas trabajadas SOLO si hay entrada Y salida
            let horasTrabajadas = 'N/A';
            if (grupo.entradas.length > 0 && grupo.salidas.length > 0) {
                const entrada = grupo.entradas[0];
                const salida = grupo.salidas[grupo.salidas.length - 1];

                // Verificar que la salida sea posterior a la entrada
                if (salida > entrada) {
                    const diffMs = salida - entrada;
                    const diffHoras = Math.floor(diffMs / (1000 * 60 * 60));
                    const diffMinutos = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                    horasTrabajadas = `${diffHoras}h ${diffMinutos}m`;
                } else {
                    // Si la salida es antes de la entrada, hay un error en los datos
                    horasTrabajadas = 'Error';
                }
            } else if (grupo.entradas.length > 0 && grupo.salidas.length === 0) {
                // Si solo hay entrada sin salida
                horasTrabajadas = 'En turno';
            }

            csvContent += `"${grupo.fecha}",`;
            csvContent += `"${grupo.empleado_codigo || 'N/A'}",`;
            csvContent += `"${grupo.empleado_nombre || 'N/A'}",`;
            csvContent += `"${grupo.sucursal || 'N/A'}",`;
            csvContent += `"${grupo.puesto || 'N/A'}",`;
            csvContent += `"${primeraEntrada}",`;
            csvContent += `"${ultimaSalida}",`;
            csvContent += `"${horasTrabajadas}"\n`;
        });

        // Crear archivo y descargar
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Reporte_Asistencias_${fechaInicio}_${fechaFin}.csv`;
        link.style.display = 'none';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showAlert('Éxito', `Excel descargado: ${registros.length} registros`, 'success');

    } catch (error) {
        console.error('❌ Error exportando registros:', error);
        showAlert('Error', 'Error generando archivo Excel: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Exportar función a window
window.exportarRegistros = exportarRegistros;

window.agregarBloqueHorario = (bloqueExistente = null) => {
    try {
        const container = document.getElementById('bloquesContainer');
        if (!container) return;
        
        const bloqueIndex = container.children.length + 1;
        
        // ARREGLAR EL FORMATO DE HORA COMPLETAMENTE
        let horaEntrada = '';
        let horaSalida = '';
        
        if (bloqueExistente?.hora_entrada) {
            if (typeof bloqueExistente.hora_entrada === 'string') {
                // Si es string, tomar solo HH:MM
                horaEntrada = bloqueExistente.hora_entrada.substring(0, 5);
            } else if (bloqueExistente.hora_entrada instanceof Date) {
                // Si es Date, formatear correctamente
                horaEntrada = bloqueExistente.hora_entrada.toTimeString().substring(0, 5);
            }
        }
        
        if (bloqueExistente?.hora_salida) {
            if (typeof bloqueExistente.hora_salida === 'string') {
                horaSalida = bloqueExistente.hora_salida.substring(0, 5);
            } else if (bloqueExistente.hora_salida instanceof Date) {
                horaSalida = bloqueExistente.hora_salida.toTimeString().substring(0, 5);
            }
        }
        
        const bloqueHTML = `
            <div class="bloque-item" data-bloque="${bloqueIndex}">
                <div class="bloque-header">
                    <span class="bloque-number">Bloque ${bloqueIndex}</span>
                    <button type="button" class="btn-remove-bloque" onclick="eliminarBloqueHorario(this)">
                        <i class="fas fa-trash"></i> Eliminar
                    </button>
                </div>
                
                <div class="form-row">
                    <div class="form-group" style="flex: 1;">
                        <label>Descripción</label>
                        <input type="text" name="bloque_descripcion" 
                               value="${bloqueExistente?.descripcion || `Turno ${bloqueIndex}`}" 
                               placeholder="Ej: Turno Mañana">
                    </div>
                    <div class="form-group" style="flex: 0 0 120px;">
                        <label>Orden</label>
                        <input type="number" name="bloque_orden" 
                               value="${bloqueExistente?.orden_bloque || bloqueIndex}" 
                               min="1" required>
                    </div>
                </div>
                
                <div class="form-row">
                    <div class="form-group" style="flex: 1;">
                        <label>Hora Entrada *</label>
                        <input type="time" name="bloque_entrada" 
                               value="${horaEntrada}" 
                               required>
                    </div>
                    <div class="form-group" style="flex: 1;">
                        <label>Hora Salida *</label>
                        <input type="time" name="bloque_salida" 
                               value="${horaSalida}" 
                               required>
                    </div>
                </div>
                
                <div class="form-row">
                    <div class="form-group" style="flex: 1;">
                        <label>Tolerancia Entrada (min)</label>
                        <input type="number" name="bloque_tol_entrada" 
                            value="${bloqueExistente?.tolerancia_entrada_min || 15}" 
                            min="0" max="999">
                    </div>
                    <div class="form-group" style="flex: 1;">
                        <label>Tolerancia Salida (min)</label>
                        <input type="number" name="bloque_tol_salida" 
                               value="${bloqueExistente?.tolerancia_salida_min || 15}" 
                               min="0" max="999">
                    </div>
                </div>
            </div>
        `;
        
        container.insertAdjacentHTML('beforeend', bloqueHTML);
        actualizarNumerosBloques();
        
    } catch (error) {
        console.error('Error agregando bloque:', error);
        showAlert('Error', 'Error agregando bloque de horario', 'error');
    }
};

// Funciones placeholder
window.guardarConfiguracion = () => showAlert('Info', 'Función de configuración en desarrollo', 'info');
window.viewPhoto = (url) => window.open(url, '_blank');

console.log('🖥️ Admin.js v3.0 cargado completamente - Panel Administrativo con Registros Avanzados');
