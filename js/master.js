// js/master.js — Panel del Master
import {
  auth, db,
  signInWithEmailAndPassword, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  collection, addDoc, serverTimestamp, getDocs,
} from "./firebase-config.js";

// URL de la función serverless de Vercel que genera la partida con IA.
// Al ser una ruta relativa dentro del mismo dominio, no hay problemas de CORS.
const GENERAR_PARTIDA_URL = "/api/generar-partida";

const $ = (id) => document.getElementById(id);
let currentPartidaId = localStorage.getItem("runica_master_partidaId") || null;

// ---------- Login ----------
$("login-btn").addEventListener("click", async () => {
  const email = $("login-email").value.trim();
  const pass = $("login-pass").value;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    $("login-error").textContent = "Credenciales incorrectas.";
  }
});

$("logout-btn").addEventListener("click", () => auth.signOut());

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    $("login-view").style.display = "block";
    $("master-view").style.display = "none";
    return;
  }
  // NOTA DE SEGURIDAD: esto solo oculta/muestra UI. El control real de que
  // este usuario es "master" lo hacen las reglas de Firestore (ver README),
  // comprobando un documento en /masters/{uid}.
  $("login-view").style.display = "none";
  $("master-view").style.display = "grid";

  if (currentPartidaId) {
    $("codigo-partida-actual").textContent = currentPartidaId;
    cargarPartidaExistente(currentPartidaId);
  }
});

// ---------- Navegación entre secciones ----------
document.querySelectorAll("#master-sidebar nav a").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelectorAll("#master-sidebar nav a").forEach((a) => a.classList.remove("active"));
    document.querySelectorAll(".section-panel").forEach((s) => s.classList.remove("active"));
    link.classList.add("active");
    $(`section-${link.dataset.section}`).classList.add("active");
  });
});

// ---------- Sub-pestañas dentro de "Historia y trama" ----------
document.querySelectorAll(".historia-subtab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".historia-subtab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".historia-subtab").forEach((s) => (s.style.display = "none"));
    btn.classList.add("active");
    $(`historia-subtab-${btn.dataset.subtab}`).style.display = "block";
  });
});

// ---------- Wizard: generar partida con IA ----------
$("btn-generar").addEventListener("click", async () => {
  const status = $("generar-status");
  const configuracion = {
    nombre: $("w-nombre").value.trim() || "Partida sin nombre",
    duracion: $("w-duracion").value,
    dificultad: $("w-dificultad").value,
    trampas: $("w-trampas").value,
    estilo: $("w-estilo").value.trim(),
    tono: $("w-tono").value,
    epoca: $("w-epoca").value.trim(),
    lugar: $("w-lugar").value.trim(),
    facciones: $("w-facciones").value.trim(),
    numeroJugadores: Number($("w-njugadores").value) || 6,
  };

  if (!configuracion.estilo || !configuracion.lugar) {
    status.textContent = "Rellena al menos el estilo narrativo y la ubicación física.";
    return;
  }

  status.textContent = "Generando trama con IA... (puede tardar unos segundos)";
  $("btn-generar").disabled = true;

  // Generamos un código corto de partida (ID legible para que los jugadores lo tecleen)
  const codigo = generarCodigoPartida();

  try {
    const idToken = await auth.currentUser.getIdToken();
    const resp = await fetch(GENERAR_PARTIDA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ configuracion }),
    });
    if (!resp.ok) {
      let detalle = "";
      try {
        const body = await resp.json();
        detalle = body.error || "";
      } catch (_) {}
      throw new Error(`Respuesta ${resp.status}${detalle ? `: ${detalle}` : ""}`);
    }
    const partida = await resp.json();

    await setDoc(doc(db, "partidas", codigo), {
      nombre: configuracion.nombre,
      configuracion,
      sinopsis: partida.sinopsis || "",
      pnjs: partida.pnjs || [],
      pistas: partida.pistas || [],
      trampasEncuentros: partida.trampasEncuentros || [],
      giroFinal: partida.giroFinal || "",
      creadaEn: serverTimestamp(),
      masterUid: auth.currentUser.uid,
    });

    // Creamos automáticamente una ficha de personaje jugable por cada
    // personaje sugerido por la IA. El master puede editarlos o borrarlos
    // después desde "Personajes".
    const personajes = partida.personajesSugeridos || [];
    await Promise.all(
      personajes.map((p) =>
        addDoc(collection(db, "partidas", codigo, "plantillasPersonaje"), {
          nombre: p.nombre || "Personaje sin nombre",
          raza: p.raza || "",
          clase: p.clase || "",
          descripcion: p.descripcion || "",
          vidaBase: Number(p.vidaBase) || 10,
          atributos: {
            fuerza: Number(p.atributos?.fuerza) || 10,
            destreza: Number(p.atributos?.destreza) || 10,
            vigor: Number(p.atributos?.vigor) || 10,
            inteligencia: Number(p.atributos?.inteligencia) || 10,
            carisma: Number(p.atributos?.carisma) || 10,
          },
          habilidades: (p.habilidades || []).map((h) => ({
            nombre: h.nombre || "",
            tipo: h.tipo === "pasiva" ? "pasiva" : "activa",
            dado: h.dado || "d20",
            usosPorPartida: Number(h.usosPorPartida) || 0,
            descripcion: h.descripcion || "",
          })),
          inventarioInicial: (p.inventarioInicial || []).map((o) => ({
            nombre: o.nombre || "",
            cantidad: Number(o.cantidad) || 1,
            descripcion: o.descripcion || "",
            efecto: {
              tipo: ["curar", "danio"].includes(o.efecto?.tipo) ? o.efecto.tipo : "ninguno",
              valor: Number(o.efecto?.valor) || 0,
            },
          })),
        })
      )
    );

    currentPartidaId = codigo;
    localStorage.setItem("runica_master_partidaId", codigo);
    $("codigo-partida-actual").textContent = codigo;
    cargarHistoriaEnUI({
      sinopsis: partida.sinopsis || "",
      pnjs: partida.pnjs || [],
      pistas: partida.pistas || [],
      trampasEncuentros: partida.trampasEncuentros || [],
      giroFinal: partida.giroFinal || "",
    });

    status.textContent = `Partida creada. Código para los jugadores: ${codigo}`;
    escucharJugadoresEnVivo(codigo);
    escucharPersonajes(codigo);
    escucharLogEventos(codigo);
    escucharMarcadores(codigo);
    escucharParticipantesCombate(codigo);
    escucharCombate(codigo);
    document.querySelector('[data-section="historia"]').click();
  } catch (err) {
    console.error(err);
    status.textContent = `Error generando la partida: ${err.message}`;
  } finally {
    $("btn-generar").disabled = false;
  }
});

function generarCodigoPartida() {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let codigo = "";
  for (let i = 0; i < 5; i++) codigo += letras[Math.floor(Math.random() * letras.length)];
  return codigo;
}

async function cargarPartidaExistente(codigo) {
  const snap = await getDoc(doc(db, "partidas", codigo));
  if (!snap.exists()) return;
  const data = snap.data();
  cargarHistoriaEnUI(data);
  escucharJugadoresEnVivo(codigo);
  escucharPersonajes(codigo);
  escucharLogEventos(codigo);
  escucharMarcadores(codigo);
  escucharParticipantesCombate(codigo);
  escucharCombate(codigo);
}

// ---------- Historia: sinopsis + listas de PNJs / pistas / trampas + giro ----------
function cargarHistoriaEnUI(data) {
  $("h-sinopsis").value = data.sinopsis || "";
  $("h-giro").value = data.giroFinal || "";
  renderListaEditor("lista-pnjs", data.pnjs || []);
  renderListaEditor("lista-pistas", data.pistas || []);
  renderListaEditor("lista-trampas", data.trampasEncuentros || []);
}

function crearFilaListaItem(contenedorId, item = null) {
  const tpl = document.getElementById("tpl-lista-item");
  const row = tpl.content.firstElementChild.cloneNode(true);
  if (item) {
    row.querySelector(".li-titulo").value = item.titulo || "";
    row.querySelector(".li-texto").value = item.texto || "";
  }
  row.querySelector(".btn-quitar-item").addEventListener("click", () => row.remove());
  $(contenedorId).appendChild(row);
  return row;
}

function renderListaEditor(contenedorId, items) {
  $(contenedorId).innerHTML = "";
  if (items.length === 0) {
    crearFilaListaItem(contenedorId);
  } else {
    items.forEach((item) => crearFilaListaItem(contenedorId, item));
  }
}

function leerListaEditor(contenedorId) {
  return Array.from(document.querySelectorAll(`#${contenedorId} .lista-item-row`))
    .map((row) => ({
      titulo: row.querySelector(".li-titulo").value.trim(),
      texto: row.querySelector(".li-texto").value.trim(),
    }))
    .filter((item) => item.titulo || item.texto);
}

document.querySelectorAll(".btn-add-lista-item").forEach((btn) => {
  btn.addEventListener("click", () => crearFilaListaItem(`lista-${btn.dataset.lista}`));
});

$("btn-guardar-sinopsis").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("Primero crea o carga una partida.");
  await updateDoc(doc(db, "partidas", currentPartidaId), { sinopsis: $("h-sinopsis").value });
});

$("btn-guardar-giro").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("Primero crea o carga una partida.");
  await updateDoc(doc(db, "partidas", currentPartidaId), { giroFinal: $("h-giro").value });
});

$("btn-guardar-pnjs").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("Primero crea o carga una partida.");
  await updateDoc(doc(db, "partidas", currentPartidaId), { pnjs: leerListaEditor("lista-pnjs") });
});

$("btn-guardar-pistas").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("Primero crea o carga una partida.");
  await updateDoc(doc(db, "partidas", currentPartidaId), { pistas: leerListaEditor("lista-pistas") });
});

$("btn-guardar-trampas").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("Primero crea o carga una partida.");
  await updateDoc(doc(db, "partidas", currentPartidaId), {
    trampasEncuentros: leerListaEditor("lista-trampas"),
  });
});

// ---------- Registro de eventos en vivo ----------
function escucharLogEventos(codigo) {
  const eventosCol = collection(db, "partidas", codigo, "eventos");
  onSnapshot(eventosCol, (snap) => {
    const log = $("log-eventos");
    const lineas = [];
    snap.forEach((docSnap) => {
      const e = docSnap.data();
      if (e.tipo === "tirada") {
        lineas.push(`🎲 Un jugador ha sacado un ${e.resultado}`);
      } else if (e.tipo === "habilidad") {
        lineas.push(
          `✨ ${e.nombreJugador || "Jugador"} ha usado "${e.habilidad}"${e.tirada ? ` → tirada: ${e.tirada}` : ""}`
        );
      } else if (e.tipo === "objeto") {
        lineas.push(`🎒 ${e.nombreJugador || "Jugador"} ha usado "${e.objeto}"`);
      } else if (e.tipo === "objeto_encontrado") {
        lineas.push(`🔎 ${e.nombreJugador || "Jugador"} ha encontrado "${e.objeto}"`);
      } else if (e.tipo === "narracion") {
        lineas.push(`📢 Narración: ${e.texto}`);
      } else if (e.tipo === "accion") {
        lineas.push(`🗣️ ${e.nombreJugador || "Jugador"}: "${e.texto}"`);
      }
    });
    log.innerHTML = lineas.map((l) => `<div>${l}</div>`).join("") || "<em>Sin eventos todavía.</em>";
    log.scrollTop = log.scrollHeight;
  });
}

// ---------- Ruta del targets.mind (archivo estático servido por Vercel) ----------
$("btn-guardar-targets-path").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("Primero crea o carga una partida.");
  const ruta = $("targets-path").value.trim();
  if (!ruta) return;
  await updateDoc(doc(db, "partidas", currentPartidaId), { marcadoresTargetUrl: ruta });
  $("targets-status").textContent = "Ruta guardada correctamente.";
});

// ---------- Marcadores AR: asociación de índice → contenido ----------
let unsubscribeMarcadores = null;

const ETIQUETAS_TIPO_MARCADOR = {
  narracion: "📖 Narración",
  video: "🎬 Vídeo",
  imagen: "🖼️ Imagen",
  objeto: "🎒 Objeto",
};

function escucharMarcadores(codigo) {
  if (unsubscribeMarcadores) unsubscribeMarcadores();
  const col = collection(db, "partidas", codigo, "marcadores");
  unsubscribeMarcadores = onSnapshot(col, (snap) => {
    const cont = $("lista-marcadores");
    cont.innerHTML = "";
    if (snap.empty) {
      cont.innerHTML = `<p style="color:var(--parchment-dim);">Todavía no has asociado ningún marcador.</p>`;
      return;
    }
    const docs = snap.docs.sort((a, b) => (a.data().targetIndex ?? 0) - (b.data().targetIndex ?? 0));
    docs.forEach((docSnap) => {
      const m = docSnap.data();
      const card = document.createElement("div");
      card.className = "card";
      card.style.marginBottom = ".6em";
      card.innerHTML = `
        <span class="mono" style="color:var(--amber);">#${m.targetIndex}</span>
        <strong>${m.nombre || "(sin nombre)"}</strong>
        <span class="mono" style="font-size:.75rem; color:var(--parchment-dim);"> — ${ETIQUETAS_TIPO_MARCADOR[m.tipo] || m.tipo}</span>
        <div style="display:flex; gap:.5em; margin-top:.5em;">
          <button class="btn-editar-marcador" data-id="${docSnap.id}" style="font-size:.75rem;">Editar</button>
          <button class="btn-borrar-marcador danger" data-id="${docSnap.id}" style="font-size:.75rem;">Borrar</button>
        </div>
      `;
      cont.appendChild(card);
    });

    cont.querySelectorAll(".btn-editar-marcador").forEach((btn) =>
      btn.addEventListener("click", () => abrirEditorMarcador(btn.dataset.id))
    );
    cont.querySelectorAll(".btn-borrar-marcador").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("¿Borrar este marcador?")) return;
        await deleteDoc(doc(db, "partidas", currentPartidaId, "marcadores", btn.dataset.id));
      })
    );
  });
}

$("m-tipo").addEventListener("change", () => actualizarCamposMarcador());

function actualizarCamposMarcador() {
  const tipo = $("m-tipo").value;
  document.querySelectorAll(".m-campos").forEach((el) => (el.style.display = "none"));
  const bloque = $(`m-campos-${tipo}`);
  if (bloque) bloque.style.display = "block";
}

$("btn-nuevo-marcador").addEventListener("click", () => abrirEditorMarcador(null));
$("btn-cancelar-marcador").addEventListener("click", () => {
  $("editor-marcador").style.display = "none";
});

async function abrirEditorMarcador(marcadorId) {
  $("editor-marcador").style.display = "block";
  $("m-id").value = marcadorId || "";

  if (!marcadorId) {
    $("editor-marcador-titulo").textContent = "Nuevo marcador";
    $("m-index").value = 0;
    $("m-nombre").value = "";
    $("m-tipo").value = "narracion";
    $("m-texto").value = "";
    $("m-archivo-video").value = "";
    $("m-archivo-imagen").value = "";
    $("m-obj-nombre").value = "";
    $("m-obj-cantidad").value = 1;
    $("m-obj-efecto-tipo").value = "ninguno";
    $("m-obj-efecto-valor").value = 0;
    $("m-obj-descripcion").value = "";
    actualizarCamposMarcador();
    return;
  }

  $("editor-marcador-titulo").textContent = "Editar marcador";
  const snap = await getDoc(doc(db, "partidas", currentPartidaId, "marcadores", marcadorId));
  if (!snap.exists()) return;
  const m = snap.data();
  $("m-index").value = m.targetIndex ?? 0;
  $("m-nombre").value = m.nombre || "";
  $("m-tipo").value = m.tipo || "narracion";
  $("m-texto").value = m.texto || "";
  $("m-archivo-video").value = m.archivoUrl && m.tipo === "video" ? m.archivoUrl : "";
  $("m-archivo-imagen").value = m.archivoUrl && m.tipo === "imagen" ? m.archivoUrl : "";
  const o = m.objeto || {};
  $("m-obj-nombre").value = o.nombre || "";
  $("m-obj-cantidad").value = o.cantidad ?? 1;
  $("m-obj-efecto-tipo").value = o.efecto?.tipo || "ninguno";
  $("m-obj-efecto-valor").value = o.efecto?.valor ?? 0;
  $("m-obj-descripcion").value = o.descripcion || "";
  actualizarCamposMarcador();
}

$("btn-guardar-marcador").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("Primero crea o carga una partida.");
  const tipo = $("m-tipo").value;
  const datos = {
    targetIndex: Number($("m-index").value) || 0,
    nombre: $("m-nombre").value.trim(),
    tipo,
    texto: tipo === "narracion" ? $("m-texto").value.trim() : "",
    archivoUrl:
      tipo === "video" ? $("m-archivo-video").value.trim() : tipo === "imagen" ? $("m-archivo-imagen").value.trim() : "",
    objeto:
      tipo === "objeto"
        ? {
            nombre: $("m-obj-nombre").value.trim(),
            cantidad: Number($("m-obj-cantidad").value) || 1,
            descripcion: $("m-obj-descripcion").value.trim(),
            efecto: {
              tipo: $("m-obj-efecto-tipo").value,
              valor: Number($("m-obj-efecto-valor").value) || 0,
            },
          }
        : null,
  };

  const marcadorId = $("m-id").value;
  if (marcadorId) {
    await updateDoc(doc(db, "partidas", currentPartidaId, "marcadores", marcadorId), datos);
  } else {
    await addDoc(collection(db, "partidas", currentPartidaId, "marcadores"), datos);
  }
  $("editor-marcador").style.display = "none";
});

// ---------- Combate por turnos ----------
let unsubscribeCombateJugadores = null;
let jugadoresParaCombate = [];

function escucharParticipantesCombate(codigo) {
  if (unsubscribeCombateJugadores) unsubscribeCombateJugadores();
  const jugadoresCol = collection(db, "partidas", codigo, "jugadores");
  unsubscribeCombateJugadores = onSnapshot(jugadoresCol, (snap) => {
    jugadoresParaCombate = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const cont = $("lista-participantes-combate");
    cont.innerHTML = jugadoresParaCombate
      .map(
        (j) => `
      <label class="card" style="display:flex; align-items:center; gap:.6em; cursor:pointer;">
        <input type="checkbox" class="chk-participante" value="${j.id}" checked />
        <span>${j.nombre} <span class="mono" style="color:var(--parchment-dim); font-size:.75rem;">(${j.nombrePersonaje || "sin personaje"})</span></span>
      </label>`
      )
      .join("");
  });
}

$("btn-iniciar-combate").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("Primero crea o carga una partida.");
  const idsSeleccionados = Array.from(document.querySelectorAll(".chk-participante:checked")).map((c) => c.value);
  if (idsSeleccionados.length === 0) return alert("Selecciona al menos un jugador.");

  const orden = idsSeleccionados
    .map((id) => {
      const j = jugadoresParaCombate.find((x) => x.id === id);
      const destreza = j?.atributos?.destreza ?? 10;
      const tirada = 1 + Math.floor(Math.random() * 20);
      return {
        jugadorId: id,
        nombre: j?.nombre || "Jugador",
        nombrePersonaje: j?.nombrePersonaje || "",
        iniciativa: tirada + destreza,
      };
    })
    .sort((a, b) => b.iniciativa - a.iniciativa);

  await updateDoc(doc(db, "partidas", currentPartidaId), {
    combate: { activo: true, orden, turnoActual: 0, ronda: 1 },
  });

  await addDoc(collection(db, "partidas", currentPartidaId, "eventos"), {
    tipo: "narracion",
    texto: `⚔️ ¡Comienza el combate! Orden de turnos: ${orden.map((o) => o.nombre).join(", ")}.`,
    timestamp: serverTimestamp(),
  });
});

let unsubscribeCombate = null;
function escucharCombate(codigo) {
  if (unsubscribeCombate) unsubscribeCombate();
  unsubscribeCombate = onSnapshot(doc(db, "partidas", codigo), (snap) => {
    if (!snap.exists()) return;
    renderCombate(snap.data().combate);
  });
}

function renderCombate(combate) {
  const activo = combate?.activo;
  $("combate-inactivo").style.display = activo ? "none" : "block";
  $("combate-activo").style.display = activo ? "block" : "none";
  if (!activo) return;

  $("combate-ronda").textContent = `Ronda ${combate.ronda}`;
  $("orden-combate").innerHTML = combate.orden
    .map((o, idx) => {
      const esActual = idx === combate.turnoActual;
      return `
      <div class="card" style="margin-bottom:.5em; ${esActual ? "border-color:var(--amber); background:var(--ink);" : ""}">
        ${esActual ? "▶ " : ""}<strong>${o.nombre}</strong>
        <span class="mono" style="color:var(--parchment-dim); font-size:.8rem;"> — iniciativa ${o.iniciativa}</span>
      </div>`;
    })
    .join("");
}

$("btn-siguiente-turno").addEventListener("click", async () => {
  const snap = await getDoc(doc(db, "partidas", currentPartidaId));
  const combate = snap.data()?.combate;
  if (!combate?.activo) return;
  let siguiente = combate.turnoActual + 1;
  let ronda = combate.ronda;
  if (siguiente >= combate.orden.length) {
    siguiente = 0;
    ronda += 1;
  }
  await updateDoc(doc(db, "partidas", currentPartidaId), {
    "combate.turnoActual": siguiente,
    "combate.ronda": ronda,
  });
});

$("btn-terminar-combate").addEventListener("click", async () => {
  if (!confirm("¿Terminar el combate?")) return;
  await updateDoc(doc(db, "partidas", currentPartidaId), { combate: { activo: false, orden: [], turnoActual: 0, ronda: 0 } });
});

// ---------- Narración en vivo ----------
$("btn-lanzar-narracion").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("Primero crea o carga una partida.");
  const texto = $("narracion-en-vivo").value.trim();
  if (!texto) return;
  await addDoc(collection(db, "partidas", currentPartidaId, "eventos"), {
    tipo: "narracion",
    texto,
    timestamp: serverTimestamp(),
  });
  $("narracion-en-vivo").value = "";
});

// ---------- Personajes: plantillas con atributos, habilidades e inventario ----------
let unsubscribePersonajes = null;

function escucharPersonajes(codigo) {
  if (unsubscribePersonajes) unsubscribePersonajes();
  const col = collection(db, "partidas", codigo, "plantillasPersonaje");
  unsubscribePersonajes = onSnapshot(col, (snap) => {
    const cont = $("lista-personajes");
    cont.innerHTML = "";
    if (snap.empty) {
      cont.innerHTML = `<p style="color:var(--parchment-dim);">Todavía no has creado ningún personaje.</p>`;
      return;
    }
    snap.forEach((docSnap) => {
      const p = docSnap.data();
      const card = document.createElement("div");
      card.className = "card";
      const numHabilidades = (p.habilidades || []).length;
      const numObjetos = (p.inventarioInicial || []).length;
      card.innerHTML = `
        <strong class="display" style="font-size:1rem;">${p.nombre}</strong>
        <p class="mono" style="font-size:.75rem; color:var(--parchment-dim); margin:.3em 0;">${p.raza} · ${p.clase}</p>
        <p style="font-size:.85rem;">❤ ${p.vidaBase} &nbsp;·&nbsp; ${numHabilidades} habilidad(es) &nbsp;·&nbsp; 🎒 ${numObjetos}</p>
        <div style="display:flex; gap:.5em; margin-top:.6em;">
          <button class="btn-editar-personaje" data-id="${docSnap.id}" style="font-size:.75rem;">Editar</button>
          <button class="btn-borrar-personaje danger" data-id="${docSnap.id}" style="font-size:.75rem;">Borrar</button>
        </div>
      `;
      cont.appendChild(card);
    });

    cont.querySelectorAll(".btn-editar-personaje").forEach((btn) =>
      btn.addEventListener("click", () => abrirEditorPersonaje(btn.dataset.id))
    );
    cont.querySelectorAll(".btn-borrar-personaje").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("¿Borrar este personaje?")) return;
        await deleteDoc(doc(db, "partidas", currentPartidaId, "plantillasPersonaje", btn.dataset.id));
      })
    );
  });
}

function crearFilaHabilidad(habilidad = null) {
  const tpl = document.getElementById("tpl-habilidad-row");
  const row = tpl.content.firstElementChild.cloneNode(true);
  if (habilidad) {
    row.querySelector(".h-nombre").value = habilidad.nombre || "";
    row.querySelector(".h-tipo").value = habilidad.tipo || "activa";
    row.querySelector(".h-dado").value = habilidad.dado || "d20";
    row.querySelector(".h-usos").value = habilidad.usosPorPartida ?? 3;
    row.querySelector(".h-descripcion").value = habilidad.descripcion || "";
  }
  row.querySelector(".btn-quitar-habilidad").addEventListener("click", () => row.remove());
  $("lista-habilidades-editor").appendChild(row);
}

function crearFilaObjeto(objeto = null) {
  const tpl = document.getElementById("tpl-objeto-row");
  const row = tpl.content.firstElementChild.cloneNode(true);
  if (objeto) {
    row.querySelector(".o-nombre").value = objeto.nombre || "";
    row.querySelector(".o-cantidad").value = objeto.cantidad ?? 1;
    row.querySelector(".o-efecto-tipo").value = objeto.efecto?.tipo || "ninguno";
    row.querySelector(".o-efecto-valor").value = objeto.efecto?.valor ?? 0;
    row.querySelector(".o-descripcion").value = objeto.descripcion || "";
  }
  row.querySelector(".btn-quitar-objeto").addEventListener("click", () => row.remove());
  $("lista-inventario-editor").appendChild(row);
}

$("btn-add-habilidad").addEventListener("click", () => crearFilaHabilidad());
$("btn-add-objeto").addEventListener("click", () => crearFilaObjeto());

$("btn-nuevo-personaje").addEventListener("click", () => abrirEditorPersonaje(null));

$("btn-cancelar-personaje").addEventListener("click", () => {
  $("editor-personaje").style.display = "none";
});

async function abrirEditorPersonaje(personajeId) {
  $("editor-personaje").style.display = "block";
  $("lista-habilidades-editor").innerHTML = "";
  $("lista-inventario-editor").innerHTML = "";
  $("p-id").value = personajeId || "";

  if (!personajeId) {
    $("editor-personaje-titulo").textContent = "Nuevo personaje";
    ["p-nombre", "p-raza", "p-clase", "p-descripcion"].forEach((id) => ($(id).value = ""));
    ["p-vida", "p-fuerza", "p-destreza", "p-vigor", "p-inteligencia", "p-carisma"].forEach(
      (id) => ($(id).value = 10)
    );
    crearFilaHabilidad();
    return;
  }

  $("editor-personaje-titulo").textContent = "Editar personaje";
  const snap = await getDoc(doc(db, "partidas", currentPartidaId, "plantillasPersonaje", personajeId));
  if (!snap.exists()) return;
  const p = snap.data();
  $("p-nombre").value = p.nombre || "";
  $("p-raza").value = p.raza || "";
  $("p-clase").value = p.clase || "";
  $("p-descripcion").value = p.descripcion || "";
  $("p-vida").value = p.vidaBase ?? 10;
  const a = p.atributos || {};
  $("p-fuerza").value = a.fuerza ?? 10;
  $("p-destreza").value = a.destreza ?? 10;
  $("p-vigor").value = a.vigor ?? 10;
  $("p-inteligencia").value = a.inteligencia ?? 10;
  $("p-carisma").value = a.carisma ?? 10;
  (p.habilidades || []).forEach((h) => crearFilaHabilidad(h));
  (p.inventarioInicial || []).forEach((o) => crearFilaObjeto(o));
}

$("btn-guardar-personaje").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("Primero crea o carga una partida.");
  const nombre = $("p-nombre").value.trim();
  if (!nombre) return alert("El personaje necesita un nombre.");

  const habilidades = Array.from(document.querySelectorAll("#lista-habilidades-editor .habilidad-row")).map(
    (row) => ({
      nombre: row.querySelector(".h-nombre").value.trim(),
      tipo: row.querySelector(".h-tipo").value,
      dado: row.querySelector(".h-dado").value,
      usosPorPartida: Number(row.querySelector(".h-usos").value) || 0,
      descripcion: row.querySelector(".h-descripcion").value.trim(),
    })
  );

  const inventarioInicial = Array.from(document.querySelectorAll("#lista-inventario-editor .objeto-row")).map(
    (row) => ({
      nombre: row.querySelector(".o-nombre").value.trim(),
      cantidad: Number(row.querySelector(".o-cantidad").value) || 1,
      descripcion: row.querySelector(".o-descripcion").value.trim(),
      efecto: {
        tipo: row.querySelector(".o-efecto-tipo").value,
        valor: Number(row.querySelector(".o-efecto-valor").value) || 0,
      },
    })
  );

  const datos = {
    nombre,
    raza: $("p-raza").value.trim(),
    clase: $("p-clase").value.trim(),
    descripcion: $("p-descripcion").value.trim(),
    vidaBase: Number($("p-vida").value) || 10,
    atributos: {
      fuerza: Number($("p-fuerza").value) || 10,
      destreza: Number($("p-destreza").value) || 10,
      vigor: Number($("p-vigor").value) || 10,
      inteligencia: Number($("p-inteligencia").value) || 10,
      carisma: Number($("p-carisma").value) || 10,
    },
    habilidades,
    inventarioInicial,
  };

  const personajeId = $("p-id").value;
  if (personajeId) {
    await updateDoc(doc(db, "partidas", currentPartidaId, "plantillasPersonaje", personajeId), datos);
  } else {
    await addDoc(collection(db, "partidas", currentPartidaId, "plantillasPersonaje"), datos);
  }
  $("editor-personaje").style.display = "none";
});

// ---------- Eliminar partida por completo ----------
async function borrarColeccion(codigo, nombreColeccion) {
  const snap = await getDocs(collection(db, "partidas", codigo, nombreColeccion));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}

$("btn-eliminar-partida").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("No hay ninguna partida cargada.");
  const confirmacion = prompt(
    `Esto borrará TODO de la partida "${currentPartidaId}" (jugadores, personajes, marcadores, historia) y no se puede deshacer.\n\nEscribe el código de la partida para confirmar:`
  );
  if (confirmacion?.trim().toUpperCase() !== currentPartidaId) {
    alert("Código no coincide, no se ha borrado nada.");
    return;
  }

  const codigo = currentPartidaId;
  await Promise.all([
    borrarColeccion(codigo, "jugadores"),
    borrarColeccion(codigo, "plantillasPersonaje"),
    borrarColeccion(codigo, "marcadores"),
    borrarColeccion(codigo, "eventos"),
  ]);
  await deleteDoc(doc(db, "partidas", codigo));

  currentPartidaId = null;
  localStorage.removeItem("runica_master_partidaId");
  alert("Partida eliminada.");
  location.reload();
});

// ---------- Reiniciar partida desde cero (mantiene marcadores, personajes e historia) ----------
$("btn-reiniciar-partida").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("No hay ninguna partida cargada.");
  if (
    !confirm(
      "¿Reiniciar la partida desde cero?\n\nSe borrará el registro de eventos y se desasignará a todos los jugadores actuales (tendrán que volver a entrar con el código y elegir personaje, como si empezara una partida nueva).\n\nSe mantienen: marcadores, personajes/plantillas e historia (sinopsis, PNJs, pistas, trampas)."
    )
  )
    return;

  const codigo = currentPartidaId;

  await borrarColeccion(codigo, "eventos");
  await borrarColeccion(codigo, "jugadores");
  await updateDoc(doc(db, "partidas", codigo), {
    combate: { activo: false, orden: [], turnoActual: 0, ronda: 0 },
  });

  alert("Partida reiniciada. Los jugadores deben volver a entrar con el código y elegir personaje.");
});
// ---------- Jugadores conectados en vivo ----------
function escucharJugadoresEnVivo(codigo) {
  const jugadoresCol = collection(db, "partidas", codigo, "jugadores");
  onSnapshot(jugadoresCol, (snap) => {
    const cont = $("lista-jugadores-vivo");
    cont.innerHTML = "";
    snap.forEach((docSnap) => {
      const j = docSnap.data();
      const card = document.createElement("div");
      card.className = "card";
      const personajeInfo = j.nombrePersonaje
        ? `<div class="mono" style="font-size:.75rem; color:var(--parchment-dim);">${j.nombrePersonaje} · ${j.clase || ""}</div>`
        : "";
      card.innerHTML = `<strong>${j.nombre}</strong>${personajeInfo}<br/><span class="mono">❤ ${j.vida}/${j.vidaMax ?? j.vida}</span>`;
      cont.appendChild(card);
    });
  });
}
