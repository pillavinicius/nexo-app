const VERDICT_RANK = Object.freeze({
  VETADO: 0,
  EVITAR: 1,
  AGUARDAR: 2,
  WATCHLIST: 2,
  MONITORAR: 3,
  APROVADO: 4,
  COMPRAR: 4,
});

function normalizeVerdict(value) {
  return String(value || "").trim().toUpperCase();
}

export function deriveVerdictChange(previous, current, fallback = "MANTEVE") {
  const before = normalizeVerdict(previous);
  const after = normalizeVerdict(current);

  if (before && after && before === after) return "MANTEVE";

  const beforeRank = VERDICT_RANK[before];
  const afterRank = VERDICT_RANK[after];
  if (Number.isFinite(beforeRank) && Number.isFinite(afterRank)) {
    if (afterRank > beforeRank) return "MELHOROU";
    if (afterRank < beforeRank) return "PIOROU";
    return "MANTEVE";
  }

  const declared = normalizeVerdict(fallback);
  return ["MANTEVE", "MELHOROU", "PIOROU"].includes(declared)
    ? declared
    : "MANTEVE";
}

export function reconcileFinalVerdictChange(phase, result) {
  if (phase !== "final" || !result || typeof result !== "object") return result;

  const current = result.veredito_reclassificado || result.classificacao_final;
  return {
    ...result,
    mudanca_veredito: deriveVerdictChange(
      result.veredito_anterior,
      current,
      result.mudanca_veredito
    ),
  };
}
