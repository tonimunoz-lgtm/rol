// api/narrar-voz.js
// Función serverless de Vercel (gratis en el plan Hobby). Genera audio con
// ElevenLabs como alternativa opcional y más expresiva al Web Speech API del
// propio dispositivo. El jugador la activa manualmente desde el botón de
// voz — el tier gratuito de ElevenLabs tiene una cuota mensual de caracteres
// limitada, así que no se usa por defecto.
//
// Requiere la variable de entorno ELEVENLABS_API_KEY en Vercel. Si no está
// configurada, devolvemos 501 y el cliente cae automáticamente de vuelta a
// la voz del dispositivo (ver js/app.js, función hablarConIA).

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
// Voz multilingüe por defecto de ElevenLabs (sirve para español). Se puede
// sustituir por el ID de cualquier otra voz de tu cuenta de ElevenLabs.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

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

  if (!ELEVENLABS_API_KEY) {
    res.status(501).json({ error: "Voz IA no configurada (falta ELEVENLABS_API_KEY en Vercel)" });
    return;
  }

  const { texto } = req.body || {};
  if (!texto) {
    res.status(400).json({ error: "Falta 'texto'" });
    return;
  }

  // Recortamos por si acaso: la cuota gratuita de ElevenLabs se paga por
  // carácter, mejor no dejar que una narración gigante la agote de golpe.
  const textoRecortado = texto.slice(0, 800);

  try {
    const elevenResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text: textoRecortado,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!elevenResp.ok) {
      const errorBody = await elevenResp.text();
      console.error("Error de ElevenLabs:", elevenResp.status, errorBody);
      res.status(500).json({ error: `ElevenLabs respondió ${elevenResp.status}: ${errorBody.slice(0, 300)}` });
      return;
    }

    const audioBuffer = Buffer.from(await elevenResp.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.status(200).send(audioBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Error generando voz: ${err.message}` });
  }
}
