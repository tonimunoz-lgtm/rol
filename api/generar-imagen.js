// api/generar-imagen.js
// Función serverless de Vercel (gratis en el plan Hobby) que genera
// imágenes con IA usando Flux vía Pollinations (gratis e ilimitado con
// clave de servidor: https://pollinations.ai) y las sube a Vercel Blob,
// mismo almacén que ya usamos para vídeos/imágenes/música de marcadores.
//
// Solo la puede usar un master con cuenta registrada (mismo patrón que
// api/generar-partida.js). No hace falta comprobar pertenencia a una
// partida concreta: esto no lee ni escribe nada en Firestore, solo genera
// una imagen y devuelve su URL — el propio master decide luego a qué
// partida/personaje/escena la asocia, desde el cliente.

const { put } = require("@vercel/blob");

const POLLINATIONS_API_KEY = process.env.POLLINATIONS_API_KEY;
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
  if (!POLLINATIONS_API_KEY) {
    res.status(501).json({ error: "Generación de imágenes no configurada (falta POLLINATIONS_API_KEY en Vercel)" });
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
    const lookupData = await lookupResp.json();
    const usuario = lookupData.users?.[0];
    const esAnonimo = !usuario || (!usuario.email && !(usuario.providerUserInfo?.length));
    if (esAnonimo) {
      res.status(403).json({ error: "Solo un usuario registrado puede generar imágenes" });
      return;
    }
  } catch (e) {
    res.status(500).json({ error: "No se pudo verificar la cuenta" });
    return;
  }

  const { tipo, datos } = req.body || {};
  const prompt = construirPrompt(tipo, datos || {});
  if (!prompt) {
    res.status(400).json({ error: "Tipo de imagen no reconocido o faltan datos" });
    return;
  }

  const { width, height } = DIMENSIONES[tipo] || { width: 1024, height: 1024 };

  try {
    const url = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?model=flux&width=${width}&height=${height}&nologo=true&key=${POLLINATIONS_API_KEY}`;
    const imgResp = await fetch(url);
    if (!imgResp.ok) {
      res.status(500).json({ error: `Pollinations respondió ${imgResp.status}` });
      return;
    }
    const arrayBuffer = await imgResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const carpeta = ["mapa", "personaje", "escena"].includes(tipo) ? tipo : "otros";
    const blob = await put(`generadas/${carpeta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`, buffer, {
      access: "public",
      addRandomSuffix: false,
      contentType: "image/jpeg",
    });

    res.status(200).json({ url: blob.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Error generando la imagen: ${err.message}` });
  }
}

const DIMENSIONES = {
  mapa: { width: 1024, height: 1024 },
  personaje: { width: 768, height: 1024 },
  escena: { width: 1280, height: 768 },
};

const ESTILO_BASE =
  "hand-painted digital fantasy game art, muted warm parchment color grading, atmospheric lighting, " +
  "no text, no watermark, no logo, no UI elements, no borders, no frame";

function construirPrompt(tipo, d) {
  if (tipo === "mapa") {
    // Solo terreno: nada de nombres, iconos ni fronteras — eso lo dibuja el
    // propio código encima, con precisión, a partir de los lugares reales.
    const ambientacion = (d.descripcion || "").trim();
    return (
      `Hand-drawn fantasy RPG regional map, antique parchment, top-down illustrated cartography, ` +
      `highly detailed medieval fantasy map, subtle watercolor and ink textures, dense natural terrain, ` +
      `winding dirt roads, rivers, hills, forests, rocky mountains, atmospheric terrain shading, ` +
      `elegant old-world cartography, muted warm parchment colors` +
      (ambientacion ? `, thematically evoking: ${ambientacion}` : "") +
      `, designed as a video game world map background. ` +
      `No text, no labels, no icons, no borders, no UI, no compass, no symbols, no legend.`
    );
  }

  if (tipo === "personaje") {
    const { nombre, raza, clase, descripcion, rol } = d;
    const sujeto = [raza, clase || rol].filter(Boolean).join(" ") || "fantasy character";
    const encuadre = rol === "enemigo" ? "menacing three-quarter portrait, dramatic dark lighting" : "heroic three-quarter portrait";
    return (
      `${encuadre} of a ${sujeto}${nombre ? ` named ${nombre}` : ""}. ${descripcion || ""} ` +
      `${ESTILO_BASE}, painterly concept art, single character, plain softly-lit background, ` +
      `waist-up framing, detailed costume and face.`
    );
  }

  if (tipo === "escena") {
    const narracion = (d.narracion || "").slice(0, 500);
    if (!narracion.trim()) return null;
    return (
      `Cinematic fantasy game establishing-shot background art depicting this scene: "${narracion}". ` +
      `${ESTILO_BASE}, wide environmental shot, no characters in the foreground, moody atmospheric depth, ` +
      `digital painting, dramatic lighting matching the mood described.`
    );
  }

  return null;
}
