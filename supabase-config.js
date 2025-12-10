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

            // Buscar bloque de horario válido
            let bloqueId = null;
            if (qrData.empleado.horario_id) {
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
                            mensaje: 'Ya tienes una entrada registrada sin salida'
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
                        mensaje: 'Ya tienes una salida registrada'
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

    // Obtener bloque de horario válido
    async getBloqueValido(horarioId, tipoRegistro) {
        try {
            const ahora = new Date();
            const hora = ahora.toISOString().substring(11, 19); // HH:MM:SS

            const { data: bloques } = await supabaseClient
                .from('bloques_horario')
                .select('*')
                .eq('horario_id', horarioId)
                .order('orden_bloque');

            if (!bloques || bloques.length === 0) return null;

            // Buscar bloque válido según la hora actual
            for (const bloque of bloques) {
                const horaEntrada = bloque.hora_entrada;
                const horaSalida = bloque.hora_salida;

                if (tipoRegistro === 'ENTRADA') {
                    // Rango: 15 min antes hasta 600 min después de la hora de entrada
                    const entradaMin = new Date(`1970-01-01T${horaEntrada}`);
                    entradaMin.setMinutes(entradaMin.getMinutes() - 15);
                    const entradaMax = new Date(`1970-01-01T${horaEntrada}`);
                    entradaMax.setMinutes(entradaMax.getMinutes() + 600);

                    const horaActual = new Date(`1970-01-01T${hora}`);

                    if (horaActual >= entradaMin && horaActual <= entradaMax) {
                        return bloque;
                    }
                } else {
                    // Para salida, dentro del rango de tolerancia
                    const tolerancia = bloque.tolerancia_salida_min || 15;
                    const salidaMin = new Date(`1970-01-01T${horaSalida}`);
                    salidaMin.setMinutes(salidaMin.getMinutes() - tolerancia);
                    const salidaMax = new Date(`1970-01-01T${horaSalida}`);
                    salidaMax.setMinutes(salidaMax.getMinutes() + tolerancia);

                    const horaActual = new Date(`1970-01-01T${hora}`);

                    if (horaActual >= salidaMin && horaActual <= salidaMax) {
                        return bloque;
                    }
                }
            }

            return null;

        } catch (error) {
            console.error('Error obteniendo bloque:', error);
            return null;
        }
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
