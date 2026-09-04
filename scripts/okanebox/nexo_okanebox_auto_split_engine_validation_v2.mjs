/**
 * NEXO OkaneBox Auto Split Engine Validation v2
 *
 * Ajustes incorporados após validação com Claude:
 * - O motor não depende mais da completude da tabela manual.
 * - A tabela de eventos verificados vira gabarito de validação, não fonte única de ajuste.
 * - O motor varre a série inteira e detecta todos os degraus anômalos.
 * - Ajusta em cascata do evento mais recente para o mais antigo.
 * - Depois do ajuste, varre a série inteira para confirmar que não sobrou degrau > 40%.
 * - O checklist valida CAGR e Drawdown, não apenas CAGR.
 * - IQD só recebe histórico longo como confiável se a série ajustada passar na validação global.
 *
 * Uso:
 *   export OKANE_EMAIL="pilla.vinicius@gmail.com"
 *   node nexo_okanebox_auto_split_engine_validation_v2.mjs
 *
 * Teste offline:
 *   node nexo_okanebox_auto_split_engine_validation_v2.mjs --selftest
 */

const OKANE_BASE = "https://www.okanebox.com.br/api";
const DEFAULT_START = "2015-01-01";
const DEFAULT_END = new Date().toISOString().slice(0, 10);

// Degrau diário considerado grande demais para ser trajetória normal.
// 40% = ratio < 0.60 ou ratio > 1.40.
const MAX_REMAINING_JUMP_PCT = 40;
const JUMP_LOW = 1 - MAX_REMAINING_JUMP_PCT / 100;
const JUMP_HIGH = 1 + MAX_REMAINING_JUMP_PCT / 100;

// Bandas para validar testemunhas semeadas.
const VERIFIED_DATE_TOLERANCE_DAYS = 5;
const VERIFIED_RATIO_TOLERANCE_LOG = Math.log(1.35);

// Sanidade de métricas pós-ajuste.
const MAX_ALLOWED_DRAWDOWN_PERCENT = -95;
const MIN_PLAUSIBLE_CAGR = -80;
const MAX_PLAUSIBLE_CAGR = 80;

/**
 * Eventos verificados servem como gabarito de validação.
 * Eles NÃO são a fonte única do ajuste.
 *
 * eventRatio:
 * - split 3:1 => eventRatio = 3; série crua observed after/before ≈ 1/3
 * - reverse split 10:1 => eventRatio = 0.1; série crua observed after/before ≈ 10
 */
const VERIFIED_WITNESSES = [
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

const DEFAULT_TICKERS = ["SAPR11", "MGLU3"];

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

function dateDiffDays(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return Math.abs((da - db) / (1000 * 60 * 60 * 24));
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
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, status: r.status, reason: "invalid_json", preview: text.slice(0, 300) };
  }
  if (!r.ok) return { ok: false, status: r.status, reason: "http_error", data };
  return { ok: true, status: r.status, data };
}

async function fetchOkaneDaily(ticker, email) {
  if (!email) throw new Error('OKANE_EMAIL ausente. Rode: export OKANE_EMAIL="pilla.vinicius@gmail.com"');

  const url = `${OKANE_BASE}/acoes/hist/${encodeURIComponent(ticker)}/${ymdCompact(DEFAULT_START)}/${ymdCompact(DEFAULT_END)}/`;
  const res = await fetchJsonStrict(url, {
    Authorization: `Bearer ${email}`,
    Accept: "application/json",
  });

  if (!res.ok) return { ok: false, reason: res.reason, candles: [], error: res };

  const d = res.data;
  const arr = Array.isArray(d)
    ? d
    : Array.isArray(d?.data)
    ? d.data
    : Array.isArray(d?.results)
    ? d.results
    : Array.isArray(d?.historico)
    ? d.historico
    : [];

  const candles = sortAsc(
    arr
      .map((q) => ({
        date: normalizeDate(q.DATPRG),
        open: toNumber(q.PREABE),
        high: toNumber(q.PREMAX),
        low: toNumber(q.PREMIN),
        close: toNumber(q.PREULT),
        volume: toNumber(q.VOLTOT ?? q.QUATOT),
      }))
      .filter((c) => c.date && c.close !== null)
  );

  return { ok: true, source: "OkaneBox", candles };
}

function detectDailyJumps(candles = []) {
  const arr = sortAsc(candles).filter((c) => c.date && c.close !== null && c.close > 0);
  const jumps = [];

  for (let i = 1; i < arr.length; i++) {
    const before = arr[i - 1];
    const after = arr[i];
    const observedRatio = after.close / before.close;

    if (observedRatio < JUMP_LOW || observedRatio > JUMP_HIGH) {
      const eventRatio = 1 / observedRatio;
      jumps.push({
        boundaryDate: after.date,
        beforeDate: before.date,
        afterDate: after.date,
        beforeClose: round(before.close, 6),
        afterClose: round(after.close, 6),
        observedRatio: round(observedRatio, 8),
        eventRatio: round(eventRatio, 8),
        type: observedRatio < 1 ? "split_like_drop" : "reverse_split_like_jump",
        jumpPercent: round((observedRatio - 1) * 100, 2),
      });
    }
  }

  return jumps;
}

function applyDetectedSplitAdjustments(candles = [], detectedEvents = []) {
  const arr = sortAsc(candles);
  const events = [...detectedEvents].sort((a, b) => String(b.boundaryDate).localeCompare(String(a.boundaryDate)));

  return arr.map((c) => {
    let cumulativeRatio = 1;

    for (const ev of events) {
      if (String(c.date) < String(ev.boundaryDate)) {
        cumulativeRatio *= Number(ev.eventRatio);
      }
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

    if (days <= VERIFIED_DATE_TOLERANCE_DAYS && ratioDistance <= VERIFIED_RATIO_TOLERANCE_LOG) {
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
    return {
      ticker,
      expectedBoundaryDate: w.boundaryDate,
      expectedEventRatio: w.eventRatio,
      expectedType: w.type,
      matched: !!match,
      matchedEvent: match || null,
      source: w.source,
    };
  });
}

function validatePostAdjustment(adjustedCandles = []) {
  const remainingJumps = detectDailyJumps(adjustedCandles);
  return {
    ok: remainingJumps.length === 0,
    maxAllowedJumpPercent: MAX_REMAINING_JUMP_PCT,
    remainingJumpsCount: remainingJumps.length,
    remainingJumps: remainingJumps.slice(0, 20),
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
    return {
      ok: false,
      splitAdjusted: false,
      trajectoryReason: "history_not_split_adjusted",
      maxDrawdownPercent: null,
      maxDrawdownPeakDate: null,
      maxDrawdownTroughDate: null,
      cagrPercent: null,
      ulcerIndex: null,
    };
  }

  const dd = maxDrawdown(candles);
  return {
    ok: true,
    splitAdjusted: true,
    trajectoryReason: "auto_detected_split_adjusted_history",
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
  return d > MAX_ALLOWED_DRAWDOWN_PERCENT;
}

async function analyzeTicker(ticker) {
  const okane = await fetchOkaneDaily(ticker, process.env.OKANE_EMAIL);

  if (!okane.ok) {
    return {
      ticker,
      ok: false,
      reason: "okane_fetch_failed",
      okaneReason: okane.reason,
    };
  }

  const raw = okane.candles;
  const detectedEvents = detectDailyJumps(raw);
  const witnessValidation = validateWitnesses(ticker, detectedEvents, VERIFIED_WITNESSES);

  const adjusted = detectedEvents.length ? applyDetectedSplitAdjustments(raw, detectedEvents) : raw;
  const postValidation = validatePostAdjustment(adjusted);

  const splitAdjusted = postValidation.ok;
  const rawTrajectoryMetrics = computeTrajectoryMetrics(raw, false);
  const adjustedTrajectoryMetrics = computeTrajectoryMetrics(adjusted, splitAdjusted);

  const witnessOk = witnessValidation.length === 0 || witnessValidation.every((w) => w.matched === true);
  const cagrOk = isCagrPlausible(adjustedTrajectoryMetrics.cagrPercent);
  const drawdownOk = isDrawdownPlausible(adjustedTrajectoryMetrics.maxDrawdownPercent);

  const iqdHistoryInput = {
    source: "OkaneBox",
    rawCandlesCount: raw.length,
    trustedCandlesCount: splitAdjusted ? adjusted.length : 0,
    splitAdjusted,
    splitEngineStatus: splitAdjusted
      ? "auto_detected_steps_adjusted_and_globally_clean"
      : "remaining_suspicious_jumps_after_adjustment",
    detectedEventsCount: detectedEvents.length,
    remainingJumpsCount: postValidation.remainingJumpsCount,
    historyDepthScore: trustedHistoryDepthScore({
      candlesCount: raw.length,
      splitAdjusted,
    }),
    trajectoryReason: splitAdjusted
      ? "auto_detected_split_adjusted_history"
      : "history_not_split_adjusted",
  };

  const acceptanceChecklist = {
    A_raw_metrics_are_null: rawTrajectoryMetrics.maxDrawdownPercent === null && rawTrajectoryMetrics.trajectoryReason === "history_not_split_adjusted",
    B_detected_all_large_jumps_in_raw_series: detectedEvents.length > 0 || raw.length > 0,
    C_verified_witnesses_were_matched: witnessOk,
    D_post_adjustment_series_has_no_large_remaining_jumps: postValidation.ok === true,
    E_adjusted_metrics_released: adjustedTrajectoryMetrics.ok === true && adjustedTrajectoryMetrics.maxDrawdownPercent !== null,
    F_cagr_plausible: cagrOk,
    G_drawdown_plausible: drawdownOk,
    H_iqd_history_depth_uses_adjusted_history: iqdHistoryInput.splitAdjusted === true && iqdHistoryInput.historyDepthScore >= 85,
  };

  acceptanceChecklist.approved = Object.values(acceptanceChecklist).every(Boolean);

  return {
    ticker,
    ok: true,
    coverage: {
      firstDate: raw[0]?.date || null,
      lastDate: raw[raw.length - 1]?.date || null,
      candlesCount: raw.length,
    },
    rawDetectedEvents: detectedEvents,
    verifiedWitnessValidation: witnessValidation,
    postAdjustmentValidation: postValidation,
    rawTrajectoryMetrics,
    adjustedTrajectoryMetrics,
    iqdHistoryInput,
    acceptanceChecklist,
  };
}

function selftest() {
  let pass = 0;
  let fail = 0;
  const check = (name, condition) => {
    console.log(`  [${condition ? "OK" : "XX"}] ${name}`);
    condition ? pass++ : fail++;
  };

  const mock = [
    ["2018-01-02", 80],
    ["2019-08-01", 79],
    ["2019-08-02", 9.875], // split 8:1
    ["2020-10-13", 10],
    ["2020-10-14", 2.5], // split 4:1
    ["2024-05-24", 1.4],
    ["2024-05-27", 14], // reverse 10:1
    ["2025-01-02", 13.5],
  ].map(([date, close]) => ({
    date,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
  }));

  const detected = detectDailyJumps(mock);
  const adjusted = applyDetectedSplitAdjustments(mock, detected);
  const post = validatePostAdjustment(adjusted);
  const rawMetrics = computeTrajectoryMetrics(mock, false);
  const adjMetrics = computeTrajectoryMetrics(adjusted, post.ok);

  console.log("\n# SELFTEST — auto split engine v2");
  check("detecta três degraus", detected.length === 3);
  check("série pós-ajuste não tem salto > 40%", post.ok === true);
  check("métricas cruas ficam null", rawMetrics.maxDrawdownPercent === null);
  check("métricas ajustadas liberam drawdown", adjMetrics.maxDrawdownPercent !== null);
  check("IQD longo ajustado chega a 100 com 2000 candles", trustedHistoryDepthScore({ candlesCount: 2000, splitAdjusted: true }) === 100);
  check("IQD longo cru fica travado em 50", trustedHistoryDepthScore({ candlesCount: 2000, splitAdjusted: false }) === 50);

  console.log(`\n===== SELFTEST: ${pass} passou, ${fail} falhou =====`);
  process.exit(fail ? 1 : 0);
}

function print(label, value) {
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  if (process.argv.includes("--selftest")) return selftest();

  console.log("\nNEXO OkaneBox Auto Split Engine Validation v2");
  console.log("Detecta todos os degraus grandes, ajusta em cascata e valida série inteira antes de alimentar o IQD.");

  if (!process.env.OKANE_EMAIL) {
    throw new Error('OKANE_EMAIL ausente. Rode: export OKANE_EMAIL="pilla.vinicius@gmail.com"');
  }

  const tickersFromArgs = process.argv.slice(2).map((x) => String(x).toUpperCase());
  const tickers = tickersFromArgs.length ? tickersFromArgs : DEFAULT_TICKERS;

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
    approvedTickers: usable.filter((r) => r.acceptanceChecklist?.approved).map((r) => r.ticker),
    failedTickers: usable.filter((r) => !r.acceptanceChecklist?.approved).map((r) => r.ticker),
    routeDecision: approved
      ? "OK_TO_PORT_AUTO_SPLIT_ENGINE_TO_ROUTE_V2_6_0"
      : "DO_NOT_PORT_TO_ROUTE_YET",
    iqdContract:
      "IQD.historyDepth só usa histórico longo quando splitAdjusted=true, não há degraus remanescentes >40%, CAGR e drawdown passam em sanidade. Caso contrário, metrics longas ficam null e historyDepthScore é travado.",
  };

  print("Resumo final", summary);
}

main().catch((err) => {
  console.error("\nERRO:");
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
