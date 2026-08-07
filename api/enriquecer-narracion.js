// api/enriquecer-narracion.js
// Función serverless de Vercel (gratis en el plan Hobby) que reescribe la
// narración de una escena del guion añadiendo detalle sensorial inmersivo
// (clima, luz, sonido, temperatura), sin tocar ninguna instrucción de
// mecánica de juego que el texto ya contenga (tiradas, dificultades, daño).
//
// Solo la puede usar un master con cuenta registrada (mismo patrón de
// verificación que api/generar-partida.js): no hace falta comprobar
// pertenencia a una partida concreta porque esto no lee ni escribe nada en
// Firestore, solo reescribe el texto que el propio master ya ha pegado.

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
      res.status(403).json({ error: "Solo un usuario registrado puede usar esta función" });
      return;
    }
  } catch (e) {
    res.status(500).json({ error: "No se pudo verificar la cuenta" });
    return;
  }

  const { texto, nombreEscena } = req.body || {};
  if (!texto || !texto.trim()) {
    res.status(400).json({ error: "Falta 'texto'" });
    return;
  }

  const prompt = `
Eres el asistente de un Master de rol de mesa con realidad aumentada. Reescribe la siguiente
narración de una escena${nombreEscena ? ` ("${nombreEscena}")` : ""}, añadiendo detalle sensorial
inmersivo: clima, temperatura, luz (de día, de noche, nublado...), sonidos o silencio, ambiente
general. NO cambies ni quites ninguna instrucción de mecánica de juego que el texto ya contenga
(tiradas, dificultades, daño, nombres de objetos o enemigos) — consérvala tal cual, integrada de
forma natural en la narración. Devuelve ÚNICAMENTE el texto final en español, sin comillas, sin
explicaciones adicionales, máximo 120 palabras.

Narración original:
"""
${texto.trim()}
"""
`.trim();

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
        max_tokens: 900,
        temperature: 0.8,
        // openai/gpt-oss-120b es un modelo "razonador": sin esto, puede
        // gastarse el presupuesto de tokens pensando y dejar el texto final
        // vacío. "low" reduce ese gasto interno para una tarea tan simple
        // como reescribir un párrafo.
        reasoning_effort: "low",
      }),
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      console.error("Error de Groq:", resp.status, errorBody);
      res.status(500).json({ error: `Groq respondió ${resp.status}` });
      return;
    }

    const data = await resp.json();
    let textoFinal = (data?.choices?.[0]?.message?.content || "").trim();
    textoFinal = textoFinal.replace(/^["“]|["”]$/g, "").trim();
    if (!textoFinal) {
      res.status(500).json({ error: "La IA no devolvió texto" });
      return;
    }
    res.status(200).json({ texto: textoFinal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Error generando la narración: ${err.message}` });
  }
}
