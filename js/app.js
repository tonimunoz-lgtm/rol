// js/app.js — Vista del Jugador
import {
  auth, db,
  signInAnonymously, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, onSnapshot,
  collection, addDoc, serverTimestamp,
  query, where, getDocs, runTransaction,
} from "./firebase-config.js";
import { normalizarGuion, normalizarEscenaActual, encontrarEscena } from "./guion-utils.js";
import { normalizarMapa, renderizarMapaSVG } from "./mapa-utils.js";

const els = {
  playerName: document.getElementById("player-name-label"),
  hpPill: document.getElementById("stat-hp"),
  invPill: document.getElementById("stat-inventory"),
  narrationBox: document.getElementById("narration-box"),
  narrationText: document.getElementById("narration-text"),
  toastBox: document.getElementById("toast-box"),
  toastText: document.getElementById("toast-text"),
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
  inventarioLista: document.getElementById("inventario-lista"),
  inventarioModal: document.getElementById("inventario-modal"),
  btnCerrarInventario: document.getElementById("btn-cerrar-inventario"),
  inventarioCapacidad: document.getElementById("inventario-capacidad"),
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
  fondoImgA: document.getElementById("fondo-img-a"),
  fondoImgB: document.getElementById("fondo-img-b"),
  chatOverlay: document.getElementById("chat-overlay"),
  combateDañoForm: document.getElementById("combate-daño-form"),
  combateObjetivo: document.getElementById("combate-objetivo"),
  combateDañoValor: document.getElementById("combate-daño-valor"),
  combateTipoDanio: document.getElementById("combate-tipo-danio"),
  btnAplicarDaño: document.getElementById("btn-aplicar-daño"),
  btnToggleMusica: document.getElementById("btn-toggle-musica"),
  musicaAmbiente: document.getElementById("musica-ambiente"),
  habilidadAtaqueModal: document.getElementById("habilidad-ataque-modal"),
  habilidadAtaqueTitulo: document.getElementById("habilidad-ataque-titulo"),
  habilidadAtaqueTirada: document.getElementById("habilidad-ataque-tirada"),
  habilidadAtaqueObjetivo: document.getElementById("habilidad-ataque-objetivo"),
  btnConfirmarAtaque: document.getElementById("btn-confirmar-ataque"),
  btnCancelarAtaque: document.getElementById("btn-cancelar-ataque"),
  pruebaModal: document.getElementById("acciones-modal"),
  accionesTitulo: document.getElementById("acciones-titulo"),
  accionesPnj: document.getElementById("acciones-pnj"),
  accionesLista: document.getElementById("acciones-lista"),
  btnCerrarPrueba: document.getElementById("btn-cerrar-acciones"),
  btnBitacora: document.getElementById("btn-bitacora"),
  bitacoraModal: document.getElementById("bitacora-modal"),
  btnCerrarBitacora: document.getElementById("btn-cerrar-bitacora"),
  bitacoraPnjs: document.getElementById("bitacora-pnjs"),
  bitacoraObjetivo: document.getElementById("bitacora-objetivo"),
  bitacoraPistas: document.getElementById("bitacora-pistas"),
  btnPedirPista: document.getElementById("btn-pedir-pista"),
  bitacoraPistasAgotadas: document.getElementById("bitacora-pistas-agotadas"),
  btnMapa: document.getElementById("btn-mapa"),
  mapaModal: document.getElementById("mapa-modal"),
  btnCerrarMapa: document.getElementById("btn-cerrar-mapa"),
  mapaDescripcionJugador: document.getElementById("mapa-descripcion-jugador"),
  mapaViewport: document.getElementById("mapa-viewport"),
  mapaLienzo: document.getElementById("mapa-lienzo"),
  mapaTooltip: document.getElementById("mapa-tooltip"),
  btnMapaZoomMas: document.getElementById("btn-mapa-zoom-mas"),
  btnMapaZoomMenos: document.getElementById("btn-mapa-zoom-menos"),
  btnMapaCentrar: document.getElementById("btn-mapa-centrar"),
};

const DIFICULTAD_ATAQUE_DEFECTO = 12;

// Modificador clásico: (valor del atributo - 10) / 2, redondeando hacia abajo.
function modificadorDeAtributo(nombreAtributo, atributos) {
  if (!nombreAtributo || nombreAtributo === "ninguno") return 0;
  const valor = atributos?.[nombreAtributo] ?? 10;
  return Math.floor((valor - 10) / 2);
}

function tirarDado(caras) {
  return 1 + Math.floor(Math.random() * caras);
}

// Aplica la resistencia del objetivo (si tiene alguna configurada) al daño
// bruto de un tipo concreto. 1 = normal, 0.5 = resistente, 0 = inmune,
// 1.5 = vulnerable. Sin resistencias configuradas, el daño no cambia.
function aplicarResistencia(danioBruto, tipoDanio, resistencias) {
  const multiplicador = resistencias?.[tipoDanio ?? "fisico"] ?? 1;
  return Math.max(0, Math.round(danioBruto * multiplicador));
}

let ultimoDadoResultado = null;
let enemigosCombateActual = [];
let ordenCombateActual = [];

let jugadorDataActual = null;

let jugadorRefActual = null;
let guionActual = [];
let escenaActualLocalId = null;
let pnjsActual = [];
let pistasActual = [];
let mapaCrudo = null;
let ultimaEscenaMostrada = null;
let combateActivoAnterior = false;

let currentPartidaId = localStorage.getItem("runica_partidaId") || null;
let currentJugadorId = localStorage.getItem("runica_jugadorId") || null;
let currentUid = null;

// ---------- 1. Autenticación anónima ----------
let flujoJugadorIniciado = false;

function iniciarFlujoJugador() {
  if (flujoJugadorIniciado) return;
  flujoJugadorIniciado = true;
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
}

// Si ya había una sesión de jugador guardada (volver a abrir la app tras
// unirte a una partida), vamos directos al juego sin preguntar de nuevo.
// Si no, primero preguntamos si es jugador o master, porque un usuario que
// se descarga la app por primera vez no tiene forma de saber que existe
// /master.html si no se lo decimos aquí.
if (currentPartidaId && currentJugadorId) {
  iniciarFlujoJugador();
} else {
  showLandingScreen();
}

function showLandingScreen() {
  const overlay = document.createElement("div");
  overlay.id = "landing-overlay";
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:60; background:var(--ink);
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    padding:2em; gap:1.2em; text-align:center;
  `;
  overlay.innerHTML = `
    <h1 class="display">Rúnica</h1>
    <p style="color:var(--parchment-dim); max-width:320px;">¿Cómo quieres entrar?</p>
    <button id="landing-jugador-btn" class="primary" style="width:100%; max-width:280px;">🎮 Soy jugador — tengo un código de partida</button>
    <button id="landing-master-btn" style="width:100%; max-width:280px;">🛡️ Soy master — quiero crear/dirigir una partida</button>
  `;
  document.body.appendChild(overlay);

  document.getElementById("landing-jugador-btn").addEventListener("click", () => {
    overlay.remove();
    iniciarFlujoJugador();
  });
  document.getElementById("landing-master-btn").addEventListener("click", () => {
    window.location.href = "/master.html";
  });
}

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
    if (els.inventarioModal.classList.contains("visible")) renderInventario(data);
    intentarMostrarPruebaEscenaActual();
    if (els.pruebaModal.classList.contains("visible")) renderAccionesModal();
  });

  // Estado general de la partida en tiempo real: narraciones puntuales ya se
  // gestionan como eventos (abajo); el combate vive como campo del propio
  // documento de la partida para que todos vean el mismo turno a la vez.
  onSnapshot(doc(db, "partidas", currentPartidaId), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    enemigosCombateActual = data.enemigos || [];
    renderCombateJugador(data.combate);
    musicaAmbienteBase = data.musicaAmbienteUrl || null;
    pnjsActual = data.pnjs || [];
    pistasActual = data.pistas || [];
    mapaCrudo = data.mapa || null;

    // Combate que acaba de terminar (estaba activo y ha dejado de estarlo)
    const combateActivoAhora = !!data.combate?.activo;
    if (combateActivoAnterior && !combateActivoAhora) {
      verificarAvanceGuion({ tipo: "combate_terminado" });
    }
    combateActivoAnterior = combateActivoAhora;

    // Enemigos derrotados (vida a 0) pueden disparar el avance de escena
    (data.enemigos || []).forEach((en) => {
      if (en.vida <= 0) verificarAvanceGuion({ tipo: "enemigo_derrotado", valor: en.nombre });
    });

    // Guion: normalizamos (compatibilidad con partidas antiguas y con el
    // nuevo formato de ramificaciones) y mostramos la narración/música si
    // ha cambiado de escena.
    guionActual = normalizarGuion(data.guion || []);
    const escenaActualId = normalizarEscenaActual(data.escenaActual, guionActual);
    escenaActualLocalId = escenaActualId;
    if (escenaActualId !== ultimaEscenaMostrada) {
      ultimaEscenaMostrada = escenaActualId;
      const escena = encontrarEscena(guionActual, escenaActualId);
      if (escena?.narracion) mostrarNarracion(escena.narracion);
      intentarMostrarPruebaEscenaActual();
    }
    actualizarMusicaAmbiente();
    if (els.bitacoraModal.classList.contains("visible")) renderBitacora();
    if (els.mapaModal.classList.contains("visible")) renderMapaModal();
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
        // Habilidades sin objetivo de ataque (las de ataque ya se muestran
        // localmente en el momento de usarse): se difunden a todos como
        // aviso central, igual que ve el master en su registro de eventos.
        if (evento.tipo === "habilidad" && !evento.esAtaque) {
          const texto = `✨ ${evento.nombreJugador || "Alguien"} ha usado "${evento.habilidad}"${
            evento.tirada != null ? ` → tirada: ${evento.tirada}` : ""
          }`;
          mostrarToast(texto);
          añadirMensajeChat({ tipo: "narracion", texto });
        }
        if (evento.tipo === "deteccion") {
          mostrarToast(evento.texto);
          añadirMensajeChat({ tipo: "narracion", texto: evento.texto });
        }
        // Frase de ambientación generada por IA (opcional, decorativa): la
        // pide una sola vez quien hizo la acción y se difunde como
        // narración normal, así todos ven el mismo texto en vez de que
        // cada móvil conectado le pida su propia frase a la IA.
        if (evento.tipo === "flourish") {
          añadirMensajeChat({ tipo: "narracion", texto: `📖 ${evento.texto}` });
        }
      }
    });
  });

  // Marcadores AR configurados por el master para esta partida — los
  // guardamos listos, pero la escena/cámara no se construye hasta que el
  // jugador pulse "Inspeccionar" (ver activarInspeccion).
  const partidaSnap = await getDoc(doc(db, "partidas", currentPartidaId));
  const config = partidaSnap.data() || {};
  const marcadoresSnap = await getDocs(collection(db, "partidas", currentPartidaId, "marcadores"));
  targetsUrlGuardada = config.marcadoresTargetUrl || null;
  marcadoresGuardados = marcadoresSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!targetsUrlGuardada) {
    els.scanningHint.textContent = "El Master aún no ha configurado los marcadores de esta sala.";
  }

  cargarImagenesAmbientacion(config.configuracion);
}

// ---------- 3b. Combate en pantalla ----------
function renderCombateJugador(combate) {
  if (!combate?.activo) {
    els.combateBar.classList.remove("visible", "mi-turno");
    els.combateDañoForm.style.display = "none";
    return;
  }
  els.combateBar.classList.add("visible");
  ordenCombateActual = combate.orden || [];
  const actual = combate.orden[combate.turnoActual];
  const esMiTurno = actual?.jugadorId === currentJugadorId;
  els.combateBar.classList.toggle("mi-turno", esMiTurno);
  els.combateBarTexto.textContent = esMiTurno
    ? `⚔️ ¡Es tu turno! (Ronda ${combate.ronda})`
    : `⚔️ Turno de ${actual?.nombre || "?"} (Ronda ${combate.ronda})`;

  if (esMiTurno) {
    const opcionesEnemigos = enemigosCombateActual
      .map((en, idx) => `<option value="enemigo:${idx}">${en.nombre} (❤${en.vida})</option>`)
      .join("");
    const opcionesJugadores = ordenCombateActual
      .filter((o) => o.jugadorId !== currentJugadorId)
      .map((o) => `<option value="jugador:${o.jugadorId}">${o.nombre}</option>`)
      .join("");
    els.combateObjetivo.innerHTML = opcionesEnemigos + opcionesJugadores;
    els.combateDañoValor.value = ultimoDadoResultado ?? 0;
    els.combateDañoForm.style.display = ordenCombateActual.length > 0 || enemigosCombateActual.length > 0 ? "flex" : "none";
  } else {
    els.combateDañoForm.style.display = "none";
  }
}

// ---------- 3c. Guion automático: comprueba si la escena actual debe avanzar ----------
async function verificarAvanceGuion(contexto) {
  if (!guionActual || guionActual.length === 0) return;
  const escena = encontrarEscena(guionActual, escenaActualLocalId);
  if (!escena || !escena.salidas || escena.salidas.length === 0) return;

  const normaliza = (v) => String(v ?? "").trim().toLowerCase();
  let todosSuperaronCache = null; // se calcula como mucho una vez por llamada

  for (const salida of escena.salidas) {
    const t = salida.trigger || {};
    let cumple = false;
    if (t.tipo === "marcador" && contexto.tipo === "marcador") {
      cumple = Number(t.valor) === Number(contexto.valor);
    } else if (
      ["objeto", "objeto_usado", "habilidad_usada", "enemigo_derrotado"].includes(t.tipo) &&
      t.tipo === contexto.tipo
    ) {
      cumple = normaliza(t.valor) === normaliza(contexto.valor);
    } else if (t.tipo === "combate_terminado" && contexto.tipo === "combate_terminado") {
      cumple = true;
    } else if (t.tipo === "accion_superada" && contexto.tipo === "accion_superada" && normaliza(t.valor) === normaliza(contexto.valor)) {
      cumple = true;
    } else if (t.tipo === "accion_fallada" && contexto.tipo === "accion_fallada" && normaliza(t.valor) === normaliza(contexto.valor)) {
      cumple = true;
    } else if (
      t.tipo === "todos_accion_superada" &&
      contexto.tipo === "accion_superada" &&
      normaliza(t.valor) === normaliza(contexto.valor)
    ) {
      if (todosSuperaronCache === null) todosSuperaronCache = await verificarTodosSuperaronAccion(contexto.valor);
      cumple = todosSuperaronCache;
    }
    if (cumple) {
      await avanzarAEscena(escena, salida);
      return;
    }
  }
}

// Para el trigger "TODOS superen la acción": comprueba que cada jugador
// conectado a la partida tenga esa acción marcada como superada.
async function verificarTodosSuperaronAccion(accionId) {
  const snap = await getDocs(collection(db, "partidas", currentPartidaId, "jugadores"));
  if (snap.empty) return false;
  return snap.docs.every((d) => d.data()?.accionesCompletadas?.[accionId]?.superada === true);
}

async function avanzarAEscena(escenaActual, salida) {
  if (!salida.siguienteId) return;
  try {
    let avanzo = false;
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "partidas", currentPartidaId);
      const snap = await tx.get(ref);
      const actualId = normalizarEscenaActual(snap.data()?.escenaActual, guionActual);
      if (actualId !== escenaActual.id) return; // otro jugador ya la avanzó, no dupliques
      tx.update(ref, { escenaActual: salida.siguienteId });
      avanzo = true;
    });
    // El texto de transición ("cruzas el puente y, unos metros más allá...")
    // se narra a todos justo al avanzar, antes de que llegue la narración
    // propia de la siguiente escena.
    if (avanzo && salida.transicion) {
      await addDoc(collection(db, "partidas", currentPartidaId, "eventos"), {
        tipo: "narracion",
        texto: salida.transicion,
        timestamp: serverTimestamp(),
      });
    }
  } catch (e) {
    console.warn("No se pudo avanzar de escena:", e.message);
  }
}

els.btnAplicarDaño.addEventListener("click", async () => {
  const [tipo, valor] = els.combateObjetivo.value.split(":");
  const danioBruto = Number(els.combateDañoValor.value) || 0;
  const tipoDanio = els.combateTipoDanio.value;
  if (danioBruto <= 0) return;

  let objetivoNombre = "";
  let danioAplicado = danioBruto;

  if (tipo === "enemigo") {
    const idx = Number(valor);
    const enemigo = enemigosCombateActual[idx];
    if (!enemigo) return;
    objetivoNombre = enemigo.nombre;
    // Los enemigos no tienen resistencias configurables en esta versión.
    const nuevos = [...enemigosCombateActual];
    nuevos[idx] = { ...enemigo, vida: Math.max(0, enemigo.vida - danioAplicado) };
    await updateDoc(doc(db, "partidas", currentPartidaId), { enemigos: nuevos });
  } else if (tipo === "jugador") {
    const objetivoRef = doc(db, "partidas", currentPartidaId, "jugadores", valor);
    const objetivoSnap = await getDoc(objetivoRef);
    if (!objetivoSnap.exists()) return;
    const objetivoData = objetivoSnap.data();
    objetivoNombre = objetivoData.nombrePersonaje || objetivoData.nombre;
    danioAplicado = aplicarResistencia(danioBruto, tipoDanio, objetivoData.resistencias);
    await updateDoc(objetivoRef, { vida: Math.max(0, objetivoData.vida - danioAplicado) });
  }

  await addDoc(collection(db, "partidas", currentPartidaId, "eventos"), {
    tipo: "daño",
    atacante: jugadorDataActual?.nombrePersonaje || jugadorDataActual?.nombre || "Jugador",
    objetivoNombre,
    valor: danioAplicado,
    timestamp: serverTimestamp(),
  });
});

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

// ---------- 4b. Música ambiente (variable por escena) ----------
let musicaSonando = false;
let musicaAmbienteBase = null; // pista general de la partida, si no hay una específica de la escena activa

els.btnToggleMusica.addEventListener("click", () => {
  if (!els.musicaAmbiente.src) return;
  if (musicaSonando) {
    els.musicaAmbiente.pause();
    els.btnToggleMusica.textContent = "🎵";
  } else {
    els.musicaAmbiente.volume = 0.35;
    els.musicaAmbiente.play().catch(() => {});
    els.btnToggleMusica.textContent = "🔇";
  }
  musicaSonando = !musicaSonando;
});

// Cada escena del guion puede tener su propia pista (musicaUrl); si no la
// tiene, usamos la pista general de la partida. Cambia sola al cambiar de
// escena, sin cortar la reproducción si no hace falta (mismo archivo).
function actualizarMusicaAmbiente() {
  const escena = encontrarEscena(guionActual, escenaActualLocalId);
  const url = escena?.musicaUrl || musicaAmbienteBase;
  if (!url || els.musicaAmbiente.getAttribute("src") === url) return;
  els.musicaAmbiente.src = url;
  els.musicaAmbiente.load();
  if (musicaSonando) els.musicaAmbiente.play().catch(() => {});
}

function mostrarNarracion(texto) {
  els.narrationText.textContent = texto;
  els.narrationBox.classList.add("visible");
  hablar(texto);
}

let toastTimeoutId = null;
function mostrarToast(texto, duracionMs = 4500) {
  els.toastText.textContent = texto;
  els.toastBox.classList.add("visible");
  clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(() => els.toastBox.classList.remove("visible"), duracionMs);
}

// ---------- Mapa interactivo (zoom + paneo con dedos/ratón) ----------
let mapaActual = { descripcion: "", lugares: [], conexiones: [] };
let mapaEscala = 1;
let mapaTx = 0;
let mapaTy = 0;
const MAPA_ESCALA_MIN = 0.6;
const MAPA_ESCALA_MAX = 3.5;

function aplicarTransformMapa() {
  els.mapaLienzo.style.transform = `translate(${mapaTx}px, ${mapaTy}px) scale(${mapaEscala})`;
}

function lugarActivoEnMapa() {
  return mapaActual.lugares.find((l) => l.escenaId && l.escenaId === escenaActualLocalId) || null;
}

// Centra la vista sobre "estás aquí" si el master vinculó la escena activa
// a algún lugar; si no, muestra el mapa completo.
function centrarMapa() {
  const vp = els.mapaViewport.getBoundingClientRect();
  const lugar = lugarActivoEnMapa();
  if (lugar && vp.width) {
    mapaEscala = 1.7;
    const px = (lugar.x / 100) * vp.width;
    const py = (lugar.y / 100) * vp.height;
    mapaTx = vp.width / 2 - px * mapaEscala;
    mapaTy = vp.height / 2 - py * mapaEscala;
  } else {
    mapaEscala = 1;
    mapaTx = 0;
    mapaTy = 0;
  }
  aplicarTransformMapa();
}

function renderMapaModal() {
  mapaActual = normalizarMapa(mapaCrudo);
  els.mapaDescripcionJugador.textContent = mapaActual.descripcion || "";
  const lugar = lugarActivoEnMapa();
  els.mapaLienzo.innerHTML = renderizarMapaSVG(mapaActual, lugar?.id || null);
  els.mapaTooltip.classList.remove("visible");
}

function abrirMapa() {
  renderMapaModal();
  els.mapaModal.classList.add("visible");
  requestAnimationFrame(centrarMapa);
}
els.btnMapa.addEventListener("click", abrirMapa);
els.btnCerrarMapa.addEventListener("click", () => els.mapaModal.classList.remove("visible"));
els.btnMapaCentrar.addEventListener("click", centrarMapa);
els.btnMapaZoomMas.addEventListener("click", () => {
  mapaEscala = Math.min(MAPA_ESCALA_MAX, mapaEscala * 1.25);
  aplicarTransformMapa();
});
els.btnMapaZoomMenos.addEventListener("click", () => {
  mapaEscala = Math.max(MAPA_ESCALA_MIN, mapaEscala / 1.25);
  aplicarTransformMapa();
});

// Tocar un lugar muestra su nombre/descripción; tocar fuera lo cierra.
els.mapaLienzo.addEventListener("click", (e) => {
  const grupo = e.target.closest(".mapa-lugar");
  if (!grupo) {
    els.mapaTooltip.classList.remove("visible");
    return;
  }
  const lugar = mapaActual.lugares.find((l) => l.id === grupo.dataset.id);
  if (!lugar) return;
  els.mapaTooltip.innerHTML = `<strong>${lugar.nombre}</strong>${lugar.descripcion ? `<br>${lugar.descripcion}` : ""}`;
  els.mapaTooltip.classList.add("visible");
});

// Paneo (arrastrar) y pellizco para zoom, con Pointer Events (funciona
// igual con dedo o ratón, sin depender de una librería externa).
const punterosMapa = new Map();
let distanciaPinchInicial = null;
let escalaPinchInicial = 1;

els.mapaViewport.addEventListener("pointerdown", (e) => {
  els.mapaViewport.setPointerCapture(e.pointerId);
  punterosMapa.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (punterosMapa.size === 2) {
    const [p1, p2] = Array.from(punterosMapa.values());
    distanciaPinchInicial = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    escalaPinchInicial = mapaEscala;
  }
});

els.mapaViewport.addEventListener("pointermove", (e) => {
  if (!punterosMapa.has(e.pointerId)) return;
  const anterior = punterosMapa.get(e.pointerId);
  punterosMapa.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (punterosMapa.size === 2 && distanciaPinchInicial) {
    const [p1, p2] = Array.from(punterosMapa.values());
    const distancia = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    mapaEscala = Math.min(MAPA_ESCALA_MAX, Math.max(MAPA_ESCALA_MIN, escalaPinchInicial * (distancia / distanciaPinchInicial)));
    aplicarTransformMapa();
  } else if (punterosMapa.size === 1) {
    mapaTx += e.clientX - anterior.x;
    mapaTy += e.clientY - anterior.y;
    aplicarTransformMapa();
  }
});

function soltarPunteroMapa(e) {
  punterosMapa.delete(e.pointerId);
  if (punterosMapa.size < 2) distanciaPinchInicial = null;
}
els.mapaViewport.addEventListener("pointerup", soltarPunteroMapa);
els.mapaViewport.addEventListener("pointercancel", soltarPunteroMapa);
els.mapaViewport.addEventListener("pointerleave", soltarPunteroMapa);

els.mapaViewport.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    mapaEscala = Math.min(MAPA_ESCALA_MAX, Math.max(MAPA_ESCALA_MIN, mapaEscala * (e.deltaY < 0 ? 1.1 : 0.9)));
    aplicarTransformMapa();
  },
  { passive: false }
);

// ---------- Acciones de escena (tiradas y/o interacción con PNJ) ----------
const ETIQUETAS_ATRIBUTO_PRUEBA = {
  destreza: "Destreza", fuerza: "Fuerza", vigor: "Vigor", inteligencia: "Inteligencia", carisma: "Carisma",
};
const ETIQUETAS_TIPO_DANIO = {
  fisico: "físico", fuego: "de fuego", hielo: "de hielo", veneno: "de veneno", mental: "mental",
};
let escenaAccionesActual = null; // la escena con acciones pendientes (si hay alguna)

// Ya NO se abre el modal solo al cambiar de escena (tapaba la narración y
// el chat). Solo actualizamos el aviso del botón de dado; el jugador decide
// cuándo abrirlo, con calma, después de leer y hablar con el grupo.
function intentarMostrarPruebaEscenaActual() {
  const escena = encontrarEscena(guionActual, escenaActualLocalId);
  escenaAccionesActual = escena?.acciones?.length > 0 ? escena : null;
  actualizarAvisoDado();
}

function accionPendiente(accion) {
  return !jugadorDataActual?.accionesCompletadas?.[accion.id]?.superada;
}

function actualizarAvisoDado() {
  const hayPendientes = !!escenaAccionesActual?.acciones?.some(accionPendiente);
  els.btnDice.classList.toggle("con-aviso", hayPendientes);
}

function abrirModalAcciones() {
  const escena = escenaAccionesActual;
  if (!escena) return;
  els.accionesTitulo.textContent = escena.nombre || "Acciones";
  if (escena.pnj) {
    els.accionesPnj.textContent = `🗣️ ${escena.pnj} está aquí.`;
    els.accionesPnj.style.display = "block";
  } else {
    els.accionesPnj.style.display = "none";
  }
  renderAccionesModal();
  els.pruebaModal.classList.add("visible");
}

function renderAccionesModal() {
  const escena = escenaAccionesActual;
  if (!escena) return;
  const completadas = jugadorDataActual?.accionesCompletadas || {};
  const intentos = jugadorDataActual?.intentosAccion || {};

  els.accionesLista.innerHTML = escena.acciones
    .map((a) => {
      const hecha = completadas[a.id];
      const fallosPrevios = intentos[a.id] || 0;
      const dificultadEfectiva = a.dificultad + fallosPrevios;
      const descripcion =
        a.tipo === "prueba"
          ? `Tirada de ${ETIQUETAS_ATRIBUTO_PRUEBA[a.atributo] || a.atributo} (dificultad ${dificultadEfectiva}${
              fallosPrevios > 0 ? `, +${fallosPrevios} por intento${fallosPrevios > 1 ? "s" : ""} fallido${fallosPrevios > 1 ? "s" : ""}` : ""
            }). Si fallas, ${a.danioDados}d${a.danioCaras} de daño ${ETIQUETAS_TIPO_DANIO[a.tipoDanio] || ""}.`
          : "Interacción.";
      const etiquetaBoton = hecha
        ? "✅ Hecho"
        : a.tipo === "prueba"
        ? fallosPrevios > 0
          ? "🎲 Reintentar"
          : "🎲 Tirar"
        : "🗣️ Hacer";
      return `
        <div class="habilidad-card" style="margin-bottom:.6em;">
          <div class="h-info">
            <div class="h-nombre">${a.etiqueta}</div>
            <p class="h-desc">${descripcion}</p>
            ${fallosPrevios > 0 && !hecha ? `<p class="h-desc mono" style="color:var(--rust);">Último intento: fallo.</p>` : ""}
            ${hecha ? `<p class="h-desc mono" style="color:var(--amber);">${hecha.texto || ""}</p>` : ""}
          </div>
          <div style="text-align:right;">
            <button class="btn-hacer-accion" data-id="${a.id}" ${hecha ? "disabled" : ""} style="margin-top:.4em; font-size:.75rem;">
              ${etiquetaBoton}
            </button>
          </div>
        </div>`;
    })
    .join("");

  els.accionesLista.querySelectorAll(".btn-hacer-accion").forEach((btn) => {
    btn.addEventListener("click", () => ejecutarAccionEscena(btn.dataset.id));
  });
}

async function ejecutarAccionEscena(accionId) {
  const escena = escenaAccionesActual;
  if (!escena || !jugadorDataActual || !jugadorRefActual) return;
  if (escena.id !== escenaActualLocalId) {
    alert("Esta escena ya no está activa.");
    return;
  }
  const accion = escena.acciones.find((a) => a.id === accionId);
  if (!accion) return;
  if (jugadorDataActual.accionesCompletadas?.[accionId]?.superada) return; // ya superada, no se repite

  // Cerramos el modal ya: el resultado se narra en pantalla principal para
  // todos (incluido quien la ha hecho), no dentro del propio modal.
  els.pruebaModal.classList.remove("visible");

  if (accion.tipo === "prueba") {
    await ejecutarAccionPrueba(escena, accion);
  } else {
    await ejecutarAccionPnj(escena, accion);
  }
}

async function ejecutarAccionPrueba(escena, accion) {
  const nombrePersonaje = jugadorDataActual.nombrePersonaje || jugadorDataActual.nombre;
  const fallosPrevios = jugadorDataActual.intentosAccion?.[accion.id] || 0;
  const dificultadEfectiva = accion.dificultad + fallosPrevios;

  const modificador = modificadorDeAtributo(accion.atributo, jugadorDataActual.atributos);
  const tirada = tirarDado(20) + modificador;
  const supera = tirada >= dificultadEfectiva;

  let danioFinal = 0;
  let nuevaVida = jugadorDataActual.vida;
  if (!supera) {
    let danioBruto = 0;
    for (let i = 0; i < (accion.danioDados || 1); i++) danioBruto += tirarDado(accion.danioCaras || 6);
    danioFinal = aplicarResistencia(danioBruto, accion.tipoDanio, jugadorDataActual.resistencias);
    nuevaVida = Math.max(0, jugadorDataActual.vida - danioFinal);
  }

  const desenlace = (supera ? accion.textoExito : accion.textoFallo)?.trim();
  const textoResultado =
    desenlace ||
    (supera
      ? `${nombrePersonaje} tira ${ETIQUETAS_ATRIBUTO_PRUEBA[accion.atributo] || accion.atributo} → ${tirada}. ¡Lo consigue!`
      : `${nombrePersonaje} tira ${ETIQUETAS_ATRIBUTO_PRUEBA[accion.atributo] || accion.atributo} → ${tirada}. Falla y pierde ${danioFinal} de vida.`);

  // Solo se marca como "completada" (y se bloquea el botón) si la supera.
  // Si falla, puede reintentarlo cuantas veces quiera, pero cada fallo sube
  // la dificultad +1 la próxima vez — el riesgo de insistir es acumulativo.
  const cambios = { vida: nuevaVida };
  if (supera) {
    cambios[`accionesCompletadas.${accion.id}`] = { superada: true, texto: textoResultado };
  } else {
    cambios[`intentosAccion.${accion.id}`] = fallosPrevios + 1;
  }
  await updateDoc(jugadorRefActual, cambios);

  const textoDifundido = `🎲 "${accion.etiqueta}" (${nombrePersonaje}) → ${tirada} (dificultad ${dificultadEfectiva}). ${textoResultado}`;

  // Se narra como cualquier otra narración de escena: aparece en grande
  // para todos (sustituyendo lo que hubiera antes en pantalla) y con voz.
  await addDoc(collection(db, "partidas", currentPartidaId, "eventos"), {
    tipo: "narracion",
    texto: textoDifundido,
    timestamp: serverTimestamp(),
  });

  enriquecerConNarracionIA({
    tipo: "prueba",
    personaje: nombrePersonaje,
    atributo: ETIQUETAS_ATRIBUTO_PRUEBA[accion.atributo] || accion.atributo,
    resultado: supera ? "lo consigue" : `falla y pierde ${danioFinal} de vida`,
  });

  verificarAvanceGuion({ tipo: supera ? "accion_superada" : "accion_fallada", valor: accion.id });
}

async function ejecutarAccionPnj(escena, accion) {
  const nombrePersonaje = jugadorDataActual.nombrePersonaje || jugadorDataActual.nombre;
  let textoResultado = accion.textoPnj?.trim() || `${escena.pnj || "El PNJ"} responde.`;
  const cambiosJugador = {
    [`accionesCompletadas.${accion.id}`]: { superada: true, texto: textoResultado },
  };

  if (accion.efectoPnj === "dar_pista") {
    const actuales = jugadorDataActual.pistasDesbloqueadas || 0;
    if (actuales < pistasActual.length) {
      cambiosJugador.pistasDesbloqueadas = actuales + 1;
      textoResultado += " (Nueva pista en tu Bitácora.)";
    }
  } else if (accion.efectoPnj === "dar_objeto" && accion.objetoNombre) {
    const inventario = [...(jugadorDataActual.inventario || [])];
    const idx = inventario.findIndex((o) => o.nombre === accion.objetoNombre);
    if (idx >= 0) {
      inventario[idx] = { ...inventario[idx], cantidad: (inventario[idx].cantidad || 1) + (accion.objetoCantidad || 1) };
      cambiosJugador.inventario = inventario;
      textoResultado += ` (Recibes: ${accion.objetoNombre}.)`;
    } else if (inventario.length < LIMITE_INVENTARIO) {
      inventario.push({
        nombre: accion.objetoNombre,
        cantidad: accion.objetoCantidad || 1,
        descripcion: accion.objetoDescripcion || "",
        efecto: { tipo: "ninguno", valor: 0 },
      });
      cambiosJugador.inventario = inventario;
      textoResultado += ` (Recibes: ${accion.objetoNombre}.)`;
    } else {
      textoResultado += ` (Te ofrece ${accion.objetoNombre}, pero no te cabe en la mochila.)`;
    }
  } else if (accion.efectoPnj === "avisar_trampa") {
    const yaActivadas = jugadorDataActual.trampasActivadas || [];
    const pendientes = marcadoresGuardados.filter((m) => m.tipo === "trampa" && !yaActivadas.includes(m.id));
    textoResultado +=
      pendientes.length > 0
        ? ` (Te avisa de: ${pendientes.map((m) => `"${m.nombre || "una trampa"}"`).join(", ")}.)`
        : " (No conoce ningún peligro más en esta sala.)";
  }

  await updateDoc(jugadorRefActual, cambiosJugador);

  const textoDifundido = `🗣️ "${accion.etiqueta}" (${nombrePersonaje}): ${textoResultado}`;
  await addDoc(collection(db, "partidas", currentPartidaId, "eventos"), {
    tipo: "narracion",
    texto: textoDifundido,
    timestamp: serverTimestamp(),
  });

  verificarAvanceGuion({ tipo: "accion_superada", valor: accion.id });
}

els.btnCerrarPrueba.addEventListener("click", () => {
  els.pruebaModal.classList.remove("visible");
});

// ---------- Bitácora: PNJs conocidos + pistas desbloqueables ----------
els.btnBitacora.addEventListener("click", () => {
  renderBitacora();
  els.bitacoraModal.classList.add("visible");
});
els.btnCerrarBitacora.addEventListener("click", () => els.bitacoraModal.classList.remove("visible"));

function renderBitacora() {
  // PNJs: visibles siempre que el master los haya escrito, como referencia
  // de la historia (no dependen de anuncios ni de desbloqueo).
  if (pnjsActual.length === 0) {
    els.bitacoraPnjs.innerHTML = `<p style="color:var(--parchment-dim); font-size:.85rem;">Todavía no habéis conocido a nadie reseñable.</p>`;
  } else {
    els.bitacoraPnjs.innerHTML = pnjsActual
      .map(
        (p) => `
      <div class="habilidad-card">
        <div class="h-info">
          <div class="h-nombre">${p.titulo}</div>
          <p class="h-desc">${p.texto || ""}</p>
        </div>
      </div>`
      )
      .join("");
  }

  // Objetivo de la escena activa: siempre visible, sin anuncio — es
  // orientación básica ("qué tengo que hacer aquí"), no una pista profunda.
  const escenaActiva = encontrarEscena(guionActual, escenaActualLocalId);
  if (escenaActiva?.objetivo) {
    els.bitacoraObjetivo.innerHTML = `
      <div class="habilidad-card" style="border-color:var(--amber);">
        <div class="h-info">
          <div class="h-nombre">🎯 Objetivo actual</div>
          <p class="h-desc">${escenaActiva.objetivo}</p>
        </div>
      </div>`;
  } else {
    els.bitacoraObjetivo.innerHTML = "";
  }

  // Pistas: solo se ven las que este jugador ya ha desbloqueado (viendo un
  // anuncio con recompensa por cada una), en el mismo orden en que el
  // master las escribió.
  const desbloqueadas = Math.min(jugadorDataActual?.pistasDesbloqueadas || 0, pistasActual.length);
  if (desbloqueadas === 0) {
    els.bitacoraPistas.innerHTML = `<p style="color:var(--parchment-dim); font-size:.85rem;">Todavía no has desbloqueado ninguna pista.</p>`;
  } else {
    els.bitacoraPistas.innerHTML = pistasActual
      .slice(0, desbloqueadas)
      .map(
        (p) => `
      <div class="habilidad-card">
        <div class="h-info">
          <div class="h-nombre">🔎 ${p.titulo}</div>
          <p class="h-desc">${p.texto || ""}</p>
        </div>
      </div>`
      )
      .join("");
  }

  const quedanPistas = desbloqueadas < pistasActual.length;
  els.btnPedirPista.style.display = quedanPistas ? "block" : "none";
  els.bitacoraPistasAgotadas.style.display = quedanPistas || pistasActual.length === 0 ? "none" : "block";
}

els.btnPedirPista.addEventListener("click", async () => {
  if (!jugadorDataActual || !jugadorRefActual) return;
  els.btnPedirPista.disabled = true;
  const textoOriginal = els.btnPedirPista.textContent;
  els.btnPedirPista.textContent = "Cargando anuncio...";
  try {
    const recompensado = await solicitarAnuncioRecompensado();
    if (!recompensado) return; // el jugador cerró el anuncio antes de tiempo, o no había disponible
    const actuales = jugadorDataActual.pistasDesbloqueadas || 0;
    const nuevas = Math.min(actuales + 1, pistasActual.length);
    await updateDoc(jugadorRefActual, { pistasDesbloqueadas: nuevas });
    renderBitacora();
  } catch (e) {
    console.warn("No se pudo mostrar el anuncio:", e.message);
    alert("No se ha podido cargar el anuncio. Inténtalo de nuevo en unos segundos.");
  } finally {
    els.btnPedirPista.disabled = false;
    els.btnPedirPista.textContent = textoOriginal;
  }
});

// Muestra un anuncio con recompensa (AdMob) y devuelve una promesa que se
// resuelve en `true` solo si el jugador lo ha visto entero y ha ganado la
// recompensa, o `false` si lo ha cerrado antes o no hay anuncio disponible.
//
// Esta función es solo el lado web: un TWA (Trusted Web Activity) normal NO
// tiene acceso al SDK nativo de AdMob, así que aquí solo llamamos a un
// puente que la app nativa debe exponer en `window.AdMobBridge`. Sin ese
// puente (p. ej. probando en el navegador), usamos un anuncio simulado de
// pega para poder probar el flujo completo sin necesidad de la app nativa.
function solicitarAnuncioRecompensado() {
  return new Promise((resolve, reject) => {
    if (window.AdMobBridge?.mostrarRecompensado) {
      // Contrato esperado con la capa nativa: llama a
      // window.AdMobBridge.mostrarRecompensado() y, cuando el anuncio
      // termina, la app nativa ejecuta en el WebView:
      //   window.dispatchEvent(new CustomEvent('admob-recompensa', { detail: { ganada: true|false } }))
      const onResultado = (e) => {
        window.removeEventListener("admob-recompensa", onResultado);
        resolve(!!e.detail?.ganada);
      };
      window.addEventListener("admob-recompensa", onResultado);
      try {
        window.AdMobBridge.mostrarRecompensado();
      } catch (err) {
        window.removeEventListener("admob-recompensa", onResultado);
        reject(err);
      }
      return;
    }

    // Sin puente nativo (navegador normal): simulamos un anuncio de 4
    // segundos para poder probar el resto del flujo. Esto NO es un anuncio
    // real y no genera ningún ingreso — solo sirve para desarrollo.
    const simular = confirm(
      "Los anuncios reales solo funcionan en la app de Google Play.\n\n¿Simular un anuncio de prueba de 4 segundos?"
    );
    if (!simular) {
      resolve(false);
      return;
    }
    mostrarToast("🎥 (Simulado) Reproduciendo anuncio...", 4000);
    setTimeout(() => resolve(true), 4000);
  });
}

// ---------- Frase de ambientación generada por IA (decorativa) ----------
// La pide solo quien hace la acción (para no multiplicar llamadas por cada
// jugador conectado) y publica el resultado como un evento más, que todos
// reciben igual que cualquier otro mensaje del chat. Si falla, no pasa
// nada: el aviso plano (toast + tirada) ya se mostró igualmente.
async function enriquecerConNarracionIA(contexto) {
  try {
    const idToken = await auth.currentUser.getIdToken();
    const resp = await fetch("/api/narrar-accion", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ contexto }),
    });
    if (!resp.ok) return;
    const { texto } = await resp.json();
    if (!texto) return;
    await addDoc(collection(db, "partidas", currentPartidaId, "eventos"), {
      tipo: "flourish",
      texto,
      timestamp: serverTimestamp(),
    });
  } catch (_) {
    // Decorativo: un fallo aquí nunca debe interrumpir la partida.
  }
}

document.getElementById("btn-cerrar-narracion").addEventListener("click", () => {
  els.narrationBox.classList.remove("visible");
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  if (audioIAActual) audioIAActual.pause();
});

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
function abrirFicha() {
  els.fichaModal.classList.add("visible");
}
els.btnFicha.addEventListener("click", abrirFicha);
els.btnCerrarFicha.addEventListener("click", () => els.fichaModal.classList.remove("visible"));

// ---------- 4b-2. Inventario (modal propio, ya no se repite en la ficha) ----------
function abrirInventario() {
  renderInventario(jugadorDataActual);
  els.inventarioModal.classList.add("visible");
}
els.invPill.addEventListener("click", abrirInventario);
els.btnCerrarInventario.addEventListener("click", () => els.inventarioModal.classList.remove("visible"));

// Límite de mochila: una persona normal no puede cargar con infinitas
// cosas. Cuenta como "un hueco" cada objeto distinto (no cada unidad: si ya
// tienes pociones, coger más pociones no ocupa hueco nuevo).
const LIMITE_INVENTARIO = 6;

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
  } else {
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
  }
}

// Elige un icono orientativo según el nombre/efecto del objeto. No es una
// imagen real (cada partida puede tener objetos con cualquier nombre que
// invente el master, así que no hay forma de generar arte único para cada
// uno sin un servicio de generación de imágenes aparte), pero da un golpe
// de vista distinto por tipo de objeto en vez de solo texto.
function iconoParaObjeto(obj) {
  const n = (obj.nombre || "").toLowerCase();
  const mapa = [
    [/espada|daga|hacha|lanza|arma blanca/, "🗡️"],
    [/arco|flecha|ballesta/, "🏹"],
    [/escudo/, "🛡️"],
    [/poci[oó]n|elixir|brebaje/, "🧪"],
    [/llave/, "🔑"],
    [/amuleto|colgante|talism[aá]n/, "📿"],
    [/anillo/, "💍"],
    [/libro|tomo|grimorio|pergamino/, "📖"],
    [/mapa/, "🗺️"],
    [/antorcha|vela|linterna/, "🔦"],
    [/cuerda|soga/, "🪢"],
    [/oro|moneda|gema|joya/, "💰"],
    [/comida|pan|carne|fruta/, "🍖"],
    [/veneno/, "☠️"],
    [/cristal|piedra rúnica|runa/, "🔮"],
  ];
  const encontrado = mapa.find(([regex]) => regex.test(n));
  if (encontrado) return encontrado[1];
  if (obj.efecto?.tipo === "curar") return "🧪";
  if (obj.efecto?.tipo === "danio") return "💣";
  return "📦";
}

function renderInventario(data) {
  if (!data) return;
  const inventario = data.inventario || [];
  els.inventarioCapacidad.textContent = `${inventario.length}/${LIMITE_INVENTARIO} huecos usados`;
  els.inventarioLista.innerHTML = "";

  if (inventario.length === 0) {
    els.inventarioLista.innerHTML = `<p style="grid-column:1/-1; color:var(--parchment-dim); font-size:.85rem;">Mochila vacía.</p>`;
    return;
  }

  inventario.forEach((obj, idx) => {
    const card = document.createElement("div");
    card.className = "card";
    card.style.cssText = "padding:.7em; text-align:center;";
    card.innerHTML = `
      <div style="font-size:2.2rem; line-height:1;">${iconoParaObjeto(obj)}</div>
      <div style="font-weight:600; font-size:.85rem; margin:.4em 0 .1em;">${obj.nombre}</div>
      <div class="mono" style="color:var(--parchment-dim); font-size:.75rem;">x${obj.cantidad}</div>
      <p style="color:var(--parchment-dim); font-size:.72rem; margin:.3em 0;">${obj.descripcion || ""}</p>
      <div style="display:flex; gap:.3em; justify-content:center; margin-top:.4em;">
        <button class="btn-usar-objeto" data-idx="${idx}" style="font-size:.7rem; padding:.4em .5em;">Usar</button>
        <button class="btn-tirar-objeto danger" data-idx="${idx}" style="font-size:.7rem; padding:.4em .5em;">🗑️</button>
      </div>
    `;
    els.inventarioLista.appendChild(card);
  });

  els.inventarioLista.querySelectorAll(".btn-usar-objeto").forEach((btn) => {
    btn.addEventListener("click", () => usarObjeto(Number(btn.dataset.idx), data));
  });
  els.inventarioLista.querySelectorAll(".btn-tirar-objeto").forEach((btn) => {
    btn.addEventListener("click", () => soltarObjeto(Number(btn.dataset.idx), data));
  });
}

// Tirar un objeto al suelo: lo quita de la mochila para siempre (no se
// puede recuperar), típicamente para hacer sitio a otra cosa.
async function soltarObjeto(idx, data) {
  const inventario = [...(data.inventario || [])];
  const objeto = inventario[idx];
  if (!objeto) return;
  if (!confirm(`¿Tirar "${objeto.nombre}"? No podrás recuperarlo.`)) return;
  inventario.splice(idx, 1);
  await updateDoc(jugadorRefActual, { inventario });
}

async function usarObjeto(idx, data) {
  const inventario = [...(data.inventario || [])];
  const objeto = inventario[idx];
  if (!objeto) return;

  const efecto = objeto.efecto || {};
  const esArea = efecto.alcance === "area" && (efecto.tipo === "curar" || efecto.tipo === "danio");

  // Efecto sobre uno mismo (se aplica siempre, sea individual o de área).
  let nuevaVida = data.vida;
  if (efecto.tipo === "curar") {
    nuevaVida = Math.min(data.vidaMax ?? data.vida, data.vida + Number(efecto.valor || 0));
  } else if (efecto.tipo === "danio") {
    const danioPropio = aplicarResistencia(Number(efecto.valor || 0), efecto.tipoDanio, data.resistencias);
    nuevaVida = Math.max(0, data.vida - danioPropio);
  }

  if (objeto.cantidad > 1) {
    inventario[idx] = { ...objeto, cantidad: objeto.cantidad - 1 };
  } else {
    inventario.splice(idx, 1);
  }

  await updateDoc(jugadorRefActual, { inventario, vida: nuevaVida });

  if (esArea) await aplicarEfectoAreaAOtrosJugadores(efecto);

  await addDoc(collection(db, "partidas", currentPartidaId, "eventos"), {
    tipo: "objeto",
    jugadorId: currentJugadorId,
    nombreJugador: data.nombre,
    objeto: objeto.nombre,
    timestamp: serverTimestamp(),
  });

  const nombrePersonaje = data.nombrePersonaje || data.nombre;
  let efectoTexto = "";
  if (efecto.tipo === "curar") efectoTexto = ` (recupera ${efecto.valor} de vida${esArea ? ", todo el grupo" : ""})`;
  else if (efecto.tipo === "danio") efectoTexto = ` (${efecto.valor} de daño${esArea ? ", todo el grupo" : ""})`;
  añadirMensajeChat({ tipo: "narracion", texto: `🎒 ${nombrePersonaje} usa "${objeto.nombre}"${efectoTexto}.` });

  verificarAvanceGuion({ tipo: "objeto_usado", valor: objeto.nombre });
}

// Aplica un efecto de objeto de área (curar/dañar) a los DEMÁS jugadores
// conectados a esta partida — uno mismo ya se resuelve en usarObjeto. Cada
// jugador recibe el efecto ajustado por sus propias resistencias.
async function aplicarEfectoAreaAOtrosJugadores(efecto) {
  const jugadoresSnap = await getDocs(collection(db, "partidas", currentPartidaId, "jugadores"));
  const otros = jugadoresSnap.docs.filter((d) => d.id !== currentJugadorId);
  await Promise.all(
    otros.map(async (d) => {
      const jd = d.data();
      let nuevaVida = jd.vida;
      if (efecto.tipo === "curar") {
        nuevaVida = Math.min(jd.vidaMax ?? jd.vida, jd.vida + Number(efecto.valor || 0));
      } else if (efecto.tipo === "danio") {
        const danio = aplicarResistencia(Number(efecto.valor || 0), efecto.tipoDanio, jd.resistencias);
        nuevaVida = Math.max(0, jd.vida - danio);
      }
      await updateDoc(doc(db, "partidas", currentPartidaId, "jugadores", d.id), { vida: nuevaVida });
    })
  );
}

let ataquePendiente = null;

async function usarHabilidad(idx, data) {
  const habilidad = (data.habilidades || [])[idx];
  if (!habilidad) return;
  const usosActuales = data.habilidadesUsos || {};
  const restantes = usosActuales[idx];
  const modificador = modificadorDeAtributo(habilidad.atributo, data.atributos);

  const hayObjetivos = enemigosCombateActual.length > 0 || ordenCombateActual.length > 0;

  if (habilidad.esAtaque && hayObjetivos) {
    // Pedimos objetivo antes de consumir el uso: si cancela, no se gasta.
    const opcionesEnemigos = enemigosCombateActual
      .map((en, i) => `<option value="enemigo:${i}">${en.nombre} (❤${en.vida})</option>`)
      .join("");
    const opcionesJugadores = ordenCombateActual
      .filter((o) => o.jugadorId !== currentJugadorId)
      .map((o) => `<option value="jugador:${o.jugadorId}">${o.nombre}</option>`)
      .join("");
    els.habilidadAtaqueObjetivo.innerHTML = opcionesEnemigos + opcionesJugadores;
    els.habilidadAtaqueTitulo.textContent = `Usar "${habilidad.nombre}"`;
    els.habilidadAtaqueTirada.textContent = "";
    ataquePendiente = { idx, habilidad, data, modificador, restantes };
    els.habilidadAtaqueModal.classList.add("visible");
    return;
  }

  // Habilidad sin objetivo (o esAtaque pero sin combate activo): solo tirada.
  await ejecutarUsoHabilidad(idx, habilidad, data, usosActuales, restantes, modificador, null);
}

els.btnCancelarAtaque.addEventListener("click", () => {
  els.habilidadAtaqueModal.classList.remove("visible");
  ataquePendiente = null;
});

els.btnConfirmarAtaque.addEventListener("click", async () => {
  if (!ataquePendiente) return;
  const { idx, habilidad, data, modificador } = ataquePendiente;
  const usosActuales = data.habilidadesUsos || {};
  const objetivoValor = els.habilidadAtaqueObjetivo.value;
  els.habilidadAtaqueModal.classList.remove("visible");
  await ejecutarUsoHabilidad(idx, habilidad, data, usosActuales, usosActuales[idx], modificador, objetivoValor);
  ataquePendiente = null;
});

async function ejecutarUsoHabilidad(idx, habilidad, data, usosActuales, restantes, modificador, objetivoValor) {
  const nuevosUsos = { ...usosActuales };
  if (restantes !== -1) nuevosUsos[idx] = Math.max(0, restantes - 1);
  await updateDoc(jugadorRefActual, { habilidadesUsos: nuevosUsos });

  const nombreAtacante = data.nombrePersonaje || data.nombre;
  let tiradaImpacto = null;
  let daño = 0;
  let objetivoNombre = "";
  let textoNarracion = "";

  if (habilidad.esAtaque && objetivoValor) {
    tiradaImpacto = tirarDado(20) + modificador;
    const acierta = tiradaImpacto >= DIFICULTAD_ATAQUE_DEFECTO;
    const [tipoObjetivo, valorObjetivo] = objetivoValor.split(":");

    if (tipoObjetivo === "enemigo") {
      const enIdx = Number(valorObjetivo);
      const enemigo = enemigosCombateActual[enIdx];
      objetivoNombre = enemigo?.nombre || "enemigo";
      if (acierta && enemigo) {
        const caras = Number((habilidad.dado || "d6").replace("d", "")) || 6;
        daño = Math.max(1, tirarDado(caras) + modificador);
        const nuevos = [...enemigosCombateActual];
        nuevos[enIdx] = { ...enemigo, vida: Math.max(0, enemigo.vida - daño) };
        await updateDoc(doc(db, "partidas", currentPartidaId), { enemigos: nuevos });
      }
    } else if (tipoObjetivo === "jugador") {
      const objetivoRef = doc(db, "partidas", currentPartidaId, "jugadores", valorObjetivo);
      const objetivoSnap = await getDoc(objetivoRef);
      if (objetivoSnap.exists()) {
        const objetivoData = objetivoSnap.data();
        objetivoNombre = objetivoData.nombrePersonaje || objetivoData.nombre;
        if (acierta) {
          const caras = Number((habilidad.dado || "d6").replace("d", "")) || 6;
          const danioBruto = Math.max(1, tirarDado(caras) + modificador);
          daño = aplicarResistencia(danioBruto, habilidad.tipoDanio, objetivoData.resistencias);
          await updateDoc(objetivoRef, { vida: Math.max(0, objetivoData.vida - daño) });
        }
      }
    }

    const etiquetaDanio = { fisico: "físico", fuego: "de fuego", hielo: "de hielo", veneno: "de veneno", mental: "mental" }[
      habilidad.tipoDanio
    ] || "";
    textoNarracion = acierta
      ? `⚔️ ${nombreAtacante} usa "${habilidad.nombre}" contra ${objetivoNombre} (tirada ${tiradaImpacto}) y acierta: ${daño} de daño${etiquetaDanio ? ` ${etiquetaDanio}` : ""}.`
      : `⚔️ ${nombreAtacante} usa "${habilidad.nombre}" contra ${objetivoNombre} (tirada ${tiradaImpacto}) pero falla.`;
    añadirMensajeChat({ tipo: "narracion", texto: textoNarracion });
  } else if (habilidad.dado && habilidad.dado !== "ninguno") {
    const caras = Number(habilidad.dado.replace("d", "")) || 20;
    tiradaImpacto = tirarDado(caras) + modificador;
  }
  await addDoc(collection(db, "partidas", currentPartidaId, "eventos"), {
    tipo: "habilidad",
    jugadorId: currentJugadorId,
    nombreJugador: data.nombre,
    habilidad: habilidad.nombre,
    tirada: tiradaImpacto,
    objetivoNombre: objetivoNombre || null,
    daño: daño || null,
    esAtaque: !!(habilidad.esAtaque && objetivoValor),
    timestamp: serverTimestamp(),
  });

  if (habilidad.detectaTrampas) {
    await resolverDeteccionTrampas(nombreAtacante, tiradaImpacto);
  } else if (!(habilidad.esAtaque && objetivoValor)) {
    // Solo para habilidades "normales" sin objetivo de ataque, para no
    // saturar el chat de texto extra en mitad de un combate por turnos.
    enriquecerConNarracionIA({
      tipo: "habilidad",
      personaje: nombreAtacante,
      habilidad: habilidad.nombre,
      tirada: tiradaImpacto,
    });
  }

  verificarAvanceGuion({ tipo: "habilidad_usada", valor: habilidad.nombre });
}

// ---------- 4c. Detección de trampas mediante habilidad ----------
// No hay geolocalización dentro de la sala, así que "detectar" aquí
// significa revelar las trampas de esta partida que este jugador aún no ha
// activado (no importa si están cerca o lejos del marcador que escaneó).
const DIFICULTAD_DETECCION_DEFECTO = 12;
async function resolverDeteccionTrampas(nombrePersonaje, tiradaDeteccion) {
  const yaActivadas = jugadorDataActual?.trampasActivadas || [];
  const trampasPendientes = marcadoresGuardados.filter(
    (m) => m.tipo === "trampa" && !yaActivadas.includes(m.id)
  );

  let texto;
  if (trampasPendientes.length === 0) {
    texto = `🔍 ${nombrePersonaje} no detecta ninguna trampa oculta en esta sala.`;
  } else if ((tiradaDeteccion ?? 0) >= DIFICULTAD_DETECCION_DEFECTO) {
    const nombres = trampasPendientes.map((m) => `"${m.nombre || "trampa sin nombre"}"`).join(", ");
    texto = `🔍 ${nombrePersonaje} detecta ${trampasPendientes.length} trampa(s) oculta(s): ${nombres}.`;
  } else {
    texto = `🔍 ${nombrePersonaje} lo intenta, pero no logra detectar ninguna trampa esta vez (tirada ${tiradaDeteccion}).`;
  }

  await addDoc(collection(db, "partidas", currentPartidaId, "eventos"), {
    tipo: "deteccion",
    jugadorId: currentJugadorId,
    texto,
    timestamp: serverTimestamp(),
  });

  enriquecerConNarracionIA({ tipo: "deteccion", personaje: nombrePersonaje, resultado: texto });
}

// ---------- 5. Dados ----------
els.btnDice.addEventListener("click", async () => {
  // Recalculamos aquí mismo, en vez de fiarnos solo de la variable
  // cacheada: así, aunque el modal se haya cerrado y reabra, o la escena
  // no haya cambiado, siempre refleja el estado real de las acciones.
  const escena = encontrarEscena(guionActual, escenaActualLocalId);
  if (escena?.acciones?.some(accionPendiente)) {
    escenaAccionesActual = escena;
    abrirModalAcciones();
    return;
  }
  const resultado = 1 + Math.floor(Math.random() * 20); // d20 por defecto
  ultimoDadoResultado = resultado;
  els.btnDice.textContent = `🎲 ${resultado}`;
  await addDoc(collection(db, "partidas", currentPartidaId, "eventos"), {
    tipo: "tirada",
    jugadorId: currentJugadorId,
    resultado,
    timestamp: serverTimestamp(),
  });
  setTimeout(() => (els.btnDice.textContent = "🎲 Dado"), 2500);
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

// ---------- 5e. Inspeccionar: activa/desactiva la cámara AR bajo demanda ----------
let sceneConstruida = false;
let modoInspeccionActivo = false;
let targetsUrlGuardada = null;
let marcadoresGuardados = [];

els.btnInspeccionar.addEventListener("click", async () => {
  if (modoInspeccionActivo) {
    desactivarInspeccion();
  } else {
    await activarInspeccion();
  }
});

async function activarInspeccion() {
  if (!targetsUrlGuardada) {
    els.scanningHint.textContent = "El Master aún no ha configurado los marcadores de esta sala.";
  }

  if (!sceneConstruida) {
    await construirEscenaAR(targetsUrlGuardada, marcadoresGuardados);
    sceneConstruida = true;
  } else {
    const sceneEl = els.arContainer.querySelector("a-scene");
    sceneEl?.systems?.["mindar-image-system"]?.start();
  }

  els.arContainer.classList.add("activo");
  pausarRotacionFondo();
  modoInspeccionActivo = true;
  els.btnInspeccionar.textContent = "✕ Cerrar cámara";
  els.scanningHint.style.display = "block";
}

function desactivarInspeccion() {
  const sceneEl = els.arContainer.querySelector("a-scene");
  try {
    sceneEl?.systems?.["mindar-image-system"]?.stop();
  } catch (e) {
    /* nada que hacer si ya estaba parada */
  }
  els.arContainer.classList.remove("activo");
  reanudarRotacionFondo();
  modoInspeccionActivo = false;
  els.btnInspeccionar.textContent = "🔍 Inspeccionar";
  els.runeRing.classList.remove("active");
  els.scanningHint.style.display = "none";
}

// ---------- 5f. Fondo ambiental: imágenes libres de derechos que rotan solas ----------
let imagenesAmbiente = [];
let indiceFondoActual = 0;
let intervaloFondo = null;

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
    imagenesAmbiente = imagenes || [];
    if (imagenesAmbiente.length > 0) {
      mostrarSiguienteFondo();
      if (!modoInspeccionActivo) reanudarRotacionFondo();
    }
  } catch (e) {
    console.warn("No se pudieron cargar imágenes de ambientación:", e.message);
  }
}

function mostrarSiguienteFondo() {
  if (imagenesAmbiente.length === 0) return;
  const siguiente = imagenesAmbiente[indiceFondoActual % imagenesAmbiente.length];
  indiceFondoActual++;

  const activaAhora = els.fondoImgA.classList.contains("activa") ? els.fondoImgA : els.fondoImgB;
  const nueva = activaAhora === els.fondoImgA ? els.fondoImgB : els.fondoImgA;

  nueva.onload = () => {
    nueva.classList.add("activa");
    activaAhora.classList.remove("activa");
  };
  nueva.src = siguiente.url;
}

function pausarRotacionFondo() {
  if (intervaloFondo) {
    clearInterval(intervaloFondo);
    intervaloFondo = null;
  }
}

function reanudarRotacionFondo() {
  if (imagenesAmbiente.length > 0 && !intervaloFondo) {
    intervaloFondo = setInterval(mostrarSiguienteFondo, 9000);
  }
}

// ---------- 5g. Chat transparente superpuesto (estilo overlay de stream) ----------
const MAX_LINEAS_CHAT = 6;
const DURACION_LINEA_MS = 11000;

function colorClaroDesdeTexto(texto) {
  let hash = 0;
  for (let i = 0; i < (texto || "").length; i++) hash = texto.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 75%, 68%)`;
}

function añadirMensajeChat(evento) {
  let autor = "Jugador";
  let color = "var(--amber)";

  if (evento.tipo === "chat_master") {
    autor = "Master";
    color = "#F0C93B";
  } else if (evento.tipo === "narracion") {
    autor = "Narración";
    color = "#cbbf9f";
  } else {
    autor = evento.nombrePersonaje || evento.nombreJugador || "Jugador";
    color = colorClaroDesdeTexto(autor);
  }

  const linea = document.createElement("div");
  linea.className = "chat-linea";
  linea.innerHTML = `<span class="chat-autor" style="color:${color};">${autor}:</span> <span class="chat-texto">${evento.texto}</span>`;
  els.chatOverlay.appendChild(linea);

  while (els.chatOverlay.children.length > MAX_LINEAS_CHAT) {
    els.chatOverlay.removeChild(els.chatOverlay.firstChild);
  }

  setTimeout(() => {
    linea.classList.add("saliendo");
    setTimeout(() => linea.remove(), 1000);
  }, DURACION_LINEA_MS);
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
      const ancho = m.ancho ?? 1;
      const alto = m.alto ?? 0.6;
      const pos = `${m.posX ?? 0} ${m.posY ?? 0} ${m.posZ ?? 0}`;
      if (m.tipo === "video" && m.archivoUrl) {
        contenido = `<a-video src="#asset-video-${m.targetIndex}" width="${ancho}" height="${alto}" position="${pos}"></a-video>`;
      } else if (m.tipo === "imagen" && m.archivoUrl) {
        contenido = `<a-image src="#asset-imagen-${m.targetIndex}" width="${ancho}" height="${alto}" position="${pos}"></a-image>`;
      }
      return `<a-entity mindar-image-target="targetIndex: ${m.targetIndex}" data-marcador-index="${m.targetIndex}">${contenido}</a-entity>`;
    })
    .join("\n");

  const sceneHtml = `
    <a-scene embedded mindar-image="imageTargetSrc: ${targetsUrl}; autoStart: false; uiScanning: no; uiLoading: no;"
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

  // Arrancamos la cámara en cuanto la escena esté lista (autoStart está
  // desactivado a propósito: la controla el botón "Inspeccionar").
  const arrancarCamara = () => sceneEl.systems?.["mindar-image-system"]?.start();
  if (sceneEl.hasLoaded) {
    arrancarCamara();
  } else {
    sceneEl.addEventListener("loaded", arrancarCamara, { once: true });
  }
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
  } else if (marcador.tipo === "trampa" && marcador.trampa) {
    resolverTrampa(marcador);
  }
  verificarAvanceGuion({ tipo: "marcador", valor: marcador.targetIndex });
}

// ---------- 6b2. Trampas: tirada automática de dado ----------
async function resolverTrampa(marcador) {
  if (!jugadorDataActual || !jugadorRefActual) return;
  // Igual que con los objetos, no se repite la trampa si ya se activó para
  // este jugador (para no farmear daño escaneando el mismo marcador).
  const yaActivadas = jugadorDataActual.trampasActivadas || [];
  if (yaActivadas.includes(marcador.id)) return;

  const { atributo, dificultad, danio, tipoDanio, descripcion } = marcador.trampa;
  const modificador = modificadorDeAtributo(atributo, jugadorDataActual.atributos);
  const tirada = tirarDado(20) + modificador;
  const supera = tirada >= (dificultad || 12);
  const nombrePersonaje = jugadorDataActual.nombrePersonaje || jugadorDataActual.nombre;

  const danioFinal = supera ? 0 : aplicarResistencia(danio || 0, tipoDanio, jugadorDataActual.resistencias);
  const nuevaVida = supera ? jugadorDataActual.vida : Math.max(0, jugadorDataActual.vida - danioFinal);

  await updateDoc(jugadorRefActual, {
    trampasActivadas: [...yaActivadas, marcador.id],
    vida: nuevaVida,
  });

  const texto = supera
    ? `⚠️ ${nombrePersonaje} esquiva la trampa${descripcion ? ` (${descripcion})` : ""} — tirada ${tirada}.`
    : `⚠️ ${nombrePersonaje} cae en la trampa${descripcion ? ` (${descripcion})` : ""} — tirada ${tirada}, pierde ${danioFinal} de vida.`;
  mostrarNarracion(texto);

  await addDoc(collection(db, "partidas", currentPartidaId, "eventos"), {
    tipo: "trampa",
    jugadorId: currentJugadorId,
    nombreJugador: jugadorDataActual.nombre,
    superada: supera,
    tirada,
    danio: danioFinal,
    timestamp: serverTimestamp(),
  });
}

// ---------- 6b. Recoger un objeto de un marcador (una vez por jugador) ----------
async function recogerObjeto(marcador) {
  if (!jugadorDataActual || !jugadorRefActual) return;
  const yaRecogidos = jugadorDataActual.marcadoresRecogidos || [];
  if (yaRecogidos.includes(marcador.id)) return; // ya lo cogió antes, no se duplica

  const inventario = [...(jugadorDataActual.inventario || [])];
  const existente = inventario.findIndex((o) => o.nombre === marcador.objeto.nombre);
  if (existente < 0 && inventario.length >= LIMITE_INVENTARIO) {
    mostrarNarracion(
      `🎒 Ves "${marcador.objeto.nombre}", pero no te cabe en la mochila. Tira algo primero (Ficha → mochila) y vuelve a escanear.`
    );
    return;
  }

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

  verificarAvanceGuion({ tipo: "objeto", valor: marcador.objeto.nombre });
}
