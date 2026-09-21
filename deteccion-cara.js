// Detección de cara antes de tomar la foto de la checada.
//
// De dónde sale: en agosto, 1,121 de 6,191 checadas revisadas (18%) tenían una
// foto sin ninguna cara detectable — el techo, un pasillo, una nuca. Esas
// checadas no prueban quién checó, que es justo lo que Dirección reclamó en la
// junta del 1-sep con Marlen Cisneros.
//
// QUÉ HACE Y QUÉ NO HACE
// ----------------------
// Solo espera a que haya una cara de buen tamaño en el encuadre antes de
// disparar. NO decide de quién es esa cara: eso se compara después, en el
// servidor, contra la foto de referencia de quien escaneó el QR.
//
// Siempre toma la foto: a los 12 segundos dispara pase lo que pase, porque una
// foto mala sirve más que ninguna.
//
// PERO distingue DOS finales distintos, y esa diferencia es la que importa:
//
//   - Apareció una cara y nunca quedó bien puesta (lejos, de perfil, bajo la
//     visera). La persona SI está ahí. No se le impide checar: ya se midió que
//     esos son gente legítima mal encuadrada, no impostores.
//
//   - NUNCA apareció ninguna cara en 12 segundos. Entonces no había nadie
//     enfrente, y la foto es de una pared. Quien llama puede negar la checada
//     con `dcNadieSeParo`, porque esa foto no prueba absolutamente nada.
//
// Si el detector no carga — tableta vieja, sin internet, CDN caído — devuelve
// 'sin detector' y NADA se rechaza. A nadie se le niega su checada por una
// falla nuestra.

// Qué tan grande tiene que salir la cara. Medido sobre las fotos reales: las
// que el reconocimiento no pudo usar tenían la cara en 5-7% del alto del
// encuadre, y las buenas en 30-40%. 0.12 deja pasar holgado a quien de verdad
// está enfrente y descarta al que va pasando al fondo.
const DC_CARA_MINIMA = 0.12;

// Y qué tan grande es DEMASIADO grande.
//
// El otro extremo del mismo problema. Si la cara ocupa casi todo el alto del
// encuadre es que la persona esta pegada al lente, y ahi la foto sale cortada
// —sin frente, sin barbilla— o con la mano encima. El reconocimiento necesita
// los cinco puntos (ojos, nariz, comisuras) y si falta alguno no puede alinear
// la cara, asi que no mide nada.
//
// 0.85 deja pasar holgado a quien se para de cerca a proposito —las buenas
// rondan 0.30-0.40 de alto— y solo avisa cuando de verdad esta encima.
const DC_CARA_MAXIMA = 0.85;

// Que tan de lado puede estar la cara antes de pedirle que voltee.
//
// De aqui salio: se revisaron las 15 fotos que el reconocimiento rechazo de 732
// reales. NINGUNA era un impostor —todas eran la persona correcta— y todas
// tenian lo mismo: de perfil, o mirando al suelo bajo la visera de la gorra. No
// era la referencia ni el tamano de la cara. Era el angulo de la cabeza.
//
// El numero se calibro con esas fotos: las rechazadas dan 0.379 de mediana y las
// buenas 0.056. A 0.25 se atajan 9 de las 15 y solo se le pide voltear al 4.7%
// de quienes ya salian bien.
//
// Esto NO rechaza a nadie: solo pide que voltee. A los 12 segundos se dispara de
// todos modos.
const DC_GIRO_MAXIMO = 0.25;

// Cuadros seguidos con cara buena antes de disparar. Sin esto, alguien que
// cruza por atrás dispararía la foto.
const DC_CUADROS_SEGUIDOS = 4;

// A los 12 segundos se toma la foto pase lo que pase. Ese tope es para quien SI
// esta ahi y le esta costando acomodarse: se le da tiempo.
const DC_ESPERA_MAXIMA_MS = 12000;

// Pero si no ha aparecido NADIE, no hay a quien esperarle. Quien acaba de
// escanear su QR estaba frente a la tableta hace un segundo —la misma camara le
// acaba de leer el codigo—, asi que 6 segundos sin ver a nadie ya lo dicen todo.
// Se rinde antes para no tener a la persona parada de mas.
const DC_ESPERA_SIN_NADIE_MS = 6000;

// Los dos finales de la espera. Se separan porque significan cosas opuestas:
// uno es una persona mal encuadrada y el otro es que no había nadie.
const DC_NADIE = 'nunca aparecio una cara';
const DC_MAL_PUESTA = 'la cara nunca quedo bien';

// Respiro entre cuadro y cuadro. No hace falta mas: el propio detector se tarda
// lo suyo en cada cuadro, asi que este numero solo agrega espera encima. Con 4
// cuadros seguidos, cada 100 ms eran 400 ms de puro dormir con la persona ya
// bien parada frente a la camara.
const DC_RESPIRO_MS = 40;

const DC_MODELO =
    'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const DC_VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';

// ¿Que tan de lado esta la cara? Sale de los 6 puntos que da el detector:
// ojo derecho, ojo izquierdo, punta de la nariz y centro de la boca.
//
// Se mide cuanto se sale la nariz del eje que va de los ojos a la boca, en
// proporcion a la separacion de los ojos. De frente la nariz cae sobre ese eje
// y da casi 0; de perfil se va para un lado.
//
// Devuelve null si el detector no dio puntos: entonces no se opina del angulo.
function dcGiro(cara) {
    const p = cara && cara.keypoints;
    if (!p || p.length < 4) return null;
    const [ojoDer, ojoIzq, nariz, boca] = p;
    const entreOjos = Math.hypot(ojoIzq.x - ojoDer.x, ojoIzq.y - ojoDer.y);
    if (!entreOjos) return null;

    const centroOjos = { x: (ojoDer.x + ojoIzq.x) / 2, y: (ojoDer.y + ojoIzq.y) / 2 };
    const ejeX = boca.x - centroOjos.x, ejeY = boca.y - centroOjos.y;
    const largo = Math.hypot(ejeX, ejeY);
    if (!largo) return null;

    const vx = nariz.x - centroOjos.x, vy = nariz.y - centroOjos.y;
    return Math.abs(vx * ejeY - vy * ejeX) / largo / entreOjos;
}

// ¿Esta de frente?  Si no se puede saber, se dice que si: nunca estorbar por
// algo que no se pudo medir.
function dcDeFrente(cara, maximo) {
    const giro = dcGiro(cara);
    if (giro === null) return true;
    const tope = (maximo === undefined || maximo === null) ? DC_GIRO_MAXIMO : maximo;
    return giro <= tope;
}

// ¿Esta detección sirve para tomar la foto?
// `cara` trae la caja en pixeles; `altoVideo` es el alto del encuadre.
function dcCaraUsable(cara, altoVideo, minima, giroMaximo) {
    if (!cara || !altoVideo) return false;
    const tope = (minima === undefined || minima === null) ? DC_CARA_MINIMA : minima;
    const alto = cara.height || (cara.boundingBox && cara.boundingBox.height);
    if (!alto) return false;
    if ((alto / altoVideo) < tope) return false;
    return dcDeFrente(cara, giroMaximo);
}

// De todas las caras del cuadro, la más grande: quien checa está enfrente y los
// del fondo salen chicos.
function dcCaraMasGrande(detecciones) {
    if (!detecciones || !detecciones.length) return null;
    return detecciones.reduce((mayor, d) => {
        const a = (d.boundingBox && d.boundingBox.height) || d.height || 0;
        const b = (mayor.boundingBox && mayor.boundingBox.height) || mayor.height || 0;
        return a > b ? d : mayor;
    });
}

// Qué decirle a la persona. El mensaje importa: "acércate" se obedece, un
// "error de detección" no. Y por eso se distingue estar lejos de estar de lado:
// a quien ya esta cerca decirle "acércate" no le sirve de nada.
function dcMensaje(hayCara, esUsable, cara, altoVideo, minima) {
    if (!hayCara) return 'Colócate frente a la cámara';
    if (esUsable) return '¡Listo! No te muevas';

    const alto = cara && (cara.height || (cara.boundingBox && cara.boundingBox.height));
    const tope = (minima === undefined || minima === null) ? DC_CARA_MINIMA : minima;
    const proporcion = alto && altoVideo ? alto / altoVideo : 0;

    // Demasiado cerca. Se agrega el 2026-09-21: el primer dia con el rostro en
    // las 8 sucursales aparecieron fotos con la cara cortada por estar pegada al
    // lente, y otras con la mano encima sosteniendo el QR. En las dos, la cara
    // ocupa casi todo el cuadro o se sale de el, y el reconocimiento no tiene
    // con que trabajar.
    //
    // "Acercate" y "voltea" no sirven aqui —ya esta cerca y de frente—; hay que
    // decirle lo contrario.
    if (proporcion >= DC_CARA_MAXIMA) return 'Aléjate un poco de la cámara';

    const cerca = proporcion >= tope;
    return cerca ? 'Voltea de frente a la cámara' : 'Acércate un poco más';
}

// ¿Se puede negar la checada por esto?
//
// SOLO cuando el detector corrió los 12 segundos completos y no vio a NADIE.
// Ese es el hueco que se encontró probando: con el QR en alto y la cara fuera
// del cuadro, la checada quedaba registrada con una foto de la pared.
//
// Todo lo demás devuelve false, a propósito:
//   - 'sin detector'  -> la falla es nuestra, no de la persona.
//   - DC_MAL_PUESTA   -> la persona SI está ahí; se revisaron las 15 fotos que
//                        el reconocimiento rechazó y ninguna era un impostor.
//   - hubo: true      -> se encuadró bien, no hay nada que reclamar.
function dcNadieSeParo(resultado) {
    return !!resultado && resultado.hubo === false && resultado.motivo === DC_NADIE;
}

// Carga el detector. Devuelve null si no se puede, y el llamador sigue como
// antes. A propósito no lanza: esto no puede tumbar una checada.
let _dcDetector = null;
let _dcIntentado = false;

async function dcCargarDetector() {
    if (_dcDetector || _dcIntentado) return _dcDetector;
    _dcIntentado = true;
    try {
        const vision = await import(`${DC_VISION}/vision_bundle.mjs`);
        const fileset = await vision.FilesetResolver.forVisionTasks(`${DC_VISION}/wasm`);
        _dcDetector = await vision.FaceDetector.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: DC_MODELO, delegate: 'GPU' },
            runningMode: 'VIDEO',
            minDetectionConfidence: 0.5,
        });
        console.log('👤 Detector de cara listo');
    } catch (e) {
        console.warn('👤 No se pudo cargar el detector de cara, se sigue sin él:', e);
        _dcDetector = null;
    }
    return _dcDetector;
}

// Espera a que haya una cara de buen tamaño. Devuelve
// { hubo, motivo, segundos } — `hubo:false` no impide tomar la foto, solo deja
// dicho por qué salió así.
//
// `alAvanzar(mensaje)` se llama en cada cuadro para poder pintar la instrucción
// en pantalla.
async function dcEsperarCara(video, alAvanzar, opciones) {
    const o = opciones || {};
    const espera = o.esperaMaximaMs || DC_ESPERA_MAXIMA_MS;
    const sinNadie = o.esperaSinNadieMs || DC_ESPERA_SIN_NADIE_MS;
    const minima = o.caraMinima;
    const seguidos = o.cuadrosSeguidos || DC_CUADROS_SEGUIDOS;

    const detector = await dcCargarDetector();
    if (!detector || !video) {
        return { hubo: false, motivo: 'sin detector', cara: null, segundos: 0 };
    }

    const inicio = Date.now();
    let buenos = 0;
    let ultimoMensaje = null;
    // Si en algun cuadro se vio a alguien —aunque fuera de lado o de lejos—
    // entonces habia una persona enfrente, y eso cambia el final.
    let vioAAlguien = false;

    while (Date.now() - inicio < espera) {
        let deteccion = null;
        try {
            const r = detector.detectForVideo(video, performance.now());
            deteccion = dcCaraMasGrande(r && r.detections);
        } catch (e) {
            // Un cuadro que falla no cancela nada: se intenta el siguiente.
            deteccion = null;
        }

        if (deteccion) vioAAlguien = true;

        const alto = video.videoHeight || 0;
        const usable = dcCaraUsable(deteccion, alto, minima, o.giroMaximo);

        // El mensaje solo se repinta cuando CAMBIA. El ciclo da unas 25 vueltas
        // por segundo; reescribiendolo cada vuelta, el texto vibraba y no se
        // alcanzaba a leer.
        const mensaje = dcMensaje(!!deteccion, usable, deteccion, alto, minima);
        if (typeof alAvanzar === 'function' && mensaje !== ultimoMensaje) {
            ultimoMensaje = mensaje;
            alAvanzar(mensaje);
        }

        // Nadie ha aparecido y ya paso el plazo corto: no hay a quien esperar.
        if (!vioAAlguien && (Date.now() - inicio) >= sinNadie) break;

        buenos = usable ? buenos + 1 : 0;
        if (buenos >= seguidos) {
            // Se devuelve la caja: quien verifica el rostro la necesita para
            // recortar la cara del cuadro.
            return { hubo: true, motivo: 'ok', cara: deteccion,
                     segundos: (Date.now() - inicio) / 1000 };
        }

        await new Promise(r => setTimeout(r, o.respiroMs || DC_RESPIRO_MS));
    }

    return { hubo: false, motivo: vioAAlguien ? DC_MAL_PUESTA : DC_NADIE,
             cara: null, segundos: (Date.now() - inicio) / 1000 };
}
