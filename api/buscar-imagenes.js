// api/buscar-imagenes.js
// Función serverless de Vercel (gratis en el plan Hobby). Busca fotos libres
// de derechos relacionadas con la ambientación de la partida, usando la API
// gratuita de Pexels (sin coste, con licencia de uso libre).
//
// Requiere la variable de entorno PEXELS_API_KEY en Vercel (gratis, se
// consigue en https://www.pexels.com/api/).

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;

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

  if (!PEXELS_API_KEY) {
    res.status(501).json({ error: "Búsqueda de imágenes no configurada (falta PEXELS_API_KEY en Vercel)" });
    return;
  }

  const { query } = req.body || {};
  if (!query) {
    res.status(400).json({ error: "Falta 'query'" });
    return;
  }

  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=12&orientation=portrait`;
    const pexelsResp = await fetch(url, {
      headers: { Authorization: PEXELS_API_KEY },
    });

    if (!pexelsResp.ok) {
      res.status(500).json({ error: `Pexels respondió ${pexelsResp.status}` });
      return;
    }

    const data = await pexelsResp.json();
    const imagenes = (data.photos || []).map((p) => ({
      url: p.src.large,
      autor: p.photographer,
      autorUrl: p.photographer_url,
    }));

    res.status(200).json({ imagenes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Error buscando imágenes: ${err.message}` });
  }
}
