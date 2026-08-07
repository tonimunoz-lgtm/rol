// js/mapa-utils.js
// Utilidades compartidas entre master.js y app.js para el mapa de la
// partida: un mapa vectorial (SVG), no una imagen generada, para que pueda
// ser interactivo de verdad (zoom, paneo, marcar "estás aquí" según la
// escena activa) sin depender de un servicio de pago de generación de
// imágenes.

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

function escaparXML(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Genera el SVG del mapa (viewBox 0-100, coincide con las coordenadas x/y en
// porcentaje de cada lugar). Se usa tanto en la vista previa del master como
// en el mapa interactivo del jugador, para que ambos se vean exactamente
// igual. lugarActivoId marca "estás aquí" si se pasa.
export function renderizarMapaSVG(mapa, lugarActivoId) {
  const lugares = mapa?.lugares || [];
  const conexiones = mapa?.conexiones || [];
  const porId = Object.fromEntries(lugares.map((l) => [l.id, l]));

  const lineas = conexiones
    .map(([idA, idB]) => {
      const a = porId[idA];
      const b = porId[idB];
      if (!a || !b) return "";
      // Pequeño desvío en el punto medio para que no sea una recta perfecta
      // (aspecto de camino/río trazado a mano, no una regla).
      const mx = (a.x + b.x) / 2 + Math.sin(a.x * 3 + b.y) * 4;
      const my = (a.y + b.y) / 2 + Math.cos(b.x * 3 + a.y) * 4;
      return `<path d="M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}" class="mapa-camino" />`;
    })
    .join("");

  const marcadores = lugares
    .map((l) => {
      const icono = ICONOS_LUGAR[l.tipo] || ICONOS_LUGAR.otro;
      const esActivo = l.id === lugarActivoId;
      return `
        <g class="mapa-lugar${esActivo ? " mapa-lugar-activo" : ""}" data-id="${l.id}" transform="translate(${l.x}, ${l.y})">
          ${esActivo ? `<circle r="7" class="mapa-aqui-anillo" />` : ""}
          <circle r="3.6" class="mapa-lugar-fondo" />
          <text text-anchor="middle" dominant-baseline="central" font-size="4" class="mapa-lugar-icono">${icono}</text>
          <text text-anchor="middle" y="6.8" font-size="2.6" class="mapa-lugar-etiqueta">${escaparXML(l.nombre || "")}</text>
        </g>`;
    })
    .join("");

  return `
    <svg viewBox="0 0 100 100" class="mapa-svg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <rect x="0" y="0" width="100" height="100" class="mapa-fondo" />
      ${lineas}
      ${marcadores}
    </svg>`;
}
