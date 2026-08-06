// js/app.js — Vista del Jugador
import {
  auth, db,
  signInAnonymously, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, onSnapshot,
  collection, addDoc, serverTimestamp,
  query, where, getDocs,
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
  btnFicha: document.getElementById("btn-ficha"),
  btnCerrarFicha: document.getElementById("btn-cerrar-ficha"),
  fichaModal: document.getElementById("ficha-modal"),
  fichaNombre: document.getElementById("ficha-nombre"),
  fichaRazaClase: document.getElementById("ficha-raza-clase"),
  fichaAtributos: document.getElementById("ficha-atributos"),
  fichaHabilidades: document.getElementById("ficha-habilidades"),
  fichaRetrato: document.getElementById("ficha-retrato"),
  fichaInventario: document.getElementById("ficha-inventario"),
  btnImprimirFicha: document.getElementById("btn-imprimir-ficha"),
  btnAccion: document.getElementById("btn-accion"),
  accionModal: document.getElementById("accion-modal"),
  accionTexto: document.getElementById("accion-texto"),
  btnEnviarAccion: document.getElementById("btn-enviar-accion"),
  btnCerrarAccion: document.getElementById("btn-cerrar-accion"),
  combateBar: document.getElementById("combate-bar"),
  combateBarTexto: document.getElementById("combate-bar-texto"),
  btnToggleVoz: document.getElementById("btn-toggle-voz"),
  btnInspeccionar: document.getElementById("btn-inspeccionar"),
  inspeccionarModal: document.getElementById("inspeccionar-modal"),
  btnCerrarInspeccionar: document.getElementById("btn-cerrar-inspeccionar"),
  chatFeed: document.getElementById("chat-feed"),
  imagenesGrid: document.getElementById("imagenes-grid"),
};

let jugadorDataActual = null;

let jugadorRefActual = null;

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

    // ¿Ya tenías un personaje en esta partida (misma sesión anónima, p.ej.
    // tras pulsar "Salir" y volver a entrar)? Si es así, te reconectamos
    // directamente en vez de forzarte a elegir personaje otra vez.
    const jugadorExistenteQ = query(
      collection(db, "partidas", code, "jugadores"),
      where("uid", "==", currentUid)
    );
    const jugadorExistenteSnap = await getDocs(jugadorExistenteQ);
    if (!jugadorExistenteSnap.empty) {
      const jugadorDoc = jugadorExistenteSnap.docs[0];
      currentPartidaId = code;
      currentJugadorId = jugadorDoc.id;
      localStorage.setItem("runica_partidaId", code);
      localStorage.setItem("runica_jugadorId", jugadorDoc.id);
      overlay.remove();
      await bootGame();
      return;
    }

    await mostrarSeleccionPersonaje(overlay, code, name);
  });
}

// ---------- 2b. Selección de personaje (plantillas creadas por el master) ----------
async function mostrarSeleccionPersonaje(overlay, code, nombreJugador) {
  const plantillasSnap = await getDocs(collection(db, "partidas", code, "plantillasPersonaje"));
  if (plantillasSnap.empty) {
    overlay.innerHTML = `
      <h1 class="display">Rúnica</h1>
      <p style="color:var(--parchment-dim); max-width:320px;">
        El Master todavía no ha creado personajes para esta partida. Espera un momento y recarga la página.
      </p>
    `;
    return;
  }

  // Averiguamos qué personajes ya están asignados a otro jugador
  const jugadoresSnap = await getDocs(collection(db, "partidas", code, "jugadores"));
  const idsOcupados = new Set(jugadoresSnap.docs.map((d) => d.data().personajeId).filter(Boolean));

  overlay.innerHTML = `
    <h1 class="display" style="font-size:1.3rem;">Elige tu personaje</h1>
    <div id="personajes-grid" style="display:flex; flex-direction:column; gap:.8em; width:100%; max-width:420px; overflow-y:auto; max-height:60vh;"></div>
  `;
  const grid = overlay.querySelector("#personajes-grid");

  plantillasSnap.forEach((docSnap) => {
    const p = docSnap.data();
    const ocupado = idsOcupados.has(docSnap.id);
    const card = document.createElement("div");
    card.className = "card";
    card.style.textAlign = "left";
    card.innerHTML = `
      <div style="display:flex; gap:.8em; align-items:flex-start;">
        <div style="width:64px; height:64px; flex-shrink:0;">${generarAvatarSVG(p.raza, p.clase)}</div>
        <div>
          <strong class="display" style="font-size:1rem;">${p.nombre}</strong>
          <p class="mono" style="font-size:.75rem; color:var(--parchment-dim); margin:.3em 0;">${p.raza || ""} · ${p.clase || ""}</p>
        </div>
      </div>
      <p style="font-size:.85rem; margin-top:.5em;">${p.descripcion || ""}</p>
      <p style="font-size:.8rem;">❤ ${p.vidaBase} &nbsp; · &nbsp; ${(p.habilidades || []).length} habilidad(es)</p>
      <button class="btn-elegir-personaje ${ocupado ? "" : "primary"}" data-id="${docSnap.id}" ${ocupado ? "disabled" : ""} style="width:100%; margin-top:.6em;">
        ${ocupado ? "Ya elegido" : "Elegir este personaje"}
      </button>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll(".btn-elegir-personaje").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const plantillaId = btn.dataset.id;
      const plantillaSnap = plantillasSnap.docs.find((d) => d.id === plantillaId);
      const p = plantillaSnap.data();

      const habilidadesUsos = {};
      (p.habilidades || []).forEach((h, idx) => {
        habilidadesUsos[idx] = h.usosPorPartida > 0 ? h.usosPorPartida : -1; // -1 = ilimitado
      });

      const inventario = (p.inventarioInicial || []).map((o) => ({
        nombre: o.nombre,
        cantidad: o.cantidad ?? 1,
        descripcion: o.descripcion || "",
        efecto: o.efecto || { tipo: "ninguno", valor: 0 },
      }));

      const jugadorRef = await addDoc(collection(db, "partidas", code, "jugadores"), {
        nombre: nombreJugador,
        uid: currentUid,
        personajeId: plantillaId,
        nombrePersonaje: p.nombre,
        raza: p.raza || "",
        clase: p.clase || "",
        atributos: p.atributos || {},
        habilidades: p.habilidades || [],
        habilidadesUsos,
        vida: p.vidaBase,
        vidaMax: p.vidaBase,
        inventario,
        unidoEn: serverTimestamp(),
      });

      currentPartidaId = code;
      currentJugadorId = jugadorRef.id;
      localStorage.setItem("runica_partidaId", code);
      localStorage.setItem("runica_jugadorId", jugadorRef.id);

      overlay.remove();
      await bootGame();
    });
  });
}

// ---------- 3. Arrancar la partida: ficha, marcadores AR, eventos en vivo ----------
async function bootGame() {
  const jugadorRef = doc(db, "partidas", currentPartidaId, "jugadores", currentJugadorId);
  jugadorRefActual = jugadorRef;

  // Ficha del jugador en tiempo real
  onSnapshot(jugadorRef, (snap) => {
    if (!snap.exists()) {
      // El master ha reiniciado la partida (o borrado tu personaje): te
      // devolvemos a la pantalla de unión para que vuelvas a entrar.
      localStorage.removeItem("runica_partidaId");
      localStorage.removeItem("runica_jugadorId");
      location.reload();
      return;
    }
    const data = snap.data();
    jugadorDataActual = data;
    els.playerName.textContent = data.nombre;
    els.hpPill.textContent = `❤ ${data.vida}/${data.vidaMax ?? data.vida}`;
    els.invPill.textContent = `🎒 ${(data.inventario || []).length}`;
    renderFicha(data);
  });

  // Estado general de la partida en tiempo real: narraciones puntuales ya se
  // gestionan como eventos (abajo); el combate vive como campo del propio
  // documento de la partida para que todos vean el mismo turno a la vez.
  onSnapshot(doc(db, "partidas", currentPartidaId), (snap) => {
    if (!snap.exists()) return;
    renderCombateJugador(snap.data().combate);
  });

  // Eventos en vivo lanzados por el master o por otros jugadores
  const eventosRef = collection(db, "partidas", currentPartidaId, "eventos");
  onSnapshot(eventosRef, (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === "added") {
        const evento = change.doc.data();
        if (evento.tipo === "narracion") {
          mostrarNarracion(evento.texto);
        }
        if (["narracion", "chat_master", "accion"].includes(evento.tipo)) {
          añadirMensajeChat(evento);
        }
      }
    });
  });

  // Marcadores AR configurados por el master para esta partida
  const partidaSnap = await getDoc(doc(db, "partidas", currentPartidaId));
  const config = partidaSnap.data() || {};
  const marcadoresSnap = await getDocs(collection(db, "partidas", currentPartidaId, "marcadores"));
  const marcadores = marcadoresSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  await construirEscenaAR(config.marcadoresTargetUrl || null, marcadores);

  cargarImagenesAmbientacion(config.configuracion);
}

// ---------- 3b. Combate en pantalla ----------
function renderCombateJugador(combate) {
  if (!combate?.activo) {
    els.combateBar.classList.remove("visible", "mi-turno");
    return;
  }
  els.combateBar.classList.add("visible");
  const actual = combate.orden[combate.turnoActual];
  const esMiTurno = actual?.jugadorId === currentJugadorId;
  els.combateBar.classList.toggle("mi-turno", esMiTurno);
  els.combateBarTexto.textContent = esMiTurno
    ? `⚔️ ¡Es tu turno! (Ronda ${combate.ronda})`
    : `⚔️ Turno de ${actual?.nombre || "?"} (Ronda ${combate.ronda})`;
}

// ---------- 4. Narración + lectura en voz alta ----------
// Dos modos: "dispositivo" (Web Speech API, gratis e ilimitado, es el
// predeterminado) o "ia" (ElevenLabs, más expresiva pero con cuota gratuita
// limitada — el jugador la activa manualmente si quiere probarla).
let modoVoz = localStorage.getItem("runica_modo_voz") || "dispositivo";
actualizarIconoVoz();

els.btnToggleVoz.addEventListener("click", () => {
  modoVoz = modoVoz === "dispositivo" ? "ia" : "dispositivo";
  localStorage.setItem("runica_modo_voz", modoVoz);
  actualizarIconoVoz();
});

function actualizarIconoVoz() {
  els.btnToggleVoz.textContent = modoVoz === "ia" ? "🎙️" : "🔊";
  els.btnToggleVoz.title = modoVoz === "ia" ? "Voz IA (ElevenLabs) — toca para volver a la del dispositivo" : "Voz del dispositivo — toca para probar la voz IA";
}

function mostrarNarracion(texto) {
  els.narrationText.textContent = texto;
  els.narrationBox.classList.add("visible");
  hablar(texto);
}

let vocesDisponibles = [];
if ("speechSynthesis" in window) {
  const cargarVoces = () => (vocesDisponibles = speechSynthesis.getVoices());
  cargarVoces();
  speechSynthesis.onvoiceschanged = cargarVoces;
}

function mejorVozEspanola() {
  if (vocesDisponibles.length === 0) return null;
  return (
    vocesDisponibles.find((v) => v.lang === "es-ES") ||
    vocesDisponibles.find((v) => v.lang?.startsWith("es")) ||
    null
  );
}

function hablarConDispositivo(texto) {
  if (!texto || !("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(texto);
  const voz = mejorVozEspanola();
  if (voz) utter.voice = voz;
  utter.lang = voz?.lang || "es-ES";
  utter.rate = 0.95;
  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
}

let audioIAActual = null;
async function hablarConIA(texto) {
  try {
    const resp = await fetch("/api/narrar-voz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
    });
    if (!resp.ok) throw new Error("Voz IA no disponible");
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    if (audioIAActual) audioIAActual.pause();
    audioIAActual = new Audio(url);
    audioIAActual.play();
  } catch (e) {
    console.warn("Voz IA falló, uso la del dispositivo:", e.message);
    hablarConDispositivo(texto);
  }
}

function hablar(texto) {
  if (!texto) return;
  if (modoVoz === "ia") {
    hablarConIA(texto);
  } else {
    hablarConDispositivo(texto);
  }
}

els.btnSpeak.addEventListener("click", () => hablar(els.narrationText.textContent));

// ---------- 4b. Ficha de personaje: atributos y habilidades ----------
els.btnFicha.addEventListener("click", () => els.fichaModal.classList.add("visible"));
els.btnCerrarFicha.addEventListener("click", () => els.fichaModal.classList.remove("visible"));

const NOMBRES_ATRIBUTOS = {
  fuerza: "FUE", destreza: "DES", vigor: "VIG", inteligencia: "INT", carisma: "CAR",
};

function renderFicha(data) {
  els.fichaNombre.textContent = data.nombrePersonaje || data.nombre;
  els.fichaRazaClase.textContent = [data.raza, data.clase].filter(Boolean).join(" · ");
  els.fichaRetrato.innerHTML = `<div style="width:120px; height:120px; margin:0 auto .8em;">${generarAvatarSVG(data.raza, data.clase)}</div>`;

  const atributos = data.atributos || {};
  els.fichaAtributos.innerHTML = Object.entries(NOMBRES_ATRIBUTOS)
    .map(
      ([key, label]) => `
      <div class="atributo-pill">
        ${atributos[key] ?? "—"}
        <span>${label}</span>
      </div>`
    )
    .join("");

  const habilidades = data.habilidades || [];
  const usos = data.habilidadesUsos || {};
  els.fichaHabilidades.innerHTML = "";

  if (habilidades.length === 0) {
    els.fichaHabilidades.innerHTML = `<p style="color:var(--parchment-dim); font-size:.85rem;">Este personaje no tiene habilidades especiales.</p>`;
    return;
  }

  habilidades.forEach((h, idx) => {
    const restantes = usos[idx];
    const ilimitada = restantes === -1;
    const agotada = !ilimitada && restantes <= 0;
    const etiquetaUsos = ilimitada ? "∞" : `${restantes} uso(s)`;

    const card = document.createElement("div");
    card.className = "habilidad-card";
    card.innerHTML = `
      <div class="h-info">
        <div class="h-nombre">${h.nombre} ${h.dado !== "ninguno" ? `<span class="mono" style="color:var(--parchment-dim);">(${h.dado})</span>` : ""}</div>
        <p class="h-desc">${h.descripcion || ""}</p>
      </div>
      <div style="text-align:right;">
        <div class="h-usos mono">${h.tipo === "pasiva" ? "Pasiva" : etiquetaUsos}</div>
        ${h.tipo === "activa" ? `<button class="btn-usar-habilidad" data-idx="${idx}" ${agotada ? "disabled" : ""} style="margin-top:.4em; font-size:.75rem;">Usar</button>` : ""}
      </div>
    `;
    els.fichaHabilidades.appendChild(card);
  });

  els.fichaHabilidades.querySelectorAll(".btn-usar-habilidad").forEach((btn) => {
    btn.addEventListener("click", () => usarHabilidad(Number(btn.dataset.idx), data));
  });

  renderInventario(data);
}

function renderInventario(data) {
  const inventario = data.inventario || [];
  els.fichaInventario.innerHTML = "";

  if (inventario.length === 0) {
    els.fichaInventario.innerHTML = `<p style="color:var(--parchment-dim); font-size:.85rem;">Mochila vacía.</p>`;
    return;
  }

  inventario.forEach((obj, idx) => {
    const card = document.createElement("div");
    card.className = "habilidad-card";
    card.innerHTML = `
      <div class="h-info">
        <div class="h-nombre">${obj.nombre}</div>
        <p class="h-desc">${obj.descripcion || ""}</p>
      </div>
      <div style="text-align:right;">
        <div class="h-usos mono">x${obj.cantidad}</div>
        <button class="btn-usar-objeto" data-idx="${idx}" style="margin-top:.4em; font-size:.75rem;">Usar</button>
      </div>
    `;
    els.fichaInventario.appendChild(card);
  });

  els.fichaInventario.querySelectorAll(".btn-usar-objeto").forEach((btn) => {
    btn.addEventListener("click", () => usarObjeto(Number(btn.dataset.idx), data));
  });
}

async function usarObjeto(idx, data) {
  const inventario = [...(data.inventario || [])];
  const objeto = inventario[idx];
  if (!objeto) return;

  let nuevaVida = data.vida;
  if (objeto.efecto?.tipo === "curar") {
    nuevaVida = Math.min(data.vidaMax ?? data.vida, data.vida + Number(objeto.efecto.valor || 0));
  } else if (objeto.efecto?.tipo === "danio") {
    nuevaVida = Math.max(0, data.vida - Number(objeto.efecto.valor || 0));
  }

  if (objeto.cantidad > 1) {
    inventario[idx] = { ...objeto, cantidad: objeto.cantidad - 1 };
  } else {
    inventario.splice(idx, 1);
  }

  await updateDoc(jugadorRefActual, { inventario, vida: nuevaVida });

  await addDoc(collection(db, "partidas", currentPartidaId, "eventos"), {
    tipo: "objeto",
    jugadorId: currentJugadorId,
    nombreJugador: data.nombre,
    objeto: objeto.nombre,
    timestamp: serverTimestamp(),
  });
}

async function usarHabilidad(idx, data) {
  const habilidad = (data.habilidades || [])[idx];
  if (!habilidad) return;
  const usosActuales = data.habilidadesUsos || {};
  const restantes = usosActuales[idx];

  let tirada = null;
  if (habilidad.dado && habilidad.dado !== "ninguno") {
    const caras = Number(habilidad.dado.replace("d", ""));
    tirada = 1 + Math.floor(Math.random() * caras);
  }

  const nuevosUsos = { ...usosActuales };
  if (restantes !== -1) nuevosUsos[idx] = Math.max(0, restantes - 1);

  await updateDoc(jugadorRefActual, { habilidadesUsos: nuevosUsos });

  await addDoc(collection(db, "partidas", currentPartidaId, "eventos"), {
    tipo: "habilidad",
    jugadorId: currentJugadorId,
    nombreJugador: data.nombre,
    habilidad: habilidad.nombre,
    tirada,
    timestamp: serverTimestamp(),
  });
}

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

// ---------- 5b. Enviar acción libre al master ----------
els.btnAccion.addEventListener("click", () => els.accionModal.classList.add("visible"));
els.btnCerrarAccion.addEventListener("click", () => els.accionModal.classList.remove("visible"));

els.btnEnviarAccion.addEventListener("click", async () => {
  const texto = els.accionTexto.value.trim();
  if (!texto) return;
  await addDoc(collection(db, "partidas", currentPartidaId, "eventos"), {
    tipo: "accion",
    jugadorId: currentJugadorId,
    nombreJugador: els.playerName.textContent,
    nombrePersonaje: jugadorDataActual?.nombrePersonaje || "",
    texto,
    timestamp: serverTimestamp(),
  });
  els.accionTexto.value = "";
  els.accionModal.classList.remove("visible");
});

// ---------- 5c. Imprimir ficha ----------
els.btnImprimirFicha.addEventListener("click", () => window.print());

// ---------- 5d. Retrato ilustrado (SVG estilizado, sin coste de IA de imagen) ----------
// No generamos una imagen fotorrealista (necesitaría una API de pago); en su
// lugar componemos una silueta con un icono según la clase y una paleta de
// color derivada del nombre, coherente con el estilo rúnico del juego.
const ICONOS_CLASE = [
  { match: /guerr|warrior|combat/i, icono: "⚔️" },
  { match: /mag|hechic|brujo|arcano/i, icono: "🔮" },
  { match: /arque|caza|explorador/i, icono: "🏹" },
  { match: /ladr|pícaro|picaro|sigilo/i, icono: "🗡️" },
  { match: /clérig|clerigo|sacerdot|sanador/i, icono: "✨" },
  { match: /bard|trovador/i, icono: "🎵" },
];

function iconoParaClase(clase) {
  const encontrado = ICONOS_CLASE.find((c) => c.match.test(clase || ""));
  return encontrado ? encontrado.icono : "🛡️";
}

function colorDesdeTexto(texto) {
  let hash = 0;
  for (let i = 0; i < (texto || "").length; i++) hash = texto.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 45%, 32%)`;
}

function generarAvatarSVG(raza, clase) {
  const color = colorDesdeTexto(`${raza}${clase}`);
  const icono = iconoParaClase(clase);
  return `
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%; height:100%;">
      <circle cx="50" cy="50" r="48" fill="${color}" stroke="#C9A227" stroke-width="2.5" />
      <circle cx="50" cy="50" r="40" fill="none" stroke="#C9A227" stroke-width="1" opacity="0.4" />
      <text x="50" y="62" text-anchor="middle" font-size="38">${icono}</text>
    </svg>
  `;
}

// ---------- 5e. Panel "Inspeccionar": chat + imágenes ----------
els.btnInspeccionar.addEventListener("click", () => els.inspeccionarModal.classList.add("visible"));

els.btnCerrarInspeccionar.addEventListener("click", () => {
  els.inspeccionarModal.classList.remove("visible");
  // "Cerrar y silenciar": corta cualquier narración que estuviera sonando.
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  if (audioIAActual) audioIAActual.pause();
});

document.querySelectorAll(".insp-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".insp-tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".insp-tab-content").forEach((c) => (c.style.display = "none"));
    btn.classList.add("active");
    document.getElementById(`insp-tab-${btn.dataset.tab}`).style.display = "block";
  });
});

function añadirMensajeChat(evento) {
  const div = document.createElement("div");
  let autor = "Jugador";
  let colorBorde = "var(--amber)";
  let claseExtra = "";

  if (evento.tipo === "chat_master") {
    autor = "🎙️ Master";
    claseExtra = "chat-master";
  } else if (evento.tipo === "narracion") {
    autor = "📖 Narración";
    claseExtra = "chat-narracion";
  } else {
    autor = evento.nombrePersonaje || evento.nombreJugador || "Jugador";
    colorBorde = colorDesdeTexto(autor);
  }

  div.className = `chat-msg ${claseExtra}`;
  if (!claseExtra) div.style.borderLeftColor = colorBorde;
  div.innerHTML = `<div class="chat-autor" style="color:${claseExtra ? "var(--amber)" : colorBorde};">${autor}</div><div class="chat-texto">${evento.texto}</div>`;
  els.chatFeed.appendChild(div);
  els.chatFeed.scrollTop = els.chatFeed.scrollHeight;
}

// ---------- 5f. Imágenes de ambientación (Pexels, libres de derechos) ----------
async function cargarImagenesAmbientacion(configuracion) {
  if (!configuracion) return;
  const query = [configuracion.lugar, configuracion.estilo, configuracion.epoca].filter(Boolean).join(" ");
  if (!query) return;

  try {
    const resp = await fetch("/api/buscar-imagenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!resp.ok) return;
    const { imagenes } = await resp.json();
    els.imagenesGrid.innerHTML = (imagenes || [])
      .map((img) => `<img src="${img.url}" alt="" loading="lazy" title="Foto de ${img.autor} en Pexels" />`)
      .join("");
  } catch (e) {
    console.warn("No se pudieron cargar imágenes de ambientación:", e.message);
  }
}

// ---------- 6. Escena AR (MindAR) construida dinámicamente ----------
// `targetsUrl` apunta al archivo .mind compilado por el master a partir de
// las fotos reales de la sala (se genera con el compilador online de MindAR
// y se sube al repositorio; ver README > Fase 5). `marcadores` es la lista
// de asociaciones índice → contenido creadas por el master.
async function construirEscenaAR(targetsUrl, marcadores) {
  if (!targetsUrl) {
    els.scanningHint.textContent = "El Master aún no ha configurado los marcadores de esta sala.";
    return;
  }

  const porIndice = {};
  (marcadores || []).forEach((m) => (porIndice[m.targetIndex] = m));

  const assetsHtml = (marcadores || [])
    .map((m) => {
      if (m.tipo === "video" && m.archivoUrl) {
        return `<video id="asset-video-${m.targetIndex}" src="${m.archivoUrl}" preload="auto" loop="false" playsinline webkit-playsinline crossorigin="anonymous"></video>`;
      }
      if (m.tipo === "imagen" && m.archivoUrl) {
        return `<img id="asset-imagen-${m.targetIndex}" src="${m.archivoUrl}" crossorigin="anonymous" />`;
      }
      return "";
    })
    .join("\n");

  const entidadesHtml = (marcadores || [])
    .map((m) => {
      let contenido = "";
      if (m.tipo === "video" && m.archivoUrl) {
        contenido = `<a-video src="#asset-video-${m.targetIndex}" width="1" height="0.6" position="0 0 0"></a-video>`;
      } else if (m.tipo === "imagen" && m.archivoUrl) {
        contenido = `<a-image src="#asset-imagen-${m.targetIndex}" width="1" height="1" position="0 0 0"></a-image>`;
      }
      return `<a-entity mindar-image-target="targetIndex: ${m.targetIndex}" data-marcador-index="${m.targetIndex}">${contenido}</a-entity>`;
    })
    .join("\n");

  const sceneHtml = `
    <a-scene embedded mindar-image="imageTargetSrc: ${targetsUrl}; autoStart: true; uiScanning: no; uiLoading: no;"
      color-space="sRGB" renderer="colorManagement: true, physicallyCorrectLights" vr-mode-ui="enabled: false"
      device-orientation-permission-ui="enabled: true">
      <a-assets>${assetsHtml}</a-assets>
      <a-camera position="0 0 0" look-controls="enabled: false"></a-camera>
      ${entidadesHtml}
    </a-scene>
  `;
  els.arContainer.innerHTML = sceneHtml;

  // Bug conocido de A-Frame/MindAR en móvil: la barra de direcciones del
  // navegador cambia la altura real del viewport después de cargar, y la
  // cámara puede quedar mal dimensionada (pantalla negra) hasta que se
  // dispara un resize. Lo forzamos nosotros para no depender de que el
  // usuario gire el móvil o haga scroll.
  setTimeout(() => window.dispatchEvent(new Event("resize")), 400);
  setTimeout(() => window.dispatchEvent(new Event("resize")), 1200);

  const sceneEl = els.arContainer.querySelector("a-scene");
  els.arContainer.querySelectorAll("[data-marcador-index]").forEach((entityEl) => {
    const idx = Number(entityEl.dataset.marcadorIndex);
    const marcador = porIndice[idx];
    if (!marcador) return;

    entityEl.addEventListener("targetFound", () => {
      els.runeRing.classList.add("active");
      els.scanningHint.style.display = "none";
      manejarMarcadorEncontrado(marcador);
    });
    entityEl.addEventListener("targetLost", () => {
      els.runeRing.classList.remove("active");
      els.scanningHint.style.display = "block";
      if (marcador.tipo === "video") {
        const videoEl = document.getElementById(`asset-video-${idx}`);
        if (videoEl) videoEl.pause();
      }
    });
  });

  // Marcadores sin ninguna entidad asociada (índices no configurados
  // todavía) igualmente activan el anillo rúnico como feedback genérico.
  sceneEl.addEventListener("targetFound", () => els.runeRing.classList.add("active"));
  sceneEl.addEventListener("targetLost", () => els.runeRing.classList.remove("active"));
}

function manejarMarcadorEncontrado(marcador) {
  if (marcador.tipo === "narracion" && marcador.texto) {
    mostrarNarracion(marcador.texto);
  } else if (marcador.tipo === "video") {
    const videoEl = document.getElementById(`asset-video-${marcador.targetIndex}`);
    if (videoEl) {
      videoEl.currentTime = 0;
      videoEl.play().catch(() => {});
    }
  } else if (marcador.tipo === "objeto" && marcador.objeto) {
    recogerObjeto(marcador);
  }
}

// ---------- 6b. Recoger un objeto de un marcador (una vez por jugador) ----------
async function recogerObjeto(marcador) {
  if (!jugadorDataActual || !jugadorRefActual) return;
  const yaRecogidos = jugadorDataActual.marcadoresRecogidos || [];
  if (yaRecogidos.includes(marcador.id)) return; // ya lo cogió antes, no se duplica

  const inventario = [...(jugadorDataActual.inventario || [])];
  const existente = inventario.findIndex((o) => o.nombre === marcador.objeto.nombre);
  if (existente >= 0) {
    inventario[existente] = {
      ...inventario[existente],
      cantidad: (inventario[existente].cantidad || 1) + (marcador.objeto.cantidad || 1),
    };
  } else {
    inventario.push({
      nombre: marcador.objeto.nombre,
      cantidad: marcador.objeto.cantidad || 1,
      descripcion: marcador.objeto.descripcion || "",
      efecto: marcador.objeto.efecto || { tipo: "ninguno", valor: 0 },
    });
  }

  await updateDoc(jugadorRefActual, {
    inventario,
    marcadoresRecogidos: [...yaRecogidos, marcador.id],
  });

  mostrarNarracion(`🎒 Has encontrado: ${marcador.objeto.nombre}`);

  await addDoc(collection(db, "partidas", currentPartidaId, "eventos"), {
    tipo: "objeto_encontrado",
    jugadorId: currentJugadorId,
    nombreJugador: jugadorDataActual.nombre,
    objeto: marcador.objeto.nombre,
    timestamp: serverTimestamp(),
  });
}
