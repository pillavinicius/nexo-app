export const RECLASSIFICATION_INTEGRITY_VERSION = "P3B_v1.0";

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizedKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreOf(stage, fallback = 0) {
  return finiteNumber(stage?.score_revisado, finiteNumber(stage?.score_total, fallback));
}

function scoreMaxOf(stage, fallback = 30) {
  return finiteNumber(stage?.score_max, fallback) || fallback;
}

function latestAnalyticalStage(history = {}) {
  const additions = Array.isArray(history.deepAdds) ? history.deepAdds.filter(Boolean) : [];
  if (additions.length) return { phase: "aprofundamento", data: additions.at(-1) };
  if (history.deep) return { phase: "deep", data: history.deep };
  if (history.scan) return { phase: "scan", data: history.scan };
  return { phase: "none", data: null };
}

function dimensionMapOf(stage, fallbackStage) {
  const dimensions = Array.isArray(stage?.score_dimensoes_revisadas)
    ? stage.score_dimensoes_revisadas
    : Array.isArray(stage?.score_dimensoes)
    ? stage.score_dimensoes
    : Array.isArray(fallbackStage?.score_dimensoes)
    ? fallbackStage.score_dimensoes
    : [];
  return new Map(dimensions.map((item) => [
    normalizedKey(item?.nome || item?.dimensao),
    {
      nome: String(item?.nome || item?.dimensao || "").trim(),
      nota: clamp(finiteNumber(item?.nota, finiteNumber(item?.depois, 0)), 0, 5),
    },
  ]).filter(([key]) => key));
}

function normalizeAdjustments(adjustments, sourcePhase, dimensions, allowedEvidenceIds = new Set()) {
  const seen = new Set();
  const normalized = [];
  const restrictToKnownDimensions = dimensions.size > 0;

  for (const item of Array.isArray(adjustments) ? adjustments : []) {
    const key = normalizedKey(item?.dimensao);
    const after = finiteNumber(item?.depois);
    const reason = String(item?.motivo || "").trim();
    const declaredSource = String(item?.fonte_nova || "").trim();
    const claimsLibraryDocument = /^(cvm_ipe|cvm_fnet|cvm_rad|ri):/.test(declaredSource);
    if (!key || seen.has(key) || after === null || !reason) continue;
    if (restrictToKnownDimensions && !dimensions.has(key)) continue;
    if (claimsLibraryDocument && !allowedEvidenceIds.has(declaredSource)) continue;

    seen.add(key);
    const safeBefore = dimensions.has(key)
      ? dimensions.get(key).nota
      : clamp(finiteNumber(item?.antes, 0), 0, 5);
    const safeAfter = clamp(after, 0, 5);
    normalized.push({
      dimensao: String(item.dimensao).trim(),
      antes: round2(safeBefore),
      depois: round2(safeAfter),
      motivo: reason,
      fonte_nova: claimsLibraryDocument ? declaredSource : sourcePhase,
      delta: round2(safeAfter - safeBefore),
    });
  }

  return normalized;
}

function parseLocalizedNumber(token) {
  let value = String(token || "").replace(/\s/g, "");
  const comma = value.lastIndexOf(",");
  const dot = value.lastIndexOf(".");
  if (comma > dot) value = value.replace(/\./g, "").replace(",", ".");
  else if (dot > comma) value = value.replace(/,/g, "");
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function extractPrices(value) {
  return (String(value || "").match(/\d[\d.,]*/g) || [])
    .map(parseLocalizedNumber)
    .filter((number) => number !== null);
}

function pricePrefix(...values) {
  const text = values.join(" ");
  if (/USD|US\$/i.test(text)) return "USD ";
  if (/R\$/i.test(text)) return "R$ ";
  return "";
}

function formatPrice(value, prefix) {
  const formatted = value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${prefix}${formatted}`;
}

export function reconcileBesst({ zone, besst }) {
  const zonePrices = extractPrices(zone);
  const besstPrices = extractPrices(besst);
  if (!zonePrices.length || !besstPrices.length) {
    return { value: besst, status: "unverifiable", corrected: false };
  }

  const zoneLow = Math.min(...zonePrices);
  const zoneHigh = Math.max(...zonePrices);
  const expectedLow = round2(zoneLow * 0.75);
  const expectedHigh = round2(zoneHigh * 0.85);
  const valid = besstPrices.every(
    (price) => price >= expectedLow && price <= expectedHigh && price < zoneLow
  );

  if (valid) {
    return {
      value: besst,
      status: "valid",
      corrected: false,
      expected_range: [expectedLow, expectedHigh],
    };
  }

  const prefix = pricePrefix(zone, besst);
  return {
    value: `${formatPrice(expectedLow, prefix)} a ${formatPrice(expectedHigh, prefix)}`,
    status: "corrected",
    corrected: true,
    previous_value: besst,
    expected_range: [expectedLow, expectedHigh],
    rule: "15-25% abaixo da zona de convergência",
  };
}

export function reconcileDeepIntegrity(result, history = {}, { documentIds = [] } = {}) {
  const source = result && typeof result === "object" ? result : {};
  const baseline = latestAnalyticalStage(history);
  const fallbackMax = scoreMaxOf(history.scan, 30);
  const scoreMax = scoreMaxOf(baseline.data, fallbackMax);
  const scoreOriginal = clamp(scoreOf(baseline.data, scoreOf(history.scan, 0)), 0, scoreMax);
  const sourcePhase = baseline.phase === "scan" ? "DEEP" : "APROFUNDAMENTO";
  const dimensions = dimensionMapOf(baseline.data, history.scan);
  const adjustments = normalizeAdjustments(source.ajustes_score, sourcePhase, dimensions, new Set(documentIds));
  for (const adjustment of adjustments) {
    const key = normalizedKey(adjustment.dimensao);
    if (dimensions.has(key)) dimensions.set(key, {
      ...dimensions.get(key),
      nota: adjustment.depois,
    });
  }
  const delta = round2(adjustments.reduce((total, item) => total + item.delta, 0));
  const scoreRevised = round2(clamp(scoreOriginal + delta, 0, scoreMax));
  const besst = reconcileBesst({ zone: source.zona, besst: source.besst });

  return {
    ...source,
    besst: besst.value,
    score_original: scoreOriginal,
    score_revisado: scoreRevised,
    score_total: scoreRevised,
    score_max: scoreMax,
    mudanca_score: delta > 0 ? `+${delta}` : String(delta),
    ajustes_score: adjustments,
    score_dimensoes_revisadas: [...dimensions.values()],
    integridade_analise: {
      version: RECLASSIFICATION_INTEGRITY_VERSION,
      baseline_phase: baseline.phase,
      score_source: "server_calculated",
      score_delta: delta,
      besst_status: besst.status,
      besst_corrected: besst.corrected,
      besst_previous_value: besst.previous_value || null,
    },
  };
}

export function buildDeterministicFinal({ ticker, history = {} }) {
  const baseline = latestAnalyticalStage(history);
  if (!baseline.data) return null;

  const stage = baseline.data;
  const scan = history.scan || {};
  const isScan = baseline.phase === "scan";
  const verdict = String(isScan ? stage.veredito : stage.veredito_final || "").toUpperCase();
  const scoreMax = scoreMaxOf(stage, scoreMaxOf(scan, 30));
  const score = clamp(scoreOf(stage, scoreOf(scan, 0)), 0, scoreMax);

  return {
    ticker: ticker || scan.ticker || stage.ticker || "",
    classificacao_final: verdict,
    veredito_anterior: verdict,
    veredito_reclassificado: verdict,
    score_original: score,
    score_revisado: score,
    score_max: scoreMax,
    mudanca_score: "0",
    mudanca_veredito: "MANTEVE",
    riscos_incorporados: [],
    ajustes_score: [],
    tese_final: scan.tese || "Análise consolidada sem alteração de premissas.",
    preco_final: {
      zona_convergencia: isScan ? "N/D — Deep não realizado" : stage.zona || "N/D",
      besst: isScan ? "N/D — Deep não realizado" : stage.besst || "N/D",
      margem_seguranca: isScan ? "N/D — Deep não realizado" : stage.desconto || "N/D",
      observacao: isScan
        ? "Finalização baseada somente no Scan; nenhum valuation adicional foi inferido."
        : "Faixas preservadas do último Deep concluído.",
    },
    conclusao: isScan
      ? "Análise encerrada no Scan. Sem Deep ou evidência posterior, score e veredito foram preservados."
      : `Análise finalizada com base no último ${baseline.phase}. Nenhum novo recálculo probabilístico foi realizado na finalização.`,
    hdl_conclusao: stage.hdl_conclusao || null,
    hdl_integrity: stage.hdl_integrity || null,
    tdn_conclusao: stage.tdn_conclusao || null,
    tdn_integrity: stage.tdn_integrity || null,
    nexoModules: stage.nexoModules ? { ...stage.nexoModules } : {},
    proximos_passos: Array.isArray(stage.passos)
      ? stage.passos
      : Array.isArray(scan.lacunas_deep)
      ? scan.lacunas_deep
      : [],
    integridade_reclassificacao: {
      version: RECLASSIFICATION_INTEGRITY_VERSION,
      mode: "deterministic_consolidation",
      baseline_phase: baseline.phase,
      new_evidence_after_baseline: false,
      score_preserved: true,
      verdict_preserved: true,
    },
  };
}
