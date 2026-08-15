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
  reduccionTiempoBiblioteca, alcanceAtaque, TITULOS_NOBLES,
} from "./reinos-utils.js";

const $ = (id) => document.getElementById(id);
const PALETA_COLORES = ["#c0392b", "#2980b9", "#27ae60", "#f39c12", "#8e44ad", "#16a085", "#d35400", "#2c3e50", "#e91e8c", "#7f8c8d"];
const FILAS = 8;
const COLUMNAS = 12;
const SEGUNDOS_POR_CASILLA_VIAJE = 25;
const NOMBRES_PRISIONEROS = ["Aldric", "Beorn", "Cedric", "Doran", "Edmund", "Fenwick", "Godric", "Harold", "Ivor", "Joran", "Kellan", "Leif"];

let currentUid = null;
let mundoId = localStorage.getItem("reinos_mundoId") || null;
let mundoActual = null;
let reinoActual = null;
let todosLosReinos = {}; // uid -> reino, de TODOS los jugadores del mundo (para el mapa)
let casillaSeleccionada = null;
let pactosActuales = [];
let ataquesConjuntosActuales = [];
let rescatesActuales = [];
let comerciosActuales = [];
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
    produccionPorHora: calcularProduccionTotal(edificiosIniciales, [], false),
    nobles: [],
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
    renderRecinto();
    renderMapaMundo();
    intentarFinalizarConstruccion();
    intentarFinalizarEntrenamiento();
    intentarFinalizarEntrenamientoCaballeria();
    renderPrisioneros();
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

  onSnapshot(collection(db, "mundos", mundoId, "rescates"), (snap) => {
    rescatesActuales = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderPrisioneros();
    renderRescatesPorMiGente();
  });

  onSnapshot(collection(db, "mundos", mundoId, "comercios"), (snap) => {
    comerciosActuales = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderComerciosRecibidos();
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
  mostrarImagenRecortada($("castillo-imagen"), reinoActual.castilloImagenUrl, "🏰");
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

// Muestra un icono simple ya mismo, y en cuanto el recorte de fondo esté
// listo, lo sustituye por la imagen de verdad — así nunca se ve la versión
// sin recortar, ni siquiera un instante.
function mostrarImagenRecortada(contenedor, url, iconoPorDefecto) {
  if (!contenedor) return;
  contenedor.innerHTML = url ? `<img src="${url}" style="width:100%; height:100%; object-fit:cover;" />` : iconoPorDefecto;
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
        <div class="edificio-imagen" id="edificio-imagen-${clave}">${def.icono}</div>
        <div style="flex:1;">
          <strong>${def.nombre} — Nivel ${nivel}</strong>
          <p style="color:var(--parchment-dim); font-size:.78rem; margin:.2em 0;">${def.descripcion}</p>
          <button class="btn-mejorar-edificio" data-clave="${clave}" ${enConstruccion || reinoActual.construyendo ? "disabled" : ""} style="font-size:.75rem;">
            ${enConstruccion ? "Construyendo..." : reinoActual.construyendo ? "Espera a que termine lo actual" : `Mejorar (🌾${coste.comida} 🪨${coste.piedra} 🪙${coste.oro}, ${coste.segundos}s)`}
          </button>
          <span id="cuenta-atras-${clave}" class="mono" style="font-size:.7rem; color:var(--amber); margin-left:.4em;"></span>
          ${nivel > 0 ? `<button class="btn-regenerar-edificio" data-clave="${clave}" style="font-size:.7rem; margin-left:.4em;">🔄 Regenerar imagen</button>` : ""}
        </div>
      </div>`;
  }).join("");
  ORDEN_EDIFICIOS.forEach((clave) => {
    mostrarImagenRecortada($(`edificio-imagen-${clave}`), reinoActual.edificios?.[clave]?.imagenUrl, EDIFICIOS_DEF[clave].icono);
  });
  cont.querySelectorAll(".btn-mejorar-edificio").forEach((btn) => {
    btn.addEventListener("click", () => iniciarConstruccion(btn.dataset.clave));
  });
  cont.querySelectorAll(".btn-regenerar-edificio").forEach((btn) => {
    btn.addEventListener("click", () => regenerarImagenEdificio(btn.dataset.clave));
  });
  $("barracones-nivel-texto").textContent = reinoActual.edificios?.barracones?.nivel || 0;
  $("cuadras-nivel-texto").textContent = reinoActual.edificios?.cuadras?.nivel || 0;
  renderNobles();
}

// Regenerar la imagen sin gastar recursos ni cambiar de nivel — para poder
// "reintentar" cuando a la IA le sale mal el recorte, sin coste alguno.
async function regenerarImagenEdificio(clave) {
  const btn = document.querySelector(`.btn-regenerar-edificio[data-clave="${clave}"]`);
  if (btn) { btn.disabled = true; btn.textContent = "Generando..."; }
  try {
    const nivel = reinoActual.edificios?.[clave]?.nivel || 1;
    const url = await generarImagenReino("edificio", { nombre: EDIFICIOS_DEF[clave].nombre, nivel });
    await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), { [`edificios.${clave}.imagenUrl`]: url });
  } catch (e) {
    alert(`No se pudo regenerar la imagen: ${e.message}`);
    if (btn) { btn.disabled = false; btn.textContent = "🔄 Regenerar imagen"; }
  }
}

$("btn-regenerar-castillo").addEventListener("click", async () => {
  const btn = $("btn-regenerar-castillo");
  btn.disabled = true;
  btn.textContent = "Generando...";
  try {
    const url = await generarImagenReino("castillo", { nivel: reinoActual.castilloNivel || 1 });
    await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), { castilloImagenUrl: url });
  } catch (e) {
    alert(`No se pudo regenerar la imagen: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 Regenerar imagen";
  }
});
// ---------- Nobleza: nombrar nobles y cederles tierras ----------
$("sel-titulo-noble").innerHTML = TITULOS_NOBLES.map((t) => `<option value="${t.nombre}">${t.nombre} (🪙${t.costeOro})</option>`).join("");

let nobleEnJuicioIdx = null;
let acusacionActual = "";
const ACUSACIONES_NOBLES = [
  "malversar impuestos del pueblo",
  "conspirar en secreto con un reino rival",
  "abandonar sus tierras en tiempos de necesidad",
  "cobrar tributos ilegales a los campesinos",
  "negociar a escondidas con mercaderes extranjeros",
  "desobedecer una orden directa del trono",
];

function renderNobles() {
  const cont = $("lista-nobles");
  const nobles = reinoActual.nobles || [];
  if (nobles.length === 0) {
    cont.innerHTML = `<p style="color:var(--parchment-dim); font-size:.8rem;">Todavía no has nombrado a ningún noble.</p>`;
    return;
  }
  const territoriosLibres = (reinoActual.territorios || []).filter(
    (t, idx) => idx > 0 && !nobles.some((n) => n.territorioAsignado && n.territorioAsignado.f === t.f && n.territorioAsignado.c === t.c)
  );
  cont.innerHTML = nobles
    .map((n, idx) => {
      const bonus = Math.round((TITULOS_NOBLES.find((t) => t.nombre === n.titulo)?.bonusProduccion || 0) * 100);
      const opcionesTierras = territoriosLibres.map((t) => `<option value="${t.f},${t.c}">(${t.f},${t.c})</option>`).join("");
      const infoTierras = n.territorioAsignado
        ? `de (${n.territorioAsignado.f},${n.territorioAsignado.c}) — +${bonus}% producción`
        : "sin tierras todavía";

      if (nobleEnJuicioIdx === idx) {
        return `
          <div class="reino-card" style="flex-direction:column; align-items:stretch; gap:.4em; border-color:var(--rust);">
            <span>⚖️ Juicio a ${n.nombre} — acusado de ${acusacionActual}. El rey decide:</span>
            <div style="display:flex; gap:.4em; flex-wrap:wrap;">
              <button class="btn-veredicto" data-idx="${idx}" data-veredicto="perdonar" style="font-size:.7rem;">🕊️ Perdonar</button>
              ${n.territorioAsignado ? `<button class="btn-veredicto" data-idx="${idx}" data-veredicto="despojar" style="font-size:.7rem;">📜 Despojar de tierras</button>` : ""}
              <button class="btn-veredicto" data-idx="${idx}" data-veredicto="ejecutar" style="font-size:.7rem; color:var(--rust);">⚔️ Ejecutar</button>
              <button class="btn-cancelar-juicio" style="font-size:.7rem;">Cancelar juicio</button>
            </div>
          </div>`;
      }

      return `
        <div class="reino-card">
          <span>👑 ${n.nombre}, ${n.titulo} ${infoTierras}</span>
          <div style="display:flex; gap:.3em; flex-wrap:wrap;">
            ${
              !n.territorioAsignado && territoriosLibres.length > 0
                ? `<select class="sel-tierra-noble" data-idx="${idx}">${opcionesTierras}</select><button class="btn-ceder-tierras" data-idx="${idx}" style="font-size:.7rem;">Ceder tierras</button>`
                : ""
            }
            <button class="btn-abrir-juicio" data-idx="${idx}" style="font-size:.7rem;">⚖️ Juicio</button>
          </div>
        </div>`;
    })
    .join("");
  cont.querySelectorAll(".btn-ceder-tierras").forEach((btn) =>
    btn.addEventListener("click", () => cederTierras(Number(btn.dataset.idx)))
  );
  cont.querySelectorAll(".btn-abrir-juicio").forEach((btn) =>
    btn.addEventListener("click", () => {
      nobleEnJuicioIdx = Number(btn.dataset.idx);
      acusacionActual = ACUSACIONES_NOBLES[Math.floor(Math.random() * ACUSACIONES_NOBLES.length)];
      renderNobles();
    })
  );
  cont.querySelectorAll(".btn-cancelar-juicio").forEach((btn) =>
    btn.addEventListener("click", () => {
      nobleEnJuicioIdx = null;
      renderNobles();
    })
  );
  cont.querySelectorAll(".btn-veredicto").forEach((btn) =>
    btn.addEventListener("click", () => dictarVeredicto(Number(btn.dataset.idx), btn.dataset.veredicto))
  );
}

async function dictarVeredicto(idx, veredicto) {
  const nobles = reinoActual.nobles || [];
  const noble = nobles[idx];
  if (!noble) return;

  if (veredicto === "perdonar") {
    await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), {
      reputacion: Math.min(100, (reinoActual.reputacion ?? 100) + 2),
    });
    await addDoc(collection(db, "mundos", mundoId, "mensajes"), {
      autorUid: "sistema",
      autorNombre: "📯 Heraldo",
      texto: `🕊️ El rey de ${reinoActual.nombreReino} perdona a ${noble.titulo} ${noble.nombre}, acusado de ${acusacionActual}. Un gesto de clemencia.`,
      timestamp: serverTimestamp(),
    });
  } else if (veredicto === "despojar") {
    const nuevosNobles = nobles.map((n, i) => (i === idx ? { ...n, territorioAsignado: null } : n));
    await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), {
      nobles: nuevosNobles,
      produccionPorHora: calcularProduccionTotal(reinoActual.edificios, nuevosNobles, matrimonioActivoCon(currentUid)),
    });
    await addDoc(collection(db, "mundos", mundoId, "mensajes"), {
      autorUid: "sistema",
      autorNombre: "📯 Heraldo",
      texto: `📜 El rey de ${reinoActual.nombreReino} despoja de sus tierras a ${noble.titulo} ${noble.nombre}, por ${acusacionActual}.`,
      timestamp: serverTimestamp(),
    });
  } else if (veredicto === "ejecutar") {
    if (!confirm(`¿Seguro que quieres ejecutar a ${noble.nombre}? Perderás bastante reputación.`)) {
      return;
    }
    const nuevosNobles = nobles.filter((_, i) => i !== idx);
    await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), {
      nobles: nuevosNobles,
      reputacion: Math.max(0, (reinoActual.reputacion ?? 100) - 15),
      produccionPorHora: calcularProduccionTotal(reinoActual.edificios, nuevosNobles, matrimonioActivoCon(currentUid)),
    });
    await addDoc(collection(db, "mundos", mundoId, "mensajes"), {
      autorUid: "sistema",
      autorNombre: "📯 Heraldo",
      texto: `⚔️💀 El rey de ${reinoActual.nombreReino} ordena ejecutar a ${noble.titulo} ${noble.nombre}, culpable de ${acusacionActual}. La corte queda en silencio.`,
      timestamp: serverTimestamp(),
    });
  }

  nobleEnJuicioIdx = null;
}

$("btn-nombrar-noble").addEventListener("click", async () => {
  const nombre = $("in-nombre-noble").value.trim();
  const titulo = $("sel-titulo-noble").value;
  if (!nombre) return ($("noble-status").textContent = "Ponle un nombre a tu nuevo noble.");
  const costeOro = TITULOS_NOBLES.find((t) => t.nombre === titulo)?.costeOro || 0;
  const recursos = await sincronizarRecursos();
  if (recursos.oro < costeOro) return ($("noble-status").textContent = `Necesitas 🪙${costeOro} para nombrar un ${titulo}.`);

  const nuevosNobles = [...(reinoActual.nobles || []), { nombre, titulo, territorioAsignado: null }];
  await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), {
    recursos: { comida: recursos.comida, piedra: recursos.piedra, oro: recursos.oro - costeOro },
    nobles: nuevosNobles,
  });
  $("in-nombre-noble").value = "";
  $("noble-status").textContent = `¡${nombre} ha sido nombrado ${titulo}! Ahora cédele tierras para que empiece a rendir.`;
});

async function cederTierras(idxNoble) {
  const select = document.querySelector(`.sel-tierra-noble[data-idx="${idxNoble}"]`);
  if (!select || !select.value) return;
  const [f, c] = select.value.split(",").map(Number);
  const nuevosNobles = [...(reinoActual.nobles || [])];
  nuevosNobles[idxNoble] = { ...nuevosNobles[idxNoble], territorioAsignado: { f, c } };
  await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), {
    nobles: nuevosNobles,
    produccionPorHora: calcularProduccionTotal(reinoActual.edificios, nuevosNobles, matrimonioActivoCon(currentUid)),
  });
}

// ---------- Cuentas atrás en vivo (construcción y entrenamiento) ----------
function formatearTiempoRestante(finalizaEn) {
  const totalSeg = Math.max(0, Math.ceil((finalizaEn - Date.now()) / 1000));
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  return min > 0 ? `⏳ ${min}m ${seg}s` : `⏳ ${seg}s`;
}

function actualizarCuentasAtras() {
  if (!reinoActual) return;

  const elCastillo = $("castillo-cuenta-atras");
  if (elCastillo) {
    elCastillo.textContent = reinoActual.construyendo?.clave === "castillo" ? formatearTiempoRestante(reinoActual.construyendo.finalizaEn) : "";
  }
  ORDEN_EDIFICIOS.forEach((clave) => {
    const el = document.getElementById(`cuenta-atras-${clave}`);
    if (el) el.textContent = reinoActual.construyendo?.clave === clave ? formatearTiempoRestante(reinoActual.construyendo.finalizaEn) : "";
  });

  const elSoldados = $("entrenar-cuenta-atras");
  if (elSoldados) elSoldados.textContent = reinoActual.entrenando ? formatearTiempoRestante(reinoActual.entrenando.finalizaEn) : "";
  const elCaballeria = $("entrenar-caballeria-cuenta-atras");
  if (elCaballeria) elCaballeria.textContent = reinoActual.entrenandoCaballeria ? formatearTiempoRestante(reinoActual.entrenandoCaballeria.finalizaEn) : "";
}
setInterval(actualizarCuentasAtras, 1000);

// ---------- Recinto isométrico: tu castillo y edificios vistos desde
// arriba en ángulo, cada uno con su imagen real según su nivel. ----------
const ISO_GRID = {
  granja: { gx: 0, gy: 0 },
  cantera: { gx: 1, gy: 0 },
  mina: { gx: 2, gy: 0 },
  castillo: { gx: 1, gy: 1 },
  cuadras: { gx: 2, gy: 1 },
  barracones: { gx: 0, gy: 2 },
  iglesia: { gx: 1, gy: 2 },
  biblioteca: { gx: 2, gy: 2 },
};
// Solo pares REALMENTE vecinos en la cuadrícula — así el camino nunca
// atraviesa por encima de otro edificio que no sea el destino.
const CONEXIONES_CAMINOS = [
  ["castillo", "cantera"],
  ["castillo", "cuadras"],
  ["castillo", "iglesia"],
  ["cantera", "granja"],
  ["cantera", "mina"],
  ["iglesia", "barracones"],
  ["iglesia", "biblioteca"],
];
const ISO_TILE_W = 220;
const ISO_TILE_H = 130;

function isoAScreen(gx, gy) {
  return { x: (gx - gy) * (ISO_TILE_W / 2), y: (gx + gy) * (ISO_TILE_H / 2) };
}

// ---------- Quitar el fondo magenta de los sprites de verdad (no es solo
// "colocar la imagen encima", se recorta el fondo con un lienzo, dejando
// transparencia real) ----------
const cacheImagenesTransparentes = new Map();

function obtenerImagenTransparente(url) {
  if (!url) return Promise.resolve(null);
  if (cacheImagenesTransparentes.has(url)) return cacheImagenesTransparentes.get(url);

  const promesa = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ancho = img.naturalWidth;
        const alto = img.naturalHeight;
        canvas.width = ancho;
        canvas.height = alto;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const datos = ctx.getImageData(0, 0, ancho, alto);
        const d = datos.data;

        // Referencia inicial del fondo: promedio de las 4 esquinas.
        const esquinas = [0, ancho - 1, (alto - 1) * ancho, ancho * alto - 1];
        let refR = 0, refG = 0, refB = 0;
        esquinas.forEach((idx) => {
          refR += d[idx * 4];
          refG += d[idx * 4 + 1];
          refB += d[idx * 4 + 2];
        });
        refR /= 4; refG /= 4; refB /= 4;

        // Inundación "adaptativa" desde el borde hacia dentro, con dos
        // límites a la vez: el salto de un píxel al siguiente (sigue bien
        // un degradado suave) Y la distancia total acumulada desde el
        // color original de la esquina (nunca se aleja tanto como para
        // colarse dentro del edificio, aunque el camino haya sido gradual).
        const UMBRAL_PASO = 26;
        const UMBRAL_TOTAL = 85;
        const visitado = new Uint8Array(ancho * alto);
        const cola = [];
        const colaPadre = [];
        for (let x = 0; x < ancho; x++) {
          cola.push(x, (alto - 1) * ancho + x);
          colaPadre.push(-1, -1);
        }
        for (let y = 0; y < alto; y++) {
          cola.push(y * ancho, y * ancho + (ancho - 1));
          colaPadre.push(-1, -1);
        }

        let colaInicio = 0;
        while (colaInicio < cola.length) {
          const idx = cola[colaInicio];
          const padreIdx = colaPadre[colaInicio];
          colaInicio++;
          if (visitado[idx]) continue;
          const p = idx * 4;
          let rr, gg, bb;
          if (padreIdx === -1) {
            rr = refR; gg = refG; bb = refB;
          } else {
            const pp = padreIdx * 4;
            rr = d[pp]; gg = d[pp + 1]; bb = d[pp + 2];
          }
          const distPaso = Math.sqrt((d[p] - rr) ** 2 + (d[p + 1] - gg) ** 2 + (d[p + 2] - bb) ** 2);
          const distTotal = Math.sqrt((d[p] - refR) ** 2 + (d[p + 1] - refG) ** 2 + (d[p + 2] - refB) ** 2);
          if (distPaso >= UMBRAL_PASO || distTotal >= UMBRAL_TOTAL) continue;
          visitado[idx] = 1;
          d[p + 3] = 0;

          const x = idx % ancho;
          const y = (idx / ancho) | 0;
          if (x > 0) { cola.push(idx - 1); colaPadre.push(idx); }
          if (x < ancho - 1) { cola.push(idx + 1); colaPadre.push(idx); }
          if (y > 0) { cola.push(idx - ancho); colaPadre.push(idx); }
          if (y < alto - 1) { cola.push(idx + ancho); colaPadre.push(idx); }
        }

        ctx.putImageData(datos, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch (e) {
        console.warn("No se pudo recortar el fondo de la imagen, se usa tal cual:", e.message);
        resolve(url);
      }
    };
    img.onerror = () => resolve(url);
    img.src = url;
  });

  cacheImagenesTransparentes.set(url, promesa);
  return promesa;
}

// Árboles/decoración fija en los huecos de la cuadrícula — usan las mismas
// coordenadas isométricas que los edificios (posiciones intermedias entre
// casillas), así encajan de verdad con el suelo en vez de flotar sueltos.
const DECORACION_RECINTO = [
  { gx: 0.5, gy: -0.7, icono: "🌳" },
  { gx: 1.5, gy: -0.7, icono: "🌳" },
  { gx: -0.7, gy: 0.5, icono: "🌲" },
  { gx: 2.7, gy: 0.5, icono: "🌲" },
  { gx: -0.7, gy: 1.5, icono: "🌿" },
  { gx: 2.7, gy: 1.5, icono: "🌿" },
  { gx: 0.5, gy: 2.7, icono: "🌾" },
  { gx: 1.5, gy: 2.7, icono: "🌾" },
];

function renderRecinto() {
  const cont = $("recinto-lienzo");
  if (!cont || !reinoActual) return;

  // Orden de dibujado: de atrás (gy bajo) a delante (gy alto), para que lo
  // que está "más cerca de la cámara" tape a lo que está detrás — como en
  // cualquier vista isométrica de verdad.
  const claves = Object.keys(ISO_GRID).sort((a, b) => ISO_GRID[a].gy - ISO_GRID[b].gy || ISO_GRID[a].gx - ISO_GRID[b].gx);

  // Caminos de tierra desde el castillo hasta cada edificio — refuerzan la
  // sensación de recinto habitado, no solo piezas sueltas flotando.
  const caminos = CONEXIONES_CAMINOS.map(([a, b]) => {
    const pa = isoAScreen(ISO_GRID[a].gx, ISO_GRID[a].gy);
    const pb = isoAScreen(ISO_GRID[b].gx, ISO_GRID[b].gy);
    return `<line x1="${pa.x}" y1="${pa.y}" x2="${pb.x}" y2="${pb.y}" stroke="#8a6d4a" stroke-width="7" stroke-linecap="round" opacity="0.55" />`;
  }).join("");

  // ---------- Murallas: perímetro real con almenas, torres con tejado, y
  // un arco de entrada de verdad — todo dibujado a mano, no depende de
  // ninguna imagen de IA, así que siempre sale bien. Crece con el nivel.
  const nivelMurallas = reinoActual.edificios?.murallas?.nivel || 0;
  const margen = 0.42;
  const [pTop, pRight, pBottom, pLeft] = [
    isoAScreen(-margen, -margen),
    isoAScreen(2 + margen, -margen),
    isoAScreen(2 + margen, 2 + margen),
    isoAScreen(-margen, 2 + margen),
  ];
  const grosorMuro = 10 + nivelMurallas * 3;
  const alturaAlmena = 5 + nivelMurallas * 1.2;

  // Dibuja un tramo de muro con almenas (dientes) a lo largo de toda su
  // longitud, perpendiculares a la dirección del tramo.
  function tramoConAlmenas(p1, p2, saltar = null) {
    const largoTotal = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const dx = (p2.x - p1.x) / largoTotal, dy = (p2.y - p1.y) / largoTotal;
    const nx = -dy, ny = dx; // perpendicular, hacia "fuera" del recinto
    const pasoAlmena = 26;
    const numDientes = Math.max(2, Math.round(largoTotal / pasoAlmena));
    let svg = `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#8a8070" stroke-width="${grosorMuro}" stroke-linecap="round" opacity="0.92" />`;
    for (let i = 0; i < numDientes; i++) {
      const t = (i + 0.5) / numDientes;
      if (saltar && t > saltar[0] && t < saltar[1]) continue; // hueco de la puerta
      if (i % 2 === 0) continue; // almenas alternas, como un castillo de verdad
      const cx = p1.x + dx * largoTotal * t;
      const cy = p1.y + dy * largoTotal * t;
      svg += `<rect x="${cx - 5}" y="${cy - 5}" width="10" height="${alturaAlmena + 5}" fill="#8a8070" stroke="#5a5348" stroke-width="1" transform="rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}, ${cx}, ${cy}) translate(0, -${alturaAlmena})" />`;
    }
    return svg;
  }

  function tramoConPuerta(p1, p2) {
    const hueco = 0.16;
    const g1x = p1.x + (p2.x - p1.x) * (0.5 - hueco), g1y = p1.y + (p2.y - p1.y) * (0.5 - hueco);
    const g2x = p1.x + (p2.x - p1.x) * (0.5 + hueco), g2y = p1.y + (p2.y - p1.y) * (0.5 + hueco);
    const mx = (g1x + g2x) / 2, my = (g1y + g2y) / 2;
    return `
      ${tramoConAlmenas(p1, p2, [0.5 - hueco, 0.5 + hueco])}
      <rect x="${mx - 22}" y="${my - 26}" width="44" height="34" rx="4" fill="#5a4530" stroke="#2a1f16" stroke-width="2" />
      <path d="M ${mx - 22} ${my - 8} A 22 18 0 0 1 ${mx + 22} ${my - 8}" fill="none" stroke="#2a1f16" stroke-width="2" />
      <rect x="${mx - 14}" y="${my - 12}" width="28" height="20" fill="#2a1f16" />
      <line x1="${mx - 14}" y1="${my - 12}" x2="${mx - 14}" y2="${my + 8}" stroke="#8a7050" stroke-width="2" />
      <line x1="${mx}" y1="${my - 16}" x2="${mx}" y2="${my + 8}" stroke="#8a7050" stroke-width="2" />
      <line x1="${mx + 14}" y1="${my - 12}" x2="${mx + 14}" y2="${my + 8}" stroke="#8a7050" stroke-width="2" />`;
  }

  function torreConTejado(p) {
    const r = 11 + nivelMurallas * 1.6;
    return `
      <circle cx="${p.x}" cy="${p.y}" r="${r}" fill="#6b6355" stroke="#3a352b" stroke-width="2" />
      <polygon points="${p.x},${p.y - r - 16} ${p.x - r - 3},${p.y - r + 4} ${p.x + r + 3},${p.y - r + 4}" fill="#7a2e2e" stroke="#3a1414" stroke-width="1.5" />`;
  }

  const murallaSvg =
    nivelMurallas > 0
      ? `${tramoConAlmenas(pTop, pRight)}
         ${tramoConAlmenas(pRight, pBottom)}
         ${tramoConPuerta(pBottom, pLeft)}
         ${tramoConAlmenas(pLeft, pTop)}
         ${[pTop, pRight, pBottom, pLeft].map(torreConTejado).join("")}
         <text x="${pTop.x}" y="${pTop.y - 34}" text-anchor="middle" class="etiqueta-nivel-iso">Murallas · Nv.${nivelMurallas}</text>`
      : "";

  const decoracion = DECORACION_RECINTO.map((d) => {
    const { x, y } = isoAScreen(d.gx, d.gy);
    return `<text x="${x}" y="${y}" text-anchor="middle" font-size="24" opacity="0.85">${d.icono}</text>`;
  }).join("");

  // ---------- Edificios como tarjetas enmarcadas: en vez de intentar
  // recortar el fondo de la imagen de la IA (poco fiable, depende de que
  // el modelo obedezca a la perfección), la mostramos tal cual dentro de
  // un marco redondeado — como una placa o retrato, no un sprite suelto.
  let defsRecortes = "";
  let piezas = "";
  claves.forEach((clave) => {
    const { gx, gy } = ISO_GRID[clave];
    const { x, y } = isoAScreen(gx, gy);
    const esCastillo = clave === "castillo";
    const nivel = esCastillo ? reinoActual.castilloNivel || 1 : reinoActual.edificios?.[clave]?.nivel || 0;
    const imagenUrl = esCastillo ? reinoActual.castilloImagenUrl : reinoActual.edificios?.[clave]?.imagenUrl;
    const nombre = esCastillo ? "Castillo" : EDIFICIOS_DEF[clave]?.nombre || clave;
    const icono = esCastillo ? "🏰" : EDIFICIOS_DEF[clave]?.icono || "🏗️";
    const tam = esCastillo ? 100 : 76;
    const rx = -tam / 2, ry = -tam - 6;

    if (imagenUrl) defsRecortes += `<clipPath id="clip-${clave}"><rect x="${rx}" y="${ry}" width="${tam}" height="${tam}" rx="10" /></clipPath>`;

    piezas += `
      <g class="edificio-iso" data-clave="${clave}" transform="translate(${x}, ${y})">
        <polygon class="losa-iso" points="0,${-ISO_TILE_H / 2} ${ISO_TILE_W / 2},0 0,${ISO_TILE_H / 2} ${-ISO_TILE_W / 2},0" />
        ${
          imagenUrl
            ? `<g clip-path="url(#clip-${clave})"><image href="${imagenUrl}" x="${rx}" y="${ry}" width="${tam}" height="${tam}" preserveAspectRatio="xMidYMid slice" /></g>
               <rect x="${rx}" y="${ry}" width="${tam}" height="${tam}" rx="10" fill="none" stroke="#c9a227" stroke-width="2.5" />`
            : `<text x="0" y="${ry + tam / 2 + 8}" text-anchor="middle" font-size="${esCastillo ? 34 : 24}">${icono}</text>`
        }
        <text class="etiqueta-nivel-iso" x="0" y="12">${nombre} · Nv.${nivel}</text>
      </g>`;
  });

  cont.innerHTML = `
    <svg id="recinto-svg" viewBox="-320 -180 640 520" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="suelo-recinto" cx="50%" cy="45%" r="75%">
          <stop offset="0%" stop-color="#5c7a42" />
          <stop offset="100%" stop-color="#3a4a2e" />
        </radialGradient>
        ${defsRecortes}
      </defs>
      <rect x="-320" y="-180" width="640" height="520" fill="url(#suelo-recinto)" />
      ${decoracion}
      ${caminos}
      ${murallaSvg}
      ${piezas}
    </svg>`;
}

// Zoom y paneo del recinto — mismo patrón que el del mapa del mundo, con
// sus propias variables para no interferir entre sí.
let zoomRecinto = 1;
let panXRecinto = 0;
let panYRecinto = 0;

function aplicarTransformRecinto() {
  $("recinto-lienzo").style.transform = `translate(${panXRecinto}px, ${panYRecinto}px) scale(${zoomRecinto})`;
}
function centrarRecinto() {
  zoomRecinto = 1;
  panXRecinto = 0;
  panYRecinto = 0;
  aplicarTransformRecinto();
}
$("btn-recinto-zoom-mas").addEventListener("click", () => {
  zoomRecinto = Math.min(ZOOM_MAX, zoomRecinto * 1.3);
  aplicarTransformRecinto();
});
$("btn-recinto-zoom-menos").addEventListener("click", () => {
  zoomRecinto = Math.max(ZOOM_MIN, zoomRecinto / 1.3);
  aplicarTransformRecinto();
});
$("btn-recinto-centrar").addEventListener("click", centrarRecinto);

const punterosRecinto = new Map();
let distanciaPinchInicialRecinto = null;
let escalaPinchInicialRecinto = 1;
let inicioToqueRecinto = null;
const viewportRecinto = $("recinto-viewport");
viewportRecinto.addEventListener("pointerdown", (e) => {
  viewportRecinto.setPointerCapture(e.pointerId);
  punterosRecinto.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (punterosRecinto.size === 1) inicioToqueRecinto = { x: e.clientX, y: e.clientY };
  if (punterosRecinto.size === 2) {
    inicioToqueRecinto = null;
    const [p1, p2] = Array.from(punterosRecinto.values());
    distanciaPinchInicialRecinto = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    escalaPinchInicialRecinto = zoomRecinto;
  }
});
viewportRecinto.addEventListener("pointermove", (e) => {
  if (!punterosRecinto.has(e.pointerId)) return;
  const anterior = punterosRecinto.get(e.pointerId);
  punterosRecinto.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (punterosRecinto.size === 2 && distanciaPinchInicialRecinto) {
    const [p1, p2] = Array.from(punterosRecinto.values());
    const distancia = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    zoomRecinto = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, escalaPinchInicialRecinto * (distancia / distanciaPinchInicialRecinto)));
    aplicarTransformRecinto();
  } else if (punterosRecinto.size === 1) {
    panXRecinto += e.clientX - anterior.x;
    panYRecinto += e.clientY - anterior.y;
    aplicarTransformRecinto();
  }
});
function soltarPunteroRecinto(e) {
  // Mismo motivo que en el mapa del mundo: con el puntero capturado para
  // arrastrar, el clic nativo del navegador no llega bien al edificio en
  // escritorio. Detectamos el toque nosotros mismos.
  if (inicioToqueRecinto && punterosRecinto.size === 1) {
    const distancia = Math.hypot(e.clientX - inicioToqueRecinto.x, e.clientY - inicioToqueRecinto.y);
    if (distancia < 8) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const grupo = el?.closest?.(".edificio-iso");
      if (grupo) document.querySelector('.reinos-tab-btn[data-tab="castillo"]').click();
    }
  }
  inicioToqueRecinto = null;
  punterosRecinto.delete(e.pointerId);
  if (punterosRecinto.size < 2) distanciaPinchInicialRecinto = null;
}
viewportRecinto.addEventListener("pointerup", soltarPunteroRecinto);
viewportRecinto.addEventListener("pointercancel", soltarPunteroRecinto);
viewportRecinto.addEventListener("pointerleave", soltarPunteroRecinto);
viewportRecinto.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    zoomRecinto = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomRecinto * (e.deltaY < 0 ? 1.15 : 0.87)));
    aplicarTransformRecinto();
  },
  { passive: false }
);

async function iniciarConstruccion(clave) {
  if (reinoActual.construyendo) return alert("Ya tienes una construcción en marcha. Espera a que termine.");
  const nivelActual = clave === "castillo" ? reinoActual.castilloNivel || 1 : reinoActual.edificios?.[clave]?.nivel || 0;
  const coste = costeMejora(nivelActual);
  const reduccion = reduccionTiempoBiblioteca(reinoActual.edificios?.biblioteca?.nivel);
  const segundosReales = Math.round(coste.segundos * (1 - reduccion));
  const recursos = await sincronizarRecursos();
  if (!puedeCostear(recursos, coste)) return alert("No tienes recursos suficientes todavía.");

  await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), {
    recursos: { comida: recursos.comida - coste.comida, piedra: recursos.piedra - coste.piedra, oro: recursos.oro - coste.oro },
    construyendo: {
      clave,
      nombre: clave === "castillo" ? "Castillo" : EDIFICIOS_DEF[clave].nombre,
      nivelObjetivo: nivelActual + 1,
      finalizaEn: Date.now() + segundosReales * 1000,
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
      cambios.produccionPorHora = calcularProduccionTotal(clave === "castillo" ? data.edificios : nuevosEdificios, data.nobles, matrimonioActivoCon(currentUid));
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
    entrenando: { cantidad, finalizaEn: Date.now() + COSTE_SOLDADO.segundos * cantidad * (1 - reduccionTiempoBiblioteca(reinoActual.edificios?.biblioteca?.nivel)) * 1000 },
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
    entrenandoCaballeria: { cantidad, finalizaEn: Date.now() + COSTE_CABALLERIA.segundos * cantidad * (1 - reduccionTiempoBiblioteca(reinoActual.edificios?.biblioteca?.nivel)) * 1000 },
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
let inicioToqueMundo = null;
viewportMundo.addEventListener("pointerdown", (e) => {
  viewportMundo.setPointerCapture(e.pointerId);
  punterosMapaMundo.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (punterosMapaMundo.size === 1) inicioToqueMundo = { x: e.clientX, y: e.clientY };
  if (punterosMapaMundo.size === 2) {
    inicioToqueMundo = null; // dos dedos: es un pellizco, no una selección
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
  // Con el puntero "capturado" para poder arrastrar, el clic nativo del
  // navegador sobre la casilla concreta no llega bien en escritorio (en
  // móvil, por cómo se sintetiza el toque, sí colaba). Así que detectamos
  // el toque nosotros mismos: si apenas se movió el dedo/ratón entre
  // bajar y soltar, es una selección de verdad, no un arrastre.
  if (inicioToqueMundo && punterosMapaMundo.size === 1) {
    const distancia = Math.hypot(e.clientX - inicioToqueMundo.x, e.clientY - inicioToqueMundo.y);
    if (distancia < 8) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const celda = el?.closest?.(".celda-mapa");
      if (celda) seleccionarCasilla(Number(celda.dataset.f), Number(celda.dataset.c));
    }
  }
  inicioToqueMundo = null;
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

function distanciaCasillas(a, b) {
  return Math.abs(a.f - b.f) + Math.abs(a.c - b.c);
}

function seleccionarCasilla(f, c) {
  if (!reinoActual) return;
  const alcance = alcanceAtaque(reinoActual.edificios?.biblioteca?.nivel);
  const dentroDeAlcance = (reinoActual.territorios || []).some((t) => distanciaCasillas(t, { f, c }) <= alcance && distanciaCasillas(t, { f, c }) > 0);
  const yaEsMia = (reinoActual.territorios || []).some((t) => t.f === f && t.c === c);
  if (yaEsMia) return;
  if (!dentroDeAlcance) {
    $("ataque-panel").style.display = "none";
    return alert(
      alcance > 1
        ? `Solo puedes atacar casillas a ${alcance} de distancia de tu territorio (tu biblioteca lo permite).`
        : "Solo puedes atacar casillas justo al lado de tu territorio (mejora tu biblioteca a nivel 5 para ampliar el alcance)."
    );
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
          // El atacante gana: se queda la casilla. El ejército derrotado no
          // desaparece del todo — una parte se captura como prisioneros,
          // que van al calabozo del atacante para que decida su destino.
          const totalDefensor = (defensor.ejercito?.soldados || 0) + (defensor.ejercito?.caballeria || 0);
          const numPrisioneros = totalDefensor > 0 ? Math.min(3, 1 + Math.floor(totalDefensor / 15)) : 0;
          const nuevosPrisioneros = Array.from({ length: numPrisioneros }, (_, i) => ({
            id: `${Date.now()}-${i}`,
            nombre: NOMBRES_PRISIONEROS[Math.floor(Math.random() * NOMBRES_PRISIONEROS.length)],
            origenUid: mov.defensorUid,
            origenNombre: mov.defensorNombre,
            capturadoEn: Date.now(),
          }));

          const atacanteRef = doc(db, "mundos", mundoId, "reinos", mov.atacanteUid);
          const atacanteSnap = await tx.get(atacanteRef);
          const atacante = atacanteSnap.data();
          tx.update(atacanteRef, {
            territorios: [...(atacante.territorios || []), mov.destino],
            prisioneros: [...(atacante.prisioneros || []), ...nuevosPrisioneros],
          });

          const territoriosRestantes = (defensor.territorios || []).filter((t) => !(t.f === mov.destino.f && t.c === mov.destino.c));
          const cambiosDefensor = { "ejercito.soldados": 0, "ejercito.caballeria": 0, territorios: territoriosRestantes };
          if (territoriosRestantes.length === 0) cambiosDefensor.vivo = false; // se queda sin ningún castillo: derrotado
          tx.update(defensorRef, cambiosDefensor);

          textoResultado =
            territoriosRestantes.length === 0
              ? `👑 ${mov.atacanteNombre} conquista el último territorio de ${mov.defensorNombre} — ¡reino derrotado!`
              : `⚔️ ${mov.atacanteNombre} conquista una casilla de ${mov.defensorNombre}${mov.ataqueSorpresa ? " con una EMBOSCADA por sorpresa" : ""}${nivelMurallas > 0 ? ` (a pesar de sus murallas nivel ${nivelMurallas})` : ""}${numPrisioneros > 0 ? ` y captura ${numPrisioneros} prisionero(s)` : ""}.`;
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

// ---------- Comandos secretos de desarrollo ----------
const COMANDO_SUPERADMIN = "pot of gold";
const BONUS_SUPERADMIN = 10_000;

async function ejecutarComandoSuperadmin(texto) {
  if (texto.trim().toLowerCase() !== COMANDO_SUPERADMIN) {
    return false;
  }

  // Solo el creador del mundo puede usarlo — aunque alguien encuentre la
  // frase mirando el código, no le sirve de nada si no es él.
  if (!mundoActual || mundoActual.creadoPor !== currentUid) {
    return false;
  }

  const reinoRef = doc(db, "mundos", mundoId, "reinos", currentUid);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(reinoRef);

    if (!snap.exists()) {
      throw new Error("No se ha encontrado el reino.");
    }

    const reino = snap.data();

    // Calculamos primero todo lo producido hasta este instante.
    const actuales = recursosActuales(reino);

    tx.update(reinoRef, {
      recursos: {
        comida: actuales.comida + BONUS_SUPERADMIN,
        piedra: actuales.piedra + BONUS_SUPERADMIN,
        oro: actuales.oro + BONUS_SUPERADMIN,
      },
      ultimaActualizacionRecursos: serverTimestamp(),
    });
  });

  return true;
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

  // Comando secreto de desarrollo (solo tiene efecto si eres el creador
  // del mundo — para cualquier otro jugador, esto se comporta como un
  // mensaje de chat normal). No se publica en el chat.
  if (await ejecutarComandoSuperadmin(texto)) {
    $("in-chat-texto").value = "";
    return;
  }

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

const ETIQUETAS_TIPO_PACTO = { no_agresion: "🕊️ No agresión", alianza_militar: "⚔️ Alianza militar", matrimonio: "💍 Matrimonio" };

// ¿Tiene este reino un matrimonio sellado activo ahora mismo?
function matrimonioActivoCon(uid) {
  return pactosActuales.some((p) => p.estado === "aceptado" && p.tipo === "matrimonio" && p.jugadores.includes(uid));
}

// ---------- Alerta central: aparece sola cuando alguien espera tu respuesta ----------
let pactoEnNegociacion = null;

function mostrarAlertaNegociacion(pacto) {
  pactoEnNegociacion = pacto;
  const otroUid = pacto.jugadores.find((u) => u !== currentUid);
  const otroNombre = pacto.nombres?.[otroUid] || "Un reino";
  $("negociacion-titulo").textContent = "🤝 Propuesta diplomática";
  $("negociacion-texto").textContent =
    `${otroNombre} propone: ${ETIQUETAS_TIPO_PACTO[pacto.tipo] || pacto.tipo}${pacto.tipo === "matrimonio" ? ` (dote: 🪙${pacto.dote || 0})` : ""}.` +
    (pacto.mensaje ? ` "${pacto.mensaje}"` : "");
  const historial = pacto.historial || [];
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

function comprobarNegociacionesPendientes() {
  const pendiente = pactosActuales.find((p) => p.estado === "pendiente" && p.ultimaPropuestaPor !== currentUid && p.jugadores.includes(currentUid));
  if (!pendiente) {
    $("negociacion-modal").classList.remove("visible");
    pactoEnNegociacion = null;
    return;
  }
  if (pactoEnNegociacion?.id === pendiente.id && $("negociacion-modal").classList.contains("visible")) return; // ya mostrada, no la reabrimos sola
  mostrarAlertaNegociacion(pendiente);
}

$("btn-negociacion-aceptar").addEventListener("click", async () => {
  if (!pactoEnNegociacion) return;
  const pacto = pactoEnNegociacion;
  const otroUid = pacto.jugadores.find((u) => u !== currentUid);
  const otroNombre = pacto.nombres?.[otroUid] || "otro reino";

  if (pacto.tipo === "matrimonio") {
    // El matrimonio mueve oro de verdad (la dote) y sube la producción de
    // AMBOS reinos — no solo el propio, hay que tocar el otro también.
    try {
      await runTransaction(db, async (tx) => {
        const pagadorUid = pacto.ultimaPropuestaPor; // quien propuso paga la dote
        const receptorUid = pagadorUid === currentUid ? otroUid : currentUid;
        const pagadorRef = doc(db, "mundos", mundoId, "reinos", pagadorUid);
        const receptorRef = doc(db, "mundos", mundoId, "reinos", receptorUid);
        const pagadorSnap = await tx.get(pagadorRef);
        const receptorSnap = await tx.get(receptorRef);
        const pagador = pagadorSnap.data();
        const receptor = receptorSnap.data();
        const dote = pacto.dote || 0;

        const recursosPagador = recursosActuales(pagador);
        const recursosReceptor = recursosActuales(receptor);
        if (recursosPagador.oro < dote) {
          throw new Error(`Quien propuso la unión ya no tiene suficiente oro para pagar la dote (🪙${dote}).`);
        }

        tx.update(pagadorRef, {
          recursos: { ...recursosPagador, oro: recursosPagador.oro - dote },
          ultimaActualizacionRecursos: serverTimestamp(),
          produccionPorHora: calcularProduccionTotal(pagador.edificios, pagador.nobles, true),
        });
        tx.update(receptorRef, {
          recursos: { ...recursosReceptor, oro: recursosReceptor.oro + dote },
          ultimaActualizacionRecursos: serverTimestamp(),
          produccionPorHora: calcularProduccionTotal(receptor.edificios, receptor.nobles, true),
        });
        tx.update(doc(db, "mundos", mundoId, "pactos", pacto.id), { estado: "aceptado" });
      });
      await addDoc(collection(db, "mundos", mundoId, "mensajes"), {
        autorUid: "sistema",
        autorNombre: "📯 Heraldo",
        texto: `💍 ¡${reinoActual.nombreReino} y ${otroNombre} se unen en matrimonio! Sus reinos crecen más fuertes juntos.`,
        timestamp: serverTimestamp(),
      });
    } catch (e) {
      alert(`No se pudo sellar el matrimonio: ${e.message}`);
      $("negociacion-modal").classList.remove("visible");
      return;
    }
  } else {
    await updateDoc(doc(db, "mundos", mundoId, "pactos", pacto.id), { estado: "aceptado" });
    await addDoc(collection(db, "mundos", mundoId, "mensajes"), {
      autorUid: "sistema",
      autorNombre: "📯 Heraldo",
      texto: `🤝 ${reinoActual.nombreReino} y ${otroNombre} han sellado un pacto de ${ETIQUETAS_TIPO_PACTO[pacto.tipo]}.`,
      timestamp: serverTimestamp(),
    });
  }
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

function actualizarVisibilidadDote() {
  $("campo-dote").style.display = $("sel-tipo-pacto").value === "matrimonio" ? "block" : "none";
}
$("sel-tipo-pacto").addEventListener("change", actualizarVisibilidadDote);

function abrirProponerPacto(uid, nombre, pactoExistente = null) {
  pactoObjetivoParaProponer = { uid, nombre, pactoExistente };
  $("proponer-pacto-titulo").textContent = pactoExistente ? `Contraofertar a ${nombre}` : `Proponer pacto a ${nombre}`;
  $("sel-tipo-pacto").value = pactoExistente?.tipo || "no_agresion";
  $("in-mensaje-pacto").value = "";
  $("in-dote-pacto").value = pactoExistente?.dote || 100;
  actualizarVisibilidadDote();
  $("proponer-pacto-modal").classList.add("visible");
}
$("btn-cancelar-pacto").addEventListener("click", () => $("proponer-pacto-modal").classList.remove("visible"));

$("btn-confirmar-pacto").addEventListener("click", async () => {
  if (!pactoObjetivoParaProponer) return;
  const { uid, nombre, pactoExistente } = pactoObjetivoParaProponer;
  const tipo = $("sel-tipo-pacto").value;
  const mensaje = $("in-mensaje-pacto").value.trim().slice(0, 200);
  const dote = tipo === "matrimonio" ? Math.max(0, Number($("in-dote-pacto").value) || 0) : 0;
  const entradaHistorial = { uid: currentUid, nombre: reinoActual.nombreReino, tipo, mensaje, timestamp: Date.now() };

  if (pactoExistente) {
    await updateDoc(doc(db, "mundos", mundoId, "pactos", pactoExistente.id), {
      tipo,
      mensaje,
      dote,
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
      dote,
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
        botonAlianza =
          pacto.ultimaPropuestaPor === currentUid
            ? `<span class="mono" style="font-size:.7rem; color:var(--parchment-dim);">Esperando su respuesta...</span>`
            : `<button class="btn-responder-pacto" data-id="${pacto.id}" style="font-size:.7rem;">💬 Responder</button>`;
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
            <button class="btn-abrir-comercio" data-uid="${uid}" data-nombre="${reino.nombreReino}" style="font-size:.7rem;">💱 Comerciar</button>
            <button class="btn-abrir-donar" data-uid="${uid}" data-nombre="${reino.nombreReino}" style="font-size:.7rem;">🎁 Donar</button>
          </div>
        </div>`;
    })
    .join("");

  cont.querySelectorAll(".btn-proponer-pacto").forEach((btn) =>
    btn.addEventListener("click", () => abrirProponerPacto(btn.dataset.uid, btn.dataset.nombre))
  );
  cont.querySelectorAll(".btn-romper-pacto").forEach((btn) => btn.addEventListener("click", () => romperPacto(btn.dataset.id)));
  cont.querySelectorAll(".btn-traicionar").forEach((btn) => btn.addEventListener("click", () => traicionar(btn.dataset.id, btn.dataset.uid, btn.dataset.nombre)));
  cont.querySelectorAll(".btn-responder-pacto").forEach((btn) =>
    btn.addEventListener("click", () => {
      const pacto = pactosActuales.find((p) => p.id === btn.dataset.id);
      if (pacto) mostrarAlertaNegociacion(pacto);
    })
  );
  cont.querySelectorAll(".btn-elegir-ladron").forEach((btn) =>
    btn.addEventListener("click", () => elegirObjetivoLadron(btn.dataset.uid, btn.dataset.nombre))
  );
  cont.querySelectorAll(".btn-abrir-comercio").forEach((btn) =>
    btn.addEventListener("click", () => abrirComercio(btn.dataset.uid, btn.dataset.nombre))
  );
  cont.querySelectorAll(".btn-abrir-donar").forEach((btn) =>
    btn.addEventListener("click", () => abrirDonar(btn.dataset.uid, btn.dataset.nombre))
  );
}

// ---------- Romper un pacto: si es un matrimonio, hay que recalcular la
// producción de ambos reinos (se pierde el bonus) y penaliza más la
// reputación que romper un pacto normal — es un divorcio, no un desaire. ----------
async function romperPacto(pactoId) {
  const pacto = pactosActuales.find((p) => p.id === pactoId);
  if (!pacto) return;

  if (pacto.tipo !== "matrimonio") {
    await updateDoc(doc(db, "mundos", mundoId, "pactos", pactoId), { estado: "roto" });
    return;
  }

  if (!confirm("¿Seguro que quieres romper este matrimonio? Perderéis el bonus de producción en ambos reinos, y tu reputación bajará por el divorcio.")) return;

  const otroUid = pacto.jugadores.find((u) => u !== currentUid);
  try {
    await runTransaction(db, async (tx) => {
      const miRef = doc(db, "mundos", mundoId, "reinos", currentUid);
      const otroRef = doc(db, "mundos", mundoId, "reinos", otroUid);
      const miSnap = await tx.get(miRef);
      const otroSnap = await tx.get(otroRef);
      const mi = miSnap.data();
      const otro = otroSnap.data();

      tx.update(miRef, {
        produccionPorHora: calcularProduccionTotal(mi.edificios, mi.nobles, false),
        reputacion: Math.max(0, (mi.reputacion ?? 100) - 15),
      });
      tx.update(otroRef, { produccionPorHora: calcularProduccionTotal(otro.edificios, otro.nobles, false) });
      tx.update(doc(db, "mundos", mundoId, "pactos", pactoId), { estado: "roto" });
    });
    await addDoc(collection(db, "mundos", mundoId, "mensajes"), {
      autorUid: "sistema",
      autorNombre: "📯 Heraldo",
      texto: `💔 ${reinoActual.nombreReino} rompe su matrimonio con ${pacto.nombres?.[otroUid] || "otro reino"}. Ambos reinos pierden el bonus de la unión.`,
      timestamp: serverTimestamp(),
    });
  } catch (e) {
    alert(`No se pudo romper el matrimonio: ${e.message}`);
  }
}

// ---------- Traición: rompes la alianza para siempre a cambio de una
// ventaja táctica puntual, pero todo el mundo se entera. ----------
async function traicionar(pactoId, uidVictima, nombreVictima) {
  if (!confirm(`¿Seguro que quieres traicionar a ${nombreVictima}? Perderás reputación y todo el mundo lo sabrá — pero tu próximo ataque contra ellos será una emboscada (+25% de fuerza) durante 5 minutos.`)) return;

  const pacto = pactosActuales.find((p) => p.id === pactoId);
  const cambiosPropios = {
    reputacion: Math.max(0, (reinoActual.reputacion ?? 100) - 30),
    sorpresaDisponibleContra: { uid: uidVictima, expiraEn: Date.now() + 5 * 60 * 1000 },
  };
  // Si era un matrimonio, el traidor pierde el bonus de producción — la
  // otra parte, la víctima, no tiene por qué perder nada por esto.
  if (pacto?.tipo === "matrimonio") {
    cambiosPropios.produccionPorHora = calcularProduccionTotal(reinoActual.edificios, reinoActual.nobles, false);
  }

  await updateDoc(doc(db, "mundos", mundoId, "pactos", pactoId), { estado: "roto" });
  await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), cambiosPropios);
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

// ---------- Calabozo: qué hacer con los prisioneros capturados ----------
function renderPrisioneros() {
  const cont = $("lista-prisioneros");
  if (!cont || !reinoActual) return;
  const prisioneros = reinoActual.prisioneros || [];
  if (prisioneros.length === 0) {
    cont.innerHTML = `<p style="color:var(--parchment-dim); font-size:.85rem;">No tienes ningún prisionero en tu calabozo.</p>`;
    return;
  }
  cont.innerHTML = prisioneros
    .map((p) => {
      const rescateEnCurso = rescatesActuales.find((r) => r.prisioneroId === p.id && r.estado === "pendiente");
      return `
        <div class="reino-card" style="flex-direction:column; align-items:stretch; gap:.4em;">
          <span>⛓️ ${p.nombre}, de ${p.origenNombre}</span>
          ${
            rescateEnCurso
              ? `<span class="mono" style="font-size:.72rem; color:var(--parchment-dim);">Rescate pedido: 🪙${rescateEnCurso.cantidadOro} — esperando respuesta de ${p.origenNombre}...</span>`
              : `<div style="display:flex; gap:.4em; flex-wrap:wrap;">
                  <button class="btn-liberar-prisionero" data-id="${p.id}" style="font-size:.7rem;">🔓 Liberar</button>
                  <button class="btn-pedir-rescate" data-id="${p.id}" data-nombre="${p.nombre}" data-origen-uid="${p.origenUid}" data-origen-nombre="${p.origenNombre}" style="font-size:.7rem;">💰 Pedir rescate</button>
                  <button class="btn-ejecutar-prisionero" data-id="${p.id}" data-nombre="${p.nombre}" style="font-size:.7rem; color:var(--rust);">⚔️ Ejecutar</button>
                </div>`
          }
        </div>`;
    })
    .join("");

  cont.querySelectorAll(".btn-liberar-prisionero").forEach((btn) => btn.addEventListener("click", () => liberarPrisionero(btn.dataset.id)));
  cont.querySelectorAll(".btn-ejecutar-prisionero").forEach((btn) => btn.addEventListener("click", () => ejecutarPrisionero(btn.dataset.id, btn.dataset.nombre)));
  cont.querySelectorAll(".btn-pedir-rescate").forEach((btn) =>
    btn.addEventListener("click", () => pedirRescate(btn.dataset.id, btn.dataset.nombre, btn.dataset.origenUid, btn.dataset.origenNombre))
  );
}

async function liberarPrisionero(prisioneroId) {
  const prisionero = (reinoActual.prisioneros || []).find((p) => p.id === prisioneroId);
  if (!prisionero) return;
  const nuevos = (reinoActual.prisioneros || []).filter((p) => p.id !== prisioneroId);
  await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), {
    prisioneros: nuevos,
    reputacion: Math.min(100, (reinoActual.reputacion ?? 100) + 5),
  });
  await addDoc(collection(db, "mundos", mundoId, "mensajes"), {
    autorUid: "sistema",
    autorNombre: "📯 Heraldo",
    texto: `🔓 ${reinoActual.nombreReino} libera a ${prisionero.nombre}, de ${prisionero.origenNombre}, como gesto de buena voluntad.`,
    timestamp: serverTimestamp(),
  });
}

async function ejecutarPrisionero(prisioneroId, prisioneroNombre) {
  if (!confirm(`¿Seguro que quieres ejecutar a ${prisioneroNombre}? Perderás bastante reputación, y todo el mundo se enterará.`)) return;
  const nuevos = (reinoActual.prisioneros || []).filter((p) => p.id !== prisioneroId);
  await updateDoc(doc(db, "mundos", mundoId, "reinos", currentUid), {
    prisioneros: nuevos,
    reputacion: Math.max(0, (reinoActual.reputacion ?? 100) - 20),
  });
  await addDoc(collection(db, "mundos", mundoId, "mensajes"), {
    autorUid: "sistema",
    autorNombre: "📯 Heraldo",
    texto: `⚔️💀 ${reinoActual.nombreReino} ejecuta a ${prisioneroNombre}. Un acto que no quedará olvidado.`,
    timestamp: serverTimestamp(),
  });
}

async function pedirRescate(prisioneroId, prisioneroNombre, origenUid, origenNombre) {
  const cantidadStr = prompt(`¿Cuánto oro le pides a ${origenNombre} por liberar a ${prisioneroNombre}?`, "200");
  if (!cantidadStr) return;
  const cantidad = Math.max(1, Number(cantidadStr) || 0);
  await addDoc(collection(db, "mundos", mundoId, "rescates"), {
    prisioneroId,
    prisioneroNombre,
    capturadorUid: currentUid,
    capturadorNombre: reinoActual.nombreReino,
    origenUid,
    origenNombre,
    cantidadOro: cantidad,
    estado: "pendiente",
    creadoEn: serverTimestamp(),
  });
}

function renderRescatesPorMiGente() {
  const cont = $("lista-rescates-por-mi-gente");
  if (!cont) return;
  const relevantes = rescatesActuales.filter((r) => r.origenUid === currentUid && r.estado === "pendiente");
  if (relevantes.length === 0) {
    cont.innerHTML = `<p style="color:var(--parchment-dim); font-size:.85rem;">Nadie te pide rescate por ninguno de los tuyos ahora mismo.</p>`;
    return;
  }
  cont.innerHTML = relevantes
    .map(
      (r) => `
      <div class="reino-card">
        <span>${r.capturadorNombre} pide 🪙${r.cantidadOro} por liberar a ${r.prisioneroNombre}</span>
        <div style="display:flex; gap:.4em;">
          <button class="btn-pagar-rescate" data-id="${r.id}" style="font-size:.7rem;">💰 Pagar</button>
          <button class="btn-rechazar-rescate" data-id="${r.id}" style="font-size:.7rem;">❌ No pagar</button>
        </div>
      </div>`
    )
    .join("");
  cont.querySelectorAll(".btn-pagar-rescate").forEach((btn) => btn.addEventListener("click", () => pagarRescate(btn.dataset.id)));
  cont.querySelectorAll(".btn-rechazar-rescate").forEach((btn) =>
    btn.addEventListener("click", () => updateDoc(doc(db, "mundos", mundoId, "rescates", btn.dataset.id), { estado: "rechazado" }))
  );
}

async function pagarRescate(rescateId) {
  try {
    await runTransaction(db, async (tx) => {
      const rescateRef = doc(db, "mundos", mundoId, "rescates", rescateId);
      const rescateSnap = await tx.get(rescateRef);
      const r = rescateSnap.data();
      if (!r || r.estado !== "pendiente") return;

      const origenRef = doc(db, "mundos", mundoId, "reinos", r.origenUid);
      const origenSnap = await tx.get(origenRef);
      const origen = origenSnap.data();
      const recursosOrigen = recursosActuales(origen);
      if (recursosOrigen.oro < r.cantidadOro) throw new Error("No tienes suficiente oro para pagar este rescate.");

      const capturadorRef = doc(db, "mundos", mundoId, "reinos", r.capturadorUid);
      const capturadorSnap = await tx.get(capturadorRef);
      const capturador = capturadorSnap.data();
      const recursosCapturador = recursosActuales(capturador);

      tx.update(origenRef, {
        recursos: { ...recursosOrigen, oro: recursosOrigen.oro - r.cantidadOro },
        ultimaActualizacionRecursos: serverTimestamp(),
      });
      tx.update(capturadorRef, {
        recursos: { ...recursosCapturador, oro: recursosCapturador.oro + r.cantidadOro },
        ultimaActualizacionRecursos: serverTimestamp(),
        prisioneros: (capturador.prisioneros || []).filter((p) => p.id !== r.prisioneroId),
      });
      tx.update(rescateRef, { estado: "pagado" });
    });
  } catch (e) {
    alert(`No se pudo pagar el rescate: ${e.message}`);
  }
}

// ---------- Comercio entre reinos ----------
let comercioObjetivo = null; // { uid, nombre }

function abrirComercio(uid, nombre) {
  comercioObjetivo = { uid, nombre };
  $("comercio-titulo").textContent = `💱 Comerciar con ${nombre}`;
  ["ofrece-comida", "ofrece-piedra", "ofrece-oro", "pide-comida", "pide-piedra", "pide-oro"].forEach((id) => ($(`in-${id}`).value = 0));
  $("comercio-modal").classList.add("visible");
}
$("btn-cancelar-comercio").addEventListener("click", () => $("comercio-modal").classList.remove("visible"));

$("btn-confirmar-comercio").addEventListener("click", async () => {
  if (!comercioObjetivo) return;
  const ofrece = {
    comida: Math.max(0, Number($("in-ofrece-comida").value) || 0),
    piedra: Math.max(0, Number($("in-ofrece-piedra").value) || 0),
    oro: Math.max(0, Number($("in-ofrece-oro").value) || 0),
  };
  const pide = {
    comida: Math.max(0, Number($("in-pide-comida").value) || 0),
    piedra: Math.max(0, Number($("in-pide-piedra").value) || 0),
    oro: Math.max(0, Number($("in-pide-oro").value) || 0),
  };
  const totalOfrece = ofrece.comida + ofrece.piedra + ofrece.oro;
  const totalPide = pide.comida + pide.piedra + pide.oro;
  if (totalOfrece === 0 && totalPide === 0) return alert("Pon algo que ofrezcas o que pidas, al menos.");

  const recursos = await sincronizarRecursos();
  if (recursos.comida < ofrece.comida || recursos.piedra < ofrece.piedra || recursos.oro < ofrece.oro) {
    return alert("No tienes suficientes recursos para ofrecer eso.");
  }

  await addDoc(collection(db, "mundos", mundoId, "comercios"), {
    proponenteUid: currentUid,
    proponenteNombre: reinoActual.nombreReino,
    destinatarioUid: comercioObjetivo.uid,
    destinatarioNombre: comercioObjetivo.nombre,
    ofrece,
    pide,
    estado: "pendiente",
    creadoEn: serverTimestamp(),
  });

  comercioObjetivo = null;
  $("comercio-modal").classList.remove("visible");
});

function textoRecursos(r) {
  const partes = [r.comida ? `🌾${r.comida}` : "", r.piedra ? `🪨${r.piedra}` : "", r.oro ? `🪙${r.oro}` : ""].filter(Boolean);
  return partes.length > 0 ? partes.join(" ") : "nada";
}

function renderComerciosRecibidos() {
  const cont = $("lista-comercios-recibidos");
  if (!cont) return;
  const recibidos = comerciosActuales.filter((c) => c.destinatarioUid === currentUid && c.estado === "pendiente");
  const enviados = comerciosActuales.filter((c) => c.proponenteUid === currentUid && c.estado === "pendiente");

  let html = "";
  if (recibidos.length === 0 && enviados.length === 0) {
    html = `<p style="color:var(--parchment-dim); font-size:.85rem;">No tienes ninguna oferta de comercio pendiente.</p>`;
  }
  html += recibidos
    .map(
      (c) => `
      <div class="reino-card" style="flex-direction:column; align-items:stretch; gap:.4em;">
        <span>${c.proponenteNombre} te ofrece ${textoRecursos(c.ofrece)} a cambio de ${textoRecursos(c.pide)}</span>
        <div style="display:flex; gap:.4em;">
          <button class="btn-aceptar-comercio" data-id="${c.id}" style="font-size:.7rem;">✅ Aceptar</button>
          <button class="btn-rechazar-comercio" data-id="${c.id}" style="font-size:.7rem;">❌ Rechazar</button>
        </div>
      </div>`
    )
    .join("");
  html += enviados
    .map(
      (c) => `<p style="color:var(--parchment-dim); font-size:.8rem;">⏳ Esperando que ${c.destinatarioNombre} responda a tu oferta (${textoRecursos(c.ofrece)} por ${textoRecursos(c.pide)})...</p>`
    )
    .join("");
  cont.innerHTML = html;

  cont.querySelectorAll(".btn-aceptar-comercio").forEach((btn) => btn.addEventListener("click", () => aceptarComercio(btn.dataset.id)));
  cont.querySelectorAll(".btn-rechazar-comercio").forEach((btn) =>
    btn.addEventListener("click", () => updateDoc(doc(db, "mundos", mundoId, "comercios", btn.dataset.id), { estado: "rechazado" }))
  );
}

async function aceptarComercio(comercioId) {
  try {
    await runTransaction(db, async (tx) => {
      const comercioRef = doc(db, "mundos", mundoId, "comercios", comercioId);
      const comercioSnap = await tx.get(comercioRef);
      const c = comercioSnap.data();
      if (!c || c.estado !== "pendiente") return;

      const proponenteRef = doc(db, "mundos", mundoId, "reinos", c.proponenteUid);
      const destinatarioRef = doc(db, "mundos", mundoId, "reinos", c.destinatarioUid);
      const proponenteSnap = await tx.get(proponenteRef);
      const destinatarioSnap = await tx.get(destinatarioRef);
      const proponente = proponenteSnap.data();
      const destinatario = destinatarioSnap.data();

      const recursosProponente = recursosActuales(proponente);
      const recursosDestinatario = recursosActuales(destinatario);

      if (recursosProponente.comida < c.ofrece.comida || recursosProponente.piedra < c.ofrece.piedra || recursosProponente.oro < c.ofrece.oro) {
        throw new Error(`${c.proponenteNombre} ya no tiene suficientes recursos para cumplir su parte.`);
      }
      if (recursosDestinatario.comida < c.pide.comida || recursosDestinatario.piedra < c.pide.piedra || recursosDestinatario.oro < c.pide.oro) {
        throw new Error("No tienes suficientes recursos para dar lo que pedían a cambio.");
      }

      tx.update(proponenteRef, {
        recursos: {
          comida: recursosProponente.comida - c.ofrece.comida + c.pide.comida,
          piedra: recursosProponente.piedra - c.ofrece.piedra + c.pide.piedra,
          oro: recursosProponente.oro - c.ofrece.oro + c.pide.oro,
        },
        ultimaActualizacionRecursos: serverTimestamp(),
      });
      tx.update(destinatarioRef, {
        recursos: {
          comida: recursosDestinatario.comida - c.pide.comida + c.ofrece.comida,
          piedra: recursosDestinatario.piedra - c.pide.piedra + c.ofrece.piedra,
          oro: recursosDestinatario.oro - c.pide.oro + c.ofrece.oro,
        },
        ultimaActualizacionRecursos: serverTimestamp(),
      });
      tx.update(comercioRef, { estado: "aceptado" });
    });
    await addDoc(collection(db, "mundos", mundoId, "mensajes"), {
      autorUid: "sistema",
      autorNombre: "📯 Heraldo",
      texto: `💱 ${reinoActual.nombreReino} cierra un trato comercial.`,
      timestamp: serverTimestamp(),
    });
  } catch (e) {
    alert(`No se pudo aceptar el comercio: ${e.message}`);
  }
}

// ---------- Donaciones: transferencia instantánea, sin condiciones ----------
let donarObjetivo = null; // { uid, nombre }

function abrirDonar(uid, nombre) {
  donarObjetivo = { uid, nombre };
  $("donar-titulo").textContent = `🎁 Donar a ${nombre}`;
  $("in-cantidad-donar").value = 100;
  $("donar-modal").classList.add("visible");
}
$("btn-cancelar-donar").addEventListener("click", () => $("donar-modal").classList.remove("visible"));

$("btn-confirmar-donar").addEventListener("click", async () => {
  if (!donarObjetivo) return;
  const recurso = $("sel-recurso-donar").value; // "comida" | "piedra" | "oro"
  const cantidad = Math.max(1, Number($("in-cantidad-donar").value) || 0);

  try {
    await runTransaction(db, async (tx) => {
      const miRef = doc(db, "mundos", mundoId, "reinos", currentUid);
      const otroRef = doc(db, "mundos", mundoId, "reinos", donarObjetivo.uid);
      const miSnap = await tx.get(miRef);
      const otroSnap = await tx.get(otroRef);
      const mi = miSnap.data();
      const otro = otroSnap.data();

      const recursosMios = recursosActuales(mi);
      if (recursosMios[recurso] < cantidad) throw new Error("No tienes suficiente para donar esa cantidad.");
      const recursosOtro = recursosActuales(otro);

      tx.update(miRef, {
        recursos: { ...recursosMios, [recurso]: recursosMios[recurso] - cantidad },
        ultimaActualizacionRecursos: serverTimestamp(),
      });
      tx.update(otroRef, {
        recursos: { ...recursosOtro, [recurso]: recursosOtro[recurso] + cantidad },
        ultimaActualizacionRecursos: serverTimestamp(),
      });
    });

    const emoji = { comida: "🌾", piedra: "🪨", oro: "🪙" }[recurso];
    await addDoc(collection(db, "mundos", mundoId, "mensajes"), {
      autorUid: "sistema",
      autorNombre: "📯 Heraldo",
      texto: `🎁 ${reinoActual.nombreReino} dona ${emoji}${cantidad} a ${donarObjetivo.nombre}. Un gesto generoso.`,
      timestamp: serverTimestamp(),
    });
    donarObjetivo = null;
    $("donar-modal").classList.remove("visible");
  } catch (e) {
    alert(`No se pudo donar: ${e.message}`);
  }
});
