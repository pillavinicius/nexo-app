export const GAP_INTEGRITY_VERSION = "GAP_v1.0";

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalized(value) {
  return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function distinct(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = normalized(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function deriveFallbackScanGaps(scan = {}) {
  const existing = distinct(list(scan?.lacunas_deep).map(text).filter(Boolean));
  if (existing.length >= 2) return existing.slice(0, 8);

  const missingKpis = list(scan?.kpis).filter((item) => /^(?:n\/?d|n[aã]o\s+informad|indispon[ií]vel|—|-)?$/i.test(text(item?.valor)));
  const fromKpis = missingKpis.map((item) => `Confirmar ${text(item?.nome) || "o indicador ausente"} em fonte primária recente, incluindo valor, período de referência e impacto sobre a tese.`);
  const materialRisks = list(scan?.riscos)
    .filter((item) => ["ALTO", "MEDIO", "MÉDIO"].includes(text(item?.severidade).toUpperCase()))
    .map((item) => `Quantificar em fonte primária recente o risco de ${text(item?.descricao).replace(/[.\s]+$/g, "")}, incluindo exposição financeira, horizonte e gatilhos observáveis.`);
  const fallbacks = [
    "Validar em fonte primária recente a sustentabilidade dos resultados, retornos e geração de caixa apresentados no Scan.",
    "Confirmar em fonte primária recente as premissas de valuation, endividamento e alocação de capital relevantes para a tese.",
  ];
  return distinct([...existing, ...fromKpis, ...materialRisks, ...fallbacks]).slice(0, 2);
}

export function reconcileScanGaps(result) {
  if (!result || typeof result !== "object") return result;
  const original = distinct(list(result.lacunas_deep).map(text).filter(Boolean));
  const governed = deriveFallbackScanGaps(result);
  if (governed.length === original.length && governed.every((gap, index) => gap === original[index])) return result;
  return {
    ...result,
    lacunas_deep: governed,
    integridade_analise: {
      ...(result.integridade_analise || {}),
      gap_integrity_version: GAP_INTEGRITY_VERSION,
      scan_gaps_generated_by_server: governed.slice(original.length),
    },
  };
}
