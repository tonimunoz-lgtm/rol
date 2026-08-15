// api/generar-imagen-reino.js
// Igual que api/generar-imagen.js (Flux vía Pollinations, gratis, sin
// clave → Vercel Blob) pero para el juego de Reinos: castillos, edificios
// y el mapa del mundo. Aquí NO exigimos cuenta registrada — en este juego
// no hay "master", cualquiera de los jugadores (con su sesión anónima)
// puede generar la imagen de su propio castillo.

const { put } = require("@vercel/blob");

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
    res.status(500).json({ error: `No se pudo verificar la sesión: ${e.message}` });
    return;
  }

  const { tipo, datos } = req.body || {};
  const { prompt, negativo } = construirPrompt(tipo, datos || {});
  if (!prompt) {
    res.status(400).json({ error: "Tipo de imagen no reconocido o faltan datos" });
    return;
  }

  const { width, height } = DIMENSIONES[tipo] || { width: 1024, height: 1024 };

  try {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    let url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=flux&width=${width}&height=${height}&nologo=true&seed=${seed}`;
    if (negativo) url += `&negative_prompt=${encodeURIComponent(negativo)}`;

    // Mismo motivo que en Rúnica: el nivel anónimo de Pollinations admite
    // solo 1 petición en cola por IP — reintentamos un par de veces si
    // llega un 429 pasajero, en vez de fallar a la primera.
    let imgResp;
    let intento = 0;
    while (true) {
      imgResp = await fetch(url);
      if (imgResp.ok || imgResp.status !== 429 || intento >= 2) break;
      intento++;
      await new Promise((r) => setTimeout(r, 3000 * intento));
    }

    if (!imgResp.ok) {
      const cuerpo = await imgResp.text().catch(() => "");
      res.status(500).json({
        error:
          imgResp.status === 429
            ? "Pollinations está saturado ahora mismo. Espera unos segundos y vuelve a intentarlo."
            : `Pollinations respondió ${imgResp.status}${cuerpo ? `: ${cuerpo.slice(0, 200)}` : ""}`,
      });
      return;
    }

    const arrayBuffer = await imgResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const tipoContenido = imgResp.headers.get("content-type") || "";
    if (!tipoContenido.startsWith("image/")) {
      res.status(500).json({ error: "Pollinations no devolvió una imagen." });
      return;
    }

    const carpeta = ["castillo", "edificio", "mapa-mundo", "unidad"].includes(tipo) ? tipo : "otros";
    const blob = await put(`reinos/${carpeta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`, buffer, {
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
  castillo: { width: 1024, height: 1024 },
  edificio: { width: 1024, height: 768 },
  unidad: { width: 768, height: 1024 },
  // Apaisado, nunca cuadrado — lección de Rúnica: el cuadrado empuja a
  // Flux hacia composiciones circulares/isla, pase lo que pase en el texto.
  "mapa-mundo": { width: 1536, height: 1024 },
};

const ESTILO_BASE =
  "hand-painted digital fantasy game art, medieval European setting, muted warm color grading, " +
  "atmospheric lighting, no text, no watermark, no logo, no UI elements";
const NEGATIVO_COMUN = "text, letters, words, captions, labels, watermark, logo, signature, blurry, low quality";

function construirPrompt(tipo, d) {
  if (tipo === "castillo") {
    const nivel = Number(d.nivel) || 1;
    const tamano =
      nivel <= 1
        ? "a small wooden motte-and-bailey fort, modest and simple"
        : nivel <= 3
          ? "a growing stone keep with a wooden palisade"
          : nivel <= 6
            ? "a proper stone castle with towers and a curtain wall"
            : "a grand, imposing fortress-castle with tall towers, multiple wall rings and banners";
    const prompt =
      `Isometric video game asset sprite of a medieval castle, ${tamano}. Single isolated building ` +
      `viewed from a 45-degree top-down isometric angle, in the visual style of a classic ` +
      `real-time-strategy city-builder game. Flat solid magenta background (#FF00FF), completely ` +
      `plain and uniform, no gradient, no texture, no ground, no grass, no sky, no scenery, no ` +
      `shadow cast beyond the object itself, no other buildings — just the castle sprite alone, ` +
      `clean readable silhouette, crisp edges, saturated warm painted game-art colors.`;
    const negativo =
      `photorealistic, photograph, landscape, sky, clouds, background scenery, grass, ground, ` +
      `terrain, multiple buildings, collage, people, village, gradient background, blurry, ${NEGATIVO_COMUN}`;
    return { prompt, negativo };
  }

  if (tipo === "edificio") {
    const nombre = d.nombre || "edificio medieval";
    const nivel = Number(d.nivel) || 1;
    const desarrollo = nivel <= 1 ? "small and humble" : nivel <= 3 ? "sturdy and functional" : "grand and well-developed";
    const prompt =
      `Isometric video game asset sprite of a medieval ${nombre}, level ${nivel} of development ` +
      `(${desarrollo}). Single isolated standalone building viewed from a 45-degree top-down ` +
      `isometric angle, in the visual style of a classic real-time-strategy city-builder game. ` +
      `Flat solid magenta background (#FF00FF), completely plain and uniform, no gradient, no ` +
      `texture, no ground, no grass, no sky, no scenery, no shadow cast beyond the object itself, ` +
      `no other buildings — just this one building sprite alone, clean readable silhouette, crisp ` +
      `edges, saturated warm painted game-art colors.`;
    const negativo =
      `photorealistic, photograph, landscape, sky, clouds, background scenery, grass, ground, ` +
      `terrain, multiple buildings, collage, castle, people, village, gradient background, blurry, ${NEGATIVO_COMUN}`;
    return { prompt, negativo };
  }

  if (tipo === "unidad") {
    const nombre = d.nombre || "soldado medieval";
    const prompt =
      `A medieval ${nombre}, full-body character concept art, standing pose, plain softly-lit ` +
      `background. ${ESTILO_BASE}, painterly concept art, single character, detailed armor/clothing.`;
    return { prompt, negativo: `multiple characters, crowd, text, ${NEGATIVO_COMUN}` };
  }

  if (tipo === "mapa-mundo") {
    const ambientacion = (d.descripcion || "").trim();
    const prompt =
      `Top-down flat illustrated board-game world map, in the style of a strategy board game like ` +
      `Risk or Catan. A continent filling the entire rectangular canvas edge to edge, divided into ` +
      `clearly visible distinct terrain regions: mountain ranges, forests, plains, rivers, ` +
      `coastlines along the edges. Vivid, clean, colorful flat illustration style, small distant ` +
      `castle and village landmarks scattered across the land` +
      (ambientacion ? `, thematically evoking: ${ambientacion}` : "") +
      `.`;
    const negativo =
      `circular composition, circle, disc, medallion, globe, round border, circular border, ` +
      `vignette, circular frame, porthole, mandala, radial symmetry, parchment scroll, aged paper ` +
      `texture, antique map, torn edges, mappa mundi, manuscript, island surrounded by water on ` +
      `all sides, realistic photograph, photorealistic, 3D render, aerial photograph, icons, ` +
      `symbols, compass rose, map legend, border frame, ${NEGATIVO_COMUN}`;
    return { prompt, negativo };
  }

  return { prompt: null };
}
