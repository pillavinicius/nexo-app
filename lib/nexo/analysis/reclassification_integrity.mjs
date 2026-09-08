import {
  reconcileValuationLayers,
  VALUATION_INTEGRITY_VERSION,
} from "./valuation_integrity.mjs";

export const RECLASSIFICATION_INTEGRITY_VERSION = "P3B_v1.4";

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

function formatPercent(value) {
  return Number(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function normalizedSafetyDiscount(value) {
  if (Math.abs(value - 15) <= 0.06) return 15;
  if (Math.abs(value - 25) <= 0.06) return 25;
  return value;
}

function cleanSentence(value) {
  return String(value || "").trim().replace(/[.\s]+$/g, "");
}

export function extractReferencePrice(context) {
  const text = String(context || "");
  const manual = text.match(/Valor atual\/cota atual:\s*([^\n]+)/i)?.[1] || "";
  if (manual && !/n[aã]o informad/i.test(manual)) {
    const value = extractPrices(manual)[0];
    if (Number.isFinite(value) && value > 0) return value;
  }
  const automatic = text.match(/"(?:currentPrice|price)"\s*:\s*"?(-?\d[\d.,]*)/i)?.[1];
  const value = automatic ? parseLocalizedNumber(automatic) : null;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function reconcilePriceNarrative({ zone, besst, referencePrice, previousNarrative = "" }) {
  const zonePrices = extractPrices(zone);
  const besstPrices = extractPrices(besst).sort((left, right) => left - right);
  const current = finiteNumber(referencePrice);
  if (!zonePrices.length || !besstPrices.length || current === null || current <= 0) {
    return { value: previousNarrative, status: "unverifiable", calculated: false };
  }

  const floor = Math.min(...zonePrices);
  const ceiling = Math.max(...zonePrices);
  if (floor <= 0 || ceiling <= 0) return { value: previousNarrative, status: "unverifiable", calculated: false };
  const prefix = pricePrefix(zone, besst);
  let currentPosition;
  let currentSentence;
  if (current < floor) {
    currentPosition = "below_zone";
    currentSentence = `Preço atual ${formatPrice(current, prefix)} está ${formatPercent(((floor - current) / floor) * 100)}% abaixo do piso da zona de convergência (${formatPrice(floor, prefix)}) e ${formatPercent(((ceiling - current) / ceiling) * 100)}% abaixo do teto (${formatPrice(ceiling, prefix)}).`;
  } else if (current > ceiling) {
    currentPosition = "above_zone";
    currentSentence = `Preço atual ${formatPrice(current, prefix)} está ${formatPercent(((current - ceiling) / ceiling) * 100)}% acima do teto da zona de convergência (${formatPrice(ceiling, prefix)}).`;
  } else {
    currentPosition = "inside_zone";
    currentSentence = `Preço atual ${formatPrice(current, prefix)} está dentro da zona de convergência de ${formatPrice(floor, prefix)} a ${formatPrice(ceiling, prefix)}.`;
  }

  const discounts = besstPrices.map((price) => normalizedSafetyDiscount(((floor - price) / floor) * 100));
  const besstSentence = besstPrices.length === 1
    ? `BESST de ${formatPrice(besstPrices[0], prefix)} está ${formatPercent(discounts[0])}% abaixo do piso da zona.`
    : `Faixa BESST de ${formatPrice(besstPrices[0], prefix)} a ${formatPrice(besstPrices.at(-1), prefix)} fica entre ${formatPercent(Math.min(...discounts))}% e ${formatPercent(Math.max(...discounts))}% abaixo do piso da zona.`;

  const besstLow = besstPrices[0];
  const besstHigh = besstPrices.at(-1);
  const relativeSentence = current >= besstLow && current <= besstHigh
    ? "O preço atual está dentro da faixa BESST."
    : current > besstHigh && current < floor
    ? "O preço atual está acima do BESST e abaixo da zona de convergência."
    : current < besstLow
    ? "O preço atual está abaixo da faixa BESST."
    : currentPosition === "inside_zone"
    ? "O preço atual está acima da faixa BESST."
    : "O preço atual está acima da zona de convergência e da faixa BESST.";

  return {
    value: `${currentSentence} ${besstSentence} ${relativeSentence}`,
    status: "server_calculated",
    calculated: true,
    reference_price: current,
    zone_floor: floor,
    zone_ceiling: ceiling,
    current_position: currentPosition,
    besst_discount_from_floor_pct: discounts.map(round2),
  };
}

export function reconcileBesst({ zone, besst }) {
  const zonePrices = extractPrices(zone);
  const besstPrices = extractPrices(besst);
  if (zonePrices.length < 2) {
    return { value: besst, status: "unverifiable", corrected: false };
  }

  const zoneLow = Math.min(...zonePrices);
  const expectedLow = round2(zoneLow * 0.75);
  const expectedHigh = round2(zoneLow * 0.85);
  const ascending = besstPrices.length === 2 && besstPrices[0] <= besstPrices[1];
  const valid = ascending &&
    Math.abs(besstPrices[0] - expectedLow) <= 0.05 &&
    Math.abs(besstPrices[1] - expectedHigh) <= 0.05;

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

function normalizedLayerCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").match(/^C[123]$/)?.[0] || "";
}

function valuesMatch(left, right) {
  return Math.abs(left - right) <= Math.max(0.05, Math.abs(right) * 0.02);
}

export function reconcileConvergenceZone({ zone, zoneCalculation, valuation }) {
  const layerValues = Array.isArray(valuation?.layer_values) ? valuation.layer_values : [];
  const usable = new Map(layerValues
    .filter((layer) => layer.status !== "invalid_formula" && Number.isFinite(layer.value) && layer.value > 0)
    .map((layer) => [layer.code, layer.value]));
  const requested = [...new Set((Array.isArray(zoneCalculation?.camadas_incluidas)
    ? zoneCalculation.camadas_incluidas
    : []).map(normalizedLayerCode).filter(Boolean))];
  const justification = String(zoneCalculation?.justificativa_exclusoes || "").trim();
  const parsed = extractPrices(zone);
  let included = requested.filter((code) => usable.has(code));
  if (included.length < 2) included = [...usable.keys()];

  if (included.length < 2) {
    return { value: zone, status: "invalid_contract", suppressed: true, included_layers: included };
  }

  const excludedUsable = [...usable.keys()].filter((code) => !included.includes(code));
  if (excludedUsable.length && !justification) {
    included = [...usable.keys()];
  } else if (excludedUsable.length && included.length >= 2) {
    const requestedValues = included.map((code) => usable.get(code));
    const requestedLow = Math.min(...requestedValues);
    const requestedHigh = Math.max(...requestedValues);
    for (const code of excludedUsable) {
      const value = usable.get(code);
      if (value >= requestedLow && value <= requestedHigh) included.push(code);
    }
  }

  const expected = included.map((code) => usable.get(code));
  const expectedLow = Math.min(...expected);
  const expectedHigh = Math.max(...expected);
  const prefix = pricePrefix(zone);
  const normalizedValue = `${formatPrice(expectedLow, prefix)} a ${formatPrice(expectedHigh, prefix)}`;
  const matchesExpected = parsed.length === 2 &&
    valuesMatch(Math.min(...parsed), expectedLow) &&
    valuesMatch(Math.max(...parsed), expectedHigh);
  const corrected = !matchesExpected || parsed[0] > parsed[1] || String(zone || "").trim() !== normalizedValue;
  const provisionalLayers = included.filter((code) => {
    const layer = layerValues.find((item) => item.code === code);
    return layer && !["verified", "corrected", "calculated"].includes(layer.status);
  });
  const invalidLayers = layerValues.filter((layer) => layer.status === "invalid_formula").map((layer) => layer.code);
  const finalExcluded = [...new Set([...usable.keys()].filter((code) => !included.includes(code)).concat(invalidLayers))];
  return {
    value: normalizedValue,
    status: provisionalLayers.length ? "provisional_from_declared_layers" : corrected ? "normalized" : "verified",
    corrected,
    suppressed: false,
    included_layers: included,
    excluded_layers: finalExcluded,
    exclusion_reason: finalExcluded.length
      ? justification || "Camada excluída porque sua memória de cálculo não pôde ser validada; as demais referências foram preservadas."
      : null,
    provisional_layers: provisionalLayers,
    expected_range: [round2(expectedLow), round2(expectedHigh)],
  };
}

function multipleMetric(methodology) {
  const key = normalizedKey(methodology);
  if (/\bp\s*(?:vp|vpa|b)\b/.test(key)) return "P/VP";
  if (/\bp\s*(?:l|e)\b/.test(key)) return "P/L";
  return null;
}

function reconcileMarketMultiples(valuation, referencePrice) {
  const current = finiteNumber(referencePrice);
  if (!current || current <= 0) return [];
  const seen = new Set();
  return (Array.isArray(valuation?.layer_values) ? valuation.layer_values : []).flatMap((layer) => {
    const metric = multipleMetric(layer.methodology);
    const base = finiteNumber(layer.unit_base);
    if (!metric || seen.has(metric) || !base || base <= 0) return [];
    seen.add(metric);
    return [{ metric, value: round2(current / base), reference_price: round2(current), unit_base: round2(base), source_layer: layer.code }];
  });
}

function reconcileThesisMultiples(value, reconciled = []) {
  let text = String(value || "");
  for (const item of reconciled) {
    const number = item.value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const pattern = item.metric === "P/VP"
      ? /(P\s*\/\s*(?:VP|VPA|B))\s*(?:de\s*)?-?\s*\d+(?:[.,]\d+)?\s*x?/gi
      : /(P\s*\/\s*(?:L|E))\s*(?:de\s*)?-?\s*\d+(?:[.,]\d+)?\s*x?/gi;
    text = text.replace(pattern, (_, label) => `${label} ${number}x`);
  }
  return text;
}

export function reconcileDeepIntegrity(result, history = {}, { documentIds = [], referencePrice = null } = {}) {
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
  const valuation = reconcileValuationLayers(source.preco);
  const convergence = valuation.zone_must_be_suppressed
    ? { value: source.zona, status: "layer_integrity_failed", suppressed: true }
    : reconcileConvergenceZone({ zone: source.zona, zoneCalculation: source.zona_calc, valuation });
  const zoneSuppressed = valuation.zone_must_be_suppressed || convergence.suppressed;
  const valuationWarning = "Faixa de preço não consolidada: menos de duas camadas apresentaram valores utilizáveis. Revise a memória de cálculo antes de interpretar margem de segurança.";
  const governedZone = zoneSuppressed
    ? "Faixa não consolidada — memória de cálculo insuficiente"
    : convergence.value;
  const governedBesst = zoneSuppressed
    ? "Não calculado — depende da consolidação da faixa"
    : source.besst;
  const besst = reconcileBesst({ zone: governedZone, besst: governedBesst });
  const priceNarrative = reconcilePriceNarrative({
    zone: governedZone,
    besst: besst.value,
    referencePrice,
    previousNarrative: zoneSuppressed ? valuationWarning : source.desconto,
  });
  const reconciledMultiples = reconcileMarketMultiples(valuation, referencePrice);

  return {
    ...source,
    preco: valuation.layers,
    zona: governedZone,
    zona_calc: {
      ...(source.zona_calc || {}),
      camadas_incluidas: convergence.included_layers || [],
      justificativa_exclusoes: convergence.exclusion_reason || "",
    },
    besst: besst.value,
    desconto: priceNarrative.value,
    score_original: scoreOriginal,
    score_revisado: scoreRevised,
    score_total: scoreRevised,
    score_max: scoreMax,
    mudanca_score: delta > 0 ? `+${delta}` : String(delta),
    ajustes_score: adjustments,
    score_dimensoes_revisadas: [...dimensions.values()],
    integridade_analise: {
      ...(source.integridade_analise || {}),
      version: RECLASSIFICATION_INTEGRITY_VERSION,
      baseline_phase: baseline.phase,
      score_source: "server_calculated",
      score_delta: delta,
      besst_status: besst.status,
      besst_corrected: besst.corrected,
      besst_previous_value: besst.previous_value || null,
      valuation_version: VALUATION_INTEGRITY_VERSION,
      valuation_status: valuation.status,
      valuation_corrected_layers: valuation.corrected_layers,
      valuation_verified_layers: valuation.verified_layers,
      valuation_invalid_layers: valuation.invalid_layers,
      valuation_zone_suppressed: zoneSuppressed,
      convergence_status: convergence.status,
      convergence_included_layers: convergence.included_layers || [],
      convergence_excluded_layers: convergence.excluded_layers || [],
      convergence_exclusion_reason: convergence.exclusion_reason || null,
      convergence_provisional_layers: convergence.provisional_layers || [],
      convergence_expected_range: convergence.expected_range || null,
      metricas_mercado_reconciliadas: reconciledMultiples,
      price_narrative_status: priceNarrative.status,
      reference_price: priceNarrative.reference_price || null,
      current_price_position: priceNarrative.current_position || null,
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
    tese_final: reconcileThesisMultiples(
      stage.tese_final || stage.tese || scan.tese || "Análise consolidada sem alteração de premissas.",
      stage.integridade_analise?.metricas_mercado_reconciliadas
    ),
    preco_final: {
      zona_convergencia: isScan ? "N/D — Deep não realizado" : stage.zona || "N/D",
      besst: isScan ? "N/D — Deep não realizado" : stage.besst || "N/D",
      margem_seguranca: isScan ? "N/D — Deep não realizado" : stage.desconto || "N/D",
      observacao: isScan
        ? "Finalização baseada somente no Scan; nenhum valuation adicional foi inferido."
        : stage.integridade_analise?.convergence_excluded_layers?.length
        ? `Faixas preservadas do último Deep. Convergência calculada com ${stage.integridade_analise.convergence_included_layers.join(", ")}; ${stage.integridade_analise.convergence_excluded_layers.join(", ")} foi excluída por justificativa metodológica: ${cleanSentence(stage.integridade_analise.convergence_exclusion_reason || "justificativa registrada no Deep")}.`
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
