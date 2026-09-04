/**
 * NEXO OkaneBox Split Engine Validation v1
 *
 * Objetivo:
 * - Validar o motor final de detecção + ajuste de splits antes da V2.6.0.
 * - Usa eventos verificados em tabela controlada, não o /splits do HG.
 * - Detecta degrau cru na série OkaneBox, aplica ajuste retroativo, valida que o degrau sumiu,
 *   e só então libera métricas longas e historyDepth alto para o IQD.
 *
 * Uso:
 *   export OKANE_EMAIL="pilla.vinicius@gmail.com"
 *   node nexo_okanebox_split_engine_validation_v1.mjs
 *
 * Self-test offline:
 *   node nexo_okanebox_split_engine_validation_v1.mjs --selftest
 */

const OKANE_BASE = "https://www.okanebox.com.br/api";
const DEFAULT_START = "2015-01-01";
const DEFAULT_END = new Date().toISOString().slice(0, 10);

const CONTINUOUS_BAND = Math.log(1.10);
const RAW_STEP_BAND = Math.log(1.25);

const VERIFIED_SPLITS = [
  {
    ticker: "SAPR11",
    boundaryDate: "2020-03-30",
    type: "split",
    eventRatio: 3,
    rawExpectedObserved: 0.3333,
    source: "Sanepar desdobramento 3:1, ex-desdobramento em 30/03/2020.",
  },
  {
    ticker: "MGLU3",
    boundaryDate: "2024-05-27",
    type: "reverse_split",
    eventRatio: 0.1,
    rawExpectedObserved: 10,
    source: "Magalu grupamento 10:1, negociação grupada a partir de 27/05/2024.",
  },
];

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, decimals = 4) {
  const n = toNumber(value);
  if (n === null) return null;
  const p = 10 ** decimals;
  return Math.round(n * p) / p;
}

function ymdCompact(s) {
  return String(s || "").replaceAll("-", "").slice(0, 8);
}

function normalizeDate(d) {
  return d ? String(d).slice(0, 10) : null;
}

function sortAsc(candles = []) {
  return [...candles].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function average(values = []) {
  const valid = values.map(toNumber).filter((v) => v !== null);
  if (!valid.length) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

async function fetchJsonStrict(url, headers = {}) {
  const r = await fetch(url, { cache: "no-store", headers });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); }
  catch { return { ok: false, status: r.status, reason: "invalid_json", preview: text.slice(0, 300) }; }
  if (!r.ok) return { ok: false, status: r.status, reason: "http_error", data };
  return { ok: true, status: r.status, data };
}

async function fetchOkaneDaily(ticker, email) {
  if (!email) throw new Error('OKANE_EMAIL ausente. Rode: export OKANE_EMAIL="pilla.vinicius@gmail.com"');
  const url = `${OKANE_BASE}/acoes/hist/${encodeURIComponent(ticker)}/${ymdCompact(DEFAULT_START)}/${ymdCompact(DEFAULT_END)}/`;
  const res = await fetchJsonStrict(url, { Authorization: `Bearer ${email}`, Accept: "application/json" });
  if (!res.ok) return { ok: false, reason: res.reason, candles: [], error: res };
  const d = res.data;
  const arr = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : Array.isArray(d?.results) ? d.results : Array.isArray(d?.historico) ? d.historico : [];
  const candles = sortAsc(arr.map((q) => ({
    date: normalizeDate(q.DATPRG),
    open: toNumber(q.PREABE),
    high: toNumber(q.PREMAX),
    low: toNumber(q.PREMIN),
    close: toNumber(q.PREULT),
    volume: toNumber(q.VOLTOT ?? q.QUATOT),
  })).filter((c) => c.date && c.close !== null));
  return { ok: true, source: "OkaneBox", candles };
}

function lastBefore(candles, date) {
  return [...candles].reverse().find((c) => String(c.date) < String(date) && c.close !== null) || null;
}

function firstOnAfter(candles, date) {
  return candles.find((c) => String(c.date) >= String(date) && c.close !== null) || null;
}

function localWindow(candles, date, radius = 4) {
  const idx = candles.findIndex((c) => String(c.date) >= String(date));
  if (idx < 0) return [];
  return candles.slice(Math.max(0, idx - radius), Math.min(candles.length, idx + radius + 1)).map((c) => ({ date: c.date, close: round(c.close, 6) }));
}

function classifyContinuity(observedRatio, eventRatio) {
  if (!observedRatio || !eventRatio) return { verdict: "insufficient_data", meaning: "missing_ratio" };
  const toContinuous = Math.abs(Math.log(observedRatio));
  const toRawStep = Math.abs(Math.log(observedRatio * eventRatio));
  const dist = { toContinuous1x: round(toContinuous, 6), toRawStep: round(toRawStep, 6) };
  if (toContinuous < CONTINUOUS_BAND) return { verdict: "continuous_series", meaning: "already_adjusted_or_no_step_at_this_event", dist };
  if (toRawStep < RAW_STEP_BAND) return { verdict: "raw_step_present", meaning: "raw_needs_adjustment_at_this_event", dist };
  return { verdict: "inconsistent", meaning: "neither_continuous_nor_expected_raw_step", dist };
}

function analyzeOneEvent(candles, event) {
  const before = lastBefore(candles, event.boundaryDate);
  const after = firstOnAfter(candles, event.boundaryDate);
  if (!before || !after) {
    return { ...event, usable: false, reason: "event_outside_history_coverage", coverage: { first: candles[0]?.date || null, last: candles[candles.length - 1]?.date || null } };
  }
  const observed = after.close / before.close;
  return {
    ticker: event.ticker,
    boundaryDate: event.boundaryDate,
    type: event.type,
    eventRatio: event.eventRatio,
    rawExpectedObserved: event.rawExpectedObserved,
    before: { date: before.date, close: round(before.close, 6) },
    after: { date: after.date, close: round(after.close, 6) },
    observedRatio: round(observed, 6),
    classification: classifyContinuity(observed, event.eventRatio),
    localWindowAroundBoundary: localWindow(candles, event.boundaryDate),
    source: event.source,
  };
}

function buildVerifiedAdjustmentPlan(rawEventAnalyses = []) {
  const usable = rawEventAnalyses.filter((e) => e.classification);
  const rawSteps = usable.filter((e) => e.classification.verdict === "raw_step_present");
  const continuous = usable.filter((e) => e.classification.verdict === "continuous_series");
  const inconsistent = usable.filter((e) => e.classification.verdict === "inconsistent");
  const insufficient = rawEventAnalyses.filter((e) => !e.classification);

  if (inconsistent.length) return { ok: false, splitAdjusted: false, splitEngineStatus: "verified_event_inconsistent", reason: "At least one verified event does not match raw step or continuity.", eventsToApply: [], diagnostics: { usable: usable.length, rawSteps: rawSteps.length, continuous: continuous.length, inconsistent: inconsistent.length, insufficient: insufficient.length } };
  if (!usable.length) return { ok: false, splitAdjusted: false, splitEngineStatus: "insufficient_verified_events", reason: "No usable verified events inside history coverage.", eventsToApply: [], diagnostics: { usable: 0, rawSteps: 0, continuous: 0, inconsistent: 0, insufficient: insufficient.length } };
  if (!rawSteps.length && continuous.length) return { ok: true, splitAdjusted: true, splitEngineStatus: "already_adjusted_or_no_price_step", reason: "Verified events are already continuous; no adjustment applied.", eventsToApply: [], diagnostics: { usable: usable.length, rawSteps: 0, continuous: continuous.length, inconsistent: 0, insufficient: insufficient.length } };
  return {
    ok: true,
    splitAdjusted: true,
    splitEngineStatus: "verified_raw_steps_adjusted",
    reason: "Verified raw steps detected and selected for retroactive adjustment.",
    eventsToApply: rawSteps.map((e) => ({ ticker: e.ticker, boundaryDate: e.boundaryDate, type: e.type, eventRatio: e.eventRatio, observedRatio: e.observedRatio, source: e.source })).sort((a, b) => String(b.boundaryDate).localeCompare(String(a.boundaryDate))),
    diagnostics: { usable: usable.length, rawSteps: rawSteps.length, continuous: continuous.length, inconsistent: 0, insufficient: insufficient.length },
  };
}

function applyVerifiedSplitAdjustments(candles = [], eventsToApply = []) {
  const sorted = sortAsc(candles);
  return sorted.map((c) => {
    let cumulativeRatio = 1;
    for (const ev of eventsToApply) if (String(c.date) < String(ev.boundaryDate)) cumulativeRatio *= Number(ev.eventRatio);
    return {
      ...c,
      open: c.open === null ? null : c.open / cumulativeRatio,
      high: c.high === null ? null : c.high / cumulativeRatio,
      low: c.low === null ? null : c.low / cumulativeRatio,
      close: c.close === null ? null : c.close / cumulativeRatio,
      volume: c.volume === null ? null : c.volume * cumulativeRatio,
      adjustmentFactor: cumulativeRatio,
    };
  });
}

function maxDrawdown(candles = []) {
  const arr = sortAsc(candles).filter((c) => c.close !== null);
  if (arr.length < 2) return null;
  let peak = arr[0].close, peakDate = arr[0].date, troughDate = arr[0].date, maxDd = 0;
  for (const c of arr) {
    if (c.close > peak) { peak = c.close; peakDate = c.date; }
    const dd = c.close / peak - 1;
    if (dd < maxDd) { maxDd = dd; troughDate = c.date; }
  }
  return { percent: maxDd * 100, peakDate, troughDate };
}

function smoothedCagr(candles = [], window = 5) {
  const arr = sortAsc(candles).filter((c) => c.close !== null && c.close > 0);
  if (arr.length < 2) return null;
  const startAnchor = average(arr.slice(0, Math.min(window, arr.length)).map((c) => c.close));
  const endAnchor = average(arr.slice(Math.max(0, arr.length - window)).map((c) => c.close));
  const days = (new Date(arr[arr.length - 1].date) - new Date(arr[0].date)) / (1000 * 60 * 60 * 24);
  const years = days / 365.25;
  if (!startAnchor || !endAnchor || years <= 0) return null;
  return ((endAnchor / startAnchor) ** (1 / years) - 1) * 100;
}

function ulcerIndex(candles = []) {
  const arr = sortAsc(candles).filter((c) => c.close !== null);
  if (arr.length < 2) return null;
  let peak = arr[0].close;
  const squared = [];
  for (const c of arr) {
    if (c.close > peak) peak = c.close;
    const dd = ((c.close / peak) - 1) * 100;
    squared.push(dd * dd);
  }
  return Math.sqrt(squared.reduce((s, v) => s + v, 0) / squared.length);
}

function trustedHistoryDepthScore({ candlesCount, splitAdjusted }) {
  const c = toNumber(candlesCount);
  if (c === null || c <= 0) return 0;
  if (!splitAdjusted) {
    if (c >= 252) return 50;
    if (c >= 126) return 35;
    if (c >= 60) return 20;
    return 10;
  }
  if (c >= 2000) return 100;
  if (c >= 1260) return 95;
  if (c >= 756) return 85;
  if (c >= 504) return 70;
  if (c >= 252) return 50;
  if (c >= 126) return 35;
  if (c >= 60) return 20;
  return 10;
}

function computeTrajectoryMetrics(candles = [], splitAdjusted = false) {
  if (!splitAdjusted) return { ok: false, splitAdjusted: false, trajectoryReason: "history_not_split_adjusted", maxDrawdownPercent: null, maxDrawdownPeakDate: null, maxDrawdownTroughDate: null, cagrPercent: null, ulcerIndex: null };
  const dd = maxDrawdown(candles);
  return { ok: true, splitAdjusted: true, trajectoryReason: "verified_split_engine_validated", maxDrawdownPercent: dd ? round(dd.percent, 2) : null, maxDrawdownPeakDate: dd?.peakDate || null, maxDrawdownTroughDate: dd?.troughDate || null, cagrPercent: round(smoothedCagr(candles), 2), ulcerIndex: round(ulcerIndex(candles), 2) };
}

function isCagrPlausible(cagrPercent) {
  const c = toNumber(cagrPercent);
  return c !== null && c > -80 && c < 80;
}

function validatePostAdjustment(postEventAnalyses = []) {
  const usable = postEventAnalyses.filter((e) => e.classification);
  const allContinuous = usable.length > 0 && usable.every((e) => e.classification.verdict === "continuous_series");
  return { ok: allContinuous, usableEvents: usable.length, allEventsContinuousAfterAdjustment: allContinuous, postAdjustmentVerdicts: usable.map((e) => ({ ticker: e.ticker, boundaryDate: e.boundaryDate, observedRatio: e.observedRatio, verdict: e.classification.verdict, dist: e.classification.dist })) };
}

async function analyzeTicker(ticker, verifiedEvents) {
  const okane = await fetchOkaneDaily(ticker, process.env.OKANE_EMAIL);
  if (!okane.ok) return { ticker, ok: false, reason: "okane_fetch_failed", okaneReason: okane.reason };
  const raw = okane.candles;
  const rawEventAnalyses = verifiedEvents.map((ev) => analyzeOneEvent(raw, ev));
  const plan = buildVerifiedAdjustmentPlan(rawEventAnalyses);
  const adjusted = plan.splitAdjusted ? applyVerifiedSplitAdjustments(raw, plan.eventsToApply) : raw;
  const postEventAnalyses = verifiedEvents.map((ev) => analyzeOneEvent(adjusted, ev));
  const postValidation = validatePostAdjustment(postEventAnalyses);
  const rawTrajectoryMetrics = computeTrajectoryMetrics(raw, false);
  const adjustedTrajectoryMetrics = computeTrajectoryMetrics(adjusted, plan.splitAdjusted && postValidation.ok);
  const iqdHistoryInput = {
    source: "OkaneBox",
    rawCandlesCount: raw.length,
    trustedCandlesCount: plan.splitAdjusted && postValidation.ok ? adjusted.length : 0,
    splitAdjusted: plan.splitAdjusted && postValidation.ok,
    splitEngineStatus: plan.splitEngineStatus,
    historyDepthScore: trustedHistoryDepthScore({ candlesCount: raw.length, splitAdjusted: plan.splitAdjusted && postValidation.ok }),
    trajectoryReason: plan.splitAdjusted && postValidation.ok ? "verified_split_adjusted_history" : "history_not_split_adjusted",
  };
  const acceptanceChecklist = {
    A_raw_metrics_are_null: rawTrajectoryMetrics.maxDrawdownPercent === null && rawTrajectoryMetrics.trajectoryReason === "history_not_split_adjusted",
    B_raw_detected_expected_steps_or_continuity: rawEventAnalyses.filter((e) => e.classification).every((e) => ["raw_step_present", "continuous_series"].includes(e.classification.verdict)),
    C_adjustment_plan_is_safe: plan.ok === true && plan.splitAdjusted === true,
    D_post_adjustment_events_are_continuous: postValidation.ok === true,
    E_adjusted_metrics_released: adjustedTrajectoryMetrics.ok === true && adjustedTrajectoryMetrics.maxDrawdownPercent !== null,
    F_cagr_plausible: isCagrPlausible(adjustedTrajectoryMetrics.cagrPercent),
    G_iqd_history_depth_uses_adjusted_history: iqdHistoryInput.splitAdjusted === true && iqdHistoryInput.historyDepthScore >= 85,
  };
  acceptanceChecklist.approved = Object.values(acceptanceChecklist).every(Boolean);
  return { ticker, ok: true, coverage: { firstDate: raw[0]?.date || null, lastDate: raw[raw.length - 1]?.date || null, candlesCount: raw.length }, rawEventAnalyses, splitAdjustmentPlan: plan, postAdjustmentEventAnalyses: postEventAnalyses, postAdjustmentValidation: postValidation, rawTrajectoryMetrics, adjustedTrajectoryMetrics, iqdHistoryInput, acceptanceChecklist };
}

function groupEventsByTicker(events = []) {
  const out = {};
  for (const ev of events) (out[ev.ticker] ||= []).push(ev);
  return out;
}

function selftest() {
  let pass = 0, fail = 0;
  const check = (name, condition) => { console.log(`  [${condition ? "OK" : "XX"}] ${name}`); condition ? pass++ : fail++; };
  const mockCandles = [["2020-03-27", 60.48], ["2020-03-30", 20.16], ["2020-03-31", 20.5], ["2024-05-24", 1.41], ["2024-05-27", 14.1], ["2024-05-28", 13.95]].map(([date, close]) => ({ date, open: close, high: close, low: close, close, volume: 1000 }));
  const events = [{ ticker: "TEST3", boundaryDate: "2020-03-30", type: "split", eventRatio: 3, rawExpectedObserved: 0.3333 }, { ticker: "TEST3", boundaryDate: "2024-05-27", type: "reverse_split", eventRatio: 0.1, rawExpectedObserved: 10 }];
  const rawAnalyses = events.map((ev) => analyzeOneEvent(mockCandles, ev));
  const plan = buildVerifiedAdjustmentPlan(rawAnalyses);
  const adjusted = applyVerifiedSplitAdjustments(mockCandles, plan.eventsToApply);
  const post = events.map((ev) => analyzeOneEvent(adjusted, ev));
  const postValidation = validatePostAdjustment(post);
  console.log("\n# SELFTEST — motor de ajuste");
  check("detecta dois degraus crus", rawAnalyses.every((e) => e.classification.verdict === "raw_step_present"));
  check("plano fica verified_raw_steps_adjusted", plan.splitEngineStatus === "verified_raw_steps_adjusted");
  check("pós-ajuste fica contínuo", postValidation.ok === true);
  check("métricas cruas ficam null", computeTrajectoryMetrics(mockCandles, false).maxDrawdownPercent === null);
  check("métricas ajustadas são liberadas", computeTrajectoryMetrics(adjusted, true).maxDrawdownPercent !== null);
  check("IQD histórico ajustado libera faixa longa", trustedHistoryDepthScore({ candlesCount: 2000, splitAdjusted: true }) === 100);
  check("IQD histórico cru fica travado em 50", trustedHistoryDepthScore({ candlesCount: 2000, splitAdjusted: false }) === 50);
  console.log(`\n===== SELFTEST: ${pass} passou, ${fail} falhou =====`);
  process.exit(fail ? 1 : 0);
}

function print(label, value) {
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  if (process.argv.includes("--selftest")) return selftest();
  console.log("\nNEXO OkaneBox Split Engine Validation v1");
  console.log("Valida detecção, ajuste, pós-ajuste e input do IQD.");
  if (!process.env.OKANE_EMAIL) throw new Error('OKANE_EMAIL ausente. Rode: export OKANE_EMAIL="pilla.vinicius@gmail.com"');
  const byTicker = groupEventsByTicker(VERIFIED_SPLITS);
  const results = [];
  for (const [ticker, events] of Object.entries(byTicker)) {
    console.log(` . analisando ${ticker} ...`);
    results.push(await analyzeTicker(ticker, events));
  }
  print("Resultados por ticker", results);
  const usable = results.filter((r) => r.ok);
  const approved = usable.length > 0 && usable.every((r) => r.acceptanceChecklist?.approved === true);
  const summary = {
    testedTickers: results.length,
    usableTickers: usable.length,
    approved,
    approvedTickers: usable.filter((r) => r.acceptanceChecklist?.approved).map((r) => r.ticker),
    failedTickers: usable.filter((r) => !r.acceptanceChecklist?.approved).map((r) => r.ticker),
    routeDecision: approved ? "OK_TO_PORT_ENGINE_TO_ROUTE_V2_6_0" : "DO_NOT_PORT_TO_ROUTE_YET",
    iqdContract: "IQD.historyDepth só deve usar histórico longo quando splitAdjusted=true e postAdjustmentValidation.ok=true. Caso contrário, historyDepthScore fica travado e métricas longas ficam null.",
  };
  print("Resumo final", summary);
}

main().catch((err) => {
  console.error("\nERRO:");
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
