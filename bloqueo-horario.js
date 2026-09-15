// Lógica pura de bloqueo de horario (Fase 1-A).
// Sin dependencias de Supabase ni del DOM, para poder probarla en tests/.
// COPIA IDÉNTICA en checador-qr (tabletas), V3 Checador-PWA y v2 Checador-Tablet:
// cualquier cambio aquí debe replicarse en los otros repos.

// '08:00:00' -> 480 (minutos desde medianoche)
function bhMinutosDe(horaStr) {
    const p = horaStr.split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1] || '0', 10);
}

// 'YYYY-MM-DD HH:mm:ss' o 'YYYY-MM-DDTHH:mm:ss' -> minutos desde medianoche.
// Se parsea el string directo: registros.fecha_hora es timestamp SIN zona y la
// hora guardada ya es la hora local del dispositivo que checó.
function bhMinutosDeFechaHora(fechaHoraStr) {
    const horaPart = fechaHoraStr.includes('T')
        ? fechaHoraStr.split('T')[1]
        : fechaHoraStr.split(' ')[1];
    return bhMinutosDe(horaPart);
}

// ¿A qué bloque pertenece un instante? Al primero cuyo fin (hora_salida) no
// haya pasado. Antes de la entrada del bloque 1 → bloque 1 (no hay mínimo).
// El hueco de comida → bloque 2 (regresó temprano de comer). Después del fin
// del último bloque → el último bloque.
function bhBloqueParaMinuto(bloques, minutos) {
    for (const b of bloques) {
        if (minutos <= bhMinutosDe(b.hora_salida)) return b;
    }
    return bloques[bloques.length - 1];
}

// Regla central de la spec 2026-06-09: evalúa si una ENTRADA se permite.
//   bloques        filas de bloques_horario ordenadas por orden_bloque
//   entradasHoyMin minutos de las ENTRADAs ya registradas hoy
//   ahoraMin       minutos desde medianoche (hora local del dispositivo)
//   esSabado       true si hoy es sábado (solo aplica el bloque 1)
// Devuelve { permitido, bloque, mensaje }.
function bhEvaluarEntrada(bloques, entradasHoyMin, ahoraMin, esSabado) {
    // Sin horario/bloques no hay regla que aplicar (no rompemos a esos empleados).
    if (!bloques || bloques.length === 0) {
        return { permitido: true, bloque: null, mensaje: null };
    }

    const activos = esSabado ? [bloques[0]] : bloques;
    const bloque = bhBloqueParaMinuto(activos, ahoraMin);

    // Bloque ya abierto: alguna entrada de hoy pertenece a este mismo bloque.
    const yaAbierto = entradasHoyMin.some(
        m => bhBloqueParaMinuto(activos, m).id === bloque.id
    );
    if (yaAbierto) return { permitido: true, bloque, mensaje: null };

    const tolerancia = (bloque.tolerancia_entrada_min === null || bloque.tolerancia_entrada_min === undefined)
        ? 15 : bloque.tolerancia_entrada_min;
    const tope = bhMinutosDe(bloque.hora_entrada) + tolerancia;
    if (ahoraMin <= tope) return { permitido: true, bloque, mensaje: null };

    const hh = String(Math.floor(tope / 60)).padStart(2, '0');
    const mm = String(tope % 60).padStart(2, '0');
    return {
        permitido: false,
        bloque,
        mensaje: `Fuera de horario. La entrada al turno cerró a las ${hh}:${mm}. Repórtalo con tu jefe.`,
        // Datos del rechazo. Se guardan en intentos_checada para no perder a
        // que hora llego: sin esto, el que llega tarde es indistinguible del
        // que no vino y no hay retardo que descontar. Ambos salen del bloque
        // que le toca a ESTE empleado, no de valores fijos.
        topeHora: `${hh}:${mm}:00`,
        minutosRetardo: ahoraMin - tope
    };
}

// Evalúa si una SALIDA se permite (regla del 2026-09-15).
//
// Nace de un dato incómodo: del 1-ago al 15-sep, en los horarios que salen a las
// 18:00 hubo 599 salidas checadas entre las 17:30 y las 17:58, casi todas
// apretadas entre las 17:54 y las 17:59. La ventana se cierra para que la
// checada de salida vuelva a significar que la jornada se cumplió.
//
//   bloques    filas de bloques_horario (la tableta las trae con select *)
//   ahoraMin   minutos desde medianoche (hora local del dispositivo)
//   diaSemana  0=domingo … 6=sábado, tal cual lo devuelve Date.getDay()
//
// La ventana sale de la base, nunca del código:
//   empieza en  hora_salida - bloqueo_salida_min      18:00 - 30 = 17:30
//   abre en     hora_salida - tolerancia_salida_min   18:00 -  2 = 17:58
//
// Un bloque sin `bloqueo_salida_min` no bloquea nada, y ese es el default: por
// eso los demás horarios siguen igual sin tocarlos.
//
// El borde de arriba es `tolerancia_salida_min` a propósito y no un campo
// propio: es el MISMO dato con el que el reporte de días completos del Admin
// decide si el día cerró. Compartirlo es lo único que impide que el bloqueo y el
// reporte digan cosas distintas sobre la misma hora.
//
// Devuelve { permitido, bloque, mensaje }.
function bhEvaluarSalida(bloques, ahoraMin, diaSemana) {
    // Sin horario/bloques no hay regla que aplicar.
    if (!bloques || bloques.length === 0) {
        return { permitido: true, bloque: null, mensaje: null };
    }

    // Solo de lunes a viernes. El sábado se sale a las 13:30 y esa hora no vive
    // ni puede vivir en bloques_horario (la tabla no tiene día de semana). Sin
    // ventana que defender, bloquear a ciegas solo arriesga atorar a quien
    // trabaje un sábado largo.
    if (diaSemana < 1 || diaSemana > 5) {
        return { permitido: true, bloque: null, mensaje: null };
    }

    for (const b of bloques) {
        if (b.bloqueo_salida_min === null || b.bloqueo_salida_min === undefined) continue;

        const salida = bhMinutosDe(b.hora_salida);
        const tol = (b.tolerancia_salida_min === null || b.tolerancia_salida_min === undefined)
            ? 15 : b.tolerancia_salida_min;
        const empieza = salida - b.bloqueo_salida_min;
        const abre = salida - tol;

        // Si la tolerancia creciera por encima de la ventana, `empieza >= abre`
        // y esta condición no se cumple nunca: el rango queda vacío en vez de
        // invertirse.
        if (ahoraMin >= empieza && ahoraMin < abre) {
            const hh = String(Math.floor(abre / 60)).padStart(2, '0');
            const mm = String(abre % 60).padStart(2, '0');
            return {
                permitido: false,
                bloque: b,
                mensaje: `Aún no es hora de salida. Puedes checar a partir de las ${hh}:${mm}.`,
                // Para dejar constancia en intentos_checada. `minutos_retardo` se
                // queda en null: cuántos minutos antes se quiso ir se saca
                // restando fecha_hora de tope_hora, y meter un negativo en un
                // campo llamado "retardo" es una trampa para el primer SUM().
                topeHora: `${hh}:${mm}:00`
            };
        }
    }

    return { permitido: true, bloque: null, mensaje: null };
}
