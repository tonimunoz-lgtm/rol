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
    const groqResp = await fetch(groqUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!groqResp.ok) {
      const errorBody = await groqResp.text();
      console.error("Error de Groq:", groqResp.status, errorBody);
      res.status(500).json({ error: `Groq respondió ${groqResp.status}: ${errorBody.slice(0, 200)}` });
      return;
    }

    const groqData = await groqResp.json();
    const textoCompleto = groqData?.choices?.[0]?.message?.content || "";
    if (!textoCompleto) {
      res.status(500).json({ error: "Groq no devolvió texto" });
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
