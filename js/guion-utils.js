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

// Da un id estable a cada escena (si no lo tenía) y migra los formatos
// antiguos al formato moderno:
//   - "trigger" único → lista "salidas"
//   - "prueba" única de la escena → lista "acciones" con una sola acción
//   - triggers "prueba_superada"/"prueba_fallada" (sin valor) → "accion_superada"/
//     "accion_fallada" con valor = id de esa acción migrada
// Así el resto del código solo tiene que pensar en el formato moderno.
export function normalizarGuion(guionCrudo) {
  const conId = (guionCrudo || []).map((escena, i) => ({
    ...escena,
    id: escena.id || `legacy-${i}`,
  }));

  return conId.map((escena, i) => {
    let acciones = escena.acciones;
    if (!Array.isArray(acciones)) {
      acciones = escena.prueba?.activa
        ? [
            {
              id: "accion-legacy",
              etiqueta: "Intentar superar la prueba",
              tipo: "prueba",
              atributo: escena.prueba.atributo,
              dificultad: escena.prueba.dificultad,
              tipoDanio: escena.prueba.tipoDanio,
              danioDados: escena.prueba.danioDados,
              danioCaras: escena.prueba.danioCaras,
              textoExito: "",
              textoFallo: "",
            },
          ]
        : [];
    }

    let salidas = escena.salidas;
    if (!Array.isArray(salidas)) {
      const siguienteId = conId[i + 1]?.id ?? null;
      salidas =
        escena.trigger && escena.trigger.tipo !== "manual" && siguienteId
          ? [{ trigger: escena.trigger, siguienteId }]
          : [];
    }
    salidas = salidas.map((s) => {
      if (s.trigger?.tipo === "prueba_superada") {
        return { ...s, trigger: { tipo: "accion_superada", valor: "accion-legacy" } };
      }
      if (s.trigger?.tipo === "prueba_fallada") {
        return { ...s, trigger: { tipo: "accion_fallada", valor: "accion-legacy" } };
      }
      return s;
    });

    return { ...escena, acciones, salidas };
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
