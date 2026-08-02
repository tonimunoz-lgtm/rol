// api/generar-partida.js
// Función serverless de Vercel (gratis en el plan Hobby).
//
// NOTA sobre la API key AQ.: Google está migrando las claves de Gemini a formato "AQ.".
// Estas claves NO funcionan como parámetro ?key= en la URL, pero SÍ funcionan pasándolas
// en la cabecera HTTP `x-goog-api-key`. Quitamos la librería oficial y usamos fetch nativo.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.5-flash";
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

  // CORRECCIÓN: Extracción exacta del índice [1] del token JWT de Firebase
  let uid;
  try {
    const partesToken = idToken.split(".");
    if (partesToken.length < 2) throw new Error("Formato de token incorrecto");
    const payloadBase64 = partesToken[1]; // <--- Corregido índice aquí
    const payloadJson = Buffer.from(payloadBase64, "base64url").toString("utf8");
    uid = JSON.parse(payloadJson).sub;
    if (!uid) throw new Error("Token sin uid");
  } catch (e) {
    console.error("Error parseando el token de Firebase:", e);
    res.status(401).json({ error: "Token inválido" });
    return;
  }

  const firestoreUrl = `https://googleapis.com{FIREBASE_PROJECT_ID}/databases/(default)/documents/masters/${uid}`;
  try {
    const checkResp = await fetch(firestoreUrl, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!checkResp.ok) {
      const errText = await checkResp.text();
      console.error(`Firestore devolvió estado ${checkResp.status}:`, errText);
      res.status(403).json({ error: "Solo el master puede generar partidas" });
      return;
    }
  } catch (e) {
    console.error("Error de red/código al consultar Firestore:", e);
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
    const geminiUrl = `https://googleapis.com{GEMINI_MODEL}:generateContent`;
    
    const geminiResp = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY, 
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    if (!geminiResp.ok) {
      const errorBody = await geminiResp.text();
      console.error("Error de Gemini:", geminiResp.status, errorBody);
      res.status(500).json({ error: `Gemini respondió ${geminiResp.status}: ${errorBody.slice(0, 200)}` });
      return;
    }

    const geminiData = await geminiResp.json();
    
    // CORRECCIÓN: Acceso seguro estándar sin sintaxis inválida ?.?.
    const textoCompleto = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!textoCompleto) {
      res.status(500).json({ error: "Gemini no devolvió texto (posible bloqueo de seguridad)" });
      return;
    }

    const { sinopsis, detalle } = separarSinopsisYDetalle(textoCompleto);
    res.status(200).json({ sinopsis, detalle });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Error generando contenido con IA: ${err.message}` });
  }
}

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
