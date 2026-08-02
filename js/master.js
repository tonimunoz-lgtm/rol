// js/master.js — Panel del Master
import {
  auth, db,
  signInWithEmailAndPassword, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  collection, addDoc, serverTimestamp,
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
