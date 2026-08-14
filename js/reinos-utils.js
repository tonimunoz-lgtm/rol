// js/reinos-utils.js
// Cálculo de recursos "en tiempo real" sin que nada corra constantemente
// en el servidor: cada reino guarda cuánto tenía y cuándo se calculó por
// última vez; el propio cliente calcula al vuelo cuánto se ha producido
// desde entonces (funciona igual aunque el jugador lleve horas sin
// conectarse — es la misma técnica que usan Travian/Tribal Wars).

export const EDIFICIOS_DEF = {
  granja: { nombre: "Granja", icono: "🌾", produce: "comida", descripcion: "Produce comida para alimentar a tu gente y tu ejército." },
  cantera: { nombre: "Cantera", icono: "🪨", produce: "piedra", descripcion: "Extrae piedra para construir y ampliar edificios." },
  mina: { nombre: "Mina de oro", icono: "🪙", produce: "oro", descripcion: "Oro para pagar mejoras y mantener tropas." },
  murallas: { nombre: "Murallas", icono: "🧱", produce: null, descripcion: "Cuanto más altas, más difícil conquistar tu castillo." },
  cuadras: { nombre: "Cuadras", icono: "🐎", produce: null, descripcion: "Caballos para tropas montadas, más rápidas." },
  barracones: { nombre: "Barracones", icono: "⚔️", produce: null, descripcion: "Aquí se entrenan los soldados de tu ejército." },
};

export const ORDEN_EDIFICIOS = ["granja", "cantera", "mina", "murallas", "cuadras", "barracones"];

// El coste sube de forma moderada por nivel — asequible al principio,
// cada vez más caro (y más lento) según creces.
export function costeMejora(nivelActual) {
  const factor = Math.pow(1.55, nivelActual);
  return {
    comida: Math.round(40 * factor),
    piedra: Math.round(55 * factor),
    oro: Math.round(25 * factor),
    segundos: Math.round(45 * factor),
  };
}

export function produccionPorNivel(nivel) {
  return Math.round(8 * (nivel || 0) * 1.25);
}

// La caballería cuenta el doble en combate que la infantería (más cara y
// más lenta de entrenar, a cambio de pegar más fuerte).
export function fuerzaEjercito(ejercito) {
  return (ejercito?.soldados || 0) + (ejercito?.caballeria || 0) * 2;
}

// Las murallas dan un % de defensa extra por nivel — cuanto más altas,
// más difícil conquistar ese castillo a la fuerza.
export function defensaConMurallas(reino) {
  const nivelMurallas = reino.edificios?.murallas?.nivel || 0;
  return fuerzaEjercito(reino.ejercito) * (1 + nivelMurallas * 0.15);
}

export const COSTE_SOLDADO = { comida: 8, piedra: 2, oro: 6, segundos: 6 };
export const COSTE_CABALLERIA = { comida: 14, piedra: 4, oro: 14, segundos: 10 };

export function calcularProduccionTotal(edificios) {
  return {
    // Antes esto era tan bajo que en una sesión de prueba de pocos minutos
    // no se apreciaba ningún cambio (el redondeo hacía el resto). Ahora la
    // base ya da un ritmo visible desde el primer minuto, y cada nivel de
    // edificio suma bastante más encima.
    comida: 240 + produccionPorNivel(edificios?.granja?.nivel) * 6,
    piedra: 180 + produccionPorNivel(edificios?.cantera?.nivel) * 6,
    oro: 120 + produccionPorNivel(edificios?.mina?.nivel) * 6,
  };
}

function aMilisegundos(valor) {
  if (!valor) return Date.now();
  if (typeof valor.toMillis === "function") return valor.toMillis();
  if (typeof valor === "number") return valor;
  return Date.now();
}

// Los recursos reales AHORA MISMO = lo guardado + lo producido desde la
// última vez que se calculó, según la producción por hora.
export function recursosActuales(reino) {
  const ahora = Date.now();
  const ultima = aMilisegundos(reino.ultimaActualizacionRecursos);
  const horas = Math.max(0, (ahora - ultima) / 3_600_000);
  const produccion = reino.produccionPorHora || { comida: 0, piedra: 0, oro: 0 };
  const guardado = reino.recursos || { comida: 0, piedra: 0, oro: 0 };
  return {
    comida: Math.floor(guardado.comida + produccion.comida * horas),
    piedra: Math.floor(guardado.piedra + produccion.piedra * horas),
    oro: Math.floor(guardado.oro + produccion.oro * horas),
  };
}

export function puedeCostear(recursos, coste) {
  return recursos.comida >= coste.comida && recursos.piedra >= coste.piedra && recursos.oro >= coste.oro;
}

export function generarCodigoMundo() {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += letras[Math.floor(Math.random() * letras.length)];
  return out;
}

const RANGOS = [
  { min: 0, nombre: "Aldea" },
  { min: 3, nombre: "Señorío" },
  { min: 6, nombre: "Condado" },
  { min: 11, nombre: "Ducado" },
  { min: 20, nombre: "Reino" },
  { min: 35, nombre: "Imperio" },
];
export function calcularRango(numTerritorios) {
  let actual = RANGOS[0].nombre;
  for (const r of RANGOS) {
    if (numTerritorios >= r.min) actual = r.nombre;
  }
  return actual;
}
