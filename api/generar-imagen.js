// api/generar-imagen.js
// Función serverless de Vercel (gratis en el plan Hobby) que genera
// imágenes con IA usando Flux vía Pollinations y las sube a Vercel Blob,
// mismo almacén que ya usamos para vídeos/imágenes/música de marcadores.
//
// OJO — lección aprendida a base de probarlo: el endpoint NUEVO con clave
// (gen.pollinations.ai) descuenta contra un saldo "Pollen" de la cuenta,
// que en una cuenta nueva está a 0 → 402 Payment Required, aunque el
// modelo en sí (Flux) sea gratis. El camino que SÍ es gratis de verdad,
// sin cuenta ni clave, es el endpoint clásico "anónimo":
// https://image.pollinations.ai/prompt/{prompt} — así es como Pollinations
// ofrece Flux gratis e ilimitado de verdad (documentado así, con límite de
// uso razonable por IP, no por saldo). Por eso NO enviamos ninguna clave
// aquí — enviarla activaría el descuento de Pollen otra vez.
//
// Solo la puede usar un master con cuenta registrada (mismo patrón que
// api/generar-partida.js). No hace falta comprobar pertenencia a una
// partida concreta: esto no lee ni escribe nada en Firestore, solo genera
// una imagen y devuelve su URL — el propio master decide luego a qué
// partida/personaje/escena la asocia, desde el cliente.

const { put } = require("@vercel/blob");

const FIREBASE_API_KEY = "AIzaSyB86EI00VpSCPUGaa5qSLboyszS4o7Iskc";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "openai/gpt-oss-120b";

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
    const lookupData = await lookupResp.json();
    const usuario = lookupData.users?.[0];
    const esAnonimo = !usuario || (!usuario.email && !(usuario.providerUserInfo?.length));
    if (esAnonimo) {
      res.status(403).json({ error: "Solo un usuario registrado puede generar imágenes" });
      return;
    }
  } catch (e) {
    console.error("Error verificando el token:", e);
    res.status(500).json({ error: `No se pudo verificar la cuenta: ${e.message}` });
    return;
  }

  const { tipo, datos } = req.body || {};
  const { prompt, negativo } = await construirPrompt(tipo, datos || {});
  if (!prompt) {
    res.status(400).json({ error: "Tipo de imagen no reconocido o faltan datos" });
    return;
  }

  const { width, height } = DIMENSIONES[tipo] || { width: 1024, height: 1024 };

  try {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    let url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=flux&width=${width}&height=${height}&nologo=true&seed=${seed}`;
    // El prompt negativo es un parámetro de verdad, separado del prompt
    // principal — es la forma correcta de excluir cosas. Repetirlas dentro
    // del propio prompt (aunque sea como "NOT esto") es contraproducente:
    // el modelo no entiende bien la negación en el texto y a veces acaba
    // reforzando visualmente justo lo que se quería evitar.
    if (negativo) url += `&negative_prompt=${encodeURIComponent(negativo)}`;

    // El nivel anónimo de Pollinations solo admite 1 petición en cola a la
    // vez por IP — si dos generaciones se solapan (dos pestañas, o dos
    // clics seguidos), la segunda puede recibir un 429 pasajero. Lo
    // reintentamos solos un par de veces con espera, en vez de fallar a la
    // primera.
    let imgResp;
    let intento = 0;
    while (true) {
      imgResp = await fetch(url);
      if (imgResp.ok || imgResp.status !== 429 || intento >= 2) break;
      intento++;
      await new Promise((r) => setTimeout(r, 3000 * intento));
    }

    if (!imgResp.ok) {
      let cuerpo = "";
      try {
        cuerpo = (await imgResp.text()).slice(0, 300);
      } catch (_) {}
      console.error(`Pollinations respondió ${imgResp.status}:`, cuerpo);
      const mensaje =
        imgResp.status === 429
          ? "Pollinations está saturado ahora mismo (límite de la cola gratuita). Espera unos segundos y vuelve a intentarlo."
          : `Pollinations respondió ${imgResp.status}${cuerpo ? `: ${cuerpo}` : ""}`;
      res.status(500).json({ error: mensaje });
      return;
    }
    const arrayBuffer = await imgResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const tipoContenido = imgResp.headers.get("content-type") || "";
    if (!tipoContenido.startsWith("image/")) {
      const texto = buffer.toString("utf8").slice(0, 300);
      console.error("Pollinations no devolvió una imagen:", tipoContenido, texto);
      res.status(500).json({ error: `Pollinations no devolvió una imagen (${tipoContenido}): ${texto}` });
      return;
    }

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
  // Apaisado (1.5:1), no cuadrado — en las 4 pruebas anteriores, siempre
  // cuadrado, siempre ha salido algo circular por una razón u otra. Un
  // lienzo claramente rectangular deja mucho menos margen para que el
  // modelo "redondee" la composición.
  mapa: { width: 1536, height: 1024 },
  personaje: { width: 768, height: 1024 },
  // Vertical, pensado para la pantalla del móvil (donde se ve de verdad
  // esta imagen), no horizontal — antes salía recortada/deformada ahí.
  escena: { width: 832, height: 1472 },
  portada: { width: 832, height: 1472 },
};

const ESTILO_BASE =
  "hand-painted digital fantasy game art, muted warm parchment color grading, atmospheric lighting, " +
  "no text, no watermark, no logo, no UI elements, no borders, no frame";

// Flux entiende bastante peor el español que el inglés: si le pasamos la
// narración tal cual (en español, dentro de una instrucción en inglés),
// se le escapan detalles concretos (qué hay, qué se ve, qué pasa) y a
// veces mete elementos que no pedimos (como un personaje). Por eso primero
// le pedimos a Groq (gratis, ya lo usamos en el resto del proyecto) que
// destile la narración en una lista de elementos visuales concretos EN
// INGLÉS, pensada específicamente para un generador de imágenes — no una
// traducción literal, sino una descripción de lo que debería VERSE.
async function destilarNarracionParaImagen(narracion) {
  if (!GROQ_API_KEY) return null; // sin Groq configurado, seguimos sin este paso (ver fallback más abajo)
  const prompt = `
Traduce y destila la siguiente narración de una escena de rol de mesa en una descripción VISUAL
concreta en INGLÉS, pensada para un generador de imágenes de fondo de videojuego. Describe lo que
se vería en una imagen fija: el lugar, el clima, la luz, los elementos físicos concretos
(puentes, ríos, hielo, montañas, edificios, vegetación...), la hora del día y el ambiente. Si la
narración menciona explícitamente una criatura, monstruo o personaje presente en la escena (p.ej.
un guerrero fantasma, un PNJ, un enemigo), inclúyelo tal cual se describe — qué es, qué lleva, qué
hace. Si NO se menciona ninguna criatura o personaje, no inventes ninguno. Ignora las
instrucciones de mecánica de juego (tiradas, dificultad, daño) y las acciones de LOS JUGADORES
(a ellos no hay que dibujarlos: son quienes juegan, no lo que aparece en la imagen). Máximo 60
palabras, en inglés, sin explicaciones adicionales, sin comillas.

Narración: "${narracion}"
`.trim();

  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0.6,
        reasoning_effort: "low",
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const texto = (data?.choices?.[0]?.message?.content || "").trim().replace(/^["“]|["”]$/g, "");
    return texto || null;
  } catch (e) {
    console.warn("No se pudo destilar la narración con Groq (seguimos sin este paso):", e.message);
    return null;
  }
}

// Igual que destilarNarracionParaImagen, pero para el mapa: combina la
// sinopsis de la partida con la lista REAL de lugares que el master ha
// creado (nombres y tipos: montañas, ríos, bosques...), para que el
// terreno generado tenga relación de verdad con lo que hay en el mapa, no
// solo un paisaje de fantasía genérico.
async function destilarAmbientacionMapa(sinopsis, lugares) {
  if (!GROQ_API_KEY) return null;
  const listaLugares = (lugares || [])
    .map((l) => `${l.nombre} (${l.tipo})`)
    .join(", ");
  if (!sinopsis && !listaLugares) return null;

  const prompt = `
Vas a describir el TERRENO de un mapa de fantasía para un generador de imágenes, en INGLÉS.
Tienes la sinopsis de la historia y la lista real de lugares que existen en ese mapa (con su
tipo: pueblo, bosque, río, lago, montaña, ruinas, cueva, castillo, mar, pantano, camino).
Describe la COMPOSICIÓN GEOGRÁFICA general de un TERRITORIO AMPLIO (muchos kilómetros de
extensión, varias regiones distintas) que tendría sentido para esos lugares concretos — menciona
explícitamente los tipos de terreno que aparecen en la lista (si hay un río, dilo; si hay
montañas, dilo), repartidos por distintas zonas del mapa, no todos amontonados en un único cerro
o localización. Incluye el ambiente general (clima, vegetación, época del año) que sugiere la
sinopsis. IMPORTANTE: no describas ninguna composición circular, en forma de mandala, de anillo, ni
de "árbol del mundo" — el terreno debe estar disperso de forma natural por un paisaje rectangular
amplio, sin ninguna simetría radial. Si hay mar o costa en la lista de lugares, descríbela SIEMPRE
en inglés como "coastline" (nunca "sea" ni "ocean"), como un borde en UN lado del mapa, nunca
rodeando toda la tierra como si fuera una isla. No menciones nombres propios ni texto que deba
aparecer escrito en el mapa. Máximo 60 palabras, en inglés, sin explicaciones adicionales, sin
comillas.

Sinopsis: "${sinopsis || "(sin sinopsis)"}"
Lugares del mapa: ${listaLugares || "(sin lugares definidos todavía)"}
`.trim();

  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0.6,
        reasoning_effort: "low",
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const texto = (data?.choices?.[0]?.message?.content || "").trim().replace(/^["“]|["”]$/g, "");
    return texto || null;
  } catch (e) {
    console.warn("No se pudo destilar la ambientación del mapa (seguimos sin este paso):", e.message);
    return null;
  }
}

// Cosas que no queremos en NINGUNA imagen, van siempre en el prompt
// negativo (parámetro aparte), nunca repetidas dentro del prompt principal.
const NEGATIVO_COMUN = "text, letters, words, captions, labels, watermark, logo, signature, blurry, low quality";

async function construirPrompt(tipo, d) {
  if (tipo === "mapa") {
    // Solo terreno: nada de nombres, iconos ni fronteras — eso lo dibuja el
    // propio código encima, con precisión, a partir de los lugares reales.
    const destilado = await destilarAmbientacionMapa(d.sinopsis, d.lugares);
    const ambientacion = destilado || (d.descripcion || "").trim();
    const prompt =
      `Fantasy RPG world map poster, flat 2D top-down game map illustration. Several clearly ` +
      `SEPARATE regions spread across a wide landscape with open space between them: a mountain ` +
      `range confined to one area, a forest in another area, a river cutting through the land, a ` +
      `lake, ancient ruins, a stone bridge, a village. Hand-drawn ink linework and light ` +
      `watercolor wash on aged parchment background, filling the entire canvas edge to edge, ` +
      `old-world fantasy game map style` +
      (ambientacion ? `, thematically evoking: ${ambientacion}` : "") +
      `.`;
    const negativo =
      `circular composition, circle, disc, medallion, globe, round border, circular border, ` +
      `mappa mundi, manuscript, vignette, circular frame, porthole, mandala, radial symmetry, ` +
      `tree of life, island surrounded by water on all sides, realistic landscape painting, ` +
      `photographic, 3D depth, atmospheric perspective, dramatic scenic vista, single continuous ` +
      `mountain range filling the whole frame, detailed photorealistic terrain, drone photo, ` +
      `portrait photo, close-up, single building close-up, 3D render, isometric view, aerial ` +
      `photograph, photorealistic, icons, symbols, compass rose, map legend, border frame, ` +
      `${NEGATIVO_COMUN}`;
    return { prompt, negativo };
  }

  if (tipo === "personaje") {
    const { nombre, raza, clase, descripcion, rol } = d;
    const sujeto = [raza, clase || rol].filter(Boolean).join(" ") || "fantasy character";
    const encuadre = rol === "enemigo" ? "menacing three-quarter portrait, dramatic dark lighting" : "heroic three-quarter portrait";
    const prompt =
      `${encuadre} of a ${sujeto}${nombre ? ` named ${nombre}` : ""}. ${descripcion || ""} ` +
      `${ESTILO_BASE}, painterly concept art, single character, plain softly-lit background, ` +
      `waist-up framing, detailed costume and face.`;
    return { prompt, negativo: `multiple people, extra limbs, disfigured, ${NEGATIVO_COMUN}` };
  }

  if (tipo === "escena" || tipo === "portada") {
    const textoOriginal = (d.narracion || "").trim();
    if (!textoOriginal) return { prompt: null };

    const destilada = await destilarNarracionParaImagen(textoOriginal);
    const descripcionVisual = destilada || textoOriginal.slice(0, 400);

    const prompt =
      `Cinematic fantasy game ${tipo === "portada" ? "cover art / title screen" : "establishing-shot"} background art. Scene: ${descripcionVisual}. ` +
      `${ESTILO_BASE}, atmospheric depth, digital painting, dramatic lighting matching the mood ` +
      `described, vertical mobile-screen composition. Depict only what is explicitly described ` +
      `above.`;
    const negativo = `extra unmentioned people, generic adventurers, bystanders, crowd, ${NEGATIVO_COMUN}`;
    return { prompt, negativo };
  }

  return { prompt: null };
}
