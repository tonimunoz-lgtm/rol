// js/mapa-utils.js
// Utilidades compartidas entre master.js y app.js para el mapa de la
// partida: un mapa vectorial (SVG), no una imagen generada, para que pueda
// ser interactivo de verdad (zoom, paneo, marcar "estás aquí" según la
// escena activa) sin depender de un servicio de pago de generación de
// imágenes. Dibuja relieve real (montañas, bosques, lagos, mares, pantanos)
// en vez de solo iconos sueltos sobre un fondo liso.

export function generarIdLugar() {
  return `lug_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// Da un id estable a cada lugar y convierte las conexiones del formato que
// devuelve la IA (pares de ÍNDICES dentro del array "lugares") al formato
// estable de pares de ids, para que sobrevivan a añadir/quitar/reordenar
// lugares después.
export function normalizarMapa(mapaCrudo) {
  if (!mapaCrudo) return { descripcion: "", lugares: [], conexiones: [] };

  const lugares = (mapaCrudo.lugares || []).map((l, i) => ({
    ...l,
    id: l.id || generarIdLugar(),
    x: Number(l.x) || 0,
    y: Number(l.y) || 0,
  }));

  const conexiones = (mapaCrudo.conexiones || [])
    .map((par) => {
      if (!Array.isArray(par) || par.length !== 2) return null;
      const [a, b] = par;
      // Formato antiguo/crudo (de la IA): índices numéricos en el array.
      if (typeof a === "number" && typeof b === "number") {
        const idA = lugares[a]?.id;
        const idB = lugares[b]?.id;
        return idA && idB ? [idA, idB] : null;
      }
      // Formato ya normalizado: pares de ids (strings).
      const idA = lugares.some((l) => l.id === a) ? a : null;
      const idB = lugares.some((l) => l.id === b) ? b : null;
      return idA && idB ? [idA, idB] : null;
    })
    .filter(Boolean);

  return {
    descripcion: mapaCrudo.descripcion || "",
    lugares,
    conexiones,
  };
}

export const ICONOS_LUGAR = {
  pueblo: "🏘️",
  bosque: "🌲",
  rio: "🌊",
  lago: "💧",
  puente: "🌉",
  montana: "⛰️",
  ruinas: "🏛️",
  cueva: "🕳️",
  castillo: "🏰",
  mar: "⚓",
  pantano: "🥀",
  camino: "🛤️",
  otro: "📍",
};

// Tipos que se dibujan como relieve del terreno (con forma propia) en vez
// de como un icono redondo de "punto de interés".
const TIPOS_TERRENO = ["montana", "bosque", "lago", "mar", "pantano", "rio"];

function escaparXML(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Generador pseudoaleatorio determinista (mismo id → mismo dibujo siempre,
// para que el mapa no "salte" visualmente cada vez que se vuelve a pintar).
function crearPrng(semilla) {
  let s = semilla % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
function semillaDesde(texto) {
  let h = 0;
  for (let i = 0; i < String(texto).length; i++) h = (h * 31 + String(texto).charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

// ---------- Relieve: cada tipo de terreno dibuja una "mancha" propia ----------

function dibujarMontanas(cx, cy, seed) {
  const rand = crearPrng(seed);
  const n = 3 + Math.floor(rand() * 3);
  let out = "";
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + rand() * 0.7;
    const dist = rand() * 4.5;
    const px = cx + Math.cos(ang) * dist;
    const py = cy + Math.sin(ang) * dist * 0.6;
    const w = 3.4 + rand() * 2.4;
    const h = 4.2 + rand() * 3.2;
    out += `<polygon points="${px},${py - h} ${px - w / 2},${py + h * 0.22} ${px + w / 2},${py + h * 0.22}" class="mapa-montana" />`;
    out += `<polygon points="${px},${py - h} ${px - w * 0.16},${py - h * 0.5} ${px + w * 0.16},${py - h * 0.5}" class="mapa-montana-nieve" />`;
  }
  return `<g>${out}</g>`;
}

function dibujarBosque(cx, cy, seed) {
  const rand = crearPrng(seed);
  const n = 7 + Math.floor(rand() * 6);
  let out = "";
  for (let i = 0; i < n; i++) {
    const ang = rand() * Math.PI * 2;
    const dist = rand() * 5.5;
    const px = cx + Math.cos(ang) * dist;
    const py = cy + Math.sin(ang) * dist * 0.7;
    const s = 0.8 + rand() * 0.7;
    out += `<g transform="translate(${px.toFixed(2)}, ${py.toFixed(2)}) scale(${s.toFixed(2)})" class="mapa-arbol">
      <polygon points="0,-2.6 -1.5,0.7 1.5,0.7" />
      <rect x="-0.25" y="0.6" width="0.5" height="0.9" />
    </g>`;
  }
  return `<g>${out}</g>`;
}

function dibujarBlob(cx, cy, seed, radioBase, claseRelleno) {
  const rand = crearPrng(seed);
  const n = 9;
  const puntos = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const r = radioBase * (0.7 + rand() * 0.55);
    puntos.push(`${(cx + Math.cos(ang) * r).toFixed(2)},${(cy + Math.sin(ang) * r * 0.75).toFixed(2)}`);
  }
  return `<polygon points="${puntos.join(" ")}" class="${claseRelleno}" />`;
}

function dibujarLago(cx, cy, seed) {
  const base = dibujarBlob(cx, cy, seed, 4.4, "mapa-lago");
  const brillo = `<ellipse cx="${(cx - 1).toFixed(2)}" cy="${(cy - 1).toFixed(2)}" rx="1.6" ry="0.9" class="mapa-lago-brillo" />`;
  return `<g>${base}${brillo}</g>`;
}

function dibujarPantano(cx, cy, seed) {
  const rand = crearPrng(seed);
  let out = dibujarBlob(cx, cy, seed, 4.2, "mapa-pantano");
  for (let i = 0; i < 5; i++) {
    const ang = rand() * Math.PI * 2;
    const dist = rand() * 2.6;
    const px = cx + Math.cos(ang) * dist;
    const py = cy + Math.sin(ang) * dist * 0.7;
    out += `<line x1="${px.toFixed(2)}" y1="${py.toFixed(2)}" x2="${(px + 0.25).toFixed(2)}" y2="${(py - 1.7).toFixed(2)}" class="mapa-junco" />`;
  }
  return `<g>${out}</g>`;
}

// El mar "inunda" desde el borde del mapa más cercano al punto que marcó el
// master/la IA, con una línea de costa irregular (no una raya recta).
function dibujarMar(cx, cy, seed) {
  const rand = crearPrng(seed);
  const distancias = { izquierda: cx, derecha: 100 - cx, arriba: cy, abajo: 100 - cy };
  const borde = Object.entries(distancias).sort((a, b) => a[1] - b[1])[0][0];

  const costa = [];
  const segmentos = 6;
  for (let i = 0; i <= segmentos; i++) {
    const t = i / segmentos;
    const jitter = (rand() - 0.5) * 9;
    if (borde === "izquierda" || borde === "derecha") {
      const y = t * 100;
      const xBase = borde === "izquierda" ? Math.min(cx + 10, 55) : Math.max(cx - 10, 45);
      costa.push(`${xBase + jitter},${y.toFixed(1)}`);
    } else {
      const x = t * 100;
      const yBase = borde === "arriba" ? Math.min(cy + 10, 55) : Math.max(cy - 10, 45);
      costa.push(`${x.toFixed(1)},${yBase + jitter}`);
    }
  }
  let poligono;
  if (borde === "izquierda") poligono = `0,0 ${costa.join(" ")} 0,100`;
  else if (borde === "derecha") poligono = `100,0 ${costa.join(" ")} 100,100`;
  else if (borde === "arriba") poligono = `0,0 ${costa.join(" ")} 100,0`;
  else poligono = `0,100 ${costa.join(" ")} 100,100`;

  let oleaje = "";
  for (let i = 0; i < 4; i++) {
    const t = (i + 0.5) / 4;
    let x, y;
    if (borde === "izquierda" || borde === "derecha") {
      y = t * 100;
      x = borde === "izquierda" ? cx + 15 : cx - 15;
    } else {
      x = t * 100;
      y = borde === "arriba" ? cy + 15 : cy - 15;
    }
    oleaje += `<path d="M ${(x - 3).toFixed(1)} ${y.toFixed(1)} q 1.5 -1.2 3 0 q 1.5 1.2 3 0" class="mapa-ola" />`;
  }

  return `<g><polygon points="${poligono}" class="mapa-mar" />${oleaje}</g>`;
}

// ---------- Brújula y marco decorativo ----------

function dibujarBrujula() {
  return `
    <g transform="translate(89, 89)" class="mapa-brujula">
      <circle r="6.5" class="mapa-brujula-fondo" />
      <line x1="0" y1="-5.8" x2="0" y2="5.8" class="mapa-brujula-eje" />
      <line x1="-5.8" y1="0" x2="5.8" y2="0" class="mapa-brujula-eje" />
      <polygon points="0,-6.2 -1,-4.2 1,-4.2" class="mapa-brujula-norte" />
      <text x="0" y="-7.6" text-anchor="middle" class="mapa-brujula-letra">N</text>
      <text x="0" y="9.6" text-anchor="middle" class="mapa-brujula-letra">S</text>
      <text x="8.4" y="0.9" text-anchor="middle" class="mapa-brujula-letra">E</text>
      <text x="-8.4" y="0.9" text-anchor="middle" class="mapa-brujula-letra">O</text>
    </g>`;
}

function dibujarMarco() {
  return `
    <rect x="1.2" y="1.2" width="97.6" height="97.6" class="mapa-marco-externo" />
    <rect x="2.6" y="2.6" width="94.8" height="94.8" class="mapa-marco-interno" />`;
}

function dibujarTextura() {
  const rand = crearPrng(4242);
  let out = "";
  for (let i = 0; i < 16; i++) {
    const x = rand() * 100;
    const y = rand() * 100;
    const r = 3 + rand() * 6;
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" class="mapa-mancha" />`;
  }
  return `<g>${out}</g>`;
}

// Genera el SVG del mapa (viewBox 0-100, coincide con las coordenadas x/y en
// porcentaje de cada lugar). Se usa tanto en la vista previa del master como
// en el mapa interactivo del jugador, para que ambos se vean exactamente
// igual. lugarActivoId marca "estás aquí" con una banderita, si se pasa.
export function renderizarMapaSVG(mapa, lugarActivoId) {
  const lugares = mapa?.lugares || [];
  const conexiones = mapa?.conexiones || [];
  const porId = Object.fromEntries(lugares.map((l) => [l.id, l]));

  const mares = lugares
    .filter((l) => l.tipo === "mar")
    .map((l) => dibujarMar(l.x, l.y, semillaDesde(l.id)))
    .join("");

  const lineas = conexiones
    .map(([idA, idB]) => {
      const a = porId[idA];
      const b = porId[idB];
      if (!a || !b) return "";
      const esRio = ["rio", "lago"].includes(a.tipo) || ["rio", "lago"].includes(b.tipo);
      const mx = (a.x + b.x) / 2 + Math.sin(a.x * 3 + b.y) * 5;
      const my = (a.y + b.y) / 2 + Math.cos(b.x * 3 + a.y) * 5;
      return `<path d="M ${a.x} ${a.y} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${b.x} ${b.y}" class="${esRio ? "mapa-rio" : "mapa-camino"}" />`;
    })
    .join("");

  const relieve = lugares
    .map((l) => {
      const seed = semillaDesde(l.id);
      if (l.tipo === "montana") return dibujarMontanas(l.x, l.y, seed);
      if (l.tipo === "bosque") return dibujarBosque(l.x, l.y, seed);
      if (l.tipo === "lago") return dibujarLago(l.x, l.y, seed);
      if (l.tipo === "pantano") return dibujarPantano(l.x, l.y, seed);
      return "";
    })
    .join("");

  const OFFSET_Y_ETIQUETA = { montana: -10.5, bosque: 8, lago: 7, pantano: 7, rio: -5, mar: 0 };

  const marcadores = lugares
    .map((l) => {
      const esActivo = l.id === lugarActivoId;
      const esTerreno = TIPOS_TERRENO.includes(l.tipo);
      const icono = ICONOS_LUGAR[l.tipo] || ICONOS_LUGAR.otro;
      const claseEtiqueta = esTerreno
        ? l.tipo === "montana" || l.tipo === "bosque"
          ? "mapa-etiqueta-tierra"
          : "mapa-etiqueta-agua"
        : "mapa-etiqueta-asentamiento";
      const offsetY = esTerreno ? OFFSET_Y_ETIQUETA[l.tipo] ?? 7 : 6.8;
      // Evita que el texto se salga del mapa cuando el lugar está muy cerca
      // de un borde (habitual en mares/lagos costeros): cambia la
      // alineación en vez de quedarse centrado sobre el borde.
      const anclaje = l.x > 82 ? "end" : l.x < 18 ? "start" : "middle";
      const dx = l.x > 82 ? -3 : l.x < 18 ? 3 : 0;
      const etiqueta = l.nombre
        ? `<text text-anchor="${anclaje}" x="${dx}" y="${offsetY}" class="mapa-lugar-etiqueta ${claseEtiqueta}">${escaparXML(l.nombre)}</text>`
        : "";
      const marcaAqui = esActivo
        ? `<g class="mapa-aqui">
             <circle r="6.5" class="mapa-aqui-anillo" />
             <line x1="0" y1="0" x2="0" y2="-8.5" class="mapa-aqui-asta" />
             <polygon points="0,-8.5 4.2,-6.8 0,-5.1" class="mapa-aqui-bandera" />
           </g>`
        : "";

      if (esTerreno) {
        return `<g class="mapa-lugar" data-id="${l.id}" transform="translate(${l.x}, ${l.y})">${etiqueta}${marcaAqui}</g>`;
      }
      return `
        <g class="mapa-lugar" data-id="${l.id}" transform="translate(${l.x}, ${l.y})">
          <circle r="3.6" class="mapa-lugar-fondo" />
          <text text-anchor="middle" dominant-baseline="central" font-size="4" class="mapa-lugar-icono">${icono}</text>
          ${etiqueta}
          ${marcaAqui}
        </g>`;
    })
    .join("");

  return `
    <svg viewBox="0 0 100 100" class="mapa-svg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="mapaGradienteFondo" cx="48%" cy="42%" r="75%">
          <stop offset="0%" stop-color="#ecd9a8" />
          <stop offset="100%" stop-color="#c3a267" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="100" height="100" fill="url(#mapaGradienteFondo)" />
      ${dibujarTextura()}
      ${mares}
      ${lineas}
      ${relieve}
      ${marcadores}
      ${dibujarBrujula()}
      ${dibujarMarco()}
    </svg>`;
}
