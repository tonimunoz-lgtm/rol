// js/app.js — Vista del Jugador
import {
  auth, db,
  signInAnonymously, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, onSnapshot,
  collection, addDoc, serverTimestamp,
} from "./firebase-config.js";

const els = {
  playerName: document.getElementById("player-name-label"),
  hpPill: document.getElementById("stat-hp"),
  invPill: document.getElementById("stat-inventory"),
  narrationBox: document.getElementById("narration-box"),
  narrationText: document.getElementById("narration-text"),
  btnSpeak: document.getElementById("btn-speak"),
  btnDice: document.getElementById("btn-dice"),
  btnLogout: document.getElementById("btn-logout"),
  runeRing: document.getElementById("rune-ring"),
  scanningHint: document.getElementById("scanning-hint"),
  arContainer: document.getElementById("ar-scene-container"),
};

let currentPartidaId = localStorage.getItem("runica_partidaId") || null;
let currentJugadorId = localStorage.getItem("runica_jugadorId") || null;
let currentUid = null;

// ---------- 1. Autenticación anónima ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    await signInAnonymously(auth);
    return;
  }
  currentUid = user.uid;

  if (!currentPartidaId || !currentJugadorId) {
    showJoinScreen();
  } else {
    await bootGame();
  }
});

// ---------- 2. Pantalla de "unirse a partida" ----------
function showJoinScreen() {
  const overlay = document.createElement("div");
  overlay.id = "join-overlay";
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:50; background:var(--ink);
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    padding:2em; gap:1em; text-align:center;
  `;
  overlay.innerHTML = `
    <h1 class="display">Rúnica</h1>
    <p style="color:var(--parchment-dim)">Introduce el código que te ha dado el Master</p>
    <input id="join-code" placeholder="CÓDIGO DE PARTIDA" style="text-transform:uppercase; text-align:center; width:100%; max-width:280px;" />
    <input id="join-name" placeholder="Tu nombre de jugador" style="text-align:center; width:100%; max-width:280px;" />
    <button id="join-btn" class="primary">Entrar a la partida</button>
    <p id="join-error" style="color:var(--rust); font-size:.85rem;"></p>
  `;
  document.body.appendChild(overlay);

  document.getElementById("join-btn").addEventListener("click", async () => {
    const code = document.getElementById("join-code").value.trim().toUpperCase();
    const name = document.getElementById("join-name").value.trim();
    const errorEl = document.getElementById("join-error");
    if (!code || !name) {
      errorEl.textContent = "Rellena ambos campos.";
      return;
    }
    const partidaRef = doc(db, "partidas", code);
    const partidaSnap = await getDoc(partidaRef);
    if (!partidaSnap.exists()) {
      errorEl.textContent = "No existe ninguna partida con ese código.";
      return;
    }
    // Crear (o recuperar) al jugador dentro de la partida
    const jugadorRef = await addDoc(collection(db, "partidas", code, "jugadores"), {
      nombre: name,
      uid: currentUid,
      vida: 10,
      inventario: [],
      unidoEn: serverTimestamp(),
    });

    currentPartidaId = code;
    currentJugadorId = jugadorRef.id;
    localStorage.setItem("runica_partidaId", code);
    localStorage.setItem("runica_jugadorId", jugadorRef.id);

    overlay.remove();
    await bootGame();
  });
}

// ---------- 3. Arrancar la partida: ficha, marcadores AR, eventos en vivo ----------
async function bootGame() {
  const jugadorRef = doc(db, "partidas", currentPartidaId, "jugadores", currentJugadorId);

  // Ficha del jugador en tiempo real
  onSnapshot(jugadorRef, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    els.playerName.textContent = data.nombre;
    els.hpPill.textContent = `❤ ${data.vida}`;
    els.invPill.textContent = `🎒 ${(data.inventario || []).length}`;
  });

  // Eventos en vivo lanzados por el master (narración, alertas, combate...)
  const eventosRef = collection(db, "partidas", currentPartidaId, "eventos");
  onSnapshot(eventosRef, (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === "added") {
        const evento = change.doc.data();
        if (evento.tipo === "narracion") {
          mostrarNarracion(evento.texto);
        }
      }
    });
  });

  // Marcadores AR configurados por el master para esta partida
  const marcadoresSnap = await getDoc(doc(db, "partidas", currentPartidaId));
  const config = marcadoresSnap.data() || {};
  await construirEscenaAR(config.marcadoresTargetUrl || null);
}

// ---------- 4. Narración + lectura en voz alta (Web Speech API, gratis) ----------
function mostrarNarracion(texto) {
  els.narrationText.textContent = texto;
  els.narrationBox.classList.add("visible");
}

els.btnSpeak.addEventListener("click", () => {
  const texto = els.narrationText.textContent;
  if (!texto || !("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(texto);
  utter.lang = "es-ES";
  utter.rate = 0.95;
  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
});

// ---------- 5. Dados ----------
els.btnDice.addEventListener("click", async () => {
  const resultado = 1 + Math.floor(Math.random() * 20); // d20 por defecto
  els.btnDice.textContent = `🎲 ${resultado}`;
  await addDoc(collection(db, "partidas", currentPartidaId, "eventos"), {
    tipo: "tirada",
    jugadorId: currentJugadorId,
    resultado,
    timestamp: serverTimestamp(),
  });
  setTimeout(() => (els.btnDice.textContent = "🎲 Tirar dado"), 2500);
});

els.btnLogout.addEventListener("click", () => {
  localStorage.removeItem("runica_partidaId");
  localStorage.removeItem("runica_jugadorId");
  location.reload();
});

// ---------- 6. Escena AR (MindAR) construida dinámicamente ----------
// `targetsUrl` apunta al archivo .mind compilado por el master a partir de
// las fotos reales de la sala (se genera con el compilador online de MindAR
// y se sube a Firebase Storage; ver README > Fase 4).
async function construirEscenaAR(targetsUrl) {
  if (!targetsUrl) {
    els.scanningHint.textContent = "El Master aún no ha configurado los marcadores de esta sala.";
    return;
  }

  // Traemos la definición de cada marcador (a qué target .mind corresponde,
  // qué vídeo/imagen/pista dispara) para montar las entidades de A-Frame.
  const marcadoresCol = collection(db, "partidas", currentPartidaId, "marcadores");
  const marcadoresSnap = await getDoc(doc(db, "partidas", currentPartidaId)); // placeholder simple
  // NOTA: en la versión completa esto se sustituye por un onSnapshot sobre
  // marcadoresCol para poder añadir marcadores nuevos en caliente durante la partida.

  const sceneHtml = `
    <a-scene mindar-image="imageTargetSrc: ${targetsUrl}; autoStart: true; uiScanning: no; uiLoading: no;"
      color-space="sRGB" renderer="colorManagement: true, physicallyCorrectLights" vr-mode-ui="enabled: false"
      device-orientation-permission-ui="enabled: true">
      <a-assets></a-assets>
      <a-camera position="0 0 0" look-controls="enabled: false"></a-camera>
      <!-- Las entidades <a-entity mindar-image-target="targetIndex: N"> se
           insertan aquí por JS cuando cargamos los marcadores reales. -->
    </a-scene>
  `;
  els.arContainer.innerHTML = sceneHtml;

  const sceneEl = els.arContainer.querySelector("a-scene");
  sceneEl.addEventListener("targetFound", (e) => {
    els.runeRing.classList.add("active");
    els.scanningHint.style.display = "none";
  });
  sceneEl.addEventListener("targetLost", () => {
    els.runeRing.classList.remove("active");
    els.scanningHint.style.display = "block";
  });
}
