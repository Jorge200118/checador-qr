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

// ¿Puede salir? Depende solo del ultimo registro que tenga el empleado, asi que
// se deja aparte y sin consultas para poder probarla.
function decidirSalida(ultimoRegistro) {
    if (!ultimoRegistro) {
        return { valido: false, mensaje: 'No tienes una entrada registrada para poder salir' };
    }
    if (ultimoRegistro.tipo_registro === 'SALIDA') {
        return { valido: false, mensaje: 'Ya checaste salida, ve a casa' };
    }
    return { valido: true, mensaje: 'Registro válido' };
}

// Los bloques de horario, guardados en memoria mientras la tableta esta prendida.
// En la hora pico todos los que checan comparten un puñado de horarios, y sin
// esto cada checada volvia a pedir la misma lista.
const BLOQUES_VIGENCIA_MS = 5 * 60 * 1000;
const _bloquesCache = {};

// Interruptores del sistema. Se leen una vez al arrancar: si la lectura falla
// se asume encendido, porque todo lo que gobiernan degrada solo. Se apagan con
// un UPDATE en sistema_switches, sin desplegar nada.
const SWITCHES = {};

async function cargarSwitches() {
    try {
        const { data, error } = await supabaseClient
            .from('sistema_switches')
            .select('clave, activo');
        if (error) throw error;
        (data || []).forEach(s => { SWITCHES[s.clave] = s.activo; });
        console.log('🔀 Switches:', SWITCHES);
    } catch (e) {
        console.warn('🔀 No se pudieron leer los switches, se sigue con lo de siempre:', e);
    }
}

function switchActivo(clave, porOmision = true) {
    return SWITCHES[clave] === undefined ? porOmision : SWITCHES[clave];
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

            // Las dos cosas que hay que saber para dejar checar —que registros
            // lleva hoy y que horario le toca— no dependen una de la otra. Se
            // piden JUNTAS. Antes iban en fila, y ademas los registros de hoy se
            // pedian dos veces: una para la secuencia entrada/salida y otra,
            // identica, para el tope de hora.
            // Los registros de hoy solo le sirven a la ENTRADA; la SALIDA mira
            // el ultimo registro del empleado, sea de hoy o de antier.
            const [registrosHoy, bloques] = await Promise.all([
                tipoRegistro === 'ENTRADA'
                    ? this.getRegistrosHoy(qrData.empleado.id)
                    : Promise.resolve(null),
                this.getBloques(qrData.empleado.horario_id),
            ]);

            // Verificar si puede registrar
            const validacion = await this.validarRegistro(
                qrData.empleado.id,
                tipoRegistro,
                registrosHoy
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
                const horario = this.validarHorarioEntrada(qrData.empleado, bloques, registrosHoy);
                if (!horario.permitido) {
                    await this.guardarIntentoRechazado(qrData.empleado, horario);
                    return {
                        success: false,
                        message: horario.mensaje
                    };
                }
                bloqueId = horario.bloque?.id || null;
            } else {
                const bloque = this.getBloqueValido(bloques, tipoRegistro);
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
    // `registrosHoy` llega ya pedido desde validateQR. Si no llega, se pide aqui:
    // asi la funcion sigue sirviendo sola.
    async validarRegistro(empleadoId, tipoRegistro, registrosHoy = undefined) {
        try {
            if (tipoRegistro === 'ENTRADA') {
                // Verificar que no tenga entrada sin salida
                if (registrosHoy === undefined) registrosHoy = await this.getRegistrosHoy(empleadoId);

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
                // Una sola consulta: el ultimo registro del empleado.
                //
                // Antes eran dos en fila —la ultima ENTRADA, y luego si habia
                // alguna SALIDA despues de ella— pero preguntan lo mismo:
                // "hay una entrada abierta" es exactamente "el ultimo registro
                // es una ENTRADA". Si lo ultimo fue una SALIDA, esa entrada ya
                // se cerro; si no hay nada, nunca hubo entrada.
                const { data: ultimos } = await supabaseClient
                    .from('registros')
                    .select('tipo_registro')
                    .eq('empleado_id', empleadoId)
                    .order('fecha_hora', { ascending: false })
                    .limit(1);

                const decision = decidirSalida(ultimos && ultimos[0]);
                if (!decision.valido) return decision;
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

    // Todos los registros de hoy del empleado, del mas reciente al mas viejo.
    // Una sola consulta para las dos validaciones: la secuencia entrada/salida y
    // el tope de hora. Antes eran dos, y la segunda pedia un subconjunto de la
    // primera.
    async getRegistrosHoy(empleadoId) {
        const hoy = new Date();
        const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
        const finHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);
        const { data, error } = await supabaseClient
            .from('registros')
            .select('tipo_registro, fecha_hora')
            .eq('empleado_id', empleadoId)
            .gte('fecha_hora', inicioHoy.toISOString())
            .lte('fecha_hora', finHoy.toISOString())
            .order('fecha_hora', { ascending: false });
        if (error) { console.error('Error leyendo registros de hoy:', error); return null; }
        return data || [];
    },

    // Los bloques de un horario, guardados un rato en memoria.
    //
    // En la hora pico de una sucursal checan 30 o 40 personas y casi todas
    // comparten el mismo horario: era la misma consulta una y otra vez. Se
    // guarda 5 minutos, asi que un cambio que haga RH tarda a lo mas ese rato en
    // llegar a la tableta — los horarios se editan cada varias semanas, no
    // durante la checada.
    //
    // Devuelve null si la consulta fallo. Eso NO es lo mismo que un horario sin
    // bloques, y por eso no se guarda: si la red fallo, la siguiente checada
    // vuelve a intentar.
    async getBloques(horarioId) {
        if (!horarioId) return [];

        const guardado = _bloquesCache[horarioId];
        if (guardado && (Date.now() - guardado.cuando) < BLOQUES_VIGENCIA_MS) {
            return guardado.bloques;
        }

        const { data, error } = await supabaseClient
            .from('bloques_horario')
            .select('*')
            .eq('horario_id', horarioId)
            .order('orden_bloque');
        if (error) {
            console.error('Error leyendo bloques:', error);
            return null;
        }
        _bloquesCache[horarioId] = { bloques: data || [], cuando: Date.now() };
        return data || [];
    },

    // Valida el tope de hora de una ENTRADA (Fase 1-A, spec 2026-06-09).
    // La secuencia ENTRADA/SALIDA la sigue validando validarRegistro.
    //
    // Ya no consulta nada: `bloques` y `registrosHoy` llegan pedidos en paralelo
    // desde validateQR. Antes hacia dos viajes al servidor, uno de ellos por
    // registros que el llamador ya tenia.
    // `ahora` se puede inyectar: la regla depende de la hora y sin poder fijarla
    // no se podria probar el unico caso que importa, el del que llega tarde.
    validarHorarioEntrada(empleado, bloques, registrosHoy, ahora = new Date()) {
        if (!empleado.horario_id) return { permitido: true, bloque: null, mensaje: null };

        if (bloques === null) {
            return { permitido: false, bloque: null, mensaje: 'No se pudo verificar tu horario. Intenta de nuevo.' };
        }
        if (registrosHoy === null) {
            return { permitido: false, bloque: null, mensaje: 'No se pudo verificar tus registros. Intenta de nuevo.' };
        }

        const entradasMin = registrosHoy
            .filter(r => r.tipo_registro === 'ENTRADA')
            .map(r => bhMinutosDeFechaHora(r.fecha_hora));

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

    // Deja constancia de una checada que se rechazo porque la cara no coincidio.
    // Misma tabla y mismo criterio que el rechazo por horario: NO es un registro
    // de asistencia, pero conserva la hora y el puntaje. Sin esto, el que fue
    // rechazado seria indistinguible del que no vino — y ese error ya se pago
    // una vez, cuando el bloqueo por horario borro los retardos.
    // `fotoUrl` es la foto YA subida. En un RECHAZO es la unica evidencia para
    // revisar despues si estuvo bien rechazar: sin ella, cada reclamo seria
    // palabra contra palabra.
    // `tiempos` son los milisegundos por etapa medidos EN LA TABLETA. Sin ellos
    // solo se puede medir en una computadora de escritorio, que no dice nada de
    // como se siente esto en una sucursal.
    async guardarIntentoRostro(empleado, rostro, tipoRegistro, motivo, fotoUrl = null, tiempos = null) {
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
                    tipo_registro: tipoRegistro || 'ENTRADA',
                    motivo: motivo || 'ROSTRO_NO_COINCIDE',
                    parecido: rostro.parecido != null ? Number(rostro.parecido.toFixed(4)) : null,
                    foto: fotoUrl,
                    tiempos: tiempos,
                    origen: 'TABLET',
                    tablet_id: typeof TABLET_CONFIG !== 'undefined' ? TABLET_CONFIG.id : null
                });
            if (error) console.error('No se pudo guardar el intento por rostro:', error);
        } catch (e) {
            console.error('No se pudo guardar el intento por rostro:', e);
        }
    },

    // Solo para SALIDA: encuentra el bloque cuya hora_salida cae dentro de la
    // tolerancia. Las ENTRADAs se validan con validarHorarioEntrada (Fase 1-A).
    // Fix: antes usaba toISOString() (hora UTC, corrida 7h); ahora hora local.
    // Los bloques llegan ya pedidos: esta funcion ya no consulta nada.
    getBloqueValido(bloques, tipoRegistro) {
        if (tipoRegistro !== 'SALIDA') return null;
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
    // `fotoUrl` llega ya subida. Antes esta funcion subia la foto y luego hacia
    // el insert, uno detras del otro; ahora la subida arranca en cuanto se toma
    // la foto y corre MIENTRAS se verifica el rostro, que es tiempo que la
    // persona estaba esperando dos veces.
    async createRegistro(empleadoId, tipoRegistro, qrCode, tabletId, bloqueId = null, fotoUrl = null) {
        try {

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

    // Subir foto a Supabase Storage.
    //
    // Recibe el Blob que sale del canvas. Sigue aceptando una cadena base64 por
    // si algo viejo la manda, pero ese camino ya no se usa: convertirla costaba
    // un ciclo de JavaScript sobre cada byte de la foto, con la persona
    // esperando enfrente.
    async uploadFoto(empleadoId, foto) {
        try {
            const blob = (typeof foto === 'string')
                ? await (await fetch(foto)).blob()
                : foto;

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

    // Le pega la foto a un registro que ya se guardo.
    //
    // Existe porque subir la foto tarda 14 SEGUNDOS en la tableta (medido el
    // 2026-09-02: encuadre 774 ms, rostro 522 ms, subir la foto 13,982 ms) y no
    // hay ninguna razon para que la persona se quede parada mirando la pantalla
    // mientras eso pasa. Se guarda la checada, se le dice "hasta luego", y la
    // foto se le pega cuando llegue.
    //
    // Si falla, la checada YA quedo guardada: se pierde la foto, no el registro.
    async adjuntarFoto(registroId, fotoUrl) {
        if (!registroId || !fotoUrl) return false;
        try {
            const { error } = await supabaseClient
                .from('registros')
                .update({ foto_registro: fotoUrl })
                .eq('id', registroId);
            if (error) throw error;
            console.log('📸 Foto adjuntada al registro', registroId);
            return true;
        } catch (e) {
            console.error('No se pudo adjuntar la foto al registro', registroId, e);
            return false;
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
