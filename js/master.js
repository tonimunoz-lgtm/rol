// js/master.js — Panel del Master
import {
  auth, db, storage,
  signInWithEmailAndPassword, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  collection, addDoc, serverTimestamp,
  ref, uploadBytes, getDownloadURL,
} from "./firebase-config.js";

// URL de la Cloud Function que llama a Gemini de forma segura (server-side).
// Sustituye esto por la URL real tras desplegar `functions/index.js` (ver README > Fase 3).
const GENERAR_PARTIDA_URL = "https://europe-west1-femjoc.cloudfunctions.net/generarPartida";

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
    if (!resp.ok) throw new Error(`Cloud Function respondió ${resp.status}`);
    const { sinopsis, detalle } = await resp.json();

    await setDoc(doc(db, "partidas", codigo), {
      nombre: configuracion.nombre,
      configuracion,
      sinopsis,
      detalle,
      creadaEn: serverTimestamp(),
      masterUid: auth.currentUser.uid,
    });

    currentPartidaId = codigo;
    localStorage.setItem("runica_master_partidaId", codigo);
    $("codigo-partida-actual").textContent = codigo;
    $("h-sinopsis").value = sinopsis;
    $("h-detalle").value = detalle;

    status.textContent = `Partida creada. Código para los jugadores: ${codigo}`;
    escucharJugadoresEnVivo(codigo);
    escucharPersonajes(codigo);
    escucharLogEventos(codigo);
    document.querySelector('[data-section="historia"]').click();
  } catch (err) {
    console.error(err);
    status.textContent = "Error generando la partida. Revisa que la Cloud Function esté desplegada.";
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
  $("h-sinopsis").value = data.sinopsis || "";
  $("h-detalle").value = data.detalle || "";
  escucharJugadoresEnVivo(codigo);
  escucharPersonajes(codigo);
  escucharLogEventos(codigo);
}

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
      } else if (e.tipo === "narracion") {
        lineas.push(`📢 Narración: ${e.texto}`);
      }
    });
    log.innerHTML = lineas.map((l) => `<div>${l}</div>`).join("") || "<em>Sin eventos todavía.</em>";
    log.scrollTop = log.scrollHeight;
  });
}

// ---------- Guardar edición de historia ----------
$("btn-guardar-historia").addEventListener("click", async () => {
  if (!currentPartidaId) return;
  await updateDoc(doc(db, "partidas", currentPartidaId), {
    sinopsis: $("h-sinopsis").value,
    detalle: $("h-detalle").value,
  });
});

// ---------- Subida de targets.mind ----------
$("upload-targets").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !currentPartidaId) return;
  const fileRef = ref(storage, `partidas/${currentPartidaId}/targets.mind`);
  await uploadBytes(fileRef, file);
  const url = await getDownloadURL(fileRef);
  await updateDoc(doc(db, "partidas", currentPartidaId), { marcadoresTargetUrl: url });
  alert("targets.mind subido correctamente.");
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

// ---------- Personajes: plantillas con atributos y habilidades ----------
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
      card.innerHTML = `
        <strong class="display" style="font-size:1rem;">${p.nombre}</strong>
        <p class="mono" style="font-size:.75rem; color:var(--parchment-dim); margin:.3em 0;">${p.raza} · ${p.clase}</p>
        <p style="font-size:.85rem;">❤ ${p.vidaBase} &nbsp; · &nbsp; ${numHabilidades} habilidad(es)</p>
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

$("btn-add-habilidad").addEventListener("click", () => crearFilaHabilidad());

$("btn-nuevo-personaje").addEventListener("click", () => abrirEditorPersonaje(null));

$("btn-cancelar-personaje").addEventListener("click", () => {
  $("editor-personaje").style.display = "none";
});

async function abrirEditorPersonaje(personajeId) {
  $("editor-personaje").style.display = "block";
  $("lista-habilidades-editor").innerHTML = "";
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
