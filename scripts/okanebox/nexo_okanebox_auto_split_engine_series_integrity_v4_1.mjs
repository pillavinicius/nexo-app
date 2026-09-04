/**
 * NEXO OkaneBox Auto Split Engine + IQD seriesIntegrity Validation v4.1
 *
 * Objetivo:
 * - Manter o motor v3: detecta degraus grandes, aceita apenas razões limpas, ajusta em cascata
 *   e recua honestamente quando há salto suspeito não-ajustável.
 * - Adicionar a dimensão IQD.seriesIntegrity para separar:
 *   1) histórico curto legítimo
 *   2) histórico longo contaminado
 *
 * Uso:
 *   export OKANE_EMAIL="pilla.vinicius@gmail.com"
 *   node nexo_okanebox_auto_split_engine_series_integrity_v4_1.mjs
 *
 * Self-test:
 *   node nexo_okanebox_auto_split_engine_series_integrity_v4_1.mjs --selftest
 */

const OKANE_BASE = "https://www.okanebox.com.br/api";
const DEFAULT_START = "2015-01-01";
const DEFAULT_END = new Date().toISOString().slice(0, 10);

const MAX_REMAINING_JUMP_PCT = 40;
const JUMP_LOW = 1 - MAX_REMAINING_JUMP_PCT / 100;
const JUMP_HIGH = 1 + MAX_REMAINING_JUMP_PCT / 100;

const CLEAN_RATIO_TOLERANCE_LOG = Math.log(1.08);
const MAX_ALLOWED_DRAWDOWN_PERCENT = -95;
const MIN_PLAUSIBLE_CAGR = -80;
const MAX_PLAUSIBLE_CAGR = 80;

const CLEAN_EVENT_RATIOS = [0.1, 0.125, 0.2, 0.25, 1 / 3, 0.5, 2, 3, 4, 5, 8, 10];

const VERIFIED_WITNESSES = [
  { ticker: "SAPR11", boundaryDate: "2020-03-30", type: "split", eventRatio: 3, source: "Sanepar desdobramento 3:1, ex-desdobramento em 30/03/2020." },
  { ticker: "MGLU3", boundaryDate: "2024-05-27", type: "reverse_split", eventRatio: 0.1, source: "Magalu grupamento 10:1, negociação grupada a partir de 27/05/2024." },
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

function dateDiffDays(a, b) {
  return Math.abs((new Date(a) - new Date(b)) / (1000 * 60 * 60 * 24));
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

  const candles = sortAsc(
    arr.map((q) => ({
      date: normalizeDate(q.DATPRG),
      open: toNumber(q.PREABE),
      high: toNumber(q.PREMAX),
      low: toNumber(q.PREMIN),
      close: toNumber(q.PREULT),
      volume: toNumber(q.VOLTOT ?? q.QUATOT),
    })).filter((c) => c.date && c.close !== null)
  );

  return { ok: true, source: "OkaneBox", candles };
}

function nearestCleanRatio(eventRatio) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of CLEAN_EVENT_RATIOS) {
    const distance = Math.abs(Math.log(eventRatio / candidate));
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return {
    nearest: best,
    distanceLog: bestDistance,
    withinTolerance: bestDistance <= CLEAN_RATIO_TOLERANCE_LOG,
    relativeDistancePercent: best ? round((eventRatio / best - 1) * 100, 2) : null,
  };
}

function isDuplicateCloseSuspicious(candles, idx, closeValue) {
  if (idx < 0 || closeValue === null) return false;
  const value = round(closeValue, 4);
  let distantMatches = 0;
  for (let i = 0; i < candles.length; i++) {
    if (Math.abs(i - idx) <= 20) continue;
    if (round(candles[i].close, 4) === value) distantMatches++;
  }
  return distantMatches > 0;
}

function detectDailyJumps(candles = []) {
  const arr = sortAsc(candles).filter((c) => c.date && c.close !== null && c.close > 0);
  const accepted = [];
  const rejected = [];

  for (let i = 1; i < arr.length; i++) {
    const before = arr[i - 1];
    const after = arr[i];
    const observedRatio = after.close / before.close;
    if (observedRatio >= JUMP_LOW && observedRatio <= JUMP_HIGH) continue;

    const eventRatioRaw = 1 / observedRatio;
    const clean = nearestCleanRatio(eventRatioRaw);
    const duplicateCloseSuspicion = isDuplicateCloseSuspicious(arr, i, after.close);

    const candidate = {
      boundaryDate: after.date,
      beforeDate: before.date,
      afterDate: after.date,
      beforeClose: round(before.close, 6),
      afterClose: round(after.close, 6),
      observedRatio: round(observedRatio, 8),
      eventRatioRaw: round(eventRatioRaw, 8),
      eventRatioClean: clean.nearest,
      cleanRatioDistanceLog: round(clean.distanceLog, 6),
      cleanRatioRelativeDistancePercent: clean.relativeDistancePercent,
      type: observedRatio < 1 ? "split_like_drop" : "reverse_split_like_jump",
      jumpPercent: round((observedRatio - 1) * 100, 2),
      duplicateCloseSuspicion,
    };

    if (clean.withinTolerance) accepted.push({ ...candidate, eventRatio: clean.nearest, acceptedAsSplit: true });
    else rejected.push({ ...candidate, acceptedAsSplit: false, rejectionReason: "jump_ratio_not_clean" });
  }

  return { accepted, rejected };
}

function applyDetectedSplitAdjustments(candles = [], detectedEvents = []) {
  const arr = sortAsc(candles);
  const events = [...detectedEvents].sort((a, b) => String(b.boundaryDate).localeCompare(String(a.boundaryDate)));

  return arr.map((c) => {
    let cumulativeRatio = 1;
    for (const ev of events) {
      if (String(c.date) < String(ev.boundaryDate)) cumulativeRatio *= Number(ev.eventRatio);
    }

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

function findMatchingDetectedEvent(witness, detectedEvents = []) {
  let best = null;
  let bestScore = Infinity;

  for (const ev of detectedEvents) {
    const days = dateDiffDays(witness.boundaryDate, ev.boundaryDate);
    const ratioDistance = Math.abs(Math.log(ev.eventRatio / witness.eventRatio));

    if (days <= 5 && ratioDistance <= Math.log(1.15)) {
      const score = days + ratioDistance * 10;
      if (score < bestScore) {
        best = ev;
        bestScore = score;
      }
    }
  }

  return best;
}

function validateWitnesses(ticker, detectedEvents, witnesses) {
  const relevant = witnesses.filter((w) => w.ticker === ticker);
  return relevant.map((w) => {
    const match = findMatchingDetectedEvent(w, detectedEvents);
    return { ticker, expectedBoundaryDate: w.boundaryDate, expectedEventRatio: w.eventRatio, expectedType: w.type, matched: !!match, matchedEvent: match || null, source: w.source };
  });
}

function validatePostAdjustment(adjustedCandles = []) {
  const remaining = detectDailyJumps(adjustedCandles);
  return {
    ok: remaining.accepted.length === 0,
    maxAllowedJumpPercent: MAX_REMAINING_JUMP_PCT,
    remainingAcceptedJumpsCount: remaining.accepted.length,
    remainingRejectedJumpsCount: remaining.rejected.length,
    remainingAcceptedJumps: remaining.accepted.slice(0, 20),
    remainingRejectedSuspiciousJumps: remaining.rejected.slice(0, 20),
  };
}

function maxDrawdown(candles = []) {
  const arr = sortAsc(candles).filter((c) => c.close !== null);
  if (arr.length < 2) return null;
  let peak = arr[0].close;
  let peakDate = arr[0].date;
  let troughDate = arr[0].date;
  let maxDd = 0;

  for (const c of arr) {
    if (c.close > peak) {
      peak = c.close;
      peakDate = c.date;
    }
    const dd = c.close / peak - 1;
    if (dd < maxDd) {
      maxDd = dd;
      troughDate = c.date;
    }
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
  if (!splitAdjusted) {
    return { ok: false, splitAdjusted: false, trajectoryReason: "history_not_split_adjusted", maxDrawdownPercent: null, maxDrawdownPeakDate: null, maxDrawdownTroughDate: null, cagrPercent: null, ulcerIndex: null };
  }
  const dd = maxDrawdown(candles);
  return {
    ok: true,
    splitAdjusted: true,
    trajectoryReason: "auto_detected_clean_ratio_split_adjusted_history",
    maxDrawdownPercent: dd ? round(dd.percent, 2) : null,
    maxDrawdownPeakDate: dd?.peakDate || null,
    maxDrawdownTroughDate: dd?.troughDate || null,
    cagrPercent: round(smoothedCagr(candles), 2),
    ulcerIndex: round(ulcerIndex(candles), 2),
  };
}

function isCagrPlausible(cagrPercent) {
  const c = toNumber(cagrPercent);
  if (c === null) return false;
  return c > -80 && c < 80;
}

function isDrawdownPlausible(maxDrawdownPercent) {
  const d = toNumber(maxDrawdownPercent);
  if (d === null) return false;
  return d > -95;
}

function buildSeriesIntegrity(input) {
  const {
    rawCandlesCount,
    splitAdjusted,
    splitEngineStatus,
    acceptedDetectedEventsCount,
    rejectedDetectedEventsCount,
    remainingAcceptedJumpsCount,
    remainingSuspiciousJumps,
    postAdjustmentValidationOk,
  } = input;

  let score = 100;
  const penalties = [];

  if (rejectedDetectedEventsCount > 0) {
    const penalty = 40 * rejectedDetectedEventsCount;
    score -= penalty;
    penalties.push({ reason: "rejected_unclean_jump_detected", count: rejectedDetectedEventsCount, penalty });
  }

  if (remainingAcceptedJumpsCount > 0) {
    const penalty = 40 * remainingAcceptedJumpsCount;
    score -= penalty;
    penalties.push({ reason: "remaining_clean_jump_after_adjustment", count: remainingAcceptedJumpsCount, penalty });
  }

  if (postAdjustmentValidationOk === false) {
    score -= 30;
    penalties.push({ reason: "post_adjustment_validation_failed", penalty: 30 });
  }

  const motorRetreat =
    splitAdjusted === false &&
    ["rejected_unclean_jump_detected", "remaining_suspicious_jumps_after_adjustment", "sanity_drawdown_failed", "sanity_cagr_failed", "split_engine_validation_failed"].includes(splitEngineStatus);

  if (motorRetreat) {
    score -= 25;
    penalties.push({ reason: "split_engine_retreat", penalty: 25 });
  }

  score = Math.max(0, Math.min(100, score));

  let status = "clean";
  if (score < 40) status = "severely_contaminated";
  else if (score < 60) status = "contaminated";
  else if (score < 85) status = "minor_anomalies";

  // seriesIntegrity não depende do tamanho da série.
  // Histórico curto é tratado por historyDepth; anomalia de série deve ser avaliada mesmo com poucos candles.
  const applicable = true;

  return {
    applicable,
    weight: 15,
    score,
    status,
    meaning: "seriesIntegrity mede se o histórico existente está limpo/confiável. Não mede quantidade de histórico; isso é historyDepth.",
    components: { splitAdjusted, splitEngineStatus, acceptedDetectedEventsCount, rejectedDetectedEventsCount, remainingAcceptedJumpsCount, postAdjustmentValidationOk, remainingSuspiciousJumps, penalties },
  };
}

function buildSeriesIntegrityWarnings(seriesIntegrity) {
  if (!seriesIntegrity || !seriesIntegrity.applicable) return [];
  const warnings = [];
  const suspicious = seriesIntegrity.components?.remainingSuspiciousJumps || [];
  const rejected = seriesIntegrity.components?.rejectedDetectedEventsCount || 0;

  if (seriesIntegrity.status === "contaminated" || seriesIntegrity.status === "severely_contaminated") {
    for (const jump of suspicious.slice(0, 3)) {
      warnings.push(`A série longa deste ativo contém anomalia de dado não corrigível: salto de ${jump.jumpPercent}% em ${jump.boundaryDate}, incompatível com proporção limpa de split. Métricas de trajetória longa foram suprimidas por CONTAMINAÇÃO DE FONTE, não por falta de histórico.`);
    }

    if (!suspicious.length && rejected > 0) {
      warnings.push(`A série longa deste ativo contém ${rejected} anomalia(s) de dado não corrigível. Métricas de trajetória longa foram suprimidas por CONTAMINAÇÃO DE FONTE, não por falta de histórico.`);
    }

    warnings.push("Trate leituras de longo prazo como Sharpe, CAGR, maxDrawdown, Ulcer e Calmar como indisponíveis. A fonte de dados deste ativo é suspeita para histórico longo.");
    warnings.push("GNP e RES não devem receber veredito de resiliência/eficiência baseado em trajetória longa para este ativo.");
  }
  return warnings;
}

function weightedAverageDimensions(dimensions) {
  const applicable = Object.values(dimensions).filter((d) => d && d.applicable !== false && d.score !== null && d.score !== undefined);
  const totalWeight = applicable.reduce((sum, d) => sum + (d.weight || 0), 0);
  if (!applicable.length || totalWeight <= 0) return null;
  return round(applicable.reduce((sum, d) => sum + d.score * (d.weight || 0), 0) / totalWeight, 0);
}

function ratingFromScore(score) {
  if (score === null || score === undefined) return "N/A";
  if (score >= 85) return "alta";
  if (score >= 70) return "boa";
  if (score >= 50) return "média";
  return "baixa";
}

function iqdCapFromSeriesIntegrity(seriesIntegrity) {
  const status = seriesIntegrity?.status;

  if (status === "severely_contaminated") {
    return {
      applied: true,
      cap: 40,
      reason: "seriesIntegrity_severely_contaminated",
      meaning: "Série longa severamente contaminada limita o IQD agregado. A contaminação domina o veredito de confiabilidade.",
    };
  }

  if (status === "contaminated") {
    return {
      applied: true,
      cap: 50,
      reason: "seriesIntegrity_contaminated",
      meaning: "Série longa contaminada limita o IQD agregado. A contaminação não pode ser diluída pela média ponderada.",
    };
  }

  if (status === "minor_anomalies") {
    return {
      applied: true,
      cap: 75,
      reason: "seriesIntegrity_minor_anomalies",
      meaning: "Pequenas anomalias limitam parcialmente o IQD agregado até validação adicional.",
    };
  }

  return {
    applied: false,
    cap: null,
    reason: null,
    meaning: "Sem teto aplicado por integridade de série.",
  };
}

function buildIqdMock({ ticker, historyDepthScore, seriesIntegrity, baseDataScore = 100, warnings = [] }) {
  const dimensions = {
    quoteIntegrity: { applicable: true, weight: 20, score: baseDataScore, status: "mock_complete" },
    historyDepth: { applicable: true, weight: 25, score: historyDepthScore, status: historyDepthScore >= 85 ? "long" : "limited" },
    seriesIntegrity,
    consistency: { applicable: true, weight: 20, score: baseDataScore, status: "mock_clean" },
  };

  const rawWeightedScore = weightedAverageDimensions(dimensions);
  const aggregationCap = iqdCapFromSeriesIntegrity(seriesIntegrity);
  const score = aggregationCap.applied ? Math.min(rawWeightedScore, aggregationCap.cap) : rawWeightedScore;

  return {
    ticker,
    module: "IQD",
    version: "IQD_seriesIntegrity_v1_1_capped",
    score,
    rawWeightedScore,
    rating: ratingFromScore(score),
    dimensions,
    aggregationCap,
    warnings,
    methodologyNote:
      "Se seriesIntegrity indicar contaminação, não trate como ativo novo. O histórico existe, mas a fonte longa está contaminada; suspenda leitura de trajetória longa e reduza confiança de GNP/RES. Contaminação aplica teto ao IQD agregado, não apenas penalidade ponderada.",
  };
}

function analyzePreparedCandles(ticker, raw) {
  const detection = detectDailyJumps(raw);
  const witnessValidation = validateWitnesses(ticker, detection.accepted, VERIFIED_WITNESSES);
  const adjusted = detection.accepted.length ? applyDetectedSplitAdjustments(raw, detection.accepted) : raw;
  const postValidation = validatePostAdjustment(adjusted);
  const rawMetrics = computeTrajectoryMetrics(raw, false);

  const witnessOk = witnessValidation.length === 0 || witnessValidation.every((w) => w.matched === true);
  const noAcceptedRemaining = postValidation.remainingAcceptedJumpsCount === 0;
  const hasRejectedRawJumps = detection.rejected.length > 0;
  const splitAdjustedCandidate = witnessOk && noAcceptedRemaining && !hasRejectedRawJumps;

  const adjustedMetrics = computeTrajectoryMetrics(adjusted, splitAdjustedCandidate);
  const cagrOk = isCagrPlausible(adjustedMetrics.cagrPercent);
  const drawdownOk = isDrawdownPlausible(adjustedMetrics.maxDrawdownPercent);
  const splitAdjusted = splitAdjustedCandidate && cagrOk && drawdownOk;

  const splitEngineStatus = splitAdjusted
    ? "auto_detected_clean_ratio_steps_adjusted_and_globally_clean"
    : hasRejectedRawJumps
    ? "rejected_unclean_jump_detected"
    : !drawdownOk
    ? "sanity_drawdown_failed"
    : !cagrOk
    ? "sanity_cagr_failed"
    : "split_engine_validation_failed";

  const iqdHistoryInput = {
    source: "OkaneBox",
    rawCandlesCount: raw.length,
    trustedCandlesCount: splitAdjusted ? adjusted.length : 0,
    splitAdjusted,
    splitEngineStatus,
    acceptedDetectedEventsCount: detection.accepted.length,
    rejectedDetectedEventsCount: detection.rejected.length,
    remainingAcceptedJumpsCount: postValidation.remainingAcceptedJumpsCount,
    remainingSuspiciousJumps: detection.rejected,
    postAdjustmentValidationOk: postValidation.ok,
    historyDepthScore: trustedHistoryDepthScore({ candlesCount: raw.length, splitAdjusted }),
    trajectoryReason: splitAdjusted ? "auto_detected_clean_ratio_split_adjusted_history" : "history_not_split_adjusted",
  };

  const seriesIntegrity = buildSeriesIntegrity(iqdHistoryInput);
  const seriesWarnings = buildSeriesIntegrityWarnings(seriesIntegrity);

  const iqdMock = buildIqdMock({ ticker, historyDepthScore: iqdHistoryInput.historyDepthScore, seriesIntegrity, warnings: seriesWarnings });

  const contaminatedStatus = ["contaminated", "severely_contaminated"].includes(seriesIntegrity.status);
  const shortButClean = raw.length < 252 && !hasRejectedRawJumps && seriesIntegrity.status === "clean";

  const acceptanceChecklist = {
    A_raw_metrics_are_null: rawMetrics.maxDrawdownPercent === null && rawMetrics.trajectoryReason === "history_not_split_adjusted",
    B_series_integrity_exists: !!seriesIntegrity && typeof seriesIntegrity.score === "number",
    C_clean_series_has_high_integrity_or_contaminated_series_has_low_integrity:
      (splitAdjusted && seriesIntegrity.score >= 85) || (!splitAdjusted && seriesIntegrity.score < 85) || shortButClean,
    D_contamination_generates_warnings_when_needed: seriesIntegrity.status === "clean" || seriesWarnings.length > 0,
    E_history_depth_and_series_integrity_are_separate:
      !(iqdHistoryInput.historyDepthScore === 50 && seriesIntegrity.status === "clean" && hasRejectedRawJumps),
    F_contaminated_iqd_aggregate_is_capped_below_good_band:
      !contaminatedStatus || (iqdMock.score < 60 && iqdMock.aggregationCap.applied === true),
    G_clean_or_short_clean_series_has_no_integrity_cap:
      seriesIntegrity.status !== "clean" || iqdMock.aggregationCap.applied === false,
  };

  acceptanceChecklist.approved = Object.values(acceptanceChecklist).every(Boolean);

  return {
    ticker,
    ok: true,
    coverage: { firstDate: raw[0]?.date || null, lastDate: raw[raw.length - 1]?.date || null, candlesCount: raw.length },
    rawDetectedEventsAccepted: detection.accepted,
    rawDetectedEventsRejected: detection.rejected,
    verifiedWitnessValidation: witnessValidation,
    postAdjustmentValidation: postValidation,
    rawTrajectoryMetrics: rawMetrics,
    adjustedTrajectoryMetrics: adjustedMetrics,
    iqdHistoryInput,
    iqdMock,
    acceptanceChecklist,
  };
}

async function analyzeTicker(ticker) {
  const okane = await fetchOkaneDaily(ticker, process.env.OKANE_EMAIL);
  if (!okane.ok) return { ticker, ok: false, reason: "okane_fetch_failed", okaneReason: okane.reason };
  return analyzePreparedCandles(ticker, okane.candles);
}

function makeMockCandles(rows) {
  return sortAsc(rows.map(([date, close]) => ({ date, open: close, high: close, low: close, close, volume: 1000 })));
}

function selftest() {
  let pass = 0;
  let fail = 0;
  const check = (name, condition) => {
    console.log(`  [${condition ? "OK" : "XX"}] ${name}`);
    condition ? pass++ : fail++;
  };

  const cleanLongSplit = makeMockCandles([
    ["2020-01-01", 90], ["2020-01-02", 91], ["2020-03-27", 90],
    ["2020-03-30", 30], ["2020-03-31", 31], ["2021-01-01", 33], ["2022-01-01", 35],
  ]);

  const contaminatedLong = makeMockCandles([
    ["2015-09-29", 1.75], ["2015-09-30", 1.8], ["2015-10-01", 13.15],
    ["2015-10-02", 13.2], ["2016-01-01", 13.4], ["2017-01-01", 13.8],
  ]);

  const genuinelyShort = makeMockCandles([
    ["2026-01-02", 10], ["2026-01-05", 10.1], ["2026-01-06", 10.2], ["2026-01-07", 10.15],
  ]);

  const clean = analyzePreparedCandles("MOCK_CLEAN", cleanLongSplit);
  const contaminated = analyzePreparedCandles("MOCK_DIRTY", contaminatedLong);

  const shortSeriesIntegrity = buildSeriesIntegrity({
    rawCandlesCount: genuinelyShort.length,
    splitAdjusted: false,
    splitEngineStatus: "short_history_no_long_series",
    acceptedDetectedEventsCount: 0,
    rejectedDetectedEventsCount: 0,
    remainingAcceptedJumpsCount: 0,
    remainingSuspiciousJumps: [],
    postAdjustmentValidationOk: true,
  });

  const shortIqd = buildIqdMock({
    ticker: "MOCK_SHORT",
    historyDepthScore: trustedHistoryDepthScore({ candlesCount: genuinelyShort.length, splitAdjusted: false }),
    seriesIntegrity: shortSeriesIntegrity,
    warnings: [],
  });

  console.log("\n# SELFTEST — IQD seriesIntegrity v1.1 capped");
  check("série limpa ajustada fica seriesIntegrity clean", clean.iqdMock.dimensions.seriesIntegrity.status === "clean");
  check("série contaminada fica contaminada/severamente contaminada", ["contaminated", "severely_contaminated"].includes(contaminated.iqdMock.dimensions.seriesIntegrity.status));
  check("série contaminada gera warnings textuais", contaminated.iqdMock.warnings.length >= 2);
  check("série contaminada aplica teto no IQD agregado", contaminated.iqdMock.aggregationCap.applied === true);
  check("IQD agregado contaminado fica abaixo de 60", contaminated.iqdMock.score < 60);
  check("série curta genuína mantém seriesIntegrity alta/limpa", shortSeriesIntegrity.score === 100 && shortSeriesIntegrity.status === "clean");
  check("série curta genuína não aplica teto de integridade", shortIqd.aggregationCap.applied === false);
  check("histórico curto e contaminação são distinguíveis", shortSeriesIntegrity.status !== contaminated.iqdMock.dimensions.seriesIntegrity.status);
  check("métricas contaminadas permanecem null", contaminated.adjustedTrajectoryMetrics.maxDrawdownPercent === null);
  check("IQD contaminado fica abaixo do limpo", contaminated.iqdMock.score < clean.iqdMock.score);

  console.log(`\n===== SELFTEST: ${pass} passou, ${fail} falhou =====`);
  process.exit(fail ? 1 : 0);
}

function print(label, value) {
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  if (process.argv.includes("--selftest")) return selftest();

  console.log("\nNEXO OkaneBox Auto Split Engine + IQD seriesIntegrity Validation v4.1");
  console.log("Canaliza o motivo do recuo do motor até o IQD/Claude.");

  if (!process.env.OKANE_EMAIL) throw new Error('OKANE_EMAIL ausente. Rode: export OKANE_EMAIL="pilla.vinicius@gmail.com"');

  const tickersFromArgs = process.argv.slice(2).map((x) => String(x).toUpperCase());
  const tickers = tickersFromArgs.length ? tickersFromArgs : ["SAPR11", "MGLU3"];

  const results = [];
  for (const ticker of tickers) {
    console.log(` . analisando ${ticker} ...`);
    results.push(await analyzeTicker(ticker));
  }

  print("Resultados por ticker", results);

  const usable = results.filter((r) => r.ok);
  const approved = usable.length > 0 && usable.every((r) => r.acceptanceChecklist?.approved === true);

  const summary = {
    testedTickers: results.length,
    usableTickers: usable.length,
    approved,
    cleanTickers: usable.filter((r) => r.iqdMock?.dimensions?.seriesIntegrity?.status === "clean").map((r) => r.ticker),
    contaminatedTickers: usable.filter((r) => ["contaminated", "severely_contaminated"].includes(r.iqdMock?.dimensions?.seriesIntegrity?.status)).map((r) => r.ticker),
    routeDecision: approved ? "OK_TO_PORT_SERIES_INTEGRITY_CAPPED_TO_ROUTE_V2_6_0" : "DO_NOT_PORT_TO_ROUTE_YET",
    iqdContract: "IQD deve separar historyDepth de seriesIntegrity. Histórico curto legítimo não é igual a histórico longo contaminado. Quando seriesIntegrity é contaminada, métricas longas ficam null e GNP/RES não devem emitir veredito de trajetória longa.",
  };

  print("Resumo final", summary);
}

main().catch((err) => {
  console.error("\nERRO:");
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
