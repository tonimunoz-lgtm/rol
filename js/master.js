// js/master.js — Panel del Master
import {
  auth, db,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  collection, addDoc, serverTimestamp, getDocs,
} from "./firebase-config.js";
import { normalizarGuion, normalizarEscenaActual, generarIdEscena } from "./guion-utils.js";

// URL de la función serverless que sube archivos (fotos compiladas, vídeos,
// imágenes de marcadores) a Vercel Blob.
const SUBIR_MARCADOR_URL = "/api/subir-marcador";

// URL de la función serverless de Vercel que genera la partida con IA.
// Al ser una ruta relativa dentro del mismo dominio, no hay problemas de CORS.
const GENERAR_PARTIDA_URL = "/api/generar-partida";

const $ = (id) => document.getElementById(id);
let currentPartidaId = localStorage.getItem("runica_master_partidaId") || null;

// ---------- Login / Registro ----------
let modoRegistro = false;

$("toggle-registro-link").addEventListener("click", (e) => {
  e.preventDefault();
  modoRegistro = !modoRegistro;
  $("login-error").textContent = "";
  $("login-titulo").textContent = modoRegistro ? "Crear cuenta de Master" : "Acceso del Master";
  $("login-btn").style.display = modoRegistro ? "none" : "block";
  $("registro-btn").style.display = modoRegistro ? "block" : "none";
  $("toggle-registro-link").textContent = modoRegistro
    ? "¿Ya tienes cuenta? Inicia sesión"
    : "¿No tienes cuenta todavía? Crea una";
});

$("login-btn").addEventListener("click", async () => {
  const email = $("login-email").value.trim();
  const pass = $("login-pass").value;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    $("login-error").textContent = "Credenciales incorrectas.";
  }
});

$("registro-btn").addEventListener("click", async () => {
  const email = $("login-email").value.trim();
  const pass = $("login-pass").value;
  if (!email || pass.length < 6) {
    $("login-error").textContent = "Introduce un email y una contraseña de al menos 6 caracteres.";
    return;
  }
  try {
    await createUserWithEmailAndPassword(auth, email, pass);
    // onAuthStateChanged se encarga de mostrar el panel una vez creada la cuenta.
  } catch (err) {
    $("login-error").textContent =
      err.code === "auth/email-already-in-use"
        ? "Ya existe una cuenta con ese email. Inicia sesión en vez de crear una nueva."
        : "No se pudo crear la cuenta: " + (err.message || "inténtalo de nuevo.");
  }
});

$("logout-btn").addEventListener("click", () => auth.signOut());

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    $("login-view").style.display = "block";
    $("master-view").style.display = "none";
    return;
  }
  // Cualquier cuenta registrada (no anónima) puede actuar de master. El
  // control real de qué partidas puede editar cada quien lo hacen las reglas
  // de Firestore, comparando su uid con el campo masterUid de cada partida.
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

    const guionBorrador = construirGuionDesdeEncuentros(partida.trampasEncuentros || []);

    await setDoc(doc(db, "partidas", codigo), {
      nombre: configuracion.nombre,
      configuracion,
      sinopsis: partida.sinopsis || "",
      pnjs: partida.pnjs || [],
      pistas: partida.pistas || [],
      trampasEncuentros: partida.trampasEncuentros || [],
      giroFinal: partida.giroFinal || "",
      guion: guionBorrador,
      escenaActual: guionBorrador[0]?.id ?? null,
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
          resistencias: { fisico: 1, fuego: 1, hielo: 1, veneno: 1, mental: 1 },
          habilidades: (p.habilidades || []).map((h) => ({
            nombre: h.nombre || "",
            tipo: h.tipo === "pasiva" ? "pasiva" : "activa",
            dado: h.dado || "d20",
            usosPorPartida: Number(h.usosPorPartida) || 0,
            descripcion: h.descripcion || "",
            atributo: "ninguno",
            tipoDanio: "fisico",
            esAtaque: false,
            detectaTrampas: false,
          })),
          inventarioInicial: (p.inventarioInicial || []).map((o) => ({
            nombre: o.nombre || "",
            cantidad: Number(o.cantidad) || 1,
            descripcion: o.descripcion || "",
            efecto: {
              tipo: ["curar", "danio"].includes(o.efecto?.tipo) ? o.efecto.tipo : "ninguno",
              valor: Number(o.efecto?.valor) || 0,
              tipoDanio: "fisico",
              alcance: "individual",
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
      guion: guionBorrador,
    });

    status.textContent = `Partida creada (con un primer borrador de guion, en la pestaña "Guion automático"). Código para los jugadores: ${codigo}`;
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
  $("musica-ambiente-path").value = data.musicaAmbienteUrl || "";
  renderListaEditor("lista-pnjs", data.pnjs || []);
  renderListaEditor("lista-pistas", data.pistas || []);
  renderListaEditor("lista-trampas", data.trampasEncuentros || []);
  renderListaEscenas(data.guion || []);
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
          `✨ ${e.nombreJugador || "Jugador"} ha usado "${e.habilidad}"${e.objetivoNombre ? ` contra ${e.objetivoNombre}` : ""}${e.tirada ? ` → tirada: ${e.tirada}` : ""}${e.daño ? ` (${e.daño} de daño)` : ""}`
        );
      } else if (e.tipo === "trampa") {
        lineas.push(
          `⚠️ ${e.nombreJugador || "Jugador"} ${e.superada ? "esquiva" : "cae en"} una trampa (tirada ${e.tirada})${!e.superada ? ` — ${e.danio} de daño` : ""}`
        );
      } else if (e.tipo === "objeto") {
        lineas.push(`🎒 ${e.nombreJugador || "Jugador"} ha usado "${e.objeto}"`);
      } else if (e.tipo === "objeto_encontrado") {
        lineas.push(`🔎 ${e.nombreJugador || "Jugador"} ha encontrado "${e.objeto}"`);
      } else if (e.tipo === "narracion") {
        lineas.push(`📢 Narración: ${e.texto}`);
      } else if (e.tipo === "accion") {
        lineas.push(`🗣️ ${e.nombreJugador || "Jugador"}: "${e.texto}"`);
      } else if (e.tipo === "chat_master") {
        lineas.push(`🎙️ Master: "${e.texto}"`);
      } else if (e.tipo === "daño") {
        lineas.push(`⚔️ ${e.atacante} inflige ${e.valor} de daño a ${e.objetivoNombre}`);
      }
    });
    log.innerHTML = lineas.map((l) => `<div>${l}</div>`).join("") || "<em>Sin eventos todavía.</em>";
    log.scrollTop = log.scrollHeight;
  });
}

// ---------- Subida genérica de archivos a Vercel Blob ----------
function archivoABase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}

async function subirArchivo(file, tipo) {
  if (!currentPartidaId) throw new Error("Primero crea o carga una partida.");
  const dataBase64 = await archivoABase64(file);
  const idToken = await auth.currentUser.getIdToken();
  const resp = await fetch(SUBIR_MARCADOR_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ partidaId: currentPartidaId, tipo, filename: file.name, dataBase64 }),
  });
  if (!resp.ok) {
    let detalle = "";
    try {
      detalle = (await resp.json()).error || "";
    } catch (_) {}
    throw new Error(detalle || `Error ${resp.status} subiendo el archivo.`);
  }
  const data = await resp.json();
  return data.url;
}

function archivoAImagen(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo leer la imagen "${file.name}".`));
    img.src = URL.createObjectURL(file);
  });
}

// ---------- Compilar fotos → targets.mind, todo dentro del navegador ----------
// Usa el propio motor de MindAR (el mismo que compila el compilador oficial
// de https://hiukim.github.io/mind-ar-js-doc/tools/compile), cargado como
// script en master.html. No hace falta salir de la app ni tocar GitHub.
$("btn-compilar-marcadores").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("Primero crea o carga una partida.");
  const input = $("marcadores-fotos-input");
  const files = Array.from(input.files || []);
  if (!files.length) return alert("Selecciona al menos una foto.");

  const status = $("targets-status");
  const boton = $("btn-compilar-marcadores");
  const CompilerClass = window.MINDAR?.IMAGE?.Compiler || window.MINDAR?.Compiler;
  if (!CompilerClass) {
    status.textContent = "No se pudo cargar el motor de compilación. Recarga la página e inténtalo de nuevo.";
    return;
  }

  boton.disabled = true;
  try {
    status.textContent = "Leyendo fotos...";
    const imagenes = await Promise.all(files.map(archivoAImagen));

    const compiler = new CompilerClass();
    await compiler.compileImageTargets(imagenes, (progreso) => {
      status.textContent = `Compilando marcadores... ${progreso.toFixed(0)}%`;
    });

    status.textContent = "Subiendo targets.mind...";
    const buffer = await compiler.exportData();
    const archivoMind = new File([buffer], "targets.mind");
    const url = await subirArchivo(archivoMind, "targets");

    await updateDoc(doc(db, "partidas", currentPartidaId), { marcadoresTargetUrl: url });
    $("targets-path").value = url;
    status.textContent =
      `Listo: ${files.length} marcador(es) compilado(s) y subido(s). Recuerda el orden — la foto ` +
      `1ª que subiste es el índice 0, la 2ª es el índice 1, y así sucesivamente.`;
  } catch (err) {
    console.error(err);
    status.textContent = `Error: ${err.message}`;
  } finally {
    boton.disabled = false;
  }
});

// ---------- Ruta manual del targets.mind (opción avanzada) ----------
$("btn-guardar-targets-path").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("Primero crea o carga una partida.");
  const ruta = $("targets-path").value.trim();
  if (!ruta) return;
  await updateDoc(doc(db, "partidas", currentPartidaId), { marcadoresTargetUrl: ruta });
  $("targets-status").textContent = "Ruta guardada correctamente.";
});

// ---------- Subida de vídeo/imagen de un marcador concreto ----------
$("btn-subir-video").addEventListener("click", async () => {
  const file = $("m-archivo-video-file").files?.[0];
  if (!file) return alert("Selecciona primero un archivo de vídeo.");
  try {
    $("btn-subir-video").disabled = true;
    const url = await subirArchivo(file, "video");
    $("m-archivo-video").value = url;
  } catch (err) {
    alert(err.message);
  } finally {
    $("btn-subir-video").disabled = false;
  }
});

$("btn-subir-imagen").addEventListener("click", async () => {
  const file = $("m-archivo-imagen-file").files?.[0];
  if (!file) return alert("Selecciona primero un archivo de imagen.");
  try {
    $("btn-subir-imagen").disabled = true;
    const url = await subirArchivo(file, "imagen");
    $("m-archivo-imagen").value = url;
  } catch (err) {
    alert(err.message);
  } finally {
    $("btn-subir-imagen").disabled = false;
  }
});

// ---------- Marcadores AR: asociación de índice → contenido ----------
let unsubscribeMarcadores = null;

const ETIQUETAS_TIPO_MARCADOR = {
  narracion: "📖 Narración",
  video: "🎬 Vídeo",
  imagen: "🖼️ Imagen",
  objeto: "🎒 Objeto",
  trampa: "⚠️ Trampa",
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
  if (tipo === "video" || tipo === "imagen") {
    $("m-campos-posicion").style.display = "block";
    sincronizarPreviewDesdeInputs();
  }
}

// ---------- Editor visual de posición/escala (arrastrar y redimensionar) ----------
const PREVIEW_PX = 220;
const PX_POR_UNIDAD = 90;

function sincronizarPreviewDesdeInputs() {
  const ancho = parseFloat($("m-ancho").value) || 1;
  const alto = parseFloat($("m-alto").value) || 0.6;
  const x = parseFloat($("m-pos-x").value) || 0;
  const y = parseFloat($("m-pos-y").value) || 0;
  const item = $("m-preview-item");
  const wPx = ancho * PX_POR_UNIDAD;
  const hPx = alto * PX_POR_UNIDAD;
  item.style.width = `${wPx}px`;
  item.style.height = `${hPx}px`;
  item.style.left = `${PREVIEW_PX / 2 + x * PX_POR_UNIDAD - wPx / 2}px`;
  item.style.top = `${PREVIEW_PX / 2 - y * PX_POR_UNIDAD - hPx / 2}px`;
}

["m-ancho", "m-alto", "m-pos-x", "m-pos-y"].forEach((id) =>
  $(id).addEventListener("input", sincronizarPreviewDesdeInputs)
);

let arrastrandoMarcador = false;
$("m-preview-item").addEventListener("pointerdown", (e) => {
  if (e.target.id === "m-preview-resize") return;
  arrastrandoMarcador = true;
  const rect = e.currentTarget.getBoundingClientRect();
  e.currentTarget.dataset.offsetX = e.clientX - rect.left;
  e.currentTarget.dataset.offsetY = e.clientY - rect.top;
  e.currentTarget.setPointerCapture(e.pointerId);
});
$("m-preview-item").addEventListener("pointermove", (e) => {
  if (!arrastrandoMarcador) return;
  const item = e.currentTarget;
  const boxRect = $("m-preview-box").getBoundingClientRect();
  const left = e.clientX - boxRect.left - Number(item.dataset.offsetX || 0);
  const top = e.clientY - boxRect.top - Number(item.dataset.offsetY || 0);
  item.style.left = `${left}px`;
  item.style.top = `${top}px`;
  const wPx = item.offsetWidth;
  const hPx = item.offsetHeight;
  $("m-pos-x").value = ((left + wPx / 2 - PREVIEW_PX / 2) / PX_POR_UNIDAD).toFixed(2);
  $("m-pos-y").value = (-(top + hPx / 2 - PREVIEW_PX / 2) / PX_POR_UNIDAD).toFixed(2);
});
$("m-preview-item").addEventListener("pointerup", () => (arrastrandoMarcador = false));

let redimensionandoMarcador = false;
$("m-preview-resize").addEventListener("pointerdown", (e) => {
  redimensionandoMarcador = true;
  e.stopPropagation();
  e.currentTarget.setPointerCapture(e.pointerId);
});
$("m-preview-resize").addEventListener("pointermove", (e) => {
  if (!redimensionandoMarcador) return;
  const item = $("m-preview-item");
  const rect = item.getBoundingClientRect();
  const wPx = Math.max(20, e.clientX - rect.left);
  const hPx = Math.max(20, e.clientY - rect.top);
  item.style.width = `${wPx}px`;
  item.style.height = `${hPx}px`;
  $("m-ancho").value = (wPx / PX_POR_UNIDAD).toFixed(2);
  $("m-alto").value = (hPx / PX_POR_UNIDAD).toFixed(2);
});
$("m-preview-resize").addEventListener("pointerup", (e) => {
  redimensionandoMarcador = false;
  e.stopPropagation();
});

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
    $("m-ancho").value = 1;
    $("m-alto").value = 0.6;
    $("m-pos-x").value = 0;
    $("m-pos-y").value = 0;
    $("m-pos-z").value = 0;
    $("m-obj-nombre").value = "";
    $("m-obj-cantidad").value = 1;
    $("m-obj-efecto-tipo").value = "ninguno";
    $("m-obj-efecto-valor").value = 0;
    $("m-obj-descripcion").value = "";
    $("m-trampa-atributo").value = "destreza";
    $("m-trampa-dificultad").value = 12;
    $("m-trampa-danio").value = 5;
    $("m-trampa-tipo-danio").value = "fisico";
    $("m-trampa-descripcion").value = "";
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
  $("m-ancho").value = m.ancho ?? 1;
  $("m-alto").value = m.alto ?? 0.6;
  $("m-pos-x").value = m.posX ?? 0;
  $("m-pos-y").value = m.posY ?? 0;
  $("m-pos-z").value = m.posZ ?? 0;
  const o = m.objeto || {};
  $("m-obj-nombre").value = o.nombre || "";
  $("m-obj-cantidad").value = o.cantidad ?? 1;
  $("m-obj-efecto-tipo").value = o.efecto?.tipo || "ninguno";
  $("m-obj-efecto-valor").value = o.efecto?.valor ?? 0;
  $("m-obj-descripcion").value = o.descripcion || "";
  const tr = m.trampa || {};
  $("m-trampa-atributo").value = tr.atributo || "destreza";
  $("m-trampa-dificultad").value = tr.dificultad ?? 12;
  $("m-trampa-danio").value = tr.danio ?? 5;
  $("m-trampa-tipo-danio").value = tr.tipoDanio || "fisico";
  $("m-trampa-descripcion").value = tr.descripcion || "";
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
    ancho: parseFloat($("m-ancho").value) || 1,
    alto: parseFloat($("m-alto").value) || 0.6,
    posX: parseFloat($("m-pos-x").value) || 0,
    posY: parseFloat($("m-pos-y").value) || 0,
    posZ: parseFloat($("m-pos-z").value) || 0,
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
    trampa:
      tipo === "trampa"
        ? {
            atributo: $("m-trampa-atributo").value,
            dificultad: Number($("m-trampa-dificultad").value) || 12,
            danio: Number($("m-trampa-danio").value) || 0,
            tipoDanio: $("m-trampa-tipo-danio").value,
            descripcion: $("m-trampa-descripcion").value.trim(),
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

// Convierte una lista de trampas/encuentros de la historia en una secuencia
// lineal de escenas-borrador (una por encuentro), encadenadas por avance
// manual: el master decide luego el disparador real de cada una y puede
// añadir ramificaciones. Se usa tanto al crear la partida (borrador
// automático "junto con la historia") como desde el botón manual.
function construirGuionDesdeEncuentros(encuentros) {
  const escenas = (encuentros || []).map((enc, i) => ({
    id: generarIdEscena(),
    nombre: `${i + 1}. ${enc.titulo || "Escena"}`,
    narracion: enc.texto || "",
    musicaUrl: "",
    salidas: [],
  }));
  for (let i = 0; i < escenas.length - 1; i++) {
    escenas[i].salidas = [{ trigger: { tipo: "combate_terminado" }, siguienteId: escenas[i + 1].id }];
  }
  return escenas;
}

// ---------- Guion automático (storyboard de escenas, con ramificaciones) ----------
const ETIQUETAS_TRIGGER = {
  marcador: "Índice del marcador",
  objeto: "Objeto",
  objeto_usado: "Objeto",
  habilidad_usada: "Habilidad",
  enemigo_derrotado: "Enemigo",
};

// Opciones reales de la partida para poblar los desplegables del guion, en
// vez de que el master tenga que escribir el nombre exacto a mano (con el
// riesgo de errata que eso tiene, ya que la comparación es literal).
let opcionesObjetos = [];
let opcionesHabilidades = [];

function recalcularOpcionesDesdePersonajes(plantillas) {
  const objetos = new Set();
  const habilidades = new Set();
  plantillas.forEach((p) => {
    (p.inventarioInicial || []).forEach((o) => o.nombre && objetos.add(o.nombre));
    (p.habilidades || []).forEach((h) => h.nombre && habilidades.add(h.nombre));
  });
  opcionesObjetos = Array.from(objetos).sort();
  opcionesHabilidades = Array.from(habilidades).sort();
  refrescarSelectsGuionAbiertos();
}

function opcionesParaTipo(tipo) {
  if (tipo === "objeto" || tipo === "objeto_usado") return opcionesObjetos;
  if (tipo === "habilidad_usada") return opcionesHabilidades;
  if (tipo === "enemigo_derrotado") return enemigosActuales.map((e) => e.nombre);
  return [];
}

function crearCampoValor(tipo, valorActual, claseCampo) {
  if (tipo === "marcador") {
    const input = document.createElement("input");
    input.className = claseCampo;
    input.type = "number";
    input.min = "0";
    input.value = valorActual ?? "";
    return input;
  }

  const opciones = opcionesParaTipo(tipo);
  // Si no hay ninguna opción todavía (p.ej. aún no has creado personajes o
  // enemigos), dejamos un campo de texto libre para no bloquear al master.
  if (opciones.length === 0 && !valorActual) {
    const input = document.createElement("input");
    input.className = claseCampo;
    input.type = "text";
    input.placeholder = "Créalo primero en la sección correspondiente";
    input.value = valorActual ?? "";
    return input;
  }

  const select = document.createElement("select");
  select.className = claseCampo;
  const listaOpciones = new Set(opciones);
  if (valorActual) listaOpciones.add(valorActual); // conserva el valor guardado aunque ya no exista
  select.innerHTML =
    `<option value="">— Selecciona —</option>` +
    Array.from(listaOpciones)
      .map((op) => `<option value="${op}" ${op === valorActual ? "selected" : ""}>${op}</option>`)
      .join("");
  return select;
}

function refrescarSelectsGuionAbiertos() {
  document.querySelectorAll("#lista-escenas .salida-row").forEach((row) => {
    const tipo = row.querySelector(".sal-trigger-tipo").value;
    if (tipo === "objeto" || tipo === "objeto_usado" || tipo === "habilidad_usada" || tipo === "enemigo_derrotado") {
      const valorActual = row.querySelector(".sal-trigger-valor")?.value || "";
      const nuevoCampo = crearCampoValor(tipo, valorActual, "sal-trigger-valor");
      row.querySelector(".sal-trigger-valor").replaceWith(nuevoCampo);
    }
  });
}

// ---------- Salidas (ramificaciones) dentro de cada escena ----------
function crearFilaSalida(escenaRow, salida = null) {
  const tpl = document.getElementById("tpl-salida-row");
  const row = tpl.content.firstElementChild.cloneNode(true);
  const tipoInicial = salida?.trigger?.tipo || "marcador";
  row.querySelector(".sal-trigger-tipo").value = tipoInicial;

  const tipoSelect = row.querySelector(".sal-trigger-tipo");
  const actualizarCampoValor = () => {
    const tipo = tipoSelect.value;
    const campo = row.querySelector(".sal-trigger-valor-campo");
    if (tipo === "combate_terminado") {
      campo.style.display = "none";
      return;
    }
    campo.style.display = "block";
    row.querySelector(".sal-trigger-valor-label").textContent = ETIQUETAS_TRIGGER[tipo] || "Valor";
    const valorActual = salida && salida.trigger?.tipo === tipo ? salida.trigger.valor : "";
    const nuevoCampo = crearCampoValor(tipo, valorActual, "sal-trigger-valor");
    row.querySelector(".sal-trigger-valor").replaceWith(nuevoCampo);
  };
  tipoSelect.addEventListener("change", actualizarCampoValor);
  actualizarCampoValor();

  row.querySelector(".btn-quitar-salida").addEventListener("click", () => {
    row.remove();
    actualizarVisibilidadSinSalidas(escenaRow);
  });

  escenaRow.querySelector(".es-salidas").appendChild(row);
  refrescarSelectsDestinoEscena();
  // El destino puede apuntar a una escena que todavía no se ha creado en el
  // DOM (si el guion guardado tiene una salida que "adelanta" hacia una
  // escena posterior en la lista). Guardamos el id pendiente y lo
  // resolvemos al final, cuando ya existen todas las escenas como opción.
  if (salida?.siguienteId) {
    row.dataset.destinoPendiente = salida.siguienteId;
    const destinoSelect = row.querySelector(".sal-destino");
    if (destinoSelect) destinoSelect.value = salida.siguienteId;
  }
  actualizarVisibilidadSinSalidas(escenaRow);
}

function resolverDestinosPendientes() {
  document.querySelectorAll("#lista-escenas .salida-row").forEach((row) => {
    const pendiente = row.dataset.destinoPendiente;
    if (!pendiente) return;
    const select = row.querySelector(".sal-destino");
    if (select) select.value = pendiente;
  });
}

function actualizarVisibilidadSinSalidas(escenaRow) {
  const hay = escenaRow.querySelectorAll(".salida-row").length > 0;
  const aviso = escenaRow.querySelector(".es-sin-salidas");
  if (aviso) aviso.style.display = hay ? "none" : "block";
}

// Recalcula las opciones "Va a la escena..." de TODAS las salidas de TODAS
// las escenas, a partir de los nombres/ids actuales de las escenas del
// editor (cambia cada vez que se añade, quita o renombra una escena).
function refrescarSelectsDestinoEscena() {
  const escenas = Array.from(document.querySelectorAll("#lista-escenas .escena-row")).map((row) => ({
    id: row.querySelector(".es-id").value,
    nombre: row.querySelector(".es-nombre").value.trim() || "(sin nombre)",
  }));
  document.querySelectorAll("#lista-escenas .sal-destino").forEach((select) => {
    const valorActual = select.value;
    select.innerHTML =
      `<option value="">— Selecciona —</option>` +
      escenas.map((e) => `<option value="${e.id}">${e.nombre}</option>`).join("");
    if (escenas.some((e) => e.id === valorActual)) select.value = valorActual;
  });
}

// ---------- Escenas ----------
function crearFilaEscena(escena = null) {
  const tpl = document.getElementById("tpl-escena-row");
  const row = tpl.content.firstElementChild.cloneNode(true);
  row.querySelector(".es-id").value = escena?.id || generarIdEscena();
  if (escena) {
    row.querySelector(".es-nombre").value = escena.nombre || "";
    row.querySelector(".es-narracion").value = escena.narracion || "";
    row.querySelector(".es-musica-url").value = escena.musicaUrl || "";
  }

  row.querySelector(".es-nombre").addEventListener("input", refrescarSelectsDestinoEscena);
  row.querySelector(".btn-quitar-escena").addEventListener("click", () => {
    row.remove();
    refrescarSelectsDestinoEscena();
  });
  row.querySelector(".btn-nueva-salida").addEventListener("click", () => crearFilaSalida(row));
  row.querySelector(".btn-subir-musica-escena").addEventListener("click", async () => {
    const fileInput = row.querySelector(".es-musica-file");
    if (!fileInput.files?.[0]) {
      fileInput.click();
      fileInput.onchange = async () => {
        if (!fileInput.files?.[0]) return;
        await subirMusicaEscena(fileInput.files[0], row);
      };
      return;
    }
    await subirMusicaEscena(fileInput.files[0], row);
  });

  $("lista-escenas").appendChild(row);
  (escena?.salidas || (escena?.trigger && escena.trigger.tipo !== "manual" ? [{ trigger: escena.trigger }] : [])).forEach(
    (salida) => crearFilaSalida(row, salida)
  );
  actualizarVisibilidadSinSalidas(row);
  refrescarSelectsDestinoEscena();
}

async function subirMusicaEscena(file, escenaRow) {
  const boton = escenaRow.querySelector(".btn-subir-musica-escena");
  try {
    boton.disabled = true;
    boton.textContent = "Subiendo...";
    const url = await subirArchivo(file, "audio");
    escenaRow.querySelector(".es-musica-url").value = url;
  } catch (err) {
    alert(err.message);
  } finally {
    boton.disabled = false;
    boton.textContent = "Subir";
  }
}

function renderListaEscenas(escenas) {
  $("lista-escenas").innerHTML = "";
  normalizarGuion(escenas || []).forEach((es) => crearFilaEscena(es));
  resolverDestinosPendientes();
}

function leerListaEscenas() {
  return Array.from(document.querySelectorAll("#lista-escenas .escena-row")).map((escenaRow) => {
    const salidas = Array.from(escenaRow.querySelectorAll(".salida-row"))
      .map((salidaRow) => {
        const tipo = salidaRow.querySelector(".sal-trigger-tipo").value;
        const valorInput = salidaRow.querySelector(".sal-trigger-valor");
        const siguienteId = salidaRow.querySelector(".sal-destino")?.value || "";
        return {
          trigger: {
            tipo,
            valor: tipo === "marcador" ? Number(valorInput?.value) || 0 : (valorInput?.value || "").trim(),
          },
          siguienteId,
        };
      })
      .filter((s) => s.siguienteId); // una salida sin destino elegido no cuenta

    return {
      id: escenaRow.querySelector(".es-id").value,
      nombre: escenaRow.querySelector(".es-nombre").value.trim() || "Escena sin nombre",
      narracion: escenaRow.querySelector(".es-narracion").value.trim(),
      musicaUrl: escenaRow.querySelector(".es-musica-url").value.trim(),
      salidas,
    };
  });
}

$("btn-nueva-escena").addEventListener("click", () => crearFilaEscena());

// Reutilizamos el botón "+ Añadir escena" como disparador; el guardado real
// se hace con este botón que insertamos junto a él.
const btnGuardarGuion = document.createElement("button");
btnGuardarGuion.textContent = "💾 Guardar guion";
btnGuardarGuion.className = "primary";
btnGuardarGuion.style.marginLeft = ".6em";
$("btn-nueva-escena").insertAdjacentElement("afterend", btnGuardarGuion);
btnGuardarGuion.addEventListener("click", async () => {
  if (!currentPartidaId) return alert("Primero crea o carga una partida.");
  await updateDoc(doc(db, "partidas", currentPartidaId), { guion: leerListaEscenas() });
  alert("Guion guardado.");
});

let guionActual = [];

function renderEscenaActual(guionCrudo, escenaActualCruda) {
  const guion = normalizarGuion(guionCrudo || []);
  const escenaId = normalizarEscenaActual(escenaActualCruda, guion);
  const escena = guion.find((e) => e.id === escenaId);
  $("guion-escena-actual").textContent = escena ? escena.nombre : "— (sin guion o sin empezar)";

  // Repoblamos el desplegable de salto manual con todas las escenas.
  const select = $("salto-escena-select");
  const valorPrevio = select.value;
  select.innerHTML = guion.map((e) => `<option value="${e.id}">${e.nombre}</option>`).join("");
  if (guion.some((e) => e.id === valorPrevio)) select.value = valorPrevio;
}

async function dispararNarracionEscena(codigo, escena) {
  if (!escena?.narracion) return;
  await addDoc(collection(db, "partidas", codigo, "eventos"), {
    tipo: "narracion",
    texto: escena.narracion,
    timestamp: serverTimestamp(),
  });
}

$("btn-saltar-escena").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("Primero crea o carga una partida.");
  const destinoId = $("salto-escena-select").value;
  if (!destinoId) return;
  await updateDoc(doc(db, "partidas", currentPartidaId), { escenaActual: destinoId });
  const escena = guionActual.find((e) => e.id === destinoId);
  if (escena) await dispararNarracionEscena(currentPartidaId, escena);
});

$("btn-reiniciar-guion").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("Primero crea o carga una partida.");
  if (!confirm("¿Volver a la primera escena del guion?")) return;
  const snap = await getDoc(doc(db, "partidas", currentPartidaId));
  const guion = normalizarGuion(snap.data()?.guion || []);
  if (!guion[0]) return;
  await updateDoc(doc(db, "partidas", currentPartidaId), { escenaActual: guion[0].id });
  await dispararNarracionEscena(currentPartidaId, guion[0]);
});

// ---------- Que la IA proponga un primer borrador de guion ----------
// Convierte la historia ya generada (o escrita a mano) en una secuencia
// lineal de escenas, una por cada trampa/encuentro de la historia, que el
// master puede editar, reordenar o ramificar después a su gusto.
$("btn-sugerir-guion").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("Primero crea o carga una partida.");
  if (
    document.querySelectorAll("#lista-escenas .escena-row").length > 0 &&
    !confirm("Esto añade escenas nuevas de borrador al final del guion actual. ¿Continuar?")
  ) {
    return;
  }
  const snap = await getDoc(doc(db, "partidas", currentPartidaId));
  const data = snap.data() || {};
  const encuentros = data.trampasEncuentros || [];
  if (encuentros.length === 0) {
    alert("Todavía no hay trampas/encuentros en la Historia generada de los que partir.");
    return;
  }

  const nuevasEscenas = construirGuionDesdeEncuentros(encuentros);

  nuevasEscenas.forEach((es) => crearFilaEscena(es));
  refrescarSelectsDestinoEscena();
  resolverDestinosPendientes();
  alert(
    "Borrador añadido. Revisa el disparador de cada salida (ahora mismo todas están puestas como " +
    "\"termine el combate\", cámbialas por lo que corresponda) y añade ramificaciones si quieres."
  );
});

// ---------- Combate por turnos ----------
let unsubscribeCombateJugadores = null;
let jugadoresParaCombate = [];
let enemigosActuales = [];

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
    const data = snap.data();
    renderCombate(data.combate);
    enemigosActuales = data.enemigos || [];
    renderEnemigos();
    refrescarSelectsGuionAbiertos();
    guionActual = normalizarGuion(data.guion || []);
    renderEscenaActual(data.guion || [], data.escenaActual);
  });
}

function renderEnemigos() {
  const cont = $("lista-enemigos");
  if (enemigosActuales.length === 0) {
    cont.innerHTML = `<p style="color:var(--parchment-dim); font-size:.85rem;">Todavía no hay enemigos.</p>`;
    return;
  }
  cont.innerHTML = enemigosActuales
    .map(
      (en, idx) => `
    <div class="card" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:.5em;">
      <div><strong>${en.nombre}</strong> <span class="mono" style="color:var(--parchment-dim);">❤ ${en.vida}/${en.vidaMax}</span></div>
      <div style="display:flex; gap:.3em;">
        <button class="btn-enemigo-ajustar" data-idx="${idx}" data-delta="-5" style="font-size:.7rem;">-5</button>
        <button class="btn-enemigo-ajustar" data-idx="${idx}" data-delta="-1" style="font-size:.7rem;">-1</button>
        <button class="btn-enemigo-ajustar" data-idx="${idx}" data-delta="1" style="font-size:.7rem;">+1</button>
        <button class="btn-enemigo-quitar" data-idx="${idx}" class="danger" style="font-size:.7rem;">✕</button>
      </div>
    </div>`
    )
    .join("");

  cont.querySelectorAll(".btn-enemigo-ajustar").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.idx);
      const delta = Number(btn.dataset.delta);
      const nuevos = [...enemigosActuales];
      nuevos[idx] = { ...nuevos[idx], vida: Math.max(0, Math.min(nuevos[idx].vidaMax, nuevos[idx].vida + delta)) };
      await updateDoc(doc(db, "partidas", currentPartidaId), { enemigos: nuevos });
    })
  );
  cont.querySelectorAll(".btn-enemigo-quitar").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.idx);
      const nuevos = enemigosActuales.filter((_, i) => i !== idx);
      await updateDoc(doc(db, "partidas", currentPartidaId), { enemigos: nuevos });
    })
  );
}

$("btn-add-enemigo").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("Primero crea o carga una partida.");
  const nombre = $("en-nombre").value.trim();
  const vida = Number($("en-vida").value) || 10;
  if (!nombre) return alert("Ponle un nombre al enemigo.");
  const nuevos = [...enemigosActuales, { nombre, vida, vidaMax: vida }];
  await updateDoc(doc(db, "partidas", currentPartidaId), { enemigos: nuevos });
  $("en-nombre").value = "";
  $("en-vida").value = 10;
});

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

$("btn-enviar-chat-master").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("Primero crea o carga una partida.");
  const texto = $("chat-master-texto").value.trim();
  if (!texto) return;
  await addDoc(collection(db, "partidas", currentPartidaId, "eventos"), {
    tipo: "chat_master",
    texto,
    timestamp: serverTimestamp(),
  });
  $("chat-master-texto").value = "";
});

$("btn-guardar-musica").addEventListener("click", async () => {
  if (!currentPartidaId) return alert("Primero crea o carga una partida.");
  const ruta = $("musica-ambiente-path").value.trim();
  await updateDoc(doc(db, "partidas", currentPartidaId), { musicaAmbienteUrl: ruta });
  $("musica-status").textContent = "Guardado.";
});

// ---------- Personajes: plantillas con atributos, habilidades e inventario ----------
let unsubscribePersonajes = null;

function escucharPersonajes(codigo) {
  if (unsubscribePersonajes) unsubscribePersonajes();
  const col = collection(db, "partidas", codigo, "plantillasPersonaje");
  unsubscribePersonajes = onSnapshot(col, (snap) => {
    const plantillas = snap.docs.map((d) => d.data());
    recalcularOpcionesDesdePersonajes(plantillas);

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
    row.querySelector(".h-atributo").value = habilidad.atributo || "ninguno";
    row.querySelector(".h-tipo-danio").value = habilidad.tipoDanio || "fisico";
    row.querySelector(".h-es-ataque").checked = !!habilidad.esAtaque;
    row.querySelector(".h-detecta-trampas").checked = !!habilidad.detectaTrampas;
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
    row.querySelector(".o-efecto-tipo-danio").value = objeto.efecto?.tipoDanio || "fisico";
    row.querySelector(".o-efecto-alcance").value = objeto.efecto?.alcance || "individual";
    row.querySelector(".o-descripcion").value = objeto.descripcion || "";
  }

  const efectoSelect = row.querySelector(".o-efecto-tipo");
  const actualizarCamposEfecto = () => {
    const tipo = efectoSelect.value;
    row.querySelector(".o-campos-alcance").style.display = tipo === "ninguno" ? "none" : "block";
    row.querySelector(".o-campos-danio").style.display = tipo === "danio" ? "block" : "none";
  };
  efectoSelect.addEventListener("change", actualizarCamposEfecto);
  actualizarCamposEfecto();

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
    document.querySelectorAll(".p-resistencia").forEach((sel) => (sel.value = "1"));
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
  const r = p.resistencias || {};
  document.querySelectorAll(".p-resistencia").forEach((sel) => {
    sel.value = r[sel.dataset.tipo] ?? 1;
  });
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
      atributo: row.querySelector(".h-atributo").value,
      tipoDanio: row.querySelector(".h-tipo-danio").value,
      esAtaque: row.querySelector(".h-es-ataque").checked,
      detectaTrampas: row.querySelector(".h-detecta-trampas").checked,
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
        tipoDanio: row.querySelector(".o-efecto-tipo-danio").value,
        alcance: row.querySelector(".o-efecto-alcance").value,
      },
    })
  );

  const resistencias = {};
  document.querySelectorAll(".p-resistencia").forEach((sel) => {
    resistencias[sel.dataset.tipo] = Number(sel.value);
  });

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
    resistencias,
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
    escenaActual: 0,
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
