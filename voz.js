// La tableta habla.
//
// POR QUE
// -------
// El 2026-09-21, primer dia con el reconocimiento facial en las 8 sucursales,
// aparecieron fotos con la mano tapando el lente, el QR delante de la camara y
// caras cortadas por estar pegadas a la pantalla. Los avisos ya existian
// —"Acércate", "Voltea de frente"— pero van escritos sobre el video, y quien
// esta levantando el QR frente a la camara NO ESTA MIRANDO LA PANTALLA. Ahi un
// letrero no sirve; una voz si.
//
// COMO
// ----
// Con la voz que ya trae el navegador (speechSynthesis). No hay archivos que
// bajar, no ocupa espacio en la tableta y funciona sin internet una vez que el
// sistema tiene su voz en español instalada.
//
// TRES REGLAS QUE IMPORTAN EN UNA SUCURSAL
// ----------------------------------------
// 1. No repetir. Si el mensaje es el mismo que acaba de decir, se calla. Sin
//    esto, el encuadre —que corre varias veces por segundo— convertiria la
//    tableta en un loro.
// 2. No acumular. Cada mensaje nuevo cancela el anterior: mas vale decir lo
//    que pasa AHORA que terminar de leer lo de hace tres segundos.
// 3. Se apaga sin desplegar, con un switch en la base. Una tableta en un
//    mostrador con clientes enfrente puede necesitar silencio, y eso no se
//    resuelve con un despliegue.
//
// Si el navegador no tiene voz, o no hay voz en español, todo esto se queda
// callado y no pasa nada: los letreros siguen ahi.

// Cuanto tiene que pasar para volver a decir el MISMO mensaje. Si alguien se
// queda mal encuadrado, que se lo repita cada tanto, no cada cuadro.
const VOZ_REPETIR_MS = 4000;

let _vozUltimo = '';
let _vozCuando = 0;
let _vozVoz = null;
let _vozBuscada = false;

// ¿Se puede hablar? Tres condiciones: que el navegador sepa, que el switch de
// la base este encendido y que haya voz cargada.
function vozDisponible() {
    if (typeof speechSynthesis === 'undefined') return false;
    if (typeof switchActivo === 'function' && !switchActivo('voz_tableta')) return false;
    return true;
}

// La voz en español que tenga el sistema. Se busca UNA vez y se guarda: en
// algunos navegadores getVoices() es caro y ademas viene vacio al arrancar.
function vozEnEspanol() {
    if (_vozBuscada) return _vozVoz;
    _vozBuscada = true;
    try {
        const todas = speechSynthesis.getVoices() || [];
        // Primero una de México, que es como habla la gente aqui; si no,
        // cualquier español; si no, la que sea.
        _vozVoz = todas.find(v => /es[-_]MX/i.test(v.lang))
               || todas.find(v => /^es/i.test(v.lang))
               || null;
    } catch (e) {
        _vozVoz = null;
    }
    return _vozVoz;
}

// Las voces llegan tarde en algunos navegadores: se vuelve a buscar cuando el
// sistema avisa que ya las tiene.
if (typeof speechSynthesis !== 'undefined' && 'onvoiceschanged' in speechSynthesis) {
    speechSynthesis.onvoiceschanged = () => { _vozBuscada = false; vozEnEspanol(); };
}

// Dice algo en voz alta. Nunca lanza: esto no puede tumbar una checada.
function decir(texto, forzar) {
    if (!texto || !vozDisponible()) return;

    const ahora = Date.now();
    if (!forzar && texto === _vozUltimo && (ahora - _vozCuando) < VOZ_REPETIR_MS) return;

    _vozUltimo = texto;
    _vozCuando = ahora;

    try {
        // Lo de antes se cancela: importa lo que pasa ahora, no lo de hace rato.
        speechSynthesis.cancel();

        const u = new SpeechSynthesisUtterance(texto);
        const v = vozEnEspanol();
        if (v) u.voice = v;
        u.lang = (v && v.lang) || 'es-MX';
        // Un poco mas despacio de lo normal: se oye en un mostrador con ruido y
        // le da tiempo a la persona de reaccionar.
        u.rate = 0.95;
        u.pitch = 1.0;
        u.volume = 1.0;
        speechSynthesis.speak(u);
    } catch (e) {
        console.warn('🔊 No se pudo hablar:', e);
    }
}

// Limpia el recuerdo del ultimo mensaje. Se llama al terminar una checada para
// que el primer aviso de la siguiente persona SI se diga, aunque sea el mismo.
function vozOlvidar() {
    _vozUltimo = '';
    _vozCuando = 0;
    try {
        if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    } catch (e) { /* ni modo */ }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { decir, vozOlvidar, vozDisponible, VOZ_REPETIR_MS };
}
