// js/reinos.js
import {
  auth, db,
  signInAnonymously, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, onSnapshot,
  collection, addDoc, serverTimestamp,
  query, where, getDocs, runTransaction,
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
  if (propietario) {
    const nivelMurallas = propietario[1].edificios?.murallas?.nivel || 0;
    const fuerza = Math.round(defensaConMurallas(propietario[1]));
    $("ataque-info").textContent =
      `Atacar a "${propietario[1].nombreReino}" en (${f},${c}). Fuerza defensiva estimada: ${fuerza}` +
      (nivelMurallas > 0 ? ` (incluye el bonus de sus murallas nivel ${nivelMurallas}).` : ".");
  } else {
    $("ataque-info").textContent = `Conquistar casilla libre (${f},${c}) — sin defensores, la ocupas directamente al llegar.`;
  }
  $("ataque-panel").style.display = "block";
}

$("btn-cancelar-ataque").addEventListener("click", () => {
  casillaSeleccionada = null;
  $("ataque-panel").style.display = "none";
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

  await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), {
    "ejercito.soldados": (reinoActual.ejercito.soldados || 0) - soldadosEnviados,
    "ejercito.caballeria": (reinoActual.ejercito.caballeria || 0) - caballeriaEnviada,
  });

  await addDoc(collection(db, "mundos", mundoId, "movimientos"), {
    atacanteUid: currentUid,
    atacanteNombre: reinoActual.nombreReino,
    defensorUid: propietarioDestino ? propietarioDestino[0] : null,
    defensorNombre: propietarioDestino ? propietarioDestino[1].nombreReino : null,
    destino: casillaSeleccionada,
    soldadosEnviados,
    caballeriaEnviada,
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

        const fuerzaAtacante = (mov.soldadosEnviados || 0) + (mov.caballeriaEnviada || 0) * 2;
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
              : `⚔️ ${mov.atacanteNombre} conquista una casilla de ${mov.defensorNombre}${nivelMurallas > 0 ? ` (a pesar de sus murallas nivel ${nivelMurallas})` : ""}.`;
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
