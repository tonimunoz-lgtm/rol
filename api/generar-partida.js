// api/generar-partida.js
// Función serverless de Vercel (gratis en el plan Hobby).
//
// Usamos Groq en vez de Gemini: tier gratuito generoso, sin tarjeta, y una
// autenticación estándar (Authorization: Bearer) sin los líos de formato de
// clave que está teniendo Gemini ahora mismo (claves "AQ." rechazadas).
// La API de Groq es compatible con el formato de OpenAI (chat completions).
//
// Seguridad sin plan de pago ni cuentas de servicio:
// El master envía su ID Token de Firebase Auth. En vez de verificarlo con
// firebase-admin (que exigiría credenciales de cuenta de servicio), le
// pedimos directamente a Firestore (con ese mismo token, vía su API REST)
// que nos confirme si existe /masters/{uid}. Firestore ya valida el token
// por nosotros: si es falso o ha caducado, la petición fallará sola.

// Guarda esto en Vercel → Project Settings → Environment Variables,
// nunca hace falta escribirlo en el código ni en el repositorio.
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "openai/gpt-oss-120b";
const FIREBASE_PROJECT_ID = "femjoc";

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

  // Extraemos el uid del token SOLO para construir la ruta a comprobar.
  // No hace falta verificar la firma aquí: Firestore la verificará de
  // verdad al recibir este mismo token como Bearer en la petición REST.
  let uid;
  try {
    const payloadBase64 = idToken.split(".")[1];
    const payloadJson = Buffer.from(payloadBase64, "base64url").toString("utf8");
    uid = JSON.parse(payloadJson).sub;
    if (!uid) throw new Error("Token sin uid");
  } catch (e) {
    res.status(401).json({ error: "Token inválido" });
    return;
  }

  // Comprobación real de permisos: le pedimos a Firestore el documento
  // /masters/{uid} usando el token del que dice ser el master. Si el token
  // no es válido o no es ese uid, Firestore responderá con error y aquí
  // cortamos. Si el documento no existe, también cortamos.
  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/masters/${uid}`;
  try {
    const checkResp = await fetch(firestoreUrl, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!checkResp.ok) {
      res.status(403).json({ error: "Solo el master puede generar partidas" });
      return;
    }
  } catch (e) {
    res.status(500).json({ error: "No se pudo verificar el rol de master" });
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
    max_tokens: 8000,
    temperature: 0.7,
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
  "sinopsis": "4-6 párrafos con la trama general que el master debe conocer: contexto, conflicto central, qué está en juego y cómo empieza la sesión",
  "pnjs": [
    { "titulo": "Nombre del PNJ (raza/rol)", "texto": "Personalidad, motivación, secretos, cómo interactúa con los jugadores" }
  ],
  "pistas": [
    { "titulo": "Nombre corto de la pista", "texto": "Qué descubren los jugadores y cómo conecta con la trama" }
  ],
  "trampasEncuentros": [
    { "titulo": "Nombre del encuentro/trampa/enigma", "texto": "Descripción, mecánica sugerida y consecuencia de fallar o superarlo" }
  ],
  "giroFinal": "El giro o revelación final de la partida",
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

Genera exactamente ${c.numeroJugadores} personajes en "personajesSugeridos", variados entre sí
(clases y roles distintos, complementarios en combate/exploración/social), cada uno con 2-4
habilidades y 1-3 objetos de inventario inicial coherentes con la ambientación. El campo
"efecto.tipo" de los objetos debe ser uno de: "curar", "danio", "ninguno". Ajusta el número de
PNJs, pistas y trampasEncuentros según la duración y dificultad indicadas (una partida larga o
difícil necesita más contenido). Los atributos deben ir de 1 a 20. Escribe todo en español.
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
