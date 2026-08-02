// js/master.js — Panel del Master
import {
  auth, db,
  signInAnonymously, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  collection, addDoc, serverTimestamp,
} from "./firebase-config.js";

const GENERAR_PARTIDA_URL = "/api/generar-partida";
const $ = (id) => document.getElementById(id);
let currentPartidaId = localStorage.getItem("runica_master_partidaId") || null;

// ---------- Autenticación Anónima Automática y Abierta ----------
async function asegurarAutenticacion() {
  if (!auth.currentUser) {
    try {
      await signInAnonymously(auth);
      console.log("Acceso concedido de forma anónima.");
    } catch (err) {
      console.error("Error en login anónimo:", err);
    }
  }
}

asegurarAutenticacion();

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if ($("login-view")) $("login-view").style.display = "block";
    $("master-view").style.display = "none";
    return;
  }
  
  // Acceso directo a la interfaz del Máster para cualquiera
  if ($("login-view")) $("login-view").style.display = "none";
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

  const codigo = generarCodigoPartida();

  try {
    if (!auth.currentUser) {
      throw new Error("No hay un usuario autenticado todavía. Espera un segundo y vuelve a intentarlo.");
    }

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

$("btn-guardar-historia").addEventListener("click", async () => {
  if (!currentPartidaId) return;
  await updateDoc(doc(db, "partidas", currentPartidaId), {
    sinopsis: $("h-sinopsis").value,
    detalle: $("h-detalle").value,
  });
});

$("btn-guardar-targets-path").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("Primero crea o carga una partida.");
  const ruta = $("targets-path").value.trim();
  if (!ruta) return;
  await updateDoc(doc(db, "partidas", currentPartidaId), { marcadoresTargetUrl: ruta });
  $("targets-status").textContent = "Ruta guardada correctamente.";
});

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
      card.innerHTML = `<strong class="display" style="font-size:1rem;">${p.nombre}</strong>`;
      cont.appendChild(card);
    });
  });
}

function escucharJugadoresEnVivo(codigo) {
  // Aquí va tu función original para escuchar la lista de jugadores en vivo
}
