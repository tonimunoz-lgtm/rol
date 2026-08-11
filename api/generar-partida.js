// api/generar-partida.js
// Función serverless de Vercel (gratis en el plan Hobby).
//
// Usamos Groq en vez de Gemini: tier gratuito generoso, sin tarjeta, y una
// autenticación estándar (Authorization: Bearer) sin los líos de formato de
// clave que está teniendo Gemini ahora mismo (claves "AQ." rechazadas).
// La API de Groq es compatible con el formato de OpenAI (chat completions).
//
// Seguridad sin plan de pago ni cuentas de servicio:
// Cualquier usuario con cuenta registrada (no anónima) puede generar su
// propia partida — no hay un master único. El cliente envía su ID Token de
// Firebase Auth; en vez de verificarlo con firebase-admin (que exigiría
// credenciales de cuenta de servicio), lo verificamos de verdad (firma
// incluida) contra el propio servicio de Firebase Auth (accounts:lookup),
// y comprobamos que la cuenta no sea anónima.

// Guarda esto en Vercel → Project Settings → Environment Variables,
// nunca hace falta escribirlo en el código ni en el repositorio.
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "openai/gpt-oss-120b";
// Misma apiKey pública que en js/firebase-config.js.
const FIREBASE_API_KEY = "AIzaSyB86EI00VpSCPUGaa5qSLboyszS4o7Iskc";

module.exports = async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    console.error("Error no controlado:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: `Error interno: ${err.message}` });
    }
  }
};

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }

  const authHeader = req.headers["authorization"] || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) {
    res.status(401).json({ error: "Falta token de autenticación" });
    return;
  }

  // Verificación real del token (firma incluida) contra Firebase Auth, y
  // comprobación de que la cuenta no sea anónima (los jugadores entran de
  // forma anónima, así que quedan excluidos de poder generar partidas).
  try {
    const lookupResp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!lookupResp.ok) {
      res.status(401).json({ error: "Token inválido o caducado" });
      return;
    }
    const lookupData = await lookupResp.json();
    const usuario = lookupData.users?.[0];
    const esAnonimo = !usuario || (!usuario.email && !(usuario.providerUserInfo?.length));
    if (esAnonimo) {
      res.status(403).json({ error: "Solo un usuario registrado puede generar partidas" });
      return;
    }
  } catch (e) {
    res.status(500).json({ error: "No se pudo verificar la cuenta" });
    return;
  }

  const { configuracion } = req.body || {};
  if (!configuracion) {
    res.status(400).json({ error: "Falta 'configuracion'" });
    return;
  }

  const prompt = construirPrompt(configuracion);

  try {
    const groqUrl = "https://api.groq.com/openai/v1/chat/completions";
    let groqResp = await llamarGroq(groqUrl, prompt, true);

    // Si Groq no logra validar su propio modo JSON estricto, reintentamos una
    // vez sin exigirlo — usamos igualmente nuestro propio parseo tolerante.
    if (!groqResp.ok) {
      const errorBody = await groqResp.text();
      let esFalloDeJson = false;
      try {
        esFalloDeJson = JSON.parse(errorBody)?.error?.code === "json_validate_failed";
      } catch (_) {}

      if (esFalloDeJson) {
        groqResp = await llamarGroq(groqUrl, prompt, false);
      } else {
        console.error("Error de Groq:", groqResp.status, errorBody);
        res.status(500).json({ error: `Groq respondió ${groqResp.status}: ${errorBody.slice(0, 200)}` });
        return;
      }
    }

    if (!groqResp.ok) {
      const errorBody = await groqResp.text();
      console.error("Error de Groq (reintento):", groqResp.status, errorBody);
      res.status(500).json({ error: `Groq respondió ${groqResp.status}: ${errorBody.slice(0, 200)}` });
      return;
    }

    const groqData = await groqResp.json();
    const textoCompleto = groqData?.choices?.[0]?.message?.content || "";
    if (!textoCompleto) {
      res.status(500).json({ error: "Groq no devolvió texto" });
      return;
    }

    const partida = parsearJson(textoCompleto);
    if (!partida) {
      res.status(500).json({ error: "La IA no devolvió un JSON válido. Prueba a generar de nuevo." });
      return;
    }

    res.status(200).json(partida);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Error generando contenido con IA: ${err.message}` });
  }
}

function llamarGroq(url, prompt, forzarJson) {
  const body = {
    model: GROQ_MODEL,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 5200,
    temperature: 0.7,
    // Sin esto, el modelo puede gastar parte del presupuesto de tokens
    // "pensando" antes de escribir el JSON final, dejando menos margen del
    // que parece para el contenido real.
    reasoning_effort: "low",
  };
  if (forzarJson) body.response_format = { type: "json_object" };

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
}

function construirPrompt(c) {
  // Límite de personajes autogenerados para no exceder el presupuesto de
  // tokens del plan gratuito de Groq; si hay más jugadores, el master añade
  // el resto a mano desde "Personajes" (mismo editor, sin límite ahí).
  const numPersonajes = Math.min(Number(c.numeroJugadores) || 6, 8);

  return `
Eres el asistente de un Master de un juego de rol de mesa colaborativo con realidad aumentada,
ambientado con marcadores físicos repartidos por una sala. Genera una partida completa y rica
en detalle con estas características:

- Nombre: ${c.nombre}
- Duración: ${c.duracion}
- Dificultad: ${c.dificultad}
- Nivel de trampas/enigmas: ${c.trampas}
- Estilo narrativo: ${c.estilo}
- Tono: ${c.tono}
- Época: ${c.epoca}
- Lugar/ambientación: ${c.lugar}
- Tribus/razas/facciones: ${c.facciones}
- Número de jugadores: ${c.numeroJugadores}

Responde ÚNICAMENTE con un JSON válido (sin texto antes ni después, sin bloques de markdown),
con exactamente esta forma:

{
  "sinopsis": "3-4 párrafos con la trama general que el master debe conocer: contexto, conflicto central, qué está en juego y cómo empieza la sesión",
  "pnjs": [
    { "titulo": "Nombre del PNJ (raza/rol)", "texto": "Personalidad, motivación, secretos, cómo interactúa con los jugadores" }
  ],
  "pistas": [
    { "titulo": "Nombre corto de la pista", "texto": "Qué descubren los jugadores y cómo conecta con la trama" }
  ],
  "trampasEncuentros": [
    {
      "titulo": "Nombre del encuentro/trampa/enigma",
      "texto": "Descripción inmersiva: qué ven/sienten los jugadores, mecánica sugerida y consecuencia de fallar o superarlo",
      "requierePrueba": true,
      "atributoPrueba": "destreza",
      "dificultadPrueba": 12,
      "tipoDanioPrueba": "fisico",
      "danioDados": 2,
      "danioCaras": 6
    }
  ],
  "giroFinal": "El giro o revelación final de la partida",
  "enemigosSugeridos": [
    {
      "nombre": "Nombre del enemigo",
      "vida": 20,
      "tipoDanio": "fisico",
      "danioDados": 1,
      "danioCaras": 6,
      "descripcion": "1 frase: qué es y cómo ataca"
    }
  ],
  "mapa": {
    "descripcion": "1-2 frases de ambientación general del mapa (época, aspecto del terreno)",
    "lugares": [
      { "nombre": "Nombre del lugar", "tipo": "pueblo", "x": 20, "y": 30, "descripcion": "1 frase" }
    ],
    "conexiones": [[0, 1], [1, 2]]
  },
  "personajesSugeridos": [
    {
      "nombre": "Nombre del personaje jugable",
      "raza": "Raza o especie",
      "clase": "Clase o rol de combate/narrativo",
      "descripcion": "Trasfondo breve, 2-3 frases",
      "vidaBase": 10,
      "atributos": { "fuerza": 10, "destreza": 10, "vigor": 10, "inteligencia": 10, "carisma": 10 },
      "habilidades": [
        { "nombre": "Nombre de la habilidad", "tipo": "activa", "dado": "d20", "usosPorPartida": 3, "descripcion": "Efecto de la habilidad" }
      ],
      "inventarioInicial": [
        { "nombre": "Nombre del objeto", "cantidad": 1, "descripcion": "Qué es y para qué sirve", "efecto": { "tipo": "curar", "valor": 5 } }
      ]
    }
  ]
}

Genera entre 2 y 4 "enemigosSugeridos" coherentes con la ambientación (tipo de amenaza acorde a
la dificultad pedida), con vida proporcional a la dificultad general. "danioDados" (1-2) y
"danioCaras" (4, 6, 8 o 10) definen cuánto daño hace su ataque — más alto para enemigos más
peligrosos.

Para "mapa": genera entre 6 y 9 "lugares" que reflejen una geografía real y variada (no los
pongas en línea recta ni repartidos de forma uniforme). Incluye idealmente: 1-2 asentamientos
(pueblo/castillo/ruinas), al menos una cordillera (montana), al menos un bosque, y al menos una
masa de agua (rio, lago o mar) — el resto según encaje con la trama (puente, cueva, pantano,
camino). El campo "tipo" debe ser uno de: pueblo, bosque, rio, lago, puente, montana, ruinas,
cueva, castillo, mar, pantano, camino, otro. Dale a cada lugar un NOMBRE PROPIO evocador (p.ej.
"Cordillera de Fangbrok", "Río Helado", no solo "montaña" o "río"). Los campos "x" e "y" son
coordenadas de 0 a 100 que reflejen su posición relativa real según la trama: si hay un "mar",
ponlo pegado a uno de los bordes (x o y cerca de 0 o de 100); si un "rio" nace en una montaña y
desemboca en el mar/lago, coloca sus puntos en una trayectoria lógica entre ambos; agrupa lo que
narrativamente esté cerca y separa lo que esté lejos. "conexiones" es una lista de pares de
ÍNDICES (posición en el array "lugares", empezando en 0): conecta asentamientos entre sí con
caminos, y conecta el curso de los ríos/lagos entre montaña y mar siguiendo el orden narrativo
del recorrido de la partida.

Genera exactamente ${numPersonajes} personajes en "personajesSugeridos" (aunque se hayan pedido
${c.numeroJugadores} jugadores, limita los personajes generados a ${numPersonajes} para no
exceder el espacio de respuesta disponible), variados entre sí (clases y roles distintos,
complementarios en combate/exploración/social), cada uno con 2-3 habilidades y 1-2 objetos de
inventario inicial coherentes con la ambientación. El campo "efecto.tipo" de los objetos debe ser
uno de: "curar", "danio", "ninguno". Ajusta el número de PNJs (máximo 4), pistas (máximo 5) y
trampasEncuentros (máximo 4) según la duración y dificultad indicadas, sin excederte de esos
máximos. Los atributos deben ir de 1 a 20. Sé conciso en los textos (2-4 frases cada uno), pero
en "trampasEncuentros" describe también brevemente el ambiente físico (clima, luz, sonido) para
que la escena se sienta inmersiva, no solo la mecánica. Para cada trampasEncuentros, decide si
tiene sentido que exija una tirada de dado a los jugadores (la mayoría de trampas y muchos
encuentros la tienen): si es así, pon "requierePrueba": true y rellena "atributoPrueba" (uno de:
destreza, fuerza, inteligencia, vigor, carisma — el que mejor encaje), "dificultadPrueba" (10-16
según la dificultad general pedida), "tipoDanioPrueba" (uno de: fisico, fuego, hielo, veneno,
mental — el que mejor encaje con la descripción) y "danioDados"/"danioCaras" (p.ej. 2 y 6 para
2d6). Si el encuentro es puramente narrativo o social (hablar con un PNJ, encontrar una pista sin
peligro), pon "requierePrueba": false y deja los demás campos de mecánica con valores por defecto
razonables igualmente. Escribe todo en español.
`.trim();
}

function parsearJson(texto) {
  let limpio = texto.trim();
  // Por si el modelo envuelve la respuesta en bloques de markdown pese a la instrucción.
  limpio = limpio.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  try {
    return JSON.parse(limpio);
  } catch (e) {
    // Último intento: coger solo desde la primera { hasta la última }
    const inicio = limpio.indexOf("{");
    const fin = limpio.lastIndexOf("}");
    if (inicio === -1 || fin === -1) return null;
    try {
      return JSON.parse(limpio.slice(inicio, fin + 1));
    } catch (e2) {
      return null;
    }
  }
}
