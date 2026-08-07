// api/subir-marcador.js
// Función serverless de Vercel (gratis en el plan Hobby) que recibe un
// archivo (targets.mind compilado, o un vídeo/imagen de marcador) desde el
// panel del master y lo sube a Vercel Blob (también gratis en el plan
// Hobby), para que cualquier usuario que se descargue la app pueda generar
// y alojar sus propios marcadores sin tocar GitHub ni Firebase Storage.
//
// Seguridad sin plan de pago ni cuentas de servicio (mismo patrón que
// api/generar-partida.js):
// 1. Verificamos el ID Token de Firebase Auth de verdad (firma incluida)
//    contra el propio servicio de Firebase Auth (accounts:lookup), así
//    sabemos con certeza el uid real y si la cuenta es anónima o no.
// 2. Comprobamos contra Firestore (con ese mismo token) que ese uid es
//    realmente el masterUid de la partida indicada.

const { put, del } = require("@vercel/blob");

// Misma apiKey pública que en js/firebase-config.js: es pública por diseño,
// solo sirve para identificar el proyecto ante Firebase, no da permisos por
// sí sola.
const FIREBASE_API_KEY = "AIzaSyB86EI00VpSCPUGaa5qSLboyszS4o7Iskc";
const FIREBASE_PROJECT_ID = "femjoc";

// Margen de seguridad bajo el límite real de tamaño de petición de las
// funciones serverless de Vercel (4.5MB en el plan Hobby).
const MAX_BYTES = 3 * 1024 * 1024;

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

  // 1. Verificamos el token de verdad (firma incluida) y si la cuenta es
  // anónima, usando el propio servicio de Firebase Auth.
  let uid;
  try {
    const lookupResp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!lookupResp.ok) {
      res.status(401).json({ error: "Token inválido o caducado" });
      return;
    }
    const lookupData = await lookupResp.json();
    const usuario = lookupData.users?.[0];
    const esAnonimo = !usuario || (!usuario.email && !(usuario.providerUserInfo?.length));
    if (esAnonimo) {
      res.status(403).json({ error: "Solo un usuario registrado (no anónimo) puede subir marcadores" });
      return;
    }
    uid = usuario.localId;
  } catch (e) {
    res.status(500).json({ error: "No se pudo verificar el token" });
    return;
  }

  const { partidaId, accion } = req.body || {};
  if (!partidaId) {
    res.status(400).json({ error: "Falta partidaId" });
    return;
  }

  // 2. Comprobamos que este usuario es realmente el master de ESA partida,
  // pidiéndole el documento a Firestore con su propio token.
  try {
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/partidas/${partidaId}`;
    const partidaResp = await fetch(firestoreUrl, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!partidaResp.ok) {
      res.status(403).json({ error: "No tienes acceso a esa partida" });
      return;
    }
    const partidaData = await partidaResp.json();
    const masterUid = partidaData.fields?.masterUid?.stringValue;
    if (masterUid !== uid) {
      res.status(403).json({ error: "No eres el master de esa partida" });
      return;
    }
  } catch (e) {
    res.status(500).json({ error: "No se pudo verificar la partida" });
    return;
  }

  // ---------- Borrar un archivo ya subido (control manual desde el panel) ----------
  if (accion === "borrar") {
    const { url } = req.body || {};
    if (!url) {
      res.status(400).json({ error: "Falta 'url'" });
      return;
    }
    try {
      await del(url);
      res.status(200).json({ borrado: true });
    } catch (err) {
      console.error("Error borrando el archivo:", err);
      res.status(500).json({ error: `No se pudo borrar: ${err.message}` });
    }
    return;
  }

  // ---------- Subir un archivo nuevo ----------
  const { tipo, filename, dataBase64, urlAnterior } = req.body || {};
  if (!filename || !dataBase64) {
    res.status(400).json({ error: "Faltan datos (filename o dataBase64)" });
    return;
  }

  const buffer = Buffer.from(dataBase64, "base64");
  if (buffer.length > MAX_BYTES) {
    res.status(413).json({
      error: `El archivo pesa ${(buffer.length / 1024 / 1024).toFixed(1)}MB; el máximo desde aquí es 4MB.`,
    });
    return;
  }

  const nombreSeguro = String(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
  const carpeta = ["targets", "video", "imagen", "audio"].includes(tipo) ? tipo : "otros";

  try {
    const blob = await put(`marcadores/${partidaId}/${carpeta}/${Date.now()}-${nombreSeguro}`, buffer, {
      access: "public",
      addRandomSuffix: false,
    });

    // Si esto sustituye a un archivo anterior (p.ej. recompilar el
    // targets.mind, o cambiar el vídeo de un marcador), borramos el
    // antiguo para no dejar basura acumulándose en el almacenamiento. Si
    // falla (por ejemplo, porque la "url anterior" no era en realidad un
    // archivo nuestro), no pasa nada — el archivo nuevo ya se subió bien.
    if (urlAnterior && urlAnterior.includes("blob.vercel-storage.com") && urlAnterior !== blob.url) {
      try {
        await del(urlAnterior);
      } catch (e) {
        console.warn("No se pudo borrar el archivo anterior (no crítico):", e.message);
      }
    }

    res.status(200).json({ url: blob.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Error subiendo el archivo: ${err.message}` });
  }
}
