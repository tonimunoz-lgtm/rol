// js/reinos.js
import {
  auth, db,
  signInAnonymously, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, onSnapshot,
  collection, addDoc, serverTimestamp,
  query, where, orderBy, getDocs, runTransaction,
} from "./firebase-config.js";
import {
  EDIFICIOS_DEF, ORDEN_EDIFICIOS, costeMejora, calcularProduccionTotal,
  recursosActuales, puedeCostear, generarCodigoMundo,
  fuerzaEjercito, defensaConMurallas, COSTE_SOLDADO, COSTE_CABALLERIA, calcularRango,
} from "./reinos-utils.js";

const $ = (id) => document.getElementById(id);
const PALETA_COLORES = ["#c0392b", "#2980b9", "#27ae60", "#f39c12", "#8e44ad", "#16a085", "#d35400", "#2c3e50", "#e91e8c", "#7f8c8d"];
const FILAS = 8;
const COLUMNAS = 12;
const SEGUNDOS_POR_CASILLA_VIAJE = 25;

let currentUid = null;
let mundoId = localStorage.getItem("reinos_mundoId") || null;
let mundoActual = null;
let reinoActual = null;
let todosLosReinos = {}; // uid -> reino, de TODOS los jugadores del mundo (para el mapa)
let casillaSeleccionada = null;
let pactosActuales = [];
let ataquesConjuntosActuales = [];
let ladronObjetivoSeleccionado = null;

// ---------- Arranque / sesión ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    await signInAnonymously(auth);
    return;
  }
  currentUid = user.uid;
  if (mundoId) {
    const reinoSnap = await getDoc(doc(db, "mundos", mundoId, "reinos", currentUid));
    if (reinoSnap.exists()) {
      arrancarJuego();
      return;
    }
  }
  // Sin mundo guardado (o el reino ya no existe): mostramos la entrada.
  $("reinos-entrada").style.display = "block";
});

async function generarImagenReino(tipo, datos) {
  const idToken = await auth.currentUser.getIdToken();
  const resp = await fetch("/api/generar-imagen-reino", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ tipo, datos }),
  });
  if (!resp.ok) {
    let detalle = "";
    try { detalle = (await resp.json()).error || ""; } catch (_) {}
    throw new Error(detalle || `Error ${resp.status} generando la imagen.`);
  }
  return (await resp.json()).url;
}

// ---------- Crear mundo ----------
$("btn-crear-mundo").addEventListener("click", async () => {
  const nombreMundo = $("in-nombre-mundo").value.trim();
  const nombreReino = $("in-nombre-reino-crear").value.trim();
  if (!nombreMundo || !nombreReino) return alert("Ponle nombre al mundo y a tu reino.");
  const boton = $("btn-crear-mundo");
  const status = $("crear-status");
  boton.disabled = true;
  status.textContent = "Generando el mapa del mundo con IA (puede tardar unos segundos)...";
  try {
    if (!auth.currentUser) await new Promise((r) => { const u = onAuthStateChanged(auth, () => { u(); r(); }); });
    const codigo = generarCodigoMundo();

    let mapaFondoUrl = "";
    try {
      mapaFondoUrl = await generarImagenReino("mapa-mundo", { descripcion: nombreMundo });
    } catch (e) {
      console.warn("No se pudo generar el mapa del mundo, seguimos sin él:", e.message);
    }

    await setDoc(doc(db, "mundos", codigo), {
      nombre: nombreMundo,
      codigo,
      filas: FILAS,
      columnas: COLUMNAS,
      mapaFondoUrl,
      jugadoresActuales: 0,
      maxJugadores: 10,
      creadoEn: serverTimestamp(),
      creadoPor: auth.currentUser.uid,
    });

    status.textContent = "Fundando tu reino...";
    await crearReinoEnMundo(codigo, nombreReino);
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    boton.disabled = false;
  }
});

// ---------- Unirse a un mundo existente ----------
$("btn-unirse-mundo").addEventListener("click", async () => {
  const codigo = $("in-codigo-mundo").value.trim().toUpperCase();
  const nombreReino = $("in-nombre-reino").value.trim();
  if (!codigo || !nombreReino) return alert("Pon el código del mundo y el nombre de tu reino.");
  const boton = $("btn-unirse-mundo");
  const status = $("unirse-status");
  boton.disabled = true;
  status.textContent = "Buscando el mundo...";
  try {
    if (!auth.currentUser) await new Promise((r) => { const u = onAuthStateChanged(auth, () => { u(); r(); }); });
    const snap = await getDoc(doc(db, "mundos", codigo));
    if (!snap.exists()) {
      status.textContent = "No existe ningún mundo con ese código.";
      boton.disabled = false;
      return;
    }
    const mundo = snap.data();
    if ((mundo.jugadoresActuales || 0) >= (mundo.maxJugadores || 10)) {
      status.textContent = "Ese mundo ya está completo (máximo 10 jugadores).";
      boton.disabled = false;
      return;
    }
    const reinoYaExiste = await getDoc(doc(db, "mundos", codigo, "reinos", auth.currentUser.uid));
    if (reinoYaExiste.exists()) {
      mundoId = codigo;
      localStorage.setItem("reinos_mundoId", codigo);
      arrancarJuego();
      return;
    }
    status.textContent = "Fundando tu reino...";
    await crearReinoEnMundo(codigo, nombreReino);
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    boton.disabled = false;
  }
});

// Busca una casilla libre razonable para el castillo nuevo, crea el
// documento de reino con los valores iniciales, y arranca el juego.
async function buscarPosicionLibre(codigo) {
  const reinosSnap = await getDocs(collection(db, "mundos", codigo, "reinos"));
  const ocupadas = new Set();
  reinosSnap.forEach((d) => (d.data().territorios || []).forEach((t) => ocupadas.add(`${t.f},${t.c}`)));

  for (let intento = 0; intento < 200; intento++) {
    const f = Math.floor(Math.random() * FILAS);
    const c = Math.floor(Math.random() * COLUMNAS);
    if (!ocupadas.has(`${f},${c}`)) return { posicion: { f, c }, totalReinos: reinosSnap.size };
  }
  throw new Error("El mundo está completamente ocupado, no hay hueco para un castillo nuevo.");
}

function valoresIniciales(nombreReino, colorAsignado, posicion) {
  const edificiosIniciales = Object.fromEntries(ORDEN_EDIFICIOS.map((k) => [k, { nivel: 0 }]));
  return {
    nombreReino,
    color: colorAsignado,
    posicion,
    territorios: [posicion],
    castilloNivel: 1,
    castilloImagenUrl: "",
    edificios: edificiosIniciales,
    recursos: { comida: 150, piedra: 150, oro: 100 },
    produccionPorHora: calcularProduccionTotal(edificiosIniciales),
    ultimaActualizacionRecursos: serverTimestamp(),
    construyendo: null,
    ejercito: { soldados: 5, caballeria: 0 },
    entrenando: null,
    entrenandoCaballeria: null,
    reputacion: 100,
    sorpresaDisponibleContra: null,
    vivo: true,
  };
}

async function crearReinoEnMundo(codigo, nombreReino) {
  const { posicion, totalReinos } = await buscarPosicionLibre(codigo);
  const colorAsignado = PALETA_COLORES[totalReinos % PALETA_COLORES.length];

  await setDoc(doc(db, "mundos", codigo, "reinos", auth.currentUser.uid), {
    ...valoresIniciales(nombreReino, colorAsignado, posicion),
    creadoEn: serverTimestamp(),
  });
  await updateDoc(doc(db, "mundos", codigo), { jugadoresActuales: totalReinos + 1 });

  mundoId = codigo;
  localStorage.setItem("reinos_mundoId", codigo);
  arrancarJuego();

  // El castillo genera su primera imagen ya con el juego arrancado (no
  // hace falta que el jugador espere aquí, se ve aparecer sola).
  generarImagenReino("castillo", { nivel: 1 }).then((url) => {
    updateDoc(doc(db, "mundos", codigo, "reinos", auth.currentUser.uid), { castilloImagenUrl: url }).catch(() => {});
  }).catch((e) => console.warn("No se pudo generar la imagen del castillo:", e.message));
}

// ---------- Arrancar el juego (una vez tenemos mundo + reino) ----------
let juegoYaArrancado = false;
function arrancarJuego() {
  if (juegoYaArrancado) return;
  juegoYaArrancado = true;
  $("reinos-entrada").style.display = "none";
  $("reinos-juego").style.display = "block";
  $("mundo-codigo-texto").textContent = `Mundo: ${mundoId}`;

  onSnapshot(doc(db, "mundos", mundoId), (snap) => {
    mundoActual = snap.data();
    renderMapaMundo();
  });

  onSnapshot(doc(db, "mundos", mundoId, "reinos", currentUid), (snap) => {
    if (!snap.exists()) return;
    reinoActual = snap.data();

    if (reinoActual.vivo === false) {
      $("reino-derrotado").style.display = "block";
      $("reino-vivo-contenido").style.display = "none";
      return;
    }
    $("reino-derrotado").style.display = "none";
    $("reino-vivo-contenido").style.display = "block";

    $("reino-titulo").textContent = `🏰 ${reinoActual.nombreReino}`;
    renderRecursos();
    renderCastillo();
    renderEdificios();
    renderMapaMundo();
    intentarFinalizarConstruccion();
    intentarFinalizarEntrenamiento();
    intentarFinalizarEntrenamientoCaballeria();
  });

  // El resto de reinos del mundo, para poder pintar el mapa entero.
  onSnapshot(collection(db, "mundos", mundoId, "reinos"), (snap) => {
    todosLosReinos = {};
    snap.forEach((d) => (todosLosReinos[d.id] = d.data()));
    renderMapaMundo();
  });

  onSnapshot(query(collection(db, "mundos", mundoId, "movimientos"), where("resuelto", "==", false)), (snap) => {
    const movimientos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMovimientos(movimientos);
    movimientos.forEach((m) => intentarResolverMovimiento(m));
  });

  onSnapshot(query(collection(db, "mundos", mundoId, "mensajes"), orderBy("timestamp", "asc")), (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === "added") añadirMensajeChatMundo(change.doc.data());
    });
  });

  onSnapshot(collection(db, "mundos", mundoId, "pactos"), (snap) => {
    pactosActuales = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderOtrosReinos();
    renderPactosPendientes();
  });

  onSnapshot(collection(db, "mundos", mundoId, "ataquesConjuntos"), (snap) => {
    ataquesConjuntosActuales = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAtaquesConjuntos();
  });

  onSnapshot(query(collection(db, "mundos", mundoId, "ladrones"), where("resuelto", "==", false)), (snap) => {
    const ladrones = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderLadrones(ladrones);
    ladrones.forEach((l) => intentarResolverLadron(l));
  });

  setInterval(() => {
    if (reinoActual) renderRecursos();
  }, 3000);
  setInterval(() => {
    intentarFinalizarConstruccion();
    intentarFinalizarEntrenamiento();
    intentarFinalizarEntrenamientoCaballeria();
  }, 4000);
}

$("btn-reconstruir-reino").addEventListener("click", async () => {
  const boton = $("btn-reconstruir-reino");
  boton.disabled = true;
  boton.textContent = "Buscando un nuevo lugar...";
  try {
    const { posicion } = await buscarPosicionLibre(mundoId);
    await setDoc(doc(db, "mundos", mundoId, "reinos", currentUid), valoresIniciales(reinoActual.nombreReino, reinoActual.color, posicion));
    await updateDoc(doc(db, "mundos", mundoId), { jugadoresActuales: Object.keys(todosLosReinos).length });
  } catch (e) {
    alert(`No se pudo reconstruir el reino: ${e.message}`);
    boton.disabled = false;
    boton.textContent = "🔄 Reconstruir mi reino";
  }
});

// ---------- Recursos ----------
function renderRecursos() {
  const r = recursosActuales(reinoActual);
  $("rec-comida").textContent = r.comida;
  $("rec-piedra").textContent = r.piedra;
  $("rec-oro").textContent = r.oro;
  $("rec-soldados").textContent = reinoActual.ejercito?.soldados || 0;
  $("rec-caballeria").textContent = reinoActual.ejercito?.caballeria || 0;
}

// Antes de gastar recursos en cualquier acción, "cerramos" el cálculo:
// guardamos en Firestore lo que hay AHORA MISMO (ya con lo producido desde
// la última vez) para no perder producción por el camino.
async function sincronizarRecursos() {
  const r = recursosActuales(reinoActual);
  await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), {
    recursos: r,
    ultimaActualizacionRecursos: serverTimestamp(),
  });
  reinoActual.recursos = r;
  reinoActual.ultimaActualizacionRecursos = { toMillis: () => Date.now() };
  return r;
}

// ---------- Castillo ----------
function renderCastillo() {
  const numTerritorios = (reinoActual.territorios || []).length;
  $("reino-rango-texto").textContent = calcularRango(numTerritorios);
  $("resumen-territorios").textContent = numTerritorios;
  $("resumen-ejercito").textContent = fuerzaEjercito(reinoActual.ejercito);
  $("resumen-reputacion").textContent = reinoActual.reputacion ?? 100;

  $("castillo-nivel").textContent = reinoActual.castilloNivel || 1;
  $("castillo-imagen").innerHTML = reinoActual.castilloImagenUrl
    ? `<img src="${reinoActual.castilloImagenUrl}" />`
    : "🏰";
  const boton = $("btn-mejorar-castillo");
  if (reinoActual.construyendo) {
    boton.disabled = true;
    boton.textContent = `Construyendo "${reinoActual.construyendo.nombre}"...`;
  } else {
    boton.disabled = false;
    const coste = costeMejora(reinoActual.castilloNivel || 1);
    boton.textContent = `Mejorar (🌾${coste.comida} 🪨${coste.piedra} 🪙${coste.oro}, ${coste.segundos}s)`;
  }
}

$("btn-mejorar-castillo").addEventListener("click", () => iniciarConstruccion("castillo"));

// ---------- Edificios ----------
function renderEdificios() {
  const cont = $("lista-edificios");
  cont.innerHTML = ORDEN_EDIFICIOS.map((clave) => {
    const def = EDIFICIOS_DEF[clave];
    const nivel = reinoActual.edificios?.[clave]?.nivel || 0;
    const coste = costeMejora(nivel);
    const enConstruccion = reinoActual.construyendo?.clave === clave;
    return `
      <div class="edificio-card">
        <div class="edificio-imagen">${reinoActual.edificios?.[clave]?.imagenUrl ? `<img src="${reinoActual.edificios[clave].imagenUrl}" />` : def.icono}</div>
        <div style="flex:1;">
          <strong>${def.nombre} — Nivel ${nivel}</strong>
          <p style="color:var(--parchment-dim); font-size:.78rem; margin:.2em 0;">${def.descripcion}</p>
          <button class="btn-mejorar-edificio" data-clave="${clave}" ${enConstruccion || reinoActual.construyendo ? "disabled" : ""} style="font-size:.75rem;">
            ${enConstruccion ? "Construyendo..." : reinoActual.construyendo ? "Espera a que termine lo actual" : `Mejorar (🌾${coste.comida} 🪨${coste.piedra} 🪙${coste.oro}, ${coste.segundos}s)`}
          </button>
        </div>
      </div>`;
  }).join("");
  cont.querySelectorAll(".btn-mejorar-edificio").forEach((btn) => {
    btn.addEventListener("click", () => iniciarConstruccion(btn.dataset.clave));
  });
  $("barracones-nivel-texto").textContent = reinoActual.edificios?.barracones?.nivel || 0;
  $("cuadras-nivel-texto").textContent = reinoActual.edificios?.cuadras?.nivel || 0;
}

async function iniciarConstruccion(clave) {
  if (reinoActual.construyendo) return alert("Ya tienes una construcción en marcha. Espera a que termine.");
  const nivelActual = clave === "castillo" ? reinoActual.castilloNivel || 1 : reinoActual.edificios?.[clave]?.nivel || 0;
  const coste = costeMejora(nivelActual);
  const recursos = await sincronizarRecursos();
  if (!puedeCostear(recursos, coste)) return alert("No tienes recursos suficientes todavía.");

  await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), {
    recursos: { comida: recursos.comida - coste.comida, piedra: recursos.piedra - coste.piedra, oro: recursos.oro - coste.oro },
    construyendo: {
      clave,
      nombre: clave === "castillo" ? "Castillo" : EDIFICIOS_DEF[clave].nombre,
      nivelObjetivo: nivelActual + 1,
      finalizaEn: Date.now() + coste.segundos * 1000,
    },
  });
}

// Si ya ha pasado el tiempo de construcción, cualquier cliente (el propio
// jugador, normalmente) puede darlo por terminado: sube el nivel, y de
// paso genera la imagen nueva del edificio en ese nivel.
async function intentarFinalizarConstruccion() {
  if (!reinoActual?.construyendo) return;
  if (Date.now() < reinoActual.construyendo.finalizaEn) return;
  const { clave, nivelObjetivo } = reinoActual.construyendo;

  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "mundos", mundoId, "reinos", currentUid);
      const snap = await tx.get(ref);
      const data = snap.data();
      if (!data.construyendo || data.construyendo.clave !== clave) return; // ya se resolvió
      const cambios = { construyendo: null };
      if (clave === "castillo") cambios.castilloNivel = nivelObjetivo;
      else cambios[`edificios.${clave}.nivel`] = nivelObjetivo;
      const nuevosEdificios = { ...data.edificios };
      if (clave !== "castillo") nuevosEdificios[clave] = { ...nuevosEdificios[clave], nivel: nivelObjetivo };
      cambios.produccionPorHora = calcularProduccionTotal(clave === "castillo" ? data.edificios : nuevosEdificios);
      tx.update(ref, cambios);
    });

    // Imagen nueva para el nivel alcanzado (fuera de la transacción, no es crítico).
    try {
      const url = await generarImagenReino(
        clave === "castillo" ? "castillo" : "edificio",
        clave === "castillo" ? { nivel: nivelObjetivo } : { nombre: EDIFICIOS_DEF[clave].nombre, nivel: nivelObjetivo }
      );
      if (clave === "castillo") await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), { castilloImagenUrl: url });
      else await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), { [`edificios.${clave}.imagenUrl`]: url });
    } catch (e) {
      console.warn("No se pudo generar la imagen del edificio mejorado:", e.message);
    }
  } catch (e) {
    console.warn("No se pudo finalizar la construcción:", e.message);
  }
}

// ---------- Ejército: entrenar soldados y caballería ----------
$("btn-entrenar-soldados").addEventListener("click", async () => {
  const cantidad = Math.max(1, Number($("in-num-soldados").value) || 1);
  if ((reinoActual.edificios?.barracones?.nivel || 0) < 1) {
    return ($("entrenar-status").textContent = "Necesitas al menos nivel 1 en tus barracones.");
  }
  if (reinoActual.entrenando) return ($("entrenar-status").textContent = "Ya hay una tanda de soldados entrenándose.");
  const coste = {
    comida: COSTE_SOLDADO.comida * cantidad,
    piedra: COSTE_SOLDADO.piedra * cantidad,
    oro: COSTE_SOLDADO.oro * cantidad,
  };
  const recursos = await sincronizarRecursos();
  if (!puedeCostear(recursos, coste)) return ($("entrenar-status").textContent = "No tienes recursos suficientes.");

  await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), {
    recursos: { comida: recursos.comida - coste.comida, piedra: recursos.piedra - coste.piedra, oro: recursos.oro - coste.oro },
    entrenando: { cantidad, finalizaEn: Date.now() + COSTE_SOLDADO.segundos * cantidad * 1000 },
  });
  $("entrenar-status").textContent = `Entrenando ${cantidad} soldados...`;
});

async function intentarFinalizarEntrenamiento() {
  if (!reinoActual?.entrenando) return;
  if (Date.now() < reinoActual.entrenando.finalizaEn) return;
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "mundos", mundoId, "reinos", currentUid);
      const snap = await tx.get(ref);
      const data = snap.data();
      if (!data.entrenando) return;
      tx.update(ref, {
        entrenando: null,
        "ejercito.soldados": (data.ejercito?.soldados || 0) + data.entrenando.cantidad,
      });
    });
    $("entrenar-status").textContent = "";
  } catch (e) {
    console.warn("No se pudo finalizar el entrenamiento:", e.message);
  }
}

$("btn-entrenar-caballeria").addEventListener("click", async () => {
  const cantidad = Math.max(1, Number($("in-num-caballeria").value) || 1);
  if ((reinoActual.edificios?.cuadras?.nivel || 0) < 1) {
    return ($("entrenar-caballeria-status").textContent = "Necesitas al menos nivel 1 en tus cuadras.");
  }
  if (reinoActual.entrenandoCaballeria) return ($("entrenar-caballeria-status").textContent = "Ya hay una tanda de caballería entrenándose.");
  const coste = {
    comida: COSTE_CABALLERIA.comida * cantidad,
    piedra: COSTE_CABALLERIA.piedra * cantidad,
    oro: COSTE_CABALLERIA.oro * cantidad,
  };
  const recursos = await sincronizarRecursos();
  if (!puedeCostear(recursos, coste)) return ($("entrenar-caballeria-status").textContent = "No tienes recursos suficientes.");

  await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), {
    recursos: { comida: recursos.comida - coste.comida, piedra: recursos.piedra - coste.piedra, oro: recursos.oro - coste.oro },
    entrenandoCaballeria: { cantidad, finalizaEn: Date.now() + COSTE_CABALLERIA.segundos * cantidad * 1000 },
  });
  $("entrenar-caballeria-status").textContent = `Entrenando ${cantidad} jinetes...`;
});

async function intentarFinalizarEntrenamientoCaballeria() {
  if (!reinoActual?.entrenandoCaballeria) return;
  if (Date.now() < reinoActual.entrenandoCaballeria.finalizaEn) return;
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "mundos", mundoId, "reinos", currentUid);
      const snap = await tx.get(ref);
      const data = snap.data();
      if (!data.entrenandoCaballeria) return;
      tx.update(ref, {
        entrenandoCaballeria: null,
        "ejercito.caballeria": (data.ejercito?.caballeria || 0) + data.entrenandoCaballeria.cantidad,
      });
    });
    $("entrenar-caballeria-status").textContent = "";
  } catch (e) {
    console.warn("No se pudo finalizar el entrenamiento de caballería:", e.message);
  }
}

// ---------- Pestañas ----------
document.querySelectorAll(".reinos-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".reinos-tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".reinos-tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(`reinos-tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// ---------- Mapa del mundo ----------
function renderMapaMundo() {
  if (!mundoActual) return;
  const cont = $("mundo-mapa-lienzo");
  const anchoCelda = 100 / COLUMNAS;
  const altoCelda = 100 / FILAS;

  const propietarioPorCasilla = {};
  const capitalPorUid = {};
  Object.entries(todosLosReinos).forEach(([uid, reino]) => {
    (reino.territorios || []).forEach((t) => (propietarioPorCasilla[`${t.f},${t.c}`] = { uid, color: reino.color, nombre: reino.nombreReino }));
    if (reino.territorios?.[0]) capitalPorUid[uid] = reino.territorios[0];
  });

  let celdas = "";
  for (let f = 0; f < FILAS; f++) {
    for (let c = 0; c < COLUMNAS; c++) {
      const propietario = propietarioPorCasilla[`${f},${c}`];
      const esPropia = propietario?.uid === currentUid;
      const color = propietario ? propietario.color : "transparent";
      const opacidad = propietario ? (esPropia ? 0.6 : 0.42) : 0;
      celdas += `<rect class="celda-mapa${esPropia ? " celda-mia" : ""}" data-f="${f}" data-c="${c}" x="${c * anchoCelda}" y="${f * altoCelda}" width="${anchoCelda}" height="${altoCelda}" fill="${color}" fill-opacity="${opacidad}" />`;
    }
  }

  // Un castillo bien visible + el nombre del reino, en la casilla capital
  // de cada jugador — así se ve claramente "aquí está el castillo de X",
  // no solo un cuadrado de color sin más.
  let castillos = "";
  Object.entries(capitalPorUid).forEach(([uid, cap]) => {
    const reino = todosLosReinos[uid];
    const cx = cap.c * anchoCelda + anchoCelda / 2;
    const cy = cap.f * altoCelda + altoCelda / 2;
    castillos += `
      <g transform="translate(${cx}, ${cy})" style="pointer-events:none;">
        <circle r="2.6" fill="${reino.color}" stroke="#14110D" stroke-width="0.4" />
        <text text-anchor="middle" dominant-baseline="central" font-size="3">🏰</text>
        <text text-anchor="middle" y="4.2" class="etiqueta-castillo">${reino.nombreReino}</text>
      </g>`;
  });

  const fondo = mundoActual.mapaFondoUrl
    ? `<image href="${mundoActual.mapaFondoUrl}" x="0" y="0" width="100" height="100" preserveAspectRatio="none" />`
    : `<rect x="0" y="0" width="100" height="100" fill="#6b8f4e" />`;

  cont.innerHTML = `<svg id="mundo-mapa-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${fondo}${celdas}${castillos}</svg>`;
  cont.querySelectorAll(".celda-mapa").forEach((el) => {
    el.addEventListener("click", () => seleccionarCasilla(Number(el.dataset.f), Number(el.dataset.c)));
  });
}

$("btn-regenerar-mapa").addEventListener("click", async () => {
  const boton = $("btn-regenerar-mapa");
  boton.disabled = true;
  boton.textContent = "Generando...";
  try {
    const url = await generarImagenReino("mapa-mundo", { descripcion: mundoActual?.nombre || "" });
    await updateDoc(doc(db, "mundos", mundoId), { mapaFondoUrl: url });
  } catch (e) {
    alert(`No se pudo regenerar el mapa: ${e.message}`);
  } finally {
    boton.disabled = false;
    boton.textContent = "🔄 Regenerar imagen del mapa";
  }
});

// ---------- Zoom y paneo del mapa (arrastrar, pellizcar, rueda) ----------
let zoomMapa = 1;
let panXMapa = 0;
let panYMapa = 0;
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;

function aplicarTransformMapaMundo() {
  $("mundo-mapa-lienzo").style.transform = `translate(${panXMapa}px, ${panYMapa}px) scale(${zoomMapa})`;
}

function centrarMapaMundo() {
  zoomMapa = 1;
  panXMapa = 0;
  panYMapa = 0;
  aplicarTransformMapaMundo();
}

$("btn-mapa-mundo-zoom-mas").addEventListener("click", () => {
  zoomMapa = Math.min(ZOOM_MAX, zoomMapa * 1.3);
  aplicarTransformMapaMundo();
});
$("btn-mapa-mundo-zoom-menos").addEventListener("click", () => {
  zoomMapa = Math.max(ZOOM_MIN, zoomMapa / 1.3);
  aplicarTransformMapaMundo();
});
$("btn-mapa-mundo-centrar").addEventListener("click", centrarMapaMundo);

const punterosMapaMundo = new Map();
let distanciaPinchInicialMundo = null;
let escalaPinchInicialMundo = 1;

const viewportMundo = $("mundo-mapa-viewport");
viewportMundo.addEventListener("pointerdown", (e) => {
  viewportMundo.setPointerCapture(e.pointerId);
  punterosMapaMundo.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (punterosMapaMundo.size === 2) {
    const [p1, p2] = Array.from(punterosMapaMundo.values());
    distanciaPinchInicialMundo = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    escalaPinchInicialMundo = zoomMapa;
  }
});
viewportMundo.addEventListener("pointermove", (e) => {
  if (!punterosMapaMundo.has(e.pointerId)) return;
  const anterior = punterosMapaMundo.get(e.pointerId);
  punterosMapaMundo.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (punterosMapaMundo.size === 2 && distanciaPinchInicialMundo) {
    const [p1, p2] = Array.from(punterosMapaMundo.values());
    const distancia = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    zoomMapa = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, escalaPinchInicialMundo * (distancia / distanciaPinchInicialMundo)));
    aplicarTransformMapaMundo();
  } else if (punterosMapaMundo.size === 1) {
    panXMapa += e.clientX - anterior.x;
    panYMapa += e.clientY - anterior.y;
    aplicarTransformMapaMundo();
  }
});
function soltarPunteroMapaMundo(e) {
  punterosMapaMundo.delete(e.pointerId);
  if (punterosMapaMundo.size < 2) distanciaPinchInicialMundo = null;
}
viewportMundo.addEventListener("pointerup", soltarPunteroMapaMundo);
viewportMundo.addEventListener("pointercancel", soltarPunteroMapaMundo);
viewportMundo.addEventListener("pointerleave", soltarPunteroMapaMundo);
viewportMundo.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    zoomMapa = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomMapa * (e.deltaY < 0 ? 1.15 : 0.87)));
    aplicarTransformMapaMundo();
  },
  { passive: false }
);

function sonVecinas(a, b) {
  return Math.abs(a.f - b.f) + Math.abs(a.c - b.c) === 1;
}

function seleccionarCasilla(f, c) {
  if (!reinoActual) return;
  const esVecinaDeAlgunaPropia = (reinoActual.territorios || []).some((t) => sonVecinas(t, { f, c }));
  const yaEsMia = (reinoActual.territorios || []).some((t) => t.f === f && t.c === c);
  if (yaEsMia) return;
  if (!esVecinaDeAlgunaPropia) {
    $("ataque-panel").style.display = "none";
    return alert("Solo puedes atacar casillas justo al lado de tu territorio.");
  }
  casillaSeleccionada = { f, c };
  const propietario = Object.entries(todosLosReinos).find(([uid, r]) => (r.territorios || []).some((t) => t.f === f && t.c === c));

  if (propietario && estadoPactoCon(propietario[0])?.estado === "aceptado") {
    $("ataque-panel").style.display = "none";
    return alert(`No puedes atacar a "${propietario[1].nombreReino}" — tenéis una alianza activa. Rómpela primero desde la pestaña "Reinos" si quieres atacarle.`);
  }

  if (propietario) {
    const nivelMurallas = propietario[1].edificios?.murallas?.nivel || 0;
    const fuerza = Math.round(defensaConMurallas(propietario[1]));
    $("ataque-info").textContent =
      `Atacar a "${propietario[1].nombreReino}" en (${f},${c}). Fuerza defensiva estimada: ${fuerza}` +
      (nivelMurallas > 0 ? ` (incluye el bonus de sus murallas nivel ${nivelMurallas}).` : ".");
  } else {
    $("ataque-info").textContent = `Conquistar casilla libre (${f},${c}) — sin defensores, la ocupas directamente al llegar.`;
  }

  const aliado = aliadoActivo();
  $("btn-proponer-ataque-conjunto").style.display = aliado ? "inline-block" : "none";
  if (aliado) $("btn-proponer-ataque-conjunto").textContent = `🤝 Proponer ataque conjunto con ${aliado.nombre}`;

  $("ataque-panel").style.display = "block";
}

$("btn-cancelar-ataque").addEventListener("click", () => {
  casillaSeleccionada = null;
  $("ataque-panel").style.display = "none";
});

$("btn-proponer-ataque-conjunto").addEventListener("click", async () => {
  if (!casillaSeleccionada) return;
  const aliado = aliadoActivo();
  if (!aliado) return;
  const soldadosEnviados = Math.max(0, Number($("in-soldados-ataque").value) || 0);
  const caballeriaEnviada = Math.max(0, Number($("in-caballeria-ataque").value) || 0);
  if (soldadosEnviados + caballeriaEnviada === 0) return alert("Aporta al menos una tropa tuya al ataque.");
  if (soldadosEnviados > (reinoActual.ejercito?.soldados || 0)) return alert("No tienes tantos soldados disponibles.");
  if (caballeriaEnviada > (reinoActual.ejercito?.caballeria || 0)) return alert("No tienes tanta caballería disponible.");

  const propietarioDestino = Object.entries(todosLosReinos).find(([uid, r]) => (r.territorios || []).some((t) => t.f === casillaSeleccionada.f && t.c === casillaSeleccionada.c));

  // Tus tropas quedan "reservadas" para este ataque conjunto ya mismo (se
  // descuentan de tu ejército), igual que en un ataque normal.
  await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), {
    "ejercito.soldados": (reinoActual.ejercito.soldados || 0) - soldadosEnviados,
    "ejercito.caballeria": (reinoActual.ejercito.caballeria || 0) - caballeriaEnviada,
  });

  await addDoc(collection(db, "mundos", mundoId, "ataquesConjuntos"), {
    destino: casillaSeleccionada,
    destinoDefensorUid: propietarioDestino ? propietarioDestino[0] : null,
    destinoDefensorNombre: propietarioDestino ? propietarioDestino[1].nombreReino : null,
    iniciadorUid: currentUid,
    iniciadorNombre: reinoActual.nombreReino,
    aliadoUid: aliado.uid,
    aliadoNombre: aliado.nombre,
    tropasIniciador: { soldados: soldadosEnviados, caballeria: caballeriaEnviada },
    tropasAliado: null,
    estado: "esperando_aliado",
    creadoEn: serverTimestamp(),
  });

  casillaSeleccionada = null;
  $("ataque-panel").style.display = "none";
  alert(`Propuesta enviada a ${aliado.nombre}. En cuanto aporte sus tropas, cualquiera de los dos podrá lanzar el ataque conjunto desde la pestaña "Reinos".`);
});

$("btn-enviar-ataque").addEventListener("click", async () => {
  if (!casillaSeleccionada) return;
  const soldadosEnviados = Math.max(0, Number($("in-soldados-ataque").value) || 0);
  const caballeriaEnviada = Math.max(0, Number($("in-caballeria-ataque").value) || 0);
  if (soldadosEnviados + caballeriaEnviada === 0) return alert("Envía al menos una tropa.");
  if (soldadosEnviados > (reinoActual.ejercito?.soldados || 0)) return alert("No tienes tantos soldados disponibles.");
  if (caballeriaEnviada > (reinoActual.ejercito?.caballeria || 0)) return alert("No tienes tanta caballería disponible.");

  const origen = reinoActual.territorios[0]; // el castillo, punto de partida
  const distancia = Math.abs(origen.f - casillaSeleccionada.f) + Math.abs(origen.c - casillaSeleccionada.c);
  // Una expedición compuesta solo de caballería viaja al doble de
  // velocidad; en cuanto lleva algo de infantería, va al ritmo de a pie.
  const soloCaballeria = caballeriaEnviada > 0 && soldadosEnviados === 0;
  const segundosPorCasilla = soloCaballeria ? SEGUNDOS_POR_CASILLA_VIAJE / 2 : SEGUNDOS_POR_CASILLA_VIAJE;
  const propietarioDestino = Object.entries(todosLosReinos).find(([uid, r]) => (r.territorios || []).some((t) => t.f === casillaSeleccionada.f && t.c === casillaSeleccionada.c));

  // Si traicionaste a este mismo reino hace poco, este ataque es la
  // emboscada por sorpresa que te ganaste — se consume al usarla.
  const sorpresa = reinoActual.sorpresaDisponibleContra;
  const aplicaSorpresa = sorpresa && propietarioDestino && sorpresa.uid === propietarioDestino[0] && sorpresa.expiraEn > Date.now();

  await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), {
    "ejercito.soldados": (reinoActual.ejercito.soldados || 0) - soldadosEnviados,
    "ejercito.caballeria": (reinoActual.ejercito.caballeria || 0) - caballeriaEnviada,
    ...(aplicaSorpresa ? { sorpresaDisponibleContra: null } : {}),
  });

  await addDoc(collection(db, "mundos", mundoId, "movimientos"), {
    atacanteUid: currentUid,
    atacanteNombre: reinoActual.nombreReino,
    defensorUid: propietarioDestino ? propietarioDestino[0] : null,
    defensorNombre: propietarioDestino ? propietarioDestino[1].nombreReino : null,
    destino: casillaSeleccionada,
    soldadosEnviados,
    caballeriaEnviada,
    ataqueSorpresa: !!aplicaSorpresa,
    salida: Date.now(),
    llegada: Date.now() + distancia * segundosPorCasilla * 1000,
    resuelto: false,
  });

  casillaSeleccionada = null;
  $("ataque-panel").style.display = "none";
});

function renderMovimientos(movimientos) {
  const cont = $("lista-movimientos");
  const relevantes = movimientos.filter((m) => m.atacanteUid === currentUid || m.defensorUid === currentUid);
  if (relevantes.length === 0) {
    cont.innerHTML = "";
    return;
  }
  cont.innerHTML =
    `<h3 style="font-size:1rem;">Ejércitos en marcha</h3>` +
    relevantes
      .map((m) => {
        const restante = Math.max(0, Math.round((m.llegada - Date.now()) / 1000));
        const esMio = m.atacanteUid === currentUid;
        const composicion = [m.soldadosEnviados ? `${m.soldadosEnviados} soldados` : "", m.caballeriaEnviada ? `${m.caballeriaEnviada} jinetes` : ""]
          .filter(Boolean)
          .join(" + ");
        return `<div class="registro-linea">${esMio ? `Tu ejército (${composicion}) marcha hacia (${m.destino.f},${m.destino.c})` : `⚠️ ${m.atacanteNombre} envía ${composicion} hacia tu casilla (${m.destino.f},${m.destino.c})`} — llega en ${restante}s</div>`;
      })
      .join("");
}

// Resuelve una batalla cuando ya ha llegado su hora — cualquier cliente
// conectado puede hacerlo, transaccional para que no se duplique.
async function intentarResolverMovimiento(movimiento) {
  if (Date.now() < movimiento.llegada) return;
  try {
    await runTransaction(db, async (tx) => {
      const movRef = doc(db, "mundos", mundoId, "movimientos", movimiento.id);
      const movSnap = await tx.get(movRef);
      const mov = movSnap.data();
      if (!mov || mov.resuelto) return;

      let textoResultado;
      if (!mov.defensorUid) {
        // Casilla libre: se ocupa directamente.
        const atacanteRef = doc(db, "mundos", mundoId, "reinos", mov.atacanteUid);
        const atacanteSnap = await tx.get(atacanteRef);
        const atacante = atacanteSnap.data();
        tx.update(atacanteRef, { territorios: [...(atacante.territorios || []), mov.destino] });
        textoResultado = `${mov.atacanteNombre} ocupa una casilla libre.`;
      } else {
        const defensorRef = doc(db, "mundos", mundoId, "reinos", mov.defensorUid);
        const defensorSnap = await tx.get(defensorRef);
        const defensor = defensorSnap.data();

        let fuerzaAtacante = (mov.soldadosEnviados || 0) + (mov.caballeriaEnviada || 0) * 2;
        if (mov.ataqueSorpresa) fuerzaAtacante = Math.round(fuerzaAtacante * 1.25);
        const fuerzaDefensiva = defensaConMurallas(defensor);
        const nivelMurallas = defensor.edificios?.murallas?.nivel || 0;

        if (fuerzaAtacante > fuerzaDefensiva) {
          // El atacante gana: se queda la casilla, el defensor pierde todo
          // el ejército que tenía plantado ahí.
          const atacanteRef = doc(db, "mundos", mundoId, "reinos", mov.atacanteUid);
          const atacanteSnap = await tx.get(atacanteRef);
          const atacante = atacanteSnap.data();
          tx.update(atacanteRef, { territorios: [...(atacante.territorios || []), mov.destino] });

          const territoriosRestantes = (defensor.territorios || []).filter((t) => !(t.f === mov.destino.f && t.c === mov.destino.c));
          const cambiosDefensor = { "ejercito.soldados": 0, "ejercito.caballeria": 0, territorios: territoriosRestantes };
          if (territoriosRestantes.length === 0) cambiosDefensor.vivo = false; // se queda sin ningún castillo: derrotado
          tx.update(defensorRef, cambiosDefensor);

          textoResultado =
            territoriosRestantes.length === 0
              ? `👑 ${mov.atacanteNombre} conquista el último territorio de ${mov.defensorNombre} — ¡reino derrotado!`
              : `⚔️ ${mov.atacanteNombre} conquista una casilla de ${mov.defensorNombre}${mov.ataqueSorpresa ? " con una EMBOSCADA por sorpresa" : ""}${nivelMurallas > 0 ? ` (a pesar de sus murallas nivel ${nivelMurallas})` : ""}.`;
        } else {
          // El defensor resiste, gracias en parte a sus murallas — pero
          // sufre bajas proporcionales al empuje del ataque recibido.
          const proporcionBajas = Math.min(1, fuerzaAtacante / Math.max(1, fuerzaDefensiva));
          const soldadosRestantes = Math.round((defensor.ejercito?.soldados || 0) * (1 - proporcionBajas));
          const caballeriaRestante = Math.round((defensor.ejercito?.caballeria || 0) * (1 - proporcionBajas));
          tx.update(defensorRef, {
            "ejercito.soldados": soldadosRestantes,
            "ejercito.caballeria": caballeriaRestante,
          });
          textoResultado = `🛡️ ${mov.defensorNombre} repele el ataque de ${mov.atacanteNombre}${nivelMurallas > 0 ? ` gracias a sus murallas (nivel ${nivelMurallas})` : ""}.`;
        }
      }

      tx.update(movRef, { resuelto: true, resultado: textoResultado });
    });
  } catch (e) {
    console.warn("No se pudo resolver el movimiento:", e.message);
  }
}

// ---------- Chat del mundo (flotante, estilo Twitch, se desvanece solo) ----------
const MAX_LINEAS_CHAT = 4; // la franja fija de arriba es más pequeña que en Rúnica, no caben tantas líneas a la vez
const DURACION_LINEA_CHAT_MS = 20000;

function colorParaUid(uid) {
  let hash = 0;
  for (let i = 0; i < String(uid).length; i++) hash = String(uid).charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${hash % 360}, 65%, 68%)`;
}

function añadirMensajeChatMundo(mensaje) {
  const cont = $("chat-overlay");
  const color = mensaje.autorUid === "sistema" ? "#F0C93B" : colorParaUid(mensaje.autorUid);
  const linea = document.createElement("div");
  linea.className = "chat-linea";
  linea.innerHTML = `<span class="chat-autor" style="color:${color};">${mensaje.autorNombre}:</span> ${mensaje.texto}`;
  cont.appendChild(linea);

  while (cont.children.length > MAX_LINEAS_CHAT) cont.removeChild(cont.firstChild);

  setTimeout(() => {
    linea.classList.add("saliendo");
    setTimeout(() => linea.remove(), 1000);
  }, DURACION_LINEA_CHAT_MS);
}

$("btn-abrir-chat").addEventListener("click", () => {
  $("chat-input-flotante").classList.toggle("visible");
  if ($("chat-input-flotante").classList.contains("visible")) $("in-chat-texto").focus();
});

$("btn-enviar-chat").addEventListener("click", async () => {
  const texto = $("in-chat-texto").value.trim();
  if (!texto || !reinoActual) return;
  await addDoc(collection(db, "mundos", mundoId, "mensajes"), {
    autorUid: currentUid,
    autorNombre: reinoActual.nombreReino,
    texto: texto.slice(0, 300),
    timestamp: serverTimestamp(),
  });
  $("in-chat-texto").value = "";
});
$("in-chat-texto").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("btn-enviar-chat").click();
});

// ---------- Reinos: lista, pactos de alianza, y espionaje ----------
function estadoPactoCon(uidOtro) {
  const pacto = pactosActuales.find((p) => p.estado !== "roto" && p.jugadores.includes(uidOtro));
  return pacto || null;
}

// Devuelve tu aliado activo con alianza MILITAR (si tienes uno) — { uid,
// nombre } — o null. Solo la alianza militar permite ataques conjuntos; la
// de no agresión solo impide atacaros entre vosotros.
function aliadoActivo() {
  const pacto = pactosActuales.find((p) => p.estado === "aceptado" && p.tipo === "alianza_militar" && p.jugadores.includes(currentUid));
  if (!pacto) return null;
  const uidAliado = pacto.jugadores.find((u) => u !== currentUid);
  return { uid: uidAliado, nombre: pacto.nombres?.[uidAliado] || "tu aliado" };
}

const ETIQUETAS_TIPO_PACTO = { no_agresion: "🕊️ No agresión", alianza_militar: "⚔️ Alianza militar" };

// ---------- Alerta central: aparece sola cuando alguien espera tu respuesta ----------
let pactoEnNegociacion = null;

function comprobarNegociacionesPendientes() {
  const pendiente = pactosActuales.find((p) => p.estado === "pendiente" && p.ultimaPropuestaPor !== currentUid && p.jugadores.includes(currentUid));
  if (!pendiente) {
    $("negociacion-modal").classList.remove("visible");
    pactoEnNegociacion = null;
    return;
  }
  if (pactoEnNegociacion?.id === pendiente.id && $("negociacion-modal").classList.contains("visible")) return; // ya mostrada
  pactoEnNegociacion = pendiente;
  const otroUid = pendiente.jugadores.find((u) => u !== currentUid);
  const otroNombre = pendiente.nombres?.[otroUid] || "Un reino";
  $("negociacion-titulo").textContent = "🤝 Propuesta diplomática";
  $("negociacion-texto").textContent =
    `${otroNombre} propone: ${ETIQUETAS_TIPO_PACTO[pendiente.tipo] || pendiente.tipo}.` + (pendiente.mensaje ? ` "${pendiente.mensaje}"` : "");
  const historial = pendiente.historial || [];
  if (historial.length > 1) {
    $("negociacion-historial").style.display = "block";
    $("negociacion-historial").innerHTML = historial
      .map((h) => `<div>${h.nombre}: ${ETIQUETAS_TIPO_PACTO[h.tipo] || h.tipo}${h.mensaje ? ` — "${h.mensaje}"` : ""}</div>`)
      .join("");
  } else {
    $("negociacion-historial").style.display = "none";
  }
  $("negociacion-modal").classList.add("visible");
}

$("btn-negociacion-aceptar").addEventListener("click", async () => {
  if (!pactoEnNegociacion) return;
  await updateDoc(doc(db, "mundos", mundoId, "pactos", pactoEnNegociacion.id), { estado: "aceptado" });
  await addDoc(collection(db, "mundos", mundoId, "mensajes"), {
    autorUid: "sistema",
    autorNombre: "📯 Heraldo",
    texto: `🤝 ${reinoActual.nombreReino} y ${pactoEnNegociacion.nombres[pactoEnNegociacion.jugadores.find((u) => u !== currentUid)]} han sellado un pacto de ${ETIQUETAS_TIPO_PACTO[pactoEnNegociacion.tipo]}.`,
    timestamp: serverTimestamp(),
  });
  $("negociacion-modal").classList.remove("visible");
});

$("btn-negociacion-rechazar").addEventListener("click", async () => {
  if (!pactoEnNegociacion) return;
  await updateDoc(doc(db, "mundos", mundoId, "pactos", pactoEnNegociacion.id), { estado: "roto" });
  $("negociacion-modal").classList.remove("visible");
});

$("btn-negociacion-contraofertar").addEventListener("click", () => {
  if (!pactoEnNegociacion) return;
  $("negociacion-modal").classList.remove("visible");
  abrirProponerPacto(
    pactoEnNegociacion.jugadores.find((u) => u !== currentUid),
    pactoEnNegociacion.nombres[pactoEnNegociacion.jugadores.find((u) => u !== currentUid)],
    pactoEnNegociacion
  );
});

// ---------- Proponer o contraofertar ----------
let pactoObjetivoParaProponer = null; // { uid, nombre, pactoExistente }

function abrirProponerPacto(uid, nombre, pactoExistente = null) {
  pactoObjetivoParaProponer = { uid, nombre, pactoExistente };
  $("proponer-pacto-titulo").textContent = pactoExistente ? `Contraofertar a ${nombre}` : `Proponer pacto a ${nombre}`;
  $("sel-tipo-pacto").value = pactoExistente?.tipo || "no_agresion";
  $("in-mensaje-pacto").value = "";
  $("proponer-pacto-modal").classList.add("visible");
}
$("btn-cancelar-pacto").addEventListener("click", () => $("proponer-pacto-modal").classList.remove("visible"));

$("btn-confirmar-pacto").addEventListener("click", async () => {
  if (!pactoObjetivoParaProponer) return;
  const { uid, nombre, pactoExistente } = pactoObjetivoParaProponer;
  const tipo = $("sel-tipo-pacto").value;
  const mensaje = $("in-mensaje-pacto").value.trim().slice(0, 200);
  const entradaHistorial = { uid: currentUid, nombre: reinoActual.nombreReino, tipo, mensaje, timestamp: Date.now() };

  if (pactoExistente) {
    await updateDoc(doc(db, "mundos", mundoId, "pactos", pactoExistente.id), {
      tipo,
      mensaje,
      ultimaPropuestaPor: currentUid,
      estado: "pendiente",
      historial: [...(pactoExistente.historial || []), entradaHistorial],
      actualizadoEn: serverTimestamp(),
    });
  } else {
    await addDoc(collection(db, "mundos", mundoId, "pactos"), {
      jugadores: [currentUid, uid],
      nombres: { [currentUid]: reinoActual.nombreReino, [uid]: nombre },
      ultimaPropuestaPor: currentUid,
      tipo,
      mensaje,
      estado: "pendiente",
      historial: [entradaHistorial],
      actualizadoEn: serverTimestamp(),
    });
  }
  pactoObjetivoParaProponer = null;
  $("proponer-pacto-modal").classList.remove("visible");
});

function renderPactosPendientes() {
  // La alerta central ya avisa de las que necesitan tu respuesta — aquí
  // solo dejamos un resumen discreto de las que has enviado tú y esperan.
  const cont = $("lista-pactos-pendientes");
  const misPropuestasEnEspera = pactosActuales.filter((p) => p.estado === "pendiente" && p.ultimaPropuestaPor === currentUid && p.jugadores.includes(currentUid));
  if (misPropuestasEnEspera.length === 0) {
    cont.innerHTML = "";
    return;
  }
  cont.innerHTML = misPropuestasEnEspera
    .map((p) => {
      const otro = p.jugadores.find((u) => u !== currentUid);
      return `<p style="color:var(--parchment-dim); font-size:.8rem;">⏳ Esperando respuesta de ${p.nombres[otro]}...</p>`;
    })
    .join("");
  comprobarNegociacionesPendientes();
}

function renderOtrosReinos() {
  const cont = $("lista-otros-reinos");
  const otros = Object.entries(todosLosReinos).filter(([uid]) => uid !== currentUid);
  if (otros.length === 0) {
    cont.innerHTML = `<p style="color:var(--parchment-dim); font-size:.85rem;">Todavía no hay más reinos en este mundo.</p>`;
    return;
  }
  cont.innerHTML = otros
    .map(([uid, reino]) => {
      const pacto = estadoPactoCon(uid);
      let botonAlianza;
      if (!pacto) {
        botonAlianza = `<button class="btn-proponer-pacto" data-uid="${uid}" data-nombre="${reino.nombreReino}" style="font-size:.7rem;">🤝 Proponer pacto</button>`;
      } else if (pacto.estado === "pendiente") {
        botonAlianza = `<span class="mono" style="font-size:.7rem; color:var(--parchment-dim);">Negociación en curso</span>`;
      } else if (pacto.estado === "aceptado") {
        botonAlianza = `
          <button class="btn-romper-pacto" data-id="${pacto.id}" style="font-size:.7rem;">💔 Romper</button>
          <button class="btn-traicionar" data-id="${pacto.id}" data-uid="${uid}" data-nombre="${reino.nombreReino}" style="font-size:.7rem; color:var(--rust);">🗡️ Traicionar</button>`;
      } else {
        botonAlianza = `<button class="btn-proponer-pacto" data-uid="${uid}" data-nombre="${reino.nombreReino}" style="font-size:.7rem;">🤝 Proponer pacto</button>`;
      }
      return `
        <div class="reino-card">
          <div>
            <strong>${reino.nombreReino}</strong> ${pacto?.estado === "aceptado" ? ETIQUETAS_TIPO_PACTO[pacto.tipo] : ""}
            <p style="color:var(--parchment-dim); font-size:.75rem; margin:.1em 0;">${(reino.territorios || []).length} territorio(s) · reputación ${reino.reputacion ?? 100}</p>
          </div>
          <div style="display:flex; gap:.4em; flex-wrap:wrap; justify-content:flex-end;">
            ${botonAlianza}
            <button class="btn-elegir-ladron" data-uid="${uid}" data-nombre="${reino.nombreReino}" style="font-size:.7rem;">🕵️ Ladrón</button>
          </div>
        </div>`;
    })
    .join("");

  cont.querySelectorAll(".btn-proponer-pacto").forEach((btn) =>
    btn.addEventListener("click", () => abrirProponerPacto(btn.dataset.uid, btn.dataset.nombre))
  );
  cont.querySelectorAll(".btn-romper-pacto").forEach((btn) =>
    btn.addEventListener("click", () => updateDoc(doc(db, "mundos", mundoId, "pactos", btn.dataset.id), { estado: "roto" }))
  );
  cont.querySelectorAll(".btn-traicionar").forEach((btn) => btn.addEventListener("click", () => traicionar(btn.dataset.id, btn.dataset.uid, btn.dataset.nombre)));
  cont.querySelectorAll(".btn-elegir-ladron").forEach((btn) =>
    btn.addEventListener("click", () => elegirObjetivoLadron(btn.dataset.uid, btn.dataset.nombre))
  );
}

// ---------- Traición: rompes la alianza para siempre a cambio de una
// ventaja táctica puntual, pero todo el mundo se entera. ----------
async function traicionar(pactoId, uidVictima, nombreVictima) {
  if (!confirm(`¿Seguro que quieres traicionar a ${nombreVictima}? Perderás reputación y todo el mundo lo sabrá — pero tu próximo ataque contra ellos será una emboscada (+25% de fuerza) durante 5 minutos.`)) return;

  await updateDoc(doc(db, "mundos", mundoId, "pactos", pactoId), { estado: "roto" });
  await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), {
    reputacion: Math.max(0, (reinoActual.reputacion ?? 100) - 30),
    sorpresaDisponibleContra: { uid: uidVictima, expiraEn: Date.now() + 5 * 60 * 1000 },
  });
  await addDoc(collection(db, "mundos", mundoId, "mensajes"), {
    autorUid: "sistema",
    autorNombre: "📯 Heraldo",
    texto: `🗡️👑 ¡TRAICIÓN! ${reinoActual.nombreReino} ha roto su alianza con ${nombreVictima} por la espalda. Su reputación cae a ${Math.max(0, (reinoActual.reputacion ?? 100) - 30)}.`,
    timestamp: serverTimestamp(),
  });
}

function elegirObjetivoLadron(uidObjetivo, nombreObjetivo) {
  const pacto = estadoPactoCon(uidObjetivo);
  if (pacto?.estado === "aceptado") {
    return alert("No puedes robar a un reino aliado — rompe la alianza primero si quieres hacerlo.");
  }
  ladronObjetivoSeleccionado = { uid: uidObjetivo, nombre: nombreObjetivo };
  $("ladron-info").textContent = `Enviar un ladrón a robar recursos de "${nombreObjetivo}". Puede ser descubierto — sus murallas dificultan el robo.`;
  $("ladron-panel").style.display = "block";
}

$("btn-cancelar-ladron").addEventListener("click", () => {
  ladronObjetivoSeleccionado = null;
  $("ladron-panel").style.display = "none";
});

const COSTE_ENVIAR_LADRON = { comida: 20, piedra: 0, oro: 30 };
const SEGUNDOS_VIAJE_LADRON = 20;

$("btn-enviar-ladron").addEventListener("click", async () => {
  if (!ladronObjetivoSeleccionado) return;
  const recursos = await sincronizarRecursos();
  if (!puedeCostear(recursos, { ...COSTE_ENVIAR_LADRON, segundos: 0 })) {
    return ($("ladron-status").textContent = "No tienes recursos suficientes para pagar al ladrón.");
  }
  const objetivo = todosLosReinos[ladronObjetivoSeleccionado.uid];
  const origen = reinoActual.territorios[0];
  const destinoCapital = objetivo?.territorios?.[0] || origen;
  const distancia = Math.abs(origen.f - destinoCapital.f) + Math.abs(origen.c - destinoCapital.c) + 1;

  // Cuantas más murallas tenga el objetivo, más probable que detecte al
  // ladrón ANTES de que llegue — dándole tiempo a reaccionar de verdad.
  const nivelMurallasObjetivo = objetivo?.edificios?.murallas?.nivel || 0;
  const detectadoTemprano = Math.random() < Math.min(0.85, 0.15 + nivelMurallasObjetivo * 0.1);

  await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), {
    recursos: { comida: recursos.comida - COSTE_ENVIAR_LADRON.comida, piedra: recursos.piedra, oro: recursos.oro - COSTE_ENVIAR_LADRON.oro },
  });

  await addDoc(collection(db, "mundos", mundoId, "ladrones"), {
    atacanteUid: currentUid,
    atacanteNombre: reinoActual.nombreReino,
    defensorUid: ladronObjetivoSeleccionado.uid,
    defensorNombre: ladronObjetivoSeleccionado.nombre,
    llegada: Date.now() + distancia * SEGUNDOS_VIAJE_LADRON * 1000,
    detectadoTemprano,
    reaccionDefensor: null,
    resuelto: false,
  });

  $("ladron-status").textContent = "Ladrón en camino...";
  ladronObjetivoSeleccionado = null;
  setTimeout(() => ($("ladron-panel").style.display = "none"), 1200);
});

const COSTE_REFORZAR_GUARDIA = { oro: 40 };
const COSTE_TENDER_TRAMPA = { oro: 30, piedra: 30 };

function renderLadrones(ladrones) {
  const cont = $("lista-ladrones");
  const relevantes = ladrones.filter((l) => l.atacanteUid === currentUid || l.defensorUid === currentUid);
  if (relevantes.length === 0) {
    cont.innerHTML = "";
    return;
  }
  cont.innerHTML =
    `<h3 style="font-size:1rem;">Ladrones en camino</h3>` +
    relevantes
      .map((l) => {
        const restante = Math.max(0, Math.round((l.llegada - Date.now()) / 1000));
        const esMio = l.atacanteUid === currentUid;

        if (esMio) {
          return `<div class="registro-linea">Tu ladrón se acerca a "${l.defensorNombre}" — ${restante}s</div>`;
        }

        // Soy el objetivo. Si no lo he detectado a tiempo, solo un aviso
        // vago (no sé quién es ni cuándo llega de verdad). Si SÍ lo he
        // detectado, aquí es donde puedo reaccionar de verdad.
        if (!l.detectadoTemprano) {
          return `<div class="registro-linea">🕵️ Rumores de que alguien podría estar tramando algo contra ti...</div>`;
        }
        if (l.reaccionDefensor) {
          const etiqueta = l.reaccionDefensor === "reforzar" ? "🛡️ Guardia reforzada" : "🕸️ Trampa tendida";
          return `<div class="registro-linea">⚠️ ${l.atacanteNombre} envía un ladrón — ${etiqueta}, llega en ${restante}s.</div>`;
        }
        return `
          <div class="reino-card" style="flex-direction:column; align-items:stretch; gap:.4em; border-color:var(--rust);">
            <span>⚠️ ¡Has detectado un ladrón de <strong>${l.atacanteNombre}</strong> dirigiéndose a tu reino! Llega en ${restante}s.</span>
            <div style="display:flex; gap:.4em; flex-wrap:wrap;">
              <button class="btn-reforzar-guardia" data-id="${l.id}" style="font-size:.75rem;">🛡️ Reforzar guardia (🪙${COSTE_REFORZAR_GUARDIA.oro})</button>
              <button class="btn-tender-trampa" data-id="${l.id}" style="font-size:.75rem;">🕸️ Tenderle una trampa (🪙${COSTE_TENDER_TRAMPA.oro} 🪨${COSTE_TENDER_TRAMPA.piedra})</button>
            </div>
          </div>`;
      })
      .join("");

  cont.querySelectorAll(".btn-reforzar-guardia").forEach((btn) => btn.addEventListener("click", () => reaccionarAnteLadron(btn.dataset.id, "reforzar")));
  cont.querySelectorAll(".btn-tender-trampa").forEach((btn) => btn.addEventListener("click", () => reaccionarAnteLadron(btn.dataset.id, "trampa")));
}

async function reaccionarAnteLadron(ladronId, tipo) {
  const coste = tipo === "reforzar" ? COSTE_REFORZAR_GUARDIA : COSTE_TENDER_TRAMPA;
  const recursos = await sincronizarRecursos();
  if (recursos.oro < (coste.oro || 0) || recursos.piedra < (coste.piedra || 0)) {
    return alert("No tienes recursos suficientes para esa reacción.");
  }
  await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), {
    recursos: { comida: recursos.comida, piedra: recursos.piedra - (coste.piedra || 0), oro: recursos.oro - (coste.oro || 0) },
  });
  await updateDoc(doc(db, "mundos", mundoId, "ladrones", ladronId), { reaccionDefensor: tipo });
}

// Un ladrón descubierto no roba nada; cuantas más murallas tenga el
// objetivo, más difícil que pase desapercibido.
async function intentarResolverLadron(ladron) {
  if (Date.now() < ladron.llegada) return;
  try {
    await runTransaction(db, async (tx) => {
      const ladronRef = doc(db, "mundos", mundoId, "ladrones", ladron.id);
      const ladronSnap = await tx.get(ladronRef);
      const l = ladronSnap.data();
      if (!l || l.resuelto) return;

      const defensorRef = doc(db, "mundos", mundoId, "reinos", l.defensorUid);
      const defensorSnap = await tx.get(defensorRef);
      const defensor = defensorSnap.data();
      const atacanteRef = doc(db, "mundos", mundoId, "reinos", l.atacanteUid);
      const atacanteSnap = await tx.get(atacanteRef);
      const atacante = atacanteSnap.data();

      const nivelMurallas = defensor?.edificios?.murallas?.nivel || 0;
      let probabilidadExito = Math.max(0.1, 0.6 - nivelMurallas * 0.05);
      if (l.reaccionDefensor === "reforzar") probabilidadExito = Math.max(0.05, probabilidadExito - 0.25);
      if (l.reaccionDefensor === "trampa") probabilidadExito = Math.max(0.05, probabilidadExito - 0.35);
      const exito = Math.random() < probabilidadExito;

      let texto;
      if (exito && defensor) {
        const recursosDefensor = recursosActuales(defensor);
        const robado = {
          comida: Math.round(recursosDefensor.comida * 0.15),
          piedra: Math.round(recursosDefensor.piedra * 0.15),
          oro: Math.round(recursosDefensor.oro * 0.15),
        };
        tx.update(defensorRef, {
          recursos: {
            comida: recursosDefensor.comida - robado.comida,
            piedra: recursosDefensor.piedra - robado.piedra,
            oro: recursosDefensor.oro - robado.oro,
          },
          ultimaActualizacionRecursos: serverTimestamp(),
        });
        if (atacante) {
          const recursosAtacante = recursosActuales(atacante);
          tx.update(atacanteRef, {
            recursos: {
              comida: recursosAtacante.comida + robado.comida,
              piedra: recursosAtacante.piedra + robado.piedra,
              oro: recursosAtacante.oro + robado.oro,
            },
            ultimaActualizacionRecursos: serverTimestamp(),
          });
        }
        texto = `🕵️ El ladrón de ${l.atacanteNombre} roba recursos de ${l.defensorNombre} sin ser visto.`;
      } else if (l.reaccionDefensor === "trampa" && atacante) {
        // Cae en la trampa: no solo fracasa, además el atacante sufre un
        // revés en su propia casa (se ha corrido la voz de su intento).
        const recursosAtacante = recursosActuales(atacante);
        const perdida = {
          comida: Math.round(recursosAtacante.comida * 0.1),
          piedra: Math.round(recursosAtacante.piedra * 0.1),
          oro: Math.round(recursosAtacante.oro * 0.1),
        };
        tx.update(atacanteRef, {
          recursos: {
            comida: recursosAtacante.comida - perdida.comida,
            piedra: recursosAtacante.piedra - perdida.piedra,
            oro: recursosAtacante.oro - perdida.oro,
          },
          ultimaActualizacionRecursos: serverTimestamp(),
        });
        texto = `🕸️ ¡${l.defensorNombre} atrapa al ladrón de ${l.atacanteNombre} en una trampa! Su intento se paga caro — pierde parte de sus propios recursos.`;
      } else {
        texto = `🛡️ ${l.defensorNombre} descubre y detiene a un ladrón enviado por ${l.atacanteNombre}${nivelMurallas > 0 ? ` (murallas nivel ${nivelMurallas})` : ""}.`;
      }

      tx.update(ladronRef, { resuelto: true, resultado: texto });
      if (l.defensorUid) {
        const eventoRef = doc(collection(db, "mundos", mundoId, "mensajes"));
        tx.set(eventoRef, { autorUid: "sistema", autorNombre: "📯 Heraldo", texto, timestamp: serverTimestamp() });
      }
    });
  } catch (e) {
    console.warn("No se pudo resolver el ladrón:", e.message);
  }
}

// ---------- Ataques conjuntos entre aliados ----------
function renderAtaquesConjuntos() {
  const cont = $("lista-ataques-conjuntos");
  const relevantes = ataquesConjuntosActuales.filter(
    (a) => (a.iniciadorUid === currentUid || a.aliadoUid === currentUid) && a.estado !== "lanzado" && a.estado !== "cancelado"
  );
  if (relevantes.length === 0) {
    cont.innerHTML = "";
    return;
  }

  cont.innerHTML =
    `<h3 style="font-size:1rem;">Ataques conjuntos</h3>` +
    relevantes
      .map((a) => {
        const destinoTexto = a.destinoDefensorNombre ? `territorio de ${a.destinoDefensorNombre}` : "casilla libre";
        if (a.estado === "esperando_aliado" && a.aliadoUid === currentUid) {
          return `
            <div class="reino-card" style="flex-direction:column; align-items:stretch; gap:.4em;">
              <span>${a.iniciadorNombre} te invita a un ataque conjunto contra ${destinoTexto} (${a.destino.f},${a.destino.c}). Aporta tus tropas:</span>
              <div style="display:flex; gap:.4em; align-items:center;">
                <input class="in-tropas-soldados-conjunto" type="number" min="0" value="5" placeholder="Soldados" style="width:90px;" data-id="${a.id}" />
                <input class="in-tropas-caballeria-conjunto" type="number" min="0" value="0" placeholder="Caballería" style="width:90px;" data-id="${a.id}" />
                <button class="btn-unirse-ataque-conjunto" data-id="${a.id}" style="font-size:.75rem;">Unirme</button>
                <button class="btn-cancelar-ataque-conjunto" data-id="${a.id}" style="font-size:.75rem;">Rechazar</button>
              </div>
            </div>`;
        }
        if (a.estado === "esperando_aliado") {
          return `<div class="reino-card"><span>Esperando a que ${a.aliadoNombre} aporte tropas para atacar ${destinoTexto}...</span>
            <button class="btn-cancelar-ataque-conjunto" data-id="${a.id}" style="font-size:.75rem;">Cancelar</button></div>`;
        }
        if (a.estado === "listo") {
          return `<div class="reino-card"><span>Listo para atacar ${destinoTexto} — ${a.iniciadorNombre} + ${a.aliadoNombre}.</span>
            <div style="display:flex; gap:.4em;">
              <button class="btn-lanzar-ataque-conjunto" data-id="${a.id}" style="font-size:.75rem;">🚀 Lanzar</button>
              <button class="btn-cancelar-ataque-conjunto" data-id="${a.id}" style="font-size:.75rem;">Cancelar</button>
            </div></div>`;
        }
        return "";
      })
      .join("");

  cont.querySelectorAll(".btn-unirse-ataque-conjunto").forEach((btn) =>
    btn.addEventListener("click", () => unirseAtaqueConjunto(btn.dataset.id))
  );
  cont.querySelectorAll(".btn-lanzar-ataque-conjunto").forEach((btn) =>
    btn.addEventListener("click", () => lanzarAtaqueConjunto(btn.dataset.id))
  );
  cont.querySelectorAll(".btn-cancelar-ataque-conjunto").forEach((btn) =>
    btn.addEventListener("click", () => cancelarAtaqueConjunto(btn.dataset.id))
  );
}

async function unirseAtaqueConjunto(id) {
  const soldados = Math.max(0, Number(document.querySelector(`.in-tropas-soldados-conjunto[data-id="${id}"]`).value) || 0);
  const caballeria = Math.max(0, Number(document.querySelector(`.in-tropas-caballeria-conjunto[data-id="${id}"]`).value) || 0);
  if (soldados + caballeria === 0) return alert("Aporta al menos una tropa.");
  if (soldados > (reinoActual.ejercito?.soldados || 0)) return alert("No tienes tantos soldados.");
  if (caballeria > (reinoActual.ejercito?.caballeria || 0)) return alert("No tienes tanta caballería.");

  await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), {
    "ejercito.soldados": (reinoActual.ejercito.soldados || 0) - soldados,
    "ejercito.caballeria": (reinoActual.ejercito.caballeria || 0) - caballeria,
  });
  await updateDoc(doc(db, "mundos", mundoId, "ataquesConjuntos", id), {
    tropasAliado: { soldados, caballeria },
    estado: "listo",
  });
}

async function lanzarAtaqueConjunto(id) {
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "mundos", mundoId, "ataquesConjuntos", id);
      const snap = await tx.get(ref);
      const a = snap.data();
      if (!a || a.estado !== "listo") return;

      const iniciadorRef = doc(db, "mundos", mundoId, "reinos", a.iniciadorUid);
      const iniciadorSnap = await tx.get(iniciadorRef);
      const iniciador = iniciadorSnap.data();
      const origen = iniciador.territorios[0];
      const distancia = Math.abs(origen.f - a.destino.f) + Math.abs(origen.c - a.destino.c);

      const soldadosTotales = (a.tropasIniciador?.soldados || 0) + (a.tropasAliado?.soldados || 0);
      const caballeriaTotal = (a.tropasIniciador?.caballeria || 0) + (a.tropasAliado?.caballeria || 0);

      const movRef = doc(collection(db, "mundos", mundoId, "movimientos"));
      tx.set(movRef, {
        atacanteUid: a.iniciadorUid,
        atacanteNombre: `${a.iniciadorNombre} + ${a.aliadoNombre} (conjunto)`,
        defensorUid: a.destinoDefensorUid,
        defensorNombre: a.destinoDefensorNombre,
        destino: a.destino,
        soldadosEnviados: soldadosTotales,
        caballeriaEnviada: caballeriaTotal,
        salida: Date.now(),
        llegada: Date.now() + distancia * SEGUNDOS_POR_CASILLA_VIAJE * 1000,
        resuelto: false,
      });
      tx.update(ref, { estado: "lanzado" });
    });
  } catch (e) {
    alert(`No se pudo lanzar el ataque conjunto: ${e.message}`);
  }
}

async function cancelarAtaqueConjunto(id) {
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "mundos", mundoId, "ataquesConjuntos", id);
      const snap = await tx.get(ref);
      const a = snap.data();
      if (!a || a.estado === "lanzado" || a.estado === "cancelado") return;

      // Se devuelven las tropas ya comprometidas a quien las puso.
      const iniciadorRef = doc(db, "mundos", mundoId, "reinos", a.iniciadorUid);
      const iniciadorSnap = await tx.get(iniciadorRef);
      const iniciador = iniciadorSnap.data();
      tx.update(iniciadorRef, {
        "ejercito.soldados": (iniciador.ejercito?.soldados || 0) + (a.tropasIniciador?.soldados || 0),
        "ejercito.caballeria": (iniciador.ejercito?.caballeria || 0) + (a.tropasIniciador?.caballeria || 0),
      });

      if (a.tropasAliado) {
        const aliadoRef = doc(db, "mundos", mundoId, "reinos", a.aliadoUid);
        const aliadoSnap = await tx.get(aliadoRef);
        const aliado = aliadoSnap.data();
        tx.update(aliadoRef, {
          "ejercito.soldados": (aliado.ejercito?.soldados || 0) + (a.tropasAliado?.soldados || 0),
          "ejercito.caballeria": (aliado.ejercito?.caballeria || 0) + (a.tropasAliado?.caballeria || 0),
        });
      }

      tx.update(ref, { estado: "cancelado" });
    });
  } catch (e) {
    alert(`No se pudo cancelar: ${e.message}`);
  }
}
