/**
 * Configuración de Supabase para Tablet App
 * Cliente directo sin backend intermedio
 */

const SUPABASE_CONFIG = {
    url: 'https://uqncsqstpcynjxnjhrqu.supabase.co',
    anonKey: 'sb_publishable_bY6BY3wa5Xm2JCG2fy4F3g_fFgS5OsA'
};

// Cliente de Supabase (se inicializa cuando se carga la librería)
let supabaseClient = null;

// Inicializar cliente de Supabase
function initSupabase() {
    if (typeof supabase === 'undefined') {
        console.error('❌ Librería de Supabase no cargada');
        return false;
    }

    supabaseClient = supabase.createClient(
        SUPABASE_CONFIG.url,
        SUPABASE_CONFIG.anonKey
    );

    console.log('✅ Cliente de Supabase inicializado');
    return true;
}

// API Helper para registros
const SupabaseAPI = {
    // Validar código QR y obtener empleado
    async validateQR(qrCode) {
        try {
            // Buscar en configuracion_qr
            const { data: qrData, error: qrError } = await supabaseClient
                .from('configuracion_qr')
                .select(`
                    *,
                    empleado:empleados(
                        id,
                        codigo_empleado,
                        nombre,
                        apellido,
                        foto_perfil,
                        horario_id,
                        trabaja_domingo
                    )
                `)
                .or(`qr_entrada.eq.${qrCode},qr_salida.eq.${qrCode}`)
                .eq('activo', true)
                .single();

            if (qrError) {
                console.error('Error validando QR:', qrError);
                return {
                    success: false,
                    message: 'Código QR no válido o inactivo'
                };
            }

            // Determinar tipo de registro
            const tipoRegistro = qrData.qr_entrada === qrCode ? 'ENTRADA' : 'SALIDA';

            // Verificar si puede registrar
            const validacion = await this.validarRegistro(
                qrData.empleado.id,
                tipoRegistro
            );

            if (!validacion.valido) {
                return {
                    success: false,
                    message: validacion.mensaje
                };
            }

            // Validar tope de hora (ENTRADA) y buscar bloque de horario (Fase 1-A)
            let bloqueId = null;
            if (tipoRegistro === 'ENTRADA') {
                const horario = await this.validarHorarioEntrada(qrData.empleado);
                if (!horario.permitido) {
                    await this.guardarIntentoRechazado(qrData.empleado, horario);
                    return {
                        success: false,
                        message: horario.mensaje
                    };
                }
                bloqueId = horario.bloque?.id || null;
            } else if (qrData.empleado.horario_id) {
                const bloque = await this.getBloqueValido(
                    qrData.empleado.horario_id,
                    tipoRegistro
                );
                bloqueId = bloque?.id || null;
            }

            return {
                success: true,
                empleado: qrData.empleado,
                tipoRegistro: tipoRegistro,
                bloqueId: bloqueId,
                qrConfig: qrData
            };

        } catch (error) {
            console.error('Error en validateQR:', error);
            return {
                success: false,
                message: 'Error al validar código QR'
            };
        }
    },

    // Validar si se puede hacer el registro
    async validarRegistro(empleadoId, tipoRegistro) {
        try {
            const hoy = new Date();
            const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
            const finHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);

            if (tipoRegistro === 'ENTRADA') {
                // Verificar que no tenga entrada sin salida
                const { data: registrosHoy } = await supabaseClient
                    .from('registros')
                    .select('tipo_registro, fecha_hora')
                    .eq('empleado_id', empleadoId)
                    .gte('fecha_hora', inicioHoy.toISOString())
                    .lte('fecha_hora', finHoy.toISOString())
                    .order('fecha_hora', { ascending: false });

                if (registrosHoy && registrosHoy.length > 0) {
                    const ultimoRegistro = registrosHoy[0];
                    if (ultimoRegistro.tipo_registro === 'ENTRADA') {
                        return {
                            valido: false,
                            mensaje: 'Ya checaste, vete a chambear'
                        };
                    }
                }

            } else if (tipoRegistro === 'SALIDA') {
                // Verificar que tenga entrada previa
                const { data: ultimaEntrada } = await supabaseClient
                    .from('registros')
                    .select('id, fecha_hora')
                    .eq('empleado_id', empleadoId)
                    .eq('tipo_registro', 'ENTRADA')
                    .order('fecha_hora', { ascending: false })
                    .limit(1);

                if (!ultimaEntrada || ultimaEntrada.length === 0) {
                    return {
                        valido: false,
                        mensaje: 'No tienes una entrada registrada para poder salir'
                    };
                }

                // Verificar que esa entrada no tenga salida
                const { data: salidaPosterior } = await supabaseClient
                    .from('registros')
                    .select('id')
                    .eq('empleado_id', empleadoId)
                    .eq('tipo_registro', 'SALIDA')
                    .gt('fecha_hora', ultimaEntrada[0].fecha_hora)
                    .limit(1);

                if (salidaPosterior && salidaPosterior.length > 0) {
                    return {
                        valido: false,
                        mensaje: 'Ya checaste salida, ve a casa'
                    };
                }
            }

            return {
                valido: true,
                mensaje: 'Registro válido'
            };

        } catch (error) {
            console.error('Error validando registro:', error);
            return {
                valido: false,
                mensaje: 'Error al validar registro'
            };
        }
    },

    // Entradas de hoy del empleado (para la validación de horario, Fase 1-A)
    async getEntradasHoy(empleadoId) {
        const hoy = new Date();
        const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
        const finHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);
        const { data, error } = await supabaseClient
            .from('registros')
            .select('tipo_registro, fecha_hora')
            .eq('empleado_id', empleadoId)
            .eq('tipo_registro', 'ENTRADA')
            .gte('fecha_hora', inicioHoy.toISOString())
            .lte('fecha_hora', finHoy.toISOString());
        if (error) { console.error('Error leyendo entradas de hoy:', error); return null; }
        return data || [];
    },

    // Valida el tope de hora de una ENTRADA (Fase 1-A, spec 2026-06-09).
    // La secuencia ENTRADA/SALIDA la sigue validando validarRegistro.
    async validarHorarioEntrada(empleado) {
        if (!empleado.horario_id) return { permitido: true, bloque: null, mensaje: null };

        const { data: bloques, error } = await supabaseClient
            .from('bloques_horario')
            .select('*')
            .eq('horario_id', empleado.horario_id)
            .order('orden_bloque');
        if (error) {
            console.error('Error leyendo bloques:', error);
            return { permitido: false, bloque: null, mensaje: 'No se pudo verificar tu horario. Intenta de nuevo.' };
        }

        const regs = await this.getEntradasHoy(empleado.id);
        if (regs === null) {
            return { permitido: false, bloque: null, mensaje: 'No se pudo verificar tus registros. Intenta de nuevo.' };
        }
        const entradasMin = regs.map(r => bhMinutosDeFechaHora(r.fecha_hora));

        const ahora = new Date();
        const ahoraMin = ahora.getHours() * 60 + ahora.getMinutes();
        return bhEvaluarEntrada(bloques, entradasMin, ahoraMin, ahora.getDay() === 6);
    },

    // Deja constancia de una checada que el bloqueo rechazo.
    // NO es un registro y por eso va a otra tabla: ningun calculo de asistencia,
    // horas o nomina debe contarla como checada valida. Sirve para saber quien SI
    // llego y con cuantos minutos de retardo; sin esto, el que llega tarde es
    // indistinguible del que no vino y no hay retardo que descontar.
    // El tope y los minutos salen del bloque que le toca a ESTE empleado.
    // Si falla, se traga el error: jamas debe estorbar el rechazo ni la app.
    async guardarIntentoRechazado(empleado, horario) {
        try {
            const a = new Date();
            const p = n => String(n).padStart(2, '0');
            const fechaHoraLocal = `${a.getFullYear()}-${p(a.getMonth() + 1)}-${p(a.getDate())} `
                + `${p(a.getHours())}:${p(a.getMinutes())}:${p(a.getSeconds())}.`
                + String(a.getMilliseconds()).padStart(3, '0');

            const { error } = await supabaseClient
                .from('intentos_checada')
                .insert({
                    empleado_id: empleado.id,
                    fecha_hora: fechaHoraLocal,
                    tipo_registro: 'ENTRADA',
                    motivo: 'FUERA_DE_HORARIO',
                    bloque_horario_id: horario.bloque ? horario.bloque.id : null,
                    tope_hora: horario.topeHora || null,
                    minutos_retardo: horario.minutosRetardo != null ? horario.minutosRetardo : null,
                    origen: 'TABLET',
                    tablet_id: typeof TABLET_CONFIG !== 'undefined' ? TABLET_CONFIG.id : null
                });
            if (error) console.error('No se pudo guardar el intento rechazado:', error);
        } catch (e) {
            console.error('No se pudo guardar el intento rechazado:', e);
        }
    },

    // Solo para SALIDA: encuentra el bloque cuya hora_salida cae dentro de la
    // tolerancia. Las ENTRADAs se validan con validarHorarioEntrada (Fase 1-A).
    // Fix: antes usaba toISOString() (hora UTC, corrida 7h); ahora hora local.
    async getBloqueValido(horarioId, tipoRegistro) {
        if (!horarioId || tipoRegistro !== 'SALIDA') return null;

        const { data: bloques } = await supabaseClient
            .from('bloques_horario')
            .select('*')
            .eq('horario_id', horarioId)
            .order('orden_bloque');
        if (!bloques || bloques.length === 0) return null;

        const ahora = new Date();
        const ahoraMin = ahora.getHours() * 60 + ahora.getMinutes();
        for (const b of bloques) {
            const tol = b.tolerancia_salida_min || 15;
            const salida = bhMinutosDe(b.hora_salida);
            if (ahoraMin >= salida - tol && ahoraMin <= salida + tol) return b;
        }
        return null;
    },

    // Crear registro de asistencia
    async createRegistro(empleadoId, tipoRegistro, qrCode, tabletId, bloqueId = null, fotoBase64 = null) {
        try {
            // Subir foto si existe
            let fotoUrl = null;
            if (fotoBase64) {
                fotoUrl = await this.uploadFoto(empleadoId, fotoBase64);
            }

            // ✅ CREAR TIMESTAMP SIN TIMEZONE (guardará hora local tal cual)
            const ahora = new Date();

            // Obtener componentes de fecha en hora local
            const year = ahora.getFullYear();
            const month = String(ahora.getMonth() + 1).padStart(2, '0');
            const day = String(ahora.getDate()).padStart(2, '0');
            const hours = String(ahora.getHours()).padStart(2, '0');
            const minutes = String(ahora.getMinutes()).padStart(2, '0');
            const seconds = String(ahora.getSeconds()).padStart(2, '0');
            const ms = String(ahora.getMilliseconds()).padStart(3, '0');

            // Formato timestamp sin timezone - se guardará como está
            const fechaHoraLocal = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;

            console.log('⏰ Enviando a Supabase (timestamp sin timezone):', fechaHoraLocal);

            // Crear registro
            const { data, error } = await supabaseClient
                .from('registros')
                .insert({
                    empleado_id: empleadoId,
                    tipo_registro: tipoRegistro,
                    fecha_hora: fechaHoraLocal,
                    qr_code: qrCode,
                    tablet_id: tabletId,
                    bloque_horario_id: bloqueId,
                    foto_registro: fotoUrl,
                    observaciones: `Registro desde ${tabletId}`
                })
                .select()
                .single();

            if (error) {
                console.error('Error creando registro:', error);
                return {
                    success: false,
                    message: 'Error al crear registro'
                };
            }

            return {
                success: true,
                data: data,
                message: 'Registro creado exitosamente'
            };

        } catch (error) {
            console.error('Error en createRegistro:', error);
            return {
                success: false,
                message: 'Error al crear registro'
            };
        }
    },

    // Subir foto a Supabase Storage
    async uploadFoto(empleadoId, base64Data) {
        try {
            // Convertir base64 a blob
            const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
            const byteCharacters = atob(base64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'image/jpeg' });

            // Nombre del archivo
            const timestamp = Date.now();
            const filename = `emp_${empleadoId}_${timestamp}.jpg`;

            // Subir a Storage
            const { data, error } = await supabaseClient.storage
                .from('registros-fotos')
                .upload(filename, blob, {
                    contentType: 'image/jpeg',
                    upsert: false
                });

            if (error) {
                console.error('Error subiendo foto:', error);
                return null;
            }

            // Obtener URL pública
            const { data: urlData } = supabaseClient.storage
                .from('registros-fotos')
                .getPublicUrl(filename);

            return urlData.publicUrl;

        } catch (error) {
            console.error('Error en uploadFoto:', error);
            return null;
        }
    },

    // Health check (verificar conexión)
    async healthCheck() {
        try {
            const { data, error } = await supabaseClient
                .from('horarios')
                .select('id')
                .limit(1);

            return !error;
        } catch (error) {
            console.error('Health check error:', error);
            return false;
        }
    }
};
