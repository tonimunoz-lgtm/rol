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
// MODO IMPROVISACIÓN: cuando el cliente indica que la escena activa ya no
// tiene más salidas escritas por el master (fin del guion), se le permite
// además inventar una continuación breve, coherente con la sinopsis y el
// tono — e incluso desencadenar un combate con enemigos nuevos si encaja.
// Fuera de ese caso, sigue con la norma de siempre: nunca inventa trama
// nueva que el master humano no haya escrito.

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
        max_tokens: 650,
        temperature: 0.85,
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
      json = { respuesta: bruto || "El master no ha sabido qué responder a eso." };
    }

    const salida = {
      respuesta: String(json.respuesta || "").slice(0, 500),
      requiereTirada: !!json.requiereTirada,
      atributo: ["fuerza", "destreza", "vigor", "inteligencia", "carisma"].includes(json.atributo) ? json.atributo : "destreza",
      dificultad: Number(json.dificultad) || 12,
      tipoDanio: ["fisico", "fuego", "hielo", "veneno", "mental"].includes(json.tipoDanio) ? json.tipoDanio : "fisico",
      danioDados: Math.min(4, Math.max(1, Number(json.danioDados) || 1)),
      danioCaras: [4, 6, 8, 10, 12, 20].includes(Number(json.danioCaras)) ? Number(json.danioCaras) : 6,
      etiqueta: String(json.etiqueta || "Intentarlo").slice(0, 40),
    };

    // Solo relevante en modo improvisación (fin del guion escrito).
    if (json.continuacion) salida.continuacion = String(json.continuacion).slice(0, 500);
    if (json.combate && Array.isArray(json.combate.enemigos) && json.combate.enemigos.length > 0) {
      salida.combate = {
        razon: String(json.combate.razon || "").slice(0, 200),
        enemigos: json.combate.enemigos.slice(0, 4).map((e) => ({
          nombre: String(e.nombre || "Enemigo").slice(0, 40),
          vida: Math.min(60, Math.max(4, Number(e.vida) || 12)),
          tipoDanio: ["fisico", "fuego", "hielo", "veneno", "mental"].includes(e.tipoDanio) ? e.tipoDanio : "fisico",
          danioDados: Math.min(3, Math.max(1, Number(e.danioDados) || 1)),
          danioCaras: [4, 6, 8, 10].includes(Number(e.danioCaras)) ? Number(e.danioCaras) : 6,
        })),
      };
    }

    res.status(200).json(salida);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Error consultando al master IA: ${err.message}` });
  }
}

function construirPrompt(modo, mensaje, c) {
  const base = `
Eres el Master de una partida de rol de mesa con realidad aumentada, actuando como suplente del
master humano mientras juega. Tono: cercano, con chispa y algo de humor cuando el jugador dice
algo ocurrente o gracioso — sin dejar de ser un buen narrador. Tienes esta información real de la
partida:

Sinopsis de la historia: "${c.sinopsis || "(sin sinopsis)"}"
Escena activa: "${c.escenaNombre || "(sin escena)"}"
Narración de la escena activa: "${c.escenaNarracion || "(sin narración)"}"
Objetivo de la escena: "${c.escenaObjetivo || "(no especificado)"}"
Personaje del jugador que te habla: ${c.personajeNombre || "un aventurero"}, ${c.personajeRaza || ""} ${c.personajeClase || ""}.
Atributos: fuerza ${c.atributos?.fuerza ?? 10}, destreza ${c.atributos?.destreza ?? 10}, vigor ${c.atributos?.vigor ?? 10}, inteligencia ${c.atributos?.inteligencia ?? 10}, carisma ${c.atributos?.carisma ?? 10}.
Habilidades del personaje: ${(c.habilidades || []).map((h) => h.nombre).join(", ") || "ninguna"}.
`.trim();

  const reglasImprovisacion = c.finGuion
    ? `
IMPORTANTE — MODO IMPROVISACIÓN: el master humano no ha escrito más escenas después de esta (el
jugador ha llegado al final de lo que preparó, o quiere ir por un camino que no estaba previsto).
Tienes permiso, EXCEPCIONALMENTE, para inventar una continuación breve y coherente con la
sinopsis y el tono de la historia — como haría un master humano improvisando en mesa. Usa el
campo "continuacion" (2-4 frases) para narrar qué pasa a continuación. Si narrativamente encaja
que aparezca una amenaza (un depredador, unos bandidos, una criatura...), puedes desencadenar un
combate: rellena "combate" con 1-3 enemigos razonables para el tono de la historia (nombre, vida
entre 8 y 25, tipoDanio, danioDados 1-2, danioCaras entre 4 y 10) y una "razon" breve de por qué
aparecen. No abuses del combate — solo si tiene sentido dramático, no en cada respuesta.
`.trim()
    : `
No inventes contenido nuevo de la trama que el master humano no haya escrito: si preguntan por
algo que no está descrito en la narración/objetivo de arriba, responde con naturalidad que no ves
o no hay nada de eso. No rellenes "continuacion" ni "combate" — déjalos vacíos/ausentes.
`.trim();

  if (modo === "pregunta") {
    return `
${base}

${reglasImprovisacion}

El jugador te dice o te pregunta lo siguiente: "${mensaje}"

Responde EN ESPAÑOL, breve (2-4 frases), inmersivo, sin salir del personaje de narrador. Reglas:
- Si es una pregunta sobre el entorno (¿hay X cerca?, ¿veo Y?), respóndela con naturalidad
  basándote en la narración/objetivo de la escena.
- Si el jugador describe una ACCIÓN que tendría sentido resolver con una tirada (buscar, forzar,
  trepar, convencer, esconderse, pelear, etc.), NO se la resuelvas tú narrando el resultado —
  indica que hace falta una tirada (di de qué atributo, de forma natural) y marca
  "requiereTirada": true con los campos de la tirada rellenos. Si el atributo relevante del
  personaje es muy bajo (5 o menos), puedes sugerir que otro compañero lo intente, pero deja
  igualmente "requiereTirada": true por si insiste.
- Si la acción no necesita tirada (hablar, mirar, moverse, algo trivial), respóndela
  narrativamente sin más, "requiereTirada": false.

Responde ÚNICAMENTE con un JSON con esta forma exacta, sin texto fuera del JSON:
{"respuesta": "...", "requiereTirada": true|false, "atributo": "destreza|fuerza|vigor|inteligencia|carisma", "dificultad": 12, "tipoDanio": "fisico|fuego|hielo|veneno|mental", "danioDados": 1, "danioCaras": 6, "etiqueta": "Buscar entre los matorrales", "continuacion": "" , "combate": null}
`.trim();
  }

  if (modo === "idle") {
    return `
${base}

${reglasImprovisacion}

El jugador lleva un rato sin hacer nada ni decir nada. Anímale con una frase breve (1-2 frases),
en tono cercano y con chispa, sugiriéndole algo concreto que podría intentar dado el contexto de
la escena actual. No hace falta tirada para esto: "requiereTirada" siempre false. Solo usa
"continuacion"/"combate" si de verdad encaja animar con algo que ocurre, no lo fuerces.

Responde ÚNICAMENTE con un JSON: {"respuesta": "...", "requiereTirada": false, "continuacion": "", "combate": null}
`.trim();
  }

  return null;
}
