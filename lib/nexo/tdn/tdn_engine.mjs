export const TDN_VERSION = "TDN_v1.0";

export const TDN_WINDOWS = Object.freeze([
  Object.freeze({ id: "J1", label: "Estresse inflacionário 2015–2016", baselineYear: 2014, stressYears: [2015, 2016] }),
  Object.freeze({ id: "J2", label: "Choque inflacionário 2021–2022", baselineYear: 2020, stressYears: [2021, 2022] }),
]);

const REQUIRED_METRICS = Object.freeze([
  "revenue",
  "gross_profit",
  "operating_income",
  "current_assets",
  "current_liabilities",
]);

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(typeof value === "string" ? value.replace(",", ".") : value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function isoDate(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function baseResult(overrides = {}) {
  return {
    version: TDN_VERSION,
    status: "dados_insuficientes",
    ticker: null,
    veredito: "dados_insuficientes",
    score_nominalidade: null,
    janelas_cobertas: 0,
    profile: null,
    profile_mode: null,
    profile_label: null,
    facts_as_of: null,
    facts_scope: null,
    windows: [],
    missing: [],
    source_fact_ids: [],
    source: "cvm_dfp",
    protection_mechanism: null,
    score_untouched: true,
    verdict_untouched: true,
    note: null,
    ...overrides,
  };
}

export function notApplicableTDN({ ticker = null, reason = "Classe de ativo fora do TDN v1.0." } = {}) {
  return baseResult({
    status: "not_applicable",
    ticker,
    veredito: "nao_aplicavel",
    note: reason,
  });
}

function normalizeFact(fact) {
  const year = Number(fact?.fiscal_year ?? fact?.exercicio);
  const value = finite(fact?.value ?? fact?.valor);
  const metric = String(fact?.metric ?? fact?.metrica ?? "").trim();
  const knownAt = isoDate(fact?.known_at ?? fact?.conhecido_em);
  const periodEnd = isoDate(fact?.period_end ?? fact?.periodo_fim) || (Number.isInteger(year) ? `${year}-12-31` : null);
  const version = Number(fact?.filing_version ?? fact?.versao_documento ?? 1);
  return {
    ticker: String(fact?.ticker || "").toUpperCase(),
    metric,
    fiscal_year: year,
    value,
    unit: String(fact?.unit ?? fact?.unidade ?? "BRL_thousands"),
    scope: String(fact?.scope ?? fact?.escopo ?? "consolidado"),
    filing_version: Number.isInteger(version) && version > 0 ? version : 1,
    known_at: knownAt,
    period_end: periodEnd,
    source_ref: String(fact?.source_ref ?? fact?.referencia_fonte ?? "").trim(),
    fact_id: String(fact?.fact_id ?? fact?.source_ref ?? fact?.referencia_fonte ?? "").trim(),
  };
}

export function selectPointInTimeFacts(facts = [], { ticker, asOf = null } = {}) {
  const normalizedTicker = String(ticker || "").toUpperCase();
  const cutoff = isoDate(asOf) || "9999-12-31";
  const candidates = (Array.isArray(facts) ? facts : [])
    .map(normalizeFact)
    .filter((fact) =>
      (!fact.ticker || fact.ticker === normalizedTicker) &&
      REQUIRED_METRICS.includes(fact.metric) &&
      Number.isInteger(fact.fiscal_year) &&
      fact.value !== null &&
      fact.known_at &&
      fact.known_at <= cutoff &&
      ["consolidado", "individual"].includes(fact.scope)
    );
  const coverage = (scope) => new Set(candidates.filter((fact) => fact.scope === scope).map((fact) => `${fact.fiscal_year}|${fact.metric}`)).size;
  const selectedScope = coverage("consolidado") >= coverage("individual") ? "consolidado" : "individual";
  const selected = new Map();
  for (const fact of candidates) {
    if (fact.scope !== selectedScope) continue;
    const key = `${fact.fiscal_year}|${fact.metric}`;
    const prior = selected.get(key);
    if (!prior || fact.known_at > prior.known_at || (fact.known_at === prior.known_at && fact.filing_version > prior.filing_version)) {
      selected.set(key, fact);
    }
  }
  return [...selected.values()].sort((a, b) => a.fiscal_year - b.fiscal_year || a.metric.localeCompare(b.metric));
}

function inflationFactor(inflation = [], years = []) {
  const index = new Map((Array.isArray(inflation) ? inflation : []).map((row) => [Number(row?.year ?? row?.ano), finite(row?.ipca_pct)]));
  let factor = 1;
  for (const year of years) {
    const rate = index.get(year);
    if (rate === null || rate === undefined) return null;
    factor *= 1 + rate / 100;
  }
  return factor;
}

function metricScore(value, { good, neutral, lowerIsBetter = false }) {
  if (!Number.isFinite(value)) return null;
  if (lowerIsBetter) {
    if (value <= good) return 1;
    if (value <= neutral) return 0.5;
    return 0;
  }
  if (value >= good) return 1;
  if (value >= neutral) return 0.5;
  return 0;
}

function yearSnapshot(facts, year) {
  const rows = facts.filter((fact) => fact.fiscal_year === year);
  const values = Object.fromEntries(rows.map((fact) => [fact.metric, fact.value]));
  const missing = REQUIRED_METRICS.filter((metric) => !Number.isFinite(values[metric]));
  if (missing.length || !Number.isFinite(values.revenue) || values.revenue === 0) return { complete: false, missing };
  return {
    complete: true,
    revenue: values.revenue,
    grossMarginPct: (values.gross_profit / values.revenue) * 100,
    operatingMarginPct: (values.operating_income / values.revenue) * 100,
    workingCapitalRatioPct: ((values.current_assets - values.current_liabilities) / values.revenue) * 100,
    factIds: rows.map((fact) => fact.fact_id || fact.source_ref).filter(Boolean),
  };
}

function computeWindow({ definition, facts, inflation, lagYears = 0 }) {
  const endYear = definition.stressYears.at(-1) + lagYears;
  const inflationYears = [];
  for (let year = definition.stressYears[0]; year <= endYear; year += 1) inflationYears.push(year);
  const factor = inflationFactor(inflation, inflationYears);
  const baseline = yearSnapshot(facts, definition.baselineYear);
  const end = yearSnapshot(facts, endYear);
  const common = {
    id: definition.id,
    label: definition.label,
    status: "incomplete",
    baseline_year: definition.baselineYear,
    end_year: endYear,
    observation_lag_years: lagYears,
    ipca_years: inflationYears,
    ipca_acumulado_pct: factor === null ? null : round((factor - 1) * 100),
    revenue_real_growth_pct: null,
    gross_margin_change_pp: null,
    operating_margin_change_pp: null,
    working_capital_ratio_change_pp: null,
    score: null,
    components: null,
    source_fact_ids: [],
    missing: [],
  };
  const missing = [];
  if (!baseline.complete) missing.push(...baseline.missing.map((metric) => `${definition.baselineYear}:${metric}`));
  if (!end.complete) missing.push(...end.missing.map((metric) => `${endYear}:${metric}`));
  if (factor === null) missing.push(...inflationYears.map((year) => `${year}:ipca`).filter((item) => {
    const year = Number(item.split(":")[0]);
    return !inflation.some((row) => Number(row?.year ?? row?.ano) === year && finite(row?.ipca_pct) !== null);
  }));
  if (missing.length) return { ...common, missing: [...new Set(missing)] };

  const revenueReal = ((end.revenue / baseline.revenue) / factor - 1) * 100;
  const grossDelta = end.grossMarginPct - baseline.grossMarginPct;
  const operatingDelta = end.operatingMarginPct - baseline.operatingMarginPct;
  const workingCapitalDelta = end.workingCapitalRatioPct - baseline.workingCapitalRatioPct;
  const components = {
    revenue_real: metricScore(revenueReal, { good: 0, neutral: -5 }),
    gross_margin: metricScore(grossDelta, { good: -1, neutral: -3 }),
    operating_margin: metricScore(operatingDelta, { good: -1, neutral: -3 }),
    working_capital: metricScore(workingCapitalDelta, { good: 1, neutral: 3, lowerIsBetter: true }),
  };
  const score = (Object.values(components).reduce((sum, value) => sum + value, 0) / 4) * 5;
  return {
    ...common,
    status: "ok",
    revenue_real_growth_pct: round(revenueReal),
    gross_margin_change_pp: round(grossDelta),
    operating_margin_change_pp: round(operatingDelta),
    working_capital_ratio_change_pp: round(workingCapitalDelta),
    score: round(score, 2),
    components,
    source_fact_ids: [...new Set([...baseline.factIds, ...end.factIds])],
  };
}

export function computeTDN({ ticker, assetType = "acao-br", classification = null, facts = [], inflation = [], asOf = null } = {}) {
  const normalizedTicker = String(ticker || "").trim().toUpperCase() || null;
  if (assetType !== "acao-br") {
    return notApplicableTDN({ ticker: normalizedTicker, reason: assetType === "fii" ? "FIIs permanecem fora do TDN v1.0." : "Ativos exteriores permanecem fora do TDN v1.0." });
  }
  if (!classification) {
    return baseResult({ ticker: normalizedTicker, note: "Ativo ainda não classificado na matriz setorial TDN.", missing: ["sector_classification"] });
  }
  if (classification.mode === "not_applicable") {
    return notApplicableTDN({ ticker: normalizedTicker, reason: classification.reason || "Perfil setorial fora do contrato TDN v1.0." });
  }

  const selectedFacts = selectPointInTimeFacts(facts, { ticker: normalizedTicker, asOf });
  const lagYears = Number(classification.observation_lag_years || 0);
  const windows = TDN_WINDOWS.map((definition) => computeWindow({ definition, facts: selectedFacts, inflation, lagYears }));
  const covered = windows.filter((window) => window.status === "ok");
  const factsAsOf = selectedFacts.reduce((latest, fact) => fact.known_at > latest ? fact.known_at : latest, "");
  const base = {
    ticker: normalizedTicker,
    profile: classification.profile || null,
    profile_mode: classification.mode,
    profile_label: classification.label || null,
    facts_as_of: factsAsOf || null,
    facts_scope: selectedFacts[0]?.scope || null,
    windows,
    janelas_cobertas: covered.length,
    missing: [...new Set(windows.flatMap((window) => window.missing))],
    source_fact_ids: [...new Set(windows.flatMap((window) => window.source_fact_ids))],
    protection_mechanism: classification.mode === "commodity_fx" ? "preco_internacional_cambio_e_operacao" : classification.mode === "regulated_lag" ? "reajuste_regulatorio_com_defasagem" : "repasse_operacional",
  };
  if (covered.length !== TDN_WINDOWS.length) {
    return baseResult({ ...base, note: "As duas janelas fixas são obrigatórias; cobertura parcial não produz score." });
  }

  const score = round(covered.reduce((sum, window) => sum + window.score, 0) / covered.length, 2);
  let verdict = score >= 3.75 ? "real" : score <= 2 ? "nominal" : "misto";
  let note = null;
  if (classification.mode === "commodity_fx" && classification.driver_attribution_available !== true) {
    verdict = "misto";
    note = "A DFP comprova o comportamento contábil, mas não separa sozinha repasse operacional, preço internacional e câmbio; a classificação foi limitada a misto.";
  }
  return baseResult({
    ...base,
    status: "ok",
    veredito: verdict,
    score_nominalidade: score,
    note,
  });
}

export function buildTdnPromptContext(tdn) {
  if (!tdn || tdn.status === "not_applicable") {
    return `TDN não aplicável: ${tdn?.note || "classe fora do TDN v1.0"}. Não substitua métricas setoriais nem invente score.`;
  }
  if (tdn.status !== "ok") {
    return `TDN com dados insuficientes: ${(tdn?.missing || []).join(", ") || tdn?.note || "histórico incompleto"}. Não presuma proteção inflacionária pela fama do setor.`;
  }
  return [
    "TDN calculado deterministicamente pelo servidor nas janelas fixas J1 2015–2016 e J2 2021–2022:",
    JSON.stringify({
      score_nominalidade: tdn.score_nominalidade,
      veredito: tdn.veredito,
      profile_mode: tdn.profile_mode,
      protection_mechanism: tdn.protection_mechanism,
      windows: tdn.windows.map((window) => ({
        id: window.id,
        baseline_year: window.baseline_year,
        end_year: window.end_year,
        ipca_acumulado_pct: window.ipca_acumulado_pct,
        revenue_real_growth_pct: window.revenue_real_growth_pct,
        gross_margin_change_pp: window.gross_margin_change_pp,
        operating_margin_change_pp: window.operating_margin_change_pp,
        working_capital_ratio_change_pp: window.working_capital_ratio_change_pp,
        score: window.score,
      })),
      note: tdn.note,
    }),
    "Interprete o resultado em tdn_conclusao sem recalcular números. O TDN qualifica proteção inflacionária; não altera score ou veredito global automaticamente.",
  ].join("\n");
}

export function applyTdnToAnalysis({ phase, result, tdn }) {
  const source = result && typeof result === "object" ? result : {};
  const module = tdn || source?.nexoModules?.TDN || null;
  if (!module) return source;
  const conclusion = String(source.tdn_conclusao || "").trim();
  const required = phase === "deep" && module.status === "ok";
  return {
    ...source,
    tdn_conclusao: conclusion || null,
    tdn_integrity: {
      version: TDN_VERSION,
      complete: !required || conclusion.length >= 24,
      conclusion_required: required,
      conclusion_present: conclusion.length >= 24,
      score_untouched: true,
      verdict_untouched: true,
    },
    nexoModules: { ...(source.nexoModules || {}), TDN: module },
  };
}

export function selfTest() {
  const inflation = [
    { year: 2015, ipca_pct: 10 }, { year: 2016, ipca_pct: 5 }, { year: 2017, ipca_pct: 3 },
    { year: 2021, ipca_pct: 10 }, { year: 2022, ipca_pct: 5 }, { year: 2023, ipca_pct: 4 },
  ];
  const years = [2014, 2016, 2017, 2020, 2022, 2023];
  const facts = years.flatMap((year) => {
    const scale = year <= 2014 ? 100 : year <= 2017 ? 125 : year === 2020 ? 150 : 190;
    return [
      ["revenue", scale], ["gross_profit", scale * 0.4], ["operating_income", scale * 0.2],
      ["current_assets", scale * 0.5], ["current_liabilities", scale * 0.25],
    ].map(([metric, value]) => ({ ticker: "TEST3", fiscal_year: year, metric, value, known_at: `${year + 1}-03-01`, source_ref: `fixture:${year}:${metric}` }));
  });
  facts.push({ ticker: "TEST3", fiscal_year: 2016, metric: "revenue", value: 1, known_at: "2017-01-01", filing_version: 1, source_ref: "old" });
  const selected = selectPointInTimeFacts(facts, { ticker: "TEST3" });
  if (selected.find((fact) => fact.fiscal_year === 2016 && fact.metric === "revenue")?.value !== 125) throw new Error("tdn_point_in_time_failed");
  const result = computeTDN({ ticker: "TEST3", classification: { profile: "operacional", mode: "standard", label: "Teste" }, facts, inflation });
  if (result.status !== "ok" || result.janelas_cobertas !== 2 || result.veredito !== "real") throw new Error("tdn_complete_windows_failed");
  const partial = computeTDN({ ticker: "TEST3", classification: { profile: "operacional", mode: "standard" }, facts: facts.filter((fact) => fact.fiscal_year < 2020), inflation });
  if (partial.status !== "dados_insuficientes" || partial.score_nominalidade !== null) throw new Error("tdn_partial_window_failed");
  const bank = computeTDN({ ticker: "BANK3", classification: { mode: "not_applicable", reason: "financeiro" }, facts, inflation });
  if (bank.status !== "not_applicable" || bank.veredito !== "nao_aplicavel") throw new Error("tdn_financial_adapter_failed");
  const external = computeTDN({ ticker: "MSFT", assetType: "stock-ext", facts, inflation });
  if (external.status !== "not_applicable") throw new Error("tdn_external_failed");
  return { passed: 4, failed: 0 };
}

if (process.env.NEXO_SELFTEST === "1") {
  const result = selfTest();
  console.log(`TDN ${TDN_VERSION}: ${result.passed} passou, ${result.failed} falhou`);
}
