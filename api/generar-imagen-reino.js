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
      `A medieval castle, ${tamano}, seen from a three-quarter elevated angle, sitting on a hill ` +
      `surrounded by farmland and a small village outside the walls. ${ESTILO_BASE}, painterly ` +
      `concept art, single clear subject, daytime, no people in close-up.`;
    return { prompt, negativo: `multiple castles, collage, ${NEGATIVO_COMUN}` };
  }

  if (tipo === "edificio") {
    const nombre = d.nombre || "edificio medieval";
    const nivel = Number(d.nivel) || 1;
    const prompt =
      `A medieval ${nombre}, level ${nivel} of development (${nivel <= 1 ? "small and humble" : nivel <= 3 ? "sturdy and functional" : "grand and well-developed"}), ` +
      `standalone building within a castle's grounds, seen from a three-quarter angle. ${ESTILO_BASE}, ` +
      `painterly concept art, single clear building, daytime.`;
    return { prompt, negativo: `multiple buildings, collage, castle in background dominating the shot, ${NEGATIVO_COMUN}` };
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
      `Fantasy medieval world map poster, flat 2D top-down game map illustration. A wide continent ` +
      `spread across the canvas with open space between distinct regions: mountain ranges, forests, ` +
      `rivers, plains, coastlines along the edges, scattered kingdoms and castles as small distant ` +
      `landmarks. Hand-drawn ink linework and light watercolor wash on aged parchment, old-world ` +
      `fantasy strategy-game map style` +
      (ambientacion ? `, thematically evoking: ${ambientacion}` : "") +
      `.`;
    const negativo =
      `circular composition, circle, disc, medallion, globe, round border, circular border, ` +
      `vignette, circular frame, porthole, mandala, radial symmetry, island surrounded by water on ` +
      `all sides, realistic landscape painting, photographic, 3D depth, single continuous mountain ` +
      `range filling the whole frame, aerial photograph, photorealistic, icons, symbols, compass ` +
      `rose, map legend, border frame, ${NEGATIVO_COMUN}`;
    return { prompt, negativo };
  }

  return { prompt: null };
}
