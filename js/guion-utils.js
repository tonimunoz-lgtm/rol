// js/guion-utils.js
// Utilidades compartidas entre master.js y app.js para trabajar con el
// guion (storyboard de escenas). Desde que el guion soporta ramificaciones
// (una escena puede tener varias salidas posibles, cada una hacia una
// escena distinta según lo que pase), cada escena guarda una lista
// "salidas" en vez de un único "trigger" fijo hacia la escena siguiente.
//
// Las funciones de aquí también dan compatibilidad con partidas creadas
// antes de este cambio (guion con "trigger" único y escenaActual numérico),
// para que sigan funcionando sin que el master tenga que rehacer nada a
// mano — se migran solas en memoria al leerlas.

export function generarIdEscena() {
  return `esc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// Da un id estable a cada escena (si no lo tenía) y convierte el trigger
// único antiguo en una lista "salidas" de un solo elemento, para que el
// resto del código solo tenga que pensar en un único formato (moderno).
export function normalizarGuion(guionCrudo) {
  const conId = (guionCrudo || []).map((escena, i) => ({
    ...escena,
    id: escena.id || `legacy-${i}`,
  }));

  return conId.map((escena, i) => {
    if (Array.isArray(escena.salidas)) return escena;
    // Formato antiguo: un único trigger que llevaba siempre a la escena
    // siguiente del array (o a ninguna parte si era "manual" o la última).
    const siguienteId = conId[i + 1]?.id ?? null;
    const salidas =
      escena.trigger && escena.trigger.tipo !== "manual" && siguienteId
        ? [{ trigger: escena.trigger, siguienteId }]
        : [];
    return { ...escena, salidas };
  });
}

// El campo "escenaActual" de la partida puede ser: un número (partidas
// antiguas, índice en el array), un string con el id de la escena (formato
// nuevo), o no existir todavía (partida recién creada).
export function normalizarEscenaActual(valorCrudo, guionNormalizado) {
  if (typeof valorCrudo === "number") return `legacy-${valorCrudo}`;
  if (typeof valorCrudo === "string" && valorCrudo) return valorCrudo;
  return guionNormalizado[0]?.id ?? null;
}

export function encontrarEscena(guionNormalizado, escenaId) {
  return (guionNormalizado || []).find((e) => e.id === escenaId) || null;
}
