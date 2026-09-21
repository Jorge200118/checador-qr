// Verificación de rostro en la tableta, al momento de checar.
//
// Compara la cara de la foto recién tomada contra la foto de referencia de
// QUIEN ESCANEÓ EL QR. Una sola comparación, no una búsqueda entre 214.
//
// POR QUÉ ESO IMPORTA
// -------------------
// Buscar entre todos es el problema difícil: hay 14 parejas de empleados
// distintos que se parecen 0.50 o más, y dos que llegan a 0.60 y 0.68 (los
// hermanos Gómez Silva). Ahí el sistema los cambiaría.
//
// Pero con el QR de por medio la pregunta es otra: "¿esta cara es la del dueño
// de este QR?". Una sola comparación, y ahí los parecidos no estorban — si un
// Gómez Silva escanea su propio QR, se le compara contra él mismo y pasa. El QR
// no es un estorbo del reconocimiento: es lo que lo hace funcionar.
//
// EL MODELO ES EL MISMO QUE EL DEL SERVIDOR
// -----------------------------------------
// SFace (OpenCV Zoo), a propósito el mismo que usa
// scripts/reconocimiento_facial.py. Si aquí corriera otro, el 0.40 calibrado
// dejaría de significar lo mismo y habría que medir todo otra vez.
//
// NADA DE ESTO PUEDE TUMBAR UNA CHECADA POR ERROR. Si el modelo no carga, si la
// persona no tiene referencia, si la comparación falla — se devuelve
// `concluyente: false` y quien llama deja pasar la checada.

// El modelo se sirve desde el propio Supabase, no desde un CDN: el de GitHub
// devuelve el puntero de Git LFS en vez del binario, y ademas la tableta ya
// habla con Supabase para todo lo demas. El service worker lo guarda, asi que
// se baja una sola vez.
const VR_MODELO = 'https://uqncsqstpcynjxnjhrqu.supabase.co/storage/v1/object/public/modelos/sface_2021dec.onnx';
const VR_ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js';

// La malla facial de MediaPipe: 478 puntos, de los que salen los cinco que
// necesita el alineado. 3.5 MB.
const VR_VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const VR_MALLA = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// SFace recibe la cara recortada a 112x112.
const VR_LADO = 112;

// EL ALINEADO: por que existe todo lo de abajo.
// -------------------------------------------------------------------------
// SFace no acepta cualquier recorte de la cara. Fue entrenado con las caras
// llevadas a una posicion fija —ojos, nariz y comisuras de la boca en estas
// coordenadas exactas dentro del cuadro de 112x112— y si se le da la cara en
// otra posicion, el vector que devuelve no es comparable con nada.
//
// El servidor lo hace con alignCrop de OpenCV, que usa los cinco puntos de
// YuNet. Aqui hay que reproducirlo. La primera version recortaba la caja del
// detector con un margen fijo y daba 0.09-0.25 donde el servidor daba 0.88:
// numeros que no significaban nada.
//
// MEDIDO sobre 18 fotos reales de 12 empleados, contra las referencias que ya
// estan guardadas: en las 13 fotos donde el detector del navegador y el del
// servidor miraron la MISMA cara, la diferencia va de -0.09 a -0.01, mediana
// -0.05. El navegador lee tantito mas bajo que el servidor, siempre para el
// mismo lado, que ademas es el lado prudente: si se equivoca, se equivoca
// dejando pasar, no rechazando.
const VR_CANONICOS = [
    [38.2946, 51.6963],   // ojo derecho (el que sale a la izquierda del cuadro)
    [73.5318, 51.5014],   // ojo izquierdo
    [56.0252, 71.7366],   // punta de la nariz
    [41.5493, 92.3655],   // comisura derecha de la boca
    [70.7299, 92.2041],   // comisura izquierda
];

// De donde sale cada uno de los cinco, dentro de los 478 de la malla. NO se
// eligieron a ojo: se probaron 16 candidatos contra los puntos de YuNet sobre
// las mismas fotos y estos son los que menos se alejaron (9-17 px en imagenes
// de 1440 px de ancho).
const VR_IRIS_DERECHO = [468, 469, 470, 471, 472];
const VR_IRIS_IZQUIERDO = [473, 474, 475, 476, 477];
const VR_NARIZ = 1;
const VR_BOCA_DERECHA = 61;
const VR_BOCA_IZQUIERDA = 291;

// Cuanto se espera al modelo cuando alguien YA esta checando. El modelo pesa
// 37 MB y el runtime otros 20: si por lo que sea no alcanzo a cargar antes, esa
// checada pasa sin medir. Hacer esperar a la gente frente a la tableta cuesta
// mas que perder una medicion, y el modo REGISTRA no depende de tenerlas todas.
const VR_ESPERA_MAXIMA_MS = 4000;

// Techo de toda la verificacion cuando la persona SI esta esperando (BLOQUEA).
// Pasado esto se abandona y la checada sigue sin medir: medido en tableta, la
// primera medicion del dia se llevaba 10 segundos, y eso no se le puede cobrar
// a quien viene llegando.
const VR_PRESUPUESTO_MS = 3000;

// A que ancho se reduce la foto antes de buscarle los puntos. La malla trabaja
// con coordenadas normalizadas, asi que los puntos se aplican despues a la foto
// GRANDE: el recorte sale igual de fino, solo se busca sobre menos pixeles.
// Medido sobre 5 fotos: el parecido cambia menos de 0.006 entre la foto
// completa y 640 px.
const VR_ANCHO_MALLA = 640;

// Cuantas caras se le piden a la malla.
//
// Estuvo en 1 y costo un rechazo real: el 2026-09-02 a las 16:57 la tableta
// rechazo a Jorge (0.0496) teniendo su cara ENFRENTE y mas grande que la otra.
// Habia dos personas en el cuadro y MediaPipe, con numFaces=1, se quedo con la
// del fondo —la que se veia completa— porque a el se le cortaba la frente.
// Con 5 aparecen las dos (0.046 y 0.600) y ya se puede escoger bien.
const VR_CARAS_MAXIMAS = 5;

// Config por omisión, por si la base no contesta. APAGADO es lo prudente: si la
// base no contesta tampoco hay referencias contra que comparar, y hacer
// reintentar a la gente por algo que no es culpa suya sí estorba.
const VR_CONFIG_DEFECTO = {
    umbral: 0.40, modo: 'APAGADO', intentos_maximos: 1,
    min_fotos_referencia: 8, min_cohesion_referencia: 0.72,
    margen_parecidos: 0.05, exigir_rostro: false,
};

// ¿Hay que comparar rostros en la tableta?
function vrEncendido(config) {
    return !!config && config.modo !== 'APAGADO';
}

// ¿Se niega la checada cuando nadie se paró frente a la cámara?
//
// Es su propio interruptor, aparte de `modo`, y a propósito. Son dos preguntas
// distintas: "¿eres tú?" (modo) y "¿hay alguien ahí?" (esta). La segunda no
// necesita referencia de nadie ni umbral: es la evidencia mínima de que la
// checada la hizo una persona y no un QR levantado desde la puerta.
//
// Por eso también aplica a los 11 sin referencia y a los 17 con referencia
// floja: a ellos no se les puede pedir que coincidan, pero sí que se paren
// frente a la cámara. Eso no depende de qué tan bien armado esté su expediente.
//
// Se apaga con: UPDATE config_reconocimiento SET exigir_rostro = false;
function vrExigeRostro(config) {
    return !!config && !!config.exigir_rostro;
}

// ¿La medicion puede impedir una checada? Solo en BLOQUEA. En REGISTRA se mide
// para juntar datos, y por eso ahi NADIE tiene que esperar: la checada se guarda
// y la medicion corre despues, con la persona ya caminando.
function vrDetiene(config) {
    return !!config && config.modo === 'BLOQUEA';
}

let _vrSesion = null;
let _vrCarga = null;        // la promesa de carga, compartida
let _vrConfig = null;
let _vrConfigCarga = null;
let _vrReferencias = {};   // empleado_id -> { vector, fotos, cohesion }
let _vrParecidos = {};     // empleado_id -> [ { id, vector } ]

// ---------------------------------------------------------------- aritmética

function vrParecido(a, b) {
    if (!a || !b || a.length !== b.length) return null;
    let punto = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        punto += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (!na || !nb) return null;
    return punto / (Math.sqrt(na) * Math.sqrt(nb));
}

// El centro de un grupo de puntos de la malla.
function vrCentro(puntos, indices) {
    let x = 0, y = 0;
    for (const i of indices) {
        if (!puntos[i]) return null;
        x += puntos[i][0];
        y += puntos[i][1];
    }
    return [x / indices.length, y / indices.length];
}

// Los cinco puntos que necesita el alineado, sacados de la malla de 478.
// `puntos` viene en pixeles de la imagen. Devuelve null si la malla no trae
// todos los que hacen falta: sin los cinco no se alinea, y sin alinear no se
// mide.
function vrCincoPuntos(puntos) {
    if (!puntos || puntos.length < 478) return null;
    const ojoDer = vrCentro(puntos, VR_IRIS_DERECHO);
    const ojoIzq = vrCentro(puntos, VR_IRIS_IZQUIERDO);
    const nariz = puntos[VR_NARIZ];
    const bocaDer = puntos[VR_BOCA_DERECHA];
    const bocaIzq = puntos[VR_BOCA_IZQUIERDA];
    if (!ojoDer || !ojoIzq || !nariz || !bocaDer || !bocaIzq) return null;
    return [ojoDer, ojoIzq, nariz, bocaDer, bocaIzq];
}

// La transformacion que lleva unos puntos a otros: giro, escala pareja y
// desplazamiento, ajustados por minimos cuadrados. Es lo mismo que calcula
// estimateAffinePartial2D de OpenCV, que es lo que usa alignCrop del servidor.
//
// Deliberadamente NO permite estirar de un lado mas que del otro: una cara
// deformada asi ya no es la misma cara para el modelo.
//
// Devuelve { c, s, tx, ty }, donde un punto (x,y) va a parar a
//   ( c*x - s*y + tx ,  s*x + c*y + ty )
// y donde c y s ya llevan la escala adentro. Null si los puntos no dan.
function vrSemejanza(origen, destino) {
    if (!origen || !destino || origen.length !== destino.length || origen.length < 2) return null;
    const n = origen.length;

    let mox = 0, moy = 0, mdx = 0, mdy = 0;
    for (let i = 0; i < n; i++) {
        mox += origen[i][0]; moy += origen[i][1];
        mdx += destino[i][0]; mdy += destino[i][1];
    }
    mox /= n; moy /= n; mdx /= n; mdy /= n;

    let punto = 0, cruz = 0, norma = 0;
    for (let i = 0; i < n; i++) {
        const ax = origen[i][0] - mox, ay = origen[i][1] - moy;
        const bx = destino[i][0] - mdx, by = destino[i][1] - mdy;
        punto += ax * bx + ay * by;    // coseno por escala
        cruz += ax * by - ay * bx;     // seno por escala
        norma += ax * ax + ay * ay;
    }
    // Todos los puntos en el mismo lugar: no hay giro ni escala que sacar.
    if (!norma) return null;

    const c = punto / norma, s = cruz / norma;
    return {
        c, s,
        tx: mdx - (c * mox - s * moy),
        ty: mdy - (s * mox + c * moy),
    };
}

// ¿Se parece MAS a otro que al dueño del QR?
//
// EL HUECO QUE CIERRA
// Comparar contra una sola referencia no distingue a dos personas parecidas: de
// 183 empleados con referencia confiable hay 250 parejas que pasan el umbral, 93
// de ellas en la misma sucursal, y la peor son dos hermanos a 0.704. Subir el
// umbral no sirve — rechazaria gente legitima.
//
// Lo que si sirve es preguntar dos cosas en vez de una: "¿es el dueño del QR?" y
// "¿no sera mas bien alguno de los pocos que se confunden con el?". Si un
// parecido le gana por margen, no es el dueño del QR.
//
// MEDIDO sobre fotos reales: ataja 132 de 133 suplantaciones que hoy pasarian
// (99.2%) y agrega 0 rechazos en 547 fotos legitimas.
//
// El margen sale de la config. En 0 la regla queda apagada.
function vrGanaUnParecido(deDueno, delParecido, config) {
    const c = config || VR_CONFIG_DEFECTO;
    const margen = Number(c.margen_parecidos);
    if (!margen || margen <= 0) return false;
    if (deDueno === null || deDueno === undefined || Number.isNaN(deDueno)) return false;
    if (delParecido === null || delParecido === undefined || Number.isNaN(delParecido)) return false;
    return delParecido > deDueno + margen;
}

// El que mas se parece de la lista corta. Devuelve { id, parecido } o null.
function vrMejorParecido(vector, parecidos) {
    if (!vector || !parecidos || !parecidos.length) return null;
    let mejor = null;
    for (const p of parecidos) {
        const s = vrParecido(vector, p.vector);
        if (s === null) continue;
        if (!mejor || s > mejor.parecido) mejor = { id: p.id, parecido: s };
    }
    return mejor;
}

// Qué hacer con un puntaje, según la config. Se separa de todo lo demás para
// poder probarla sin modelo ni cámara.
//
// Devuelve { coincide, concluyente, bloquea }:
//   concluyente  = se pudo comparar de verdad
//   bloquea      = hay que impedir la checada
//
// `puedeRechazar` es lo que separa "no coincide" de "hay que rechazarlo". Se
// mide a todos, pero solo se rechaza a quien tiene una referencia que aguante
// esa decision. Por omision es true para que quien no la pase siga midiendo
// igual que siempre.
function vrVeredicto(parecido, config, puedeRechazar) {
    const c = config || VR_CONFIG_DEFECTO;
    if (parecido === null || parecido === undefined || Number.isNaN(parecido)) {
        // Sin comparación no se castiga a nadie.
        return { coincide: null, concluyente: false, bloquea: false };
    }
    const permitido = (puedeRechazar === undefined) ? true : !!puedeRechazar;
    const coincide = parecido >= c.umbral;
    return {
        coincide,
        concluyente: true,
        bloquea: !coincide && c.modo === 'BLOQUEA' && permitido,
    };
}

// El mensaje que ve la persona. Distinto según si se le va a impedir checar:
// decirle "no eres tú" cuando de todos modos va a pasar solo genera pleitos.
function vrMensaje(veredicto, intento, intentosMaximos) {
    if (!veredicto.concluyente) return null;
    if (veredicto.coincide) return null;
    if (intento < intentosMaximos) {
        return `No se reconoció tu rostro. Intento ${intento} de ${intentosMaximos}, acércate a la cámara.`;
    }
    return veredicto.bloquea
        ? 'No se pudo confirmar tu rostro. Repórtalo con tu jefe.'
        : null;
}

// ---------------------------------------------------------------- carga

// Se guarda la promesa, no solo el resultado: si dos partes de la app la piden
// al mismo tiempo (el arranque y una checada), se hace UNA consulta, no dos.
function vrConfig() {
    if (_vrConfig) return Promise.resolve(_vrConfig);
    if (_vrConfigCarga) return _vrConfigCarga;
    _vrConfigCarga = _vrLeerConfig();
    return _vrConfigCarga;
}

async function _vrLeerConfig() {
    try {
        const { data, error } = await supabaseClient
            .from('config_reconocimiento')
            .select('umbral, modo, intentos_maximos, min_fotos_referencia, min_cohesion_referencia, margen_parecidos, exigir_rostro')
            .eq('id', 1)
            .single();
        if (error) throw error;
        _vrConfig = {
            umbral: Number(data.umbral),
            modo: data.modo,
            intentos_maximos: Number(data.intentos_maximos),
            min_fotos_referencia: Number(data.min_fotos_referencia),
            min_cohesion_referencia: Number(data.min_cohesion_referencia),
            margen_parecidos: Number(data.margen_parecidos),
            exigir_rostro: !!data.exigir_rostro,
        };
    } catch (e) {
        console.warn('🧬 No se pudo leer la config, se usa la prudente:', e);
        _vrConfig = { ...VR_CONFIG_DEFECTO };
    }
    console.log('🧬 Reconocimiento:', _vrConfig);
    return _vrConfig;
}

// La referencia trae ademas de que esta hecha: con cuantas fotos y que tan
// parecidas entre si. Eso es lo que decide si puede o no rechazar a alguien.
async function vrReferencia(empleadoId) {
    if (_vrReferencias[empleadoId] !== undefined) return _vrReferencias[empleadoId];
    try {
        const { data, error } = await supabaseClient
            .from('rostros_referencia')
            .select('vector, fotos_usadas, cohesion')
            .eq('empleado_id', empleadoId)
            .single();
        if (error) throw error;
        _vrReferencias[empleadoId] = {
            vector: Float32Array.from(data.vector),
            fotos: Number(data.fotos_usadas),
            cohesion: data.cohesion === null ? null : Number(data.cohesion),
        };
    } catch (e) {
        // Sin referencia no hay nada contra qué comparar, y eso NO es culpa de
        // la persona: se deja pasar.
        console.warn('🧬 Sin cara de referencia para', empleadoId);
        _vrReferencias[empleadoId] = null;
    }
    return _vrReferencias[empleadoId];
}

// Las caras de los pocos que se confunden con este empleado.
//
// Son 3.3 por persona en promedio y 12 el que mas, asi que son unos kilobytes.
// Se piden al calentar, mientras la persona lee la confirmacion, para que no
// cuesten nada cuando llegue la foto.
//
// Si falla, se devuelve lista vacia: la regla simplemente no aplica esa vez. NO
// se deja de verificar por esto.
async function vrCargarParecidos(empleadoId) {
    if (_vrParecidos[empleadoId] !== undefined) return _vrParecidos[empleadoId];
    _vrParecidos[empleadoId] = [];
    try {
        const { data: lista, error } = await supabaseClient
            .from('rostros_parecidos')
            .select('parecido_id')
            .eq('empleado_id', empleadoId);
        if (error) throw error;
        if (!lista || !lista.length) return _vrParecidos[empleadoId];

        const ids = lista.map(p => p.parecido_id);
        const { data: caras, error: e2 } = await supabaseClient
            .from('rostros_referencia')
            .select('empleado_id, vector')
            .in('empleado_id', ids);
        if (e2) throw e2;

        _vrParecidos[empleadoId] = (caras || []).map(c => ({
            id: c.empleado_id,
            vector: Float32Array.from(c.vector),
        }));
        if (_vrParecidos[empleadoId].length) {
            console.log(`🧬 ${_vrParecidos[empleadoId].length} parecido(s) para ${empleadoId}`);
        }
    } catch (e) {
        console.warn('🧬 No se pudieron leer los parecidos de', empleadoId, e);
        _vrParecidos[empleadoId] = [];
    }
    return _vrParecidos[empleadoId];
}

// ¿Esta referencia da para RECHAZAR a alguien?
//
// De 203 referencias, 17 estan flojas y una esta armada con UNA sola foto. A esa
// gente se le mide igual —el dato sirve— pero no se le rechaza: si su expediente
// esta mal armado, el problema es del expediente, no suyo, y no tiene por que
// quedarse sin checar por eso.
//
// Los minimos salen de config_reconocimiento, no del codigo.
function vrReferenciaConfiable(referencia, config) {
    if (!referencia) return false;
    const c = config || VR_CONFIG_DEFECTO;
    if (!(referencia.fotos >= c.min_fotos_referencia)) return false;
    // Una referencia vieja puede no traer cohesion; no se le inventa una buena.
    if (referencia.cohesion === null || referencia.cohesion === undefined) return false;
    return referencia.cohesion >= c.min_cohesion_referencia;
}

// ¿Ya se le puede rechazar por rostro, o sigue en su periodo de aprendizaje?
//
// Se pregunta a la base, no se calcula aqui: la regla tiene que valer igual
// aunque una tableta ande con codigo viejo. Ya pasó que una tableta se quedó
// meses sin actualizar y siguió aplicando reglas viejas.
//
// Se cachea por empleado y por sesion: durante el dia el estado no cambia, y
// una consulta mas por checada son milisegundos con la persona enfrente.
//
// Ante cualquier duda —sin red, error, respuesta rara— devuelve FALSE, o sea
// "no lo rechaces". Es lo prudente: si no se puede comprobar que ya termino de
// aprender, no hay derecho a negarle la checada.
const _vrAprendizaje = new Map();

async function vrFueraDeAprendizaje(empleadoId) {
    if (_vrAprendizaje.has(empleadoId)) return _vrAprendizaje.get(empleadoId);
    try {
        const { data, error } = await supabaseClient
            .rpc('rostro_puede_bloquear', { p_empleado_id: empleadoId });
        if (error) throw error;
        const puede = !!data;
        _vrAprendizaje.set(empleadoId, puede);
        return puede;
    } catch (e) {
        console.warn('🧬 No se pudo consultar el aprendizaje; no se rechaza:', e);
        return false;
    }
}

// Guarda una cara del periodo de aprendizaje.
//
// SIN await a proposito: la persona esta enfrente esperando su checada y esto
// no le importa. Si falla, se pierde una muestra de cientos — se junta otra
// mañana. Lo que NO puede pasar es que subir una muestra retrase la checada:
// esa leccion ya costo 14 segundos por persona con la subida de la foto.
//
// Solo escribe si la persona esta en periodo ABIERTO. La comprobacion es una
// consulta mas, asi que se apoya en el mismo cache de vrFueraDeAprendizaje:
// quien ya cerro su periodo no vuelve a preguntar nada.
function vrGuardarMuestra(empleadoId, vector) {
    vrFueraDeAprendizaje(empleadoId).then(yaCerro => {
        if (yaCerro) return;   // ya tiene referencia buena, no junta mas
        return supabaseClient.from('aprendizaje_muestras').insert({
            empleado_id: empleadoId,
            vector: vector,
            tablet_id: typeof TABLET_CONFIG !== 'undefined' ? TABLET_CONFIG.id : null
        });
    }).then(r => {
        if (r && r.error) console.warn('🧬 No se guardo la muestra:', r.error.message);
    }).catch(e => console.warn('🧬 No se guardo la muestra:', e));
}

function vrCargarModelo() {
    if (!_vrCarga) _vrCarga = _vrBajarModelo();
    return _vrCarga;
}

async function _vrBajarModelo() {
    try {
        if (typeof ort === 'undefined') {
            await new Promise((listo, falla) => {
                const s = document.createElement('script');
                s.src = VR_ORT;
                s.onload = listo;
                s.onerror = falla;
                document.head.appendChild(s);
            });
        }
        _vrSesion = await ort.InferenceSession.create(VR_MODELO, {
            executionProviders: ['wasm'],
        });
        console.log('🧬 Modelo de rostro listo');
    } catch (e) {
        console.warn('🧬 No se pudo cargar el modelo, se sigue sin verificar:', e);
        _vrSesion = null;
    }
    return _vrSesion;
}

let _vrMalla = null;
let _vrMallaCarga = null;

// La malla facial. Como el modelo de SFace: si no carga, no se mide y ya.
function vrCargarMalla() {
    if (!_vrMallaCarga) _vrMallaCarga = _vrBajarMalla();
    return _vrMallaCarga;
}

async function _vrBajarMalla() {
    try {
        const vision = await import(`${VR_VISION}/vision_bundle.mjs`);
        const fileset = await vision.FilesetResolver.forVisionTasks(`${VR_VISION}/wasm`);
        _vrMalla = await vision.FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: VR_MALLA, delegate: 'GPU' },
            runningMode: 'IMAGE',
            numFaces: VR_CARAS_MAXIMAS,
        });
        console.log('🧬 Malla facial lista');
    } catch (e) {
        console.warn('🧬 No se pudo cargar la malla facial:', e);
        _vrMalla = null;
    }
    return _vrMalla;
}

// La malla, pero sin esperar de mas. Faltaba: se esperaba la descarga completa
// sin ningun tope, y esa era buena parte de los 10 segundos.
async function vrMallaLista(msMaximo) {
    if (_vrMalla) return _vrMalla;
    const tope = (msMaximo === undefined) ? VR_ESPERA_MAXIMA_MS : msMaximo;
    const TARDE = Symbol('tarde');
    const cual = await Promise.race([
        vrCargarMalla(),
        new Promise(r => setTimeout(() => r(TARDE), tope)),
    ]);
    if (cual === TARDE) {
        console.warn('🧬 La malla no alcanzo a cargar; esta checada pasa sin medir');
        return null;
    }
    return cual;
}

// La sesion, pero sin esperar de mas. Devuelve null si todavia no esta lista:
// quien llama ya sabe que eso significa "esta checada no se mide", no "rechazar".
async function vrSesionLista(msMaximo) {
    if (_vrSesion) return _vrSesion;
    const tope = (msMaximo === undefined) ? VR_ESPERA_MAXIMA_MS : msMaximo;
    const TARDE = Symbol('tarde');
    const cual = await Promise.race([
        vrCargarModelo(),
        new Promise(r => setTimeout(() => r(TARDE), tope)),
    ]);
    if (cual === TARDE) {
        console.warn('🧬 El modelo no alcanzo a cargar; esta checada pasa sin medir');
        return null;
    }
    return cual;
}

// Se llama al ARRANCAR la tableta, cuando no hay nadie esperando. Antes esto
// corria al validar el QR, o sea con la persona ya parada enfrente: la primera
// checada del dia pagaba los 57 MB del modelo y el runtime.
//
// Se hace en el rato muerto del navegador para no pelearse con la camara ni con
// el escaneo de QR, que es lo unico que de verdad urge al arrancar.
async function vrCalentarAlArrancar() {
    // La config se pide de inmediato: es una consulta chica y es la que decide
    // si vale la pena bajar 57 MB o no.
    const config = await vrConfig();
    if (!vrEncendido(config)) return;

    const bajar = () => { vrCargarModelo(); vrCargarMalla(); vrPrimeraCorrida(); };
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(bajar, { timeout: 8000 });
    } else {
        setTimeout(bajar, 3000);
    }
}

// Los dos modelos tardan MUCHO mas la primera vez que corren que las siguientes:
// medido, la malla se lleva 260 ms la primera y 25 las demas, y en una tableta
// eso se multiplica. Asi que se les da una corrida en falso al arrancar, con una
// imagen en blanco, para que ese costo lo pague la tableta sola y no la persona
// que llega a checar.
async function vrPrimeraCorrida() {
    try {
        const lienzo = document.createElement('canvas');
        lienzo.width = VR_ANCHO_MALLA;
        lienzo.height = Math.round(VR_ANCHO_MALLA * 3 / 4);
        const ctx = lienzo.getContext('2d');
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, lienzo.width, lienzo.height);

        const malla = await vrCargarMalla();
        if (malla) malla.detect(lienzo);

        const sesion = await vrCargarModelo();
        if (sesion) {
            const vacio = new Float32Array(3 * VR_LADO * VR_LADO);
            await sesion.run({ [sesion.inputNames[0]]:
                new ort.Tensor('float32', vacio, [1, 3, VR_LADO, VR_LADO]) });
        }
        console.log('🧬 Modelos calentados');
    } catch (e) {
        console.warn('🧬 No se pudieron calentar los modelos:', e);
    }
}

// Se llama en cuanto se sabe QUIEN es, para tener su cara de referencia lista
// cuando llegue la foto. Es una consulta chica; el modelo ya viene del arranque.
async function vrCalentar(empleadoId) {
    const config = await vrConfig();
    if (!vrEncendido(config)) return;
    vrCargarModelo();
    vrCargarMalla();
    if (empleadoId) {
        vrReferencia(empleadoId);
        vrCargarParecidos(empleadoId);
    }
}

// ---------------------------------------------------------------- inferencia

// Lleva la cara a los cinco puntos canonicos y la deja en 112x112, que es lo
// que espera SFace. Esto es el equivalente de alignCrop de OpenCV.
function vrRecortarAlineado(imagen, puntos) {
    const t = vrSemejanza(puntos, VR_CANONICOS);
    if (!t) return null;

    const lienzo = document.createElement('canvas');
    lienzo.width = VR_LADO;
    lienzo.height = VR_LADO;
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';

    // setTransform(a,b,c,d,e,f) manda (x,y) a (a*x + c*y + e, b*x + d*y + f),
    // que es justo la matriz de arriba con la columna del seno cambiada de signo.
    ctx.setTransform(t.c, t.s, -t.s, t.c, t.tx, t.ty);
    ctx.drawImage(imagen, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    return ctx.getImageData(0, 0, VR_LADO, VR_LADO);
}

// De ImageData a lo que espera el modelo: NCHW, BGR, sin normalizar (SFace lo
// hace adentro).
function vrTensorDe(imageData) {
    const { data } = imageData;
    const n = VR_LADO * VR_LADO;
    const salida = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
        salida[i] = data[i * 4 + 2];              // B
        salida[n + i] = data[i * 4 + 1];          // G
        salida[2 * n + i] = data[i * 4];          // R
    }
    return salida;
}

// Vector de 128 números de una cara ya alineada.
async function vrVectorDe(imagen, puntos, msMaximo) {
    const sesion = await vrSesionLista(msMaximo);
    if (!sesion) return null;
    try {
        const recorte = vrRecortarAlineado(imagen, puntos);
        if (!recorte) return null;
        const tensor = new ort.Tensor('float32', vrTensorDe(recorte), [1, 3, VR_LADO, VR_LADO]);
        const salida = await sesion.run({ [sesion.inputNames[0]]: tensor });
        return salida[sesion.outputNames[0]].data;
    } catch (e) {
        console.warn('🧬 Falló la comparación de rostro:', e);
        return null;
    }
}

// ---------------------------------------------------------------- lo de arriba

// ¿La cara que encontro la malla es la misma que aprobo el encuadre?
//
// De aqui sale una cosa que se midio y que no era obvia: en 5 de 18 fotos con
// dos personas, el detector del navegador y el del servidor se quedaron con
// caras DISTINTAS, separadas 560 a 926 pixeles. Cuando eso pasa se esta
// midiendo a quien pasaba por atras, no a quien checa. Mejor no concluir.
//
// `caja` viene en coordenadas del video, sin espejo; los puntos vienen de la
// foto, que si esta espejeada. Por eso la caja se voltea antes de comparar.
function vrMismaCara(puntos, caja, anchoFoto) {
    if (!caja) return true;   // sin caja con que comparar, no se estorba
    const c = caja.boundingBox || caja;
    if (c.originX === undefined || !c.width) return true;

    const centroX = (puntos[0][0] + puntos[1][0]) / 2;
    const centroY = (puntos[0][1] + puntos[1][1]) / 2;

    const x = anchoFoto - c.originX - c.width;   // la caja, ya volteada
    const holgura = c.width * 0.5;
    return centroX >= x - holgura && centroX <= x + c.width + holgura
        && centroY >= c.originY - holgura && centroY <= c.originY + c.height + holgura;
}

// Que tan grande es una cara: la distancia entre los ojos. Se usa asi y no la
// altura de la caja porque de los cinco puntos es la medida mas estable — no
// cambia si la persona abre la boca o baja la barbilla.
function vrTamanoCara(cinco) {
    return Math.hypot(cinco[1][0] - cinco[0][0], cinco[1][1] - cinco[0][1]);
}

// De todas las caras del cuadro, la de quien esta checando.
//
// Primero las que caen dentro del encuadre que ya se aprobo; si ninguna cae ahi
// (o no hubo encuadre), la mas grande, porque quien checa esta pegado a la
// camara y los demas quedan atras. Devuelve null si no hay ninguna.
function vrElegirCara(candidatos, caja, anchoFoto) {
    if (!candidatos || !candidatos.length) return null;

    const dentro = caja
        ? candidatos.filter(c => vrMismaCara(c, caja, anchoFoto))
        : [];
    const entre = dentro.length ? dentro : candidatos;

    return entre.reduce((mayor, c) =>
        vrTamanoCara(c) > vrTamanoCara(mayor) ? c : mayor);
}

// Compara la cara de la FOTO recien tomada contra la referencia del empleado.
//
// Se mide sobre la foto, no sobre el video, y eso importa por dos razones:
//
//   1. La foto se guarda EN ESPEJO —asi la voltea capturePhoto y asi se armaron
//      las referencias del servidor. SFace no es indiferente al espejo: medido,
//      una cara contra su propio reflejo da 0.73 de promedio y en un caso dio
//      -0.08. Medir el video sin voltear contra una referencia volteada no
//      compara nada.
//   2. Lo que se mide es exactamente lo que queda guardado. Si despues alguien
//      revisa la foto en el servidor, va a sacar el mismo numero.
//
// `foto` es el lienzo con el cuadro ya espejeado, o un Blob JPEG.
// `caja` es opcional: la del encuadre, para no medir a otra persona del cuadro.
// Devuelve { parecido, coincide, concluyente, bloquea, motivo }.
async function vrVerificar(foto, empleadoId, caja) {
    const config = await vrConfig();
    if (!vrEncendido(config)) {
        return { coincide: null, concluyente: false, bloquea: false,
                 parecido: null, motivo: 'apagado' };
    }
    const sinConcluir = (motivo) => ({ ...vrVeredicto(null, config), parecido: null, motivo });

    const referencia = await vrReferencia(empleadoId);
    if (!foto) return sinConcluir('sin foto');

    // OJO: sin referencia NO se corta aqui.
    //
    // Antes si: se devolvia 'sin referencia' de inmediato. Eso tenia sentido
    // cuando el catalogo se armaba a mano, pero con el aprendizaje automatico
    // dejaba fuera justo a quien mas lo necesita — el que no tiene referencia
    // es el que tiene que juntar caras para armarla, y si nunca se le calcula
    // el vector nunca junta ninguna.
    //
    // Se sigue adelante para SACAR EL VECTOR. Mas abajo, sin referencia contra
    // que comparar, el veredicto queda en no-concluyente y no se rechaza a
    // nadie; lo unico que cambia es que la muestra se guarda.
    const sinReferencia = !referencia;

    // Se mide siempre; rechazar es otra cosa.
    //
    // Dos razones distintas para medir sin rechazar:
    //   - la referencia esta floja (pocas fotos o poca cohesion), o
    //   - la persona esta en su periodo de aprendizaje, todavia armando su
    //     referencia. Negarle seria castigarla por algo que el sistema aun no
    //     sabe de ella.
    // La segunda la decide la base con `rostro_puede_bloquear`, no la tableta:
    // asi vale igual aunque una tableta ande con codigo viejo, que ya paso.
    const confiable = !sinReferencia
                   && vrReferenciaConfiable(referencia, config)
                   && await vrFueraDeAprendizaje(empleadoId);
    if (!confiable) {
        console.log('🧬 Se mide pero no se rechaza a', empleadoId,
                    `(${referencia.fotos} fotos, cohesion ${referencia.cohesion})`);
    }

    // Si la persona esta esperando (BLOQUEA) hay un techo de tiempo; si no, se
    // deja terminar, porque ya nadie esta enfrente.
    const apurado = vrDetiene(config);
    const limite = apurado ? Date.now() + VR_PRESUPUESTO_MS : Infinity;
    const sinTiempo = () => Date.now() > limite;

    const malla = await vrMallaLista(apurado ? VR_PRESUPUESTO_MS : 30000);
    if (!malla) return sinConcluir('sin malla');
    if (sinTiempo()) return sinConcluir('se acabo el tiempo');

    // `foto` puede venir como lienzo (los pixeles ya listos) o como Blob. Lo
    // primero es lo que manda la tableta: descomprimir un JPEG que se acaba de
    // comprimir es trabajo de mas justo cuando alguien esta esperando.
    let imagen = null;
    let hayQueCerrarla = false;
    try {
        if (foto.width && foto.height) {
            imagen = foto;
        } else {
            imagen = await createImageBitmap(foto);
            hayQueCerrarla = true;
        }
        // Los puntos se buscan sobre una copia chica y se aplican a la foto
        // grande: la malla devuelve coordenadas de 0 a 1, no pixeles.
        const encontradas = malla.detect(vrParaLaMalla(imagen));
        const todas = (encontradas && encontradas.faceLandmarks) || [];
        if (!todas.length) return sinConcluir('sin cara en la foto');

        // Todas las caras del cuadro, en pixeles de la foto.
        const candidatos = todas
            .map(m => vrCincoPuntos(m.map(p => [p.x * imagen.width, p.y * imagen.height])))
            .filter(Boolean);
        if (!candidatos.length) return sinConcluir('malla incompleta');

        const cinco = vrElegirCara(candidatos, caja, imagen.width);
        if (!cinco) return sinConcluir('ninguna cara sirve');
        if (candidatos.length > 1) {
            console.log(`🧬 ${candidatos.length} caras en el cuadro; se midio la de ` +
                        `${Math.round(vrTamanoCara(cinco))} px entre ojos`);
        }
        if (sinTiempo()) return sinConcluir('se acabo el tiempo');

        const vector = await vrVectorDe(imagen, cinco, apurado ? limite - Date.now() : 30000);
        if (!vector) return sinConcluir('no se pudo medir');

        // La muestra se guarda ANTES de comparar, y a proposito: si se guardara
        // solo cuando coincide, la referencia se armaria unicamente con las
        // caras que ya se parecen a si misma y nunca aprenderia nada nuevo.
        // Quien decide cuales sirven es el cierre del periodo, que se queda con
        // el grupo mayoritario; aqui solo se junta material.
        vrGuardarMuestra(empleadoId, vector);

        if (sinReferencia) {
            // Nada contra que comparar todavia: esta juntando sus primeras
            // caras. No coincide ni deja de coincidir.
            return { coincide: null, concluyente: false, bloquea: false,
                     parecido: null, motivo: 'aprendiendo, aun sin referencia' };
        }

        const parecido = vrParecido(vector, referencia.vector);
        const veredicto = vrVeredicto(parecido, config, confiable);

        // Aunque se parezca al dueño del QR: si se parece MAS a alguno de los
        // pocos que se confunden con el, no es el dueño del QR.
        if (veredicto.coincide && confiable) {
            const mejor = vrMejorParecido(vector, await vrCargarParecidos(empleadoId));
            if (mejor && vrGanaUnParecido(parecido, mejor.parecido, config)) {
                console.warn(`🧬 Se parece mas a ${mejor.id} (${mejor.parecido.toFixed(3)}) ` +
                             `que al dueño del QR (${parecido.toFixed(3)})`);
                return {
                    coincide: false, concluyente: true,
                    bloquea: vrDetiene(config),
                    parecido, motivo: 'se parece mas a otro',
                    seParecemasA: mejor.id, parecidoDelOtro: mejor.parecido,
                };
            }
        }

        return { ...veredicto, parecido,
                 motivo: confiable ? 'comparado' : 'comparado con referencia floja' };
    } catch (e) {
        console.warn('🧬 Falló la verificación de rostro:', e);
        return sinConcluir('error');
    } finally {
        // Solo se cierra la que se creo aqui: el lienzo es del que llamo.
        if (hayQueCerrarla && imagen && imagen.close) imagen.close();
    }
}

// ¿HAY ALGUNA CARA EN ESTA FOTO?
//
// Se le pregunta solo a la malla: sin referencia, sin umbral, sin comparar con
// nadie. Es la pregunta de "¿había alguien?", no la de "¿quién era?".
//
// Por eso NO pasa por vrVerificar: esa se rinde antes de mirar la foto cuando
// la persona no tiene referencia, y entonces los 11 sin referencia se habrian
// quedado fuera de esta comprobacion —justo los que menos cubiertos estan.
//
// Devuelve true, false, o **null cuando no se pudo saber** (sin malla, error).
// null jamas debe costarle la checada a nadie: no saber no es lo mismo que no
// haber nadie.
async function vrHayCara(foto, presupuestoMs) {
    if (!foto) return null;
    const malla = await vrMallaLista(presupuestoMs || VR_PRESUPUESTO_MS);
    if (!malla) return null;

    let imagen = null;
    let hayQueCerrarla = false;
    try {
        if (foto.width && foto.height) {
            imagen = foto;
        } else {
            imagen = await createImageBitmap(foto);
            hayQueCerrarla = true;
        }
        const r = malla.detect(vrParaLaMalla(imagen));
        return !!(r && r.faceLandmarks && r.faceLandmarks.length);
    } catch (e) {
        console.warn('🧬 No se pudo mirar la foto:', e);
        return null;
    } finally {
        if (hayQueCerrarla && imagen && imagen.close) imagen.close();
    }
}

// Una copia reducida de la foto, para buscarle los puntos mas rapido. Si ya es
// chica se devuelve tal cual.
let _vrLienzoMalla = null;
function vrParaLaMalla(imagen) {
    if (imagen.width <= VR_ANCHO_MALLA) return imagen;
    if (!_vrLienzoMalla) _vrLienzoMalla = document.createElement('canvas');
    const escala = VR_ANCHO_MALLA / imagen.width;
    _vrLienzoMalla.width = VR_ANCHO_MALLA;
    _vrLienzoMalla.height = Math.round(imagen.height * escala);
    const ctx = _vrLienzoMalla.getContext('2d');
    ctx.drawImage(imagen, 0, 0, _vrLienzoMalla.width, _vrLienzoMalla.height);
    return _vrLienzoMalla;
}
