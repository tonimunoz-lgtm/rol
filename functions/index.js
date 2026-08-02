const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getAuth } = require("firebase-admin/auth");
const admin = require("firebase-admin");

admin.initializeApp();

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const GEMINI_API_KEY_FALLBACK = "AQ.Ab8RN6Ik5y1QQxNMd62UylPz7gYS9Qg2M7g0lNqyCW0mXCBKbg";

exports.generarPartida = onRequest(
  { secrets: [GEMINI_API_KEY], cors: true, region: "europe-west1" },
  async (req, res) => {
    
    // CORRECCIÓN DE SEGURETEDAD PARA EL CORS DIRECTO EN REPOSITORIO:
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Origin", "https://vercel.app");
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).send("Método no permitido");
    }

    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "Falta token de autenticación" });

    let decoded;
    try {
      decoded = await getAuth().verifyIdToken(idToken);
    } catch (e) {
      return res.status(401).json({ error: "Token inválido" });
    }

    const masterDoc = await admin.firestore().doc(`masters/${decoded.uid}`).get();
    if (!masterDoc.exists) {
      return res.status(403).json({ error: "Solo el master puede generar partidas" });
    }

    const { configuracion } = req.body;
    if (!configuracion) return res.status(400).json({ error: "Falta 'configuracion'" });

    const prompt = construirPrompt(configuracion);

    try {
      const apiKey = GEMINI_API_KEY.value() || GEMINI_API_KEY_FALLBACK;
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const result = await model.generateContent(prompt);
      const textoCompleto = result.response.text();

      const { sinopsis, detalle } = separarSinopsisYDetalle(textoCompleto);
      return res.status(200).json({ sinopsis, detalle });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Error generando contenido con IA" });
    }
  }
);

function construirPrompt(c) {
  return `
Eres el asistente de un Master de un juego de rol de mesa colaborativo con realidad aumentada.
Genera el contenido de una partida con estas características:

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

Responde EXACTAMENTE con este formato, sin nada más antes o después:

SINOPSIS:
(2-3 párrafos con la trama general que el master debe conocer)

DETALLE:
(lista de PNJs con su personalidad y motivación, lista de pistas que se descubrirán en marcadores AR,
2-3 encuentros o retos, y un posible giro final)
`.trim();
}

function separarSinopsisYDetalle(texto) {
  const idxDetalle = texto.indexOf("DETALLE:");
  if (idxDetalle === -1) return { sinopsis: texto.trim(), detalle: "" };
  const sinopsis = texto.slice(0, idxDetalle).replace("SINOPSIS:", "").trim();
  const detalle = texto.slice(idxDetalle).replace("DETALLE:", "").trim();
  return { sinopsis, detalle };
}
