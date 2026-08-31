// Lógica pura de bloqueo de horario (Fase 1-A).
// Sin dependencias de Supabase ni del DOM, para poder probarla en tests/.
// COPIA IDÉNTICA en V3 Checador-PWA y v2 Checador-Tablet — cualquier cambio
// aquí debe replicarse en el otro repo.

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
        mensaje: `Fuera de horario. La entrada al turno cerró a las ${hh}:${mm}. Repórtalo con tu jefe.`
    };
}
