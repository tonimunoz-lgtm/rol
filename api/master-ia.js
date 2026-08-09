// api/master-ia.js
// Función serverless de Vercel (gratis en el plan Hobby) que hace de
// "master suplente": responde en el momento a lo que escribe un jugador
// (preguntas sobre el entorno, intentos de acción...), con el contexto
// real de la partida (sinopsis, escena activa, ficha del personaje), y
// decide si lo que el jugador quiere hacer necesita una tirada — en ese
// caso, además del texto, devuelve los datos para que el cliente pueda
// montar esa tirada con el mismo sistema que ya usan las acciones del
// guion (mismo botón "Tirar", mismas resistencias, mismo daño).
//
// No da pistas de la trama que el master humano no haya escrito — solo
// responde con lo que ya existe en la escena/sinopsis, o con negativas/
// afirmaciones razonables ("no ves nada de eso aquí") cuando el jugador
// pregunta por algo que no está descrito.
//
// Vale cualquier sesión válida (incluida anónima: son jugadores en
// partida), solo comprobamos que el token sea real — igual que
// narrar-accion.js y enriquecer-narracion.js.

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "openai/gpt-oss-120b";
const FIREBASE_API_KEY = "AIzaSyB86EI00VpSCPUGaa5qSLboyszS4o7Iskc";

module.exports = async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    console.error("Error no controlado:", err);
    if (!res.headersSent) res.status(500).json({ error: `Error interno: ${err.message}` });
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
  try {
    const lookupResp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) }
    );
    if (!lookupResp.ok) {
      res.status(401).json({ error: "Token inválido o caducado" });
      return;
    }
  } catch (e) {
    res.status(500).json({ error: "No se pudo verificar el token" });
    return;
  }

  const { modo, mensaje, contexto } = req.body || {};
  if (!contexto) {
    res.status(400).json({ error: "Falta 'contexto'" });
    return;
  }

  const prompt = construirPrompt(modo, mensaje, contexto);
  if (!prompt) {
    res.status(400).json({ error: "Modo no reconocido" });
    return;
  }

  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500,
        temperature: 0.8,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      console.error("Error de Groq:", resp.status, errorBody);
      res.status(500).json({ error: `Groq respondió ${resp.status}` });
      return;
    }

    const data = await resp.json();
    const bruto = (data?.choices?.[0]?.message?.content || "").trim();
    let json;
    try {
      json = JSON.parse(bruto);
    } catch (e) {
      // Si el modelo no devolvió JSON válido, al menos no rompemos la
      // partida: lo tratamos como una respuesta narrativa simple.
      json = { respuesta: bruto || "El master no ha sabido qué responder a eso." };
    }

    res.status(200).json({
      respuesta: String(json.respuesta || "").slice(0, 500),
      requiereTirada: !!json.requiereTirada,
      atributo: ["fuerza", "destreza", "vigor", "inteligencia", "carisma"].includes(json.atributo) ? json.atributo : "destreza",
      dificultad: Number(json.dificultad) || 12,
      tipoDanio: ["fisico", "fuego", "hielo", "veneno", "mental"].includes(json.tipoDanio) ? json.tipoDanio : "fisico",
      danioDados: Math.min(4, Math.max(1, Number(json.danioDados) || 1)),
      danioCaras: [4, 6, 8, 10, 12, 20].includes(Number(json.danioCaras)) ? Number(json.danioCaras) : 6,
      etiqueta: String(json.etiqueta || "Intentarlo").slice(0, 40),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Error consultando al master IA: ${err.message}` });
  }
}

function construirPrompt(modo, mensaje, c) {
  const base = `
Eres el Master de una partida de rol de mesa con realidad aumentada, actuando como suplente del
master humano mientras juega. Tienes esta información real de la partida (no inventes nada fuera
de esto, y si te preguntan por algo que no está aquí descrito, responde con naturalidad que no ves
o no hay nada de eso, sin inventar contenido nuevo de la trama):

Sinopsis de la historia: "${c.sinopsis || "(sin sinopsis)"}"
Escena activa: "${c.escenaNombre || "(sin escena)"}"
Narración de la escena activa: "${c.escenaNarracion || "(sin narración)"}"
Objetivo de la escena: "${c.escenaObjetivo || "(no especificado)"}"
Personaje del jugador que te habla: ${c.personajeNombre || "un aventurero"}, ${c.personajeRaza || ""} ${c.personajeClase || ""}.
Atributos: fuerza ${c.atributos?.fuerza ?? 10}, destreza ${c.atributos?.destreza ?? 10}, vigor ${c.atributos?.vigor ?? 10}, inteligencia ${c.atributos?.inteligencia ?? 10}, carisma ${c.atributos?.carisma ?? 10}.
Habilidades del personaje: ${(c.habilidades || []).map((h) => h.nombre).join(", ") || "ninguna"}.
`.trim();

  if (modo === "pregunta") {
    return `
${base}

El jugador te dice o te pregunta lo siguiente: "${mensaje}"

Responde EN ESPAÑOL, en tono de master de rol de mesa: cercano, breve (2-4 frases), inmersivo,
sin salir del personaje de narrador. Reglas importantes:
- Si es una pregunta sobre el entorno (¿hay X cerca?, ¿veo Y?), respóndela con naturalidad
  basándote SOLO en la narración/objetivo de la escena que tienes arriba — si no se menciona,
  contesta que no, sin inventar pistas nuevas de la trama.
- Si el jugador describe una ACCIÓN que tendría sentido resolver con una tirada (buscar, forzar,
  trepar, convencer, esconderse, pelear, etc.), NO se la resuelvas tú narrando el resultado —
  en vez de eso, indica en tu respuesta que hace falta una tirada (di de qué atributo, de forma
  natural, p.ej. "eso requeriría algo de destreza") y marca "requiereTirada": true con los campos
  de la tirada rellenos. Si el atributo relevante del personaje es muy bajo (5 o menos) o la
  acción no encaja con ninguna habilidad razonable para este personaje, puedes sugerir en el
  texto que quizá otro compañero con más maña para eso lo intente, pero aun así deja
  "requiereTirada": true por si el jugador insiste.
- Si la acción no necesita tirada (hablar, mirar, moverse, algo trivial), respóndela
  narrativamente sin más, "requiereTirada": false.
- Nunca reveles secretos de la trama que no estén ya en la narración/objetivo de la escena.

Responde ÚNICAMENTE con un JSON con esta forma exacta, sin texto fuera del JSON:
{"respuesta": "...", "requiereTirada": true|false, "atributo": "destreza|fuerza|vigor|inteligencia|carisma", "dificultad": 12, "tipoDanio": "fisico|fuego|hielo|veneno|mental", "danioDados": 1, "danioCaras": 6, "etiqueta": "Buscar entre los matorrales"}
`.trim();
  }

  if (modo === "idle") {
    return `
${base}

El jugador lleva un rato sin hacer nada ni decir nada. Anímale con una frase breve (1-2 frases),
en tono cercano de master de mesa, sugiriéndole algo concreto que podría intentar dado el
contexto de la escena actual (sin resolvérselo, solo animarle a probar). No hace falta tirada
para esto: "requiereTirada" siempre false aquí.

Responde ÚNICAMENTE con un JSON: {"respuesta": "...", "requiereTirada": false}
`.trim();
  }

  return null;
}
