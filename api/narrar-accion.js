// api/narrar-accion.js
// Función serverless de Vercel (gratis en el plan Hobby) que genera UNA
// frase corta de ambientación con IA para acompañar el aviso plano que ya
// ve todo el mundo al usar una habilidad o detectar una trampa (ese aviso
// plano se muestra al instante, sin esperar a esto). Usa pocos tokens
// (max_tokens bajo) porque solo pedimos una frase, y falla en silencio: si
// Groq no responde a tiempo o da error, sencillamente no aparece la frase
// extra, sin romper nada de la partida.

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "openai/gpt-oss-120b";
// Misma apiKey pública que en js/firebase-config.js.
const FIREBASE_API_KEY = "AIzaSyB86EI00VpSCPUGaa5qSLboyszS4o7Iskc";

module.exports = async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    console.error("Error no controlado:", err);
    // Es decorativo: preferimos devolver "sin frase" a romper la petición.
    if (!res.headersSent) res.status(200).json({ texto: "" });
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

  // Aquí vale cualquier sesión válida, incluida la anónima: quien pide esto
  // es un jugador dentro de una partida en curso, no hace falta ser master.
  // Solo comprobamos que el token sea real (firma incluida).
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
  } catch (e) {
    res.status(200).json({ texto: "" });
    return;
  }

  const { contexto } = req.body || {};
  if (!contexto) {
    res.status(400).json({ error: "Falta 'contexto'" });
    return;
  }

  const prompt = construirPrompt(contexto);
  if (!prompt) {
    res.status(200).json({ texto: "" });
    return;
  }

  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0.9,
        // Igual que en enriquecer-narracion.js: sin esto, el modelo puede
        // gastar el presupuesto de tokens "pensando" y devolver texto vacío.
        reasoning_effort: "low",
      }),
    });

    if (!resp.ok) {
      res.status(200).json({ texto: "" }); // decorativo: fallo silencioso
      return;
    }

    const data = await resp.json();
    let texto = (data?.choices?.[0]?.message?.content || "").trim();
    // Quitamos comillas envolventes si el modelo las añade pese a la instrucción.
    texto = texto.replace(/^["“]|["”]$/g, "").trim();
    res.status(200).json({ texto });
  } catch (err) {
    console.error(err);
    res.status(200).json({ texto: "" });
  }
}

function construirPrompt(c) {
  const base =
    "Eres el narrador de una partida de rol de mesa con ambientación fantástica. " +
    "Escribe UNA sola frase corta (máximo 20 palabras), inmersiva y evocadora, en español. " +
    "No uses comillas ni añadas nada más aparte de la frase.";

  if (c.tipo === "habilidad") {
    return `${base} Un personaje llamado "${c.personaje || "un aventurero"}" acaba de usar la habilidad "${
      c.habilidad || "una habilidad"
    }"${c.tirada != null ? ` (resultado de la tirada: ${c.tirada})` : ""}. Describe ese instante.`;
  }
  if (c.tipo === "deteccion") {
    return `${base} Un personaje llamado "${
      c.personaje || "un aventurero"
    }" acaba de intentar detectar trampas ocultas en la sala. Resultado: "${
      c.resultado || ""
    }". Describe ese instante sin repetir literalmente el resultado.`;
  }
  if (c.tipo === "prueba") {
    return `${base} Un personaje llamado "${c.personaje || "un aventurero"}" acaba de hacer una tirada de ${
      c.atributo || "habilidad"
    } ante un peligro físico del entorno (como cruzar algo inestable o esquivar un obstáculo). Resultado: "${
      c.resultado || ""
    }". Describe ese instante con tensión, sin repetir literalmente el resultado.`;
  }
  return null;
}
