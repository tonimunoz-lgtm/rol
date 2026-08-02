// api/generar-partida.js
const https = require("https");

// Netegem espais en blanc que s'hagin pogut colar a les variables de Vercel
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : "";

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

  try {
    const partesToken = idToken.split(".");
    if (partesToken.length < 3) throw new Error("Formato de token JWT inválido");
  } catch (e) {
    console.error("Error validando la estructura del token:", e);
    res.status(401).json({ error: "Token inválido" });
    return;
  }

  const { configuracion } = req.body || {};
  if (!configuracion) {
    res.status(400).json({ error: "Falta 'configuracion'" });
    return;
  }

  const prompt = construirPrompt(configuracion);

  // Cos del JSON en el format exacte que demana l'API REST de Google
  const postData = JSON.stringify({
    contents: [
      {
        parts: [
          {
            text: prompt
          }
        ]
      }
    ]
  });

  try {
    // Executem la connexió utilitzant el mòdul blindat https passat a Promesa
    const textoCompleto = await new Promise((resolve, reject) => {
      const opciones = {
        // CORRECCIÓ DE XARXA: El hostname ha de ser ÚNICAMENT el domini net (sense https:// al davant)
        hostname: "generativelanguage.googleapis.com",
        port: 443,
        // Tota la resta de l'adreça i la clat tipus AQ. viatgen aquí
        path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData)
        }
      };

      const reqGoogle = https.request(opciones, (resGoogle) => {
        let cuerpo = "";
        resGoogle.on("data", (chunk) => { cuerpo += chunk; });
        resGoogle.on("end", () => {
          if (resGoogle.statusCode !== 200) {
            reject(new Error(`Google respondió con estado ${resGoogle.statusCode}: ${cuerpo.slice(0, 150)}`));
            return;
          }
          try {
            const geminiData = JSON.parse(cuerpo);
            
            // Extracció tradicional i ultra-segura sense operadors que puguin fallar a Node v18/20
            let texto = "";
            if (
              geminiData &&
              geminiData.candidates &&
              geminiData.candidates[0] &&
              geminiData.candidates[0].content &&
              geminiData.candidates[0].content.parts &&
              geminiData.candidates[0].content.parts[0]
            ) {
              texto = geminiData.candidates[0].content.parts[0].text || "";
            }
            resolve(texto);
          } catch (e) {
            reject(new Error("Error parseando el JSON de respuesta de Gemini"));
          }
        });
      });

      reqGoogle.on("error", (errorNet) => {
        // Captura qualsevol error de connexió físic o de DNS
        reject(errorNet);
      });

      // Enviem les dades i tanquem el flux de xarxa cap a Google
      reqGoogle.write(postData);
      reqGoogle.end();
    });

    if (!textoCompleto) {
      res.status(500).json({ error: "Gemini devolvió una respuesta de texto vacía" });
      return;
    }

    const { sinopsis, detalle } = separarSinopsisYDetalle(textoCompleto);
    res.status(200).json({ sinopsis, detalle });

  } catch (err) {
    console.error("Error en la conexión HTTPS a Gemini:", err.message);
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
