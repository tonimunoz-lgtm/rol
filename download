// js/master.js — Panel del Master
import {
  auth, db, storage,
  signInWithEmailAndPassword, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, onSnapshot,
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
      card.innerHTML = `<strong>${j.nombre}</strong><br/><span class="mono">❤ ${j.vida}</span>`;
      cont.appendChild(card);
    });
  });
}
