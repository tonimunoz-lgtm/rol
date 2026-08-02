// api/generar-partida.js
// Función serverless de Vercel (gratis en el plan Hobby). Sustituye a la
// Cloud Function de Firebase para no depender del plan Blaze.
//
// NOTA sobre la API key AQ.: Al estar ligadas a cuentas de servicio, Google exige 
// autenticación OAuth2. Generamos un JWT firmado usando 'crypto' nativo para 
// obtener el token de acceso oficial sin meter librerías de Google.

const crypto = require("crypto");

// Extraemos los datos necesarios si la variable viene en formato string plano o JSON
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

// Función auxiliar para obtener un Token de Acceso OAuth2 usando la clave AQ.
async function obtenerAccessToken(apiKeyRaw) {
  try {
    // Si tu GEMINI_API_KEY en Vercel es el JSON completo de la cuenta de servicio:
    const credentials = JSON.parse(apiKeyRaw);
    const clientEmail = credentials.client_email;
    const privateKey = credentials.private_key;

    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 3600; // 1 hora de validez

    // Payload estándar para solicitar acceso a las APIs de Google/Gemini
    const payload = {
      iss: clientEmail,
      sub: clientEmail,
      aud: "https://googleapis.com",
      iat: iat,
      exp: exp,
      scope: "https://googleapis.com",
    };

    const header = { alg: "RS256", typ: "JWT" };

    const base64UrlEncode = (obj) =>
      Buffer.from(JSON.stringify(obj))
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");

    const unsignedToken = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}`;
    
    // Firmamos el JWT de forma nativa con RSA-SHA256
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(unsignedToken);
    const signature = signer.sign(privateKey, "base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    const jwt = `${unsignedToken}.${signature}`;

    // Intercambiamos el JWT por un token de acceso federado
    const tokenResp = await fetch("https://googleapis.com", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      throw new Error(`Error de intercambio OAuth2: ${errText}`);
    }

    const tokenData = await tokenResp.json();
    return tokenData.access_token;
  } catch (e) {
    // Si no es un JSON y es una API key clásica (AIza), la devolvemos tal cual
    return null;
  }
}

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
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    
    const headers = { "Content-Type": "application/json" };
    
    // Intentamos resolver el token de cuenta de servicio (Claves nuevas AQ.)
    const accessToken = await obtenerAccessToken(GEMINI_API_KEY);
    
    if (accessToken) {
      // Si devolvió token, autenticamos vía OAuth2 (Formato AQ.)
      headers["Authorization"] = `Bearer ${accessToken}`;
    } else {
      // Si falló el parseo JSON, asume que es una clave clásica AIza vieja
      headers["x-goog-api-key"] = GEMINI_API_KEY;
    }

    const geminiResp = await fetch(geminiUrl, {
      method: "POST",
      headers: headers,
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
