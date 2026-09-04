/**
 * NEXO OkaneBox Splits A/B Test v2
 *
 * Valida os 3 estados antes do route V2.6.0:
 * 1) confirmed_events_applied
 * 2) no_events_reported
 * 3) splits_unavailable
 *
 * Uso:
 *   export OKANE_EMAIL="pilla.vinicius@gmail.com"
 *   export HG_BRASIL_KEY="sua-chave"
 *   node nexo_okanebox_splits_ab_test_v2.mjs
 */

const OKANE_BASE = "https://www.okanebox.com.br/api";
const HG_BASE = "https://api.hgbrasil.com/v2/finance";
const DEFAULT_START = "2017-01-01";
const DEFAULT_END = new Date().toISOString().slice(0, 10);

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, decimals = 2) {
  const n = toNumber(value);
  if (n === null) return null;
  const p = 10 ** decimals;
  return Math.round(n * p) / p;
}

function ymdCompact(dateStr) {
  return String(dateStr || "").replaceAll("-", "").slice(0, 8);
}

function normalizeDate(dateLike) {
  if (!dateLike) return null;
  return String(dateLike).slice(0, 10);
}

function sortCandlesAsc(candles = []) {
  return [...candles].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

async function fetchJsonStrict(url, headers = {}) {
  const r = await fetch(url, { cache: "no-store", headers });
  const text = await r.text();

  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, httpOk: r.ok, status: r.status, reason: "invalid_json", data: null, rawPreview: text.slice(0, 300) };
  }

  if (!r.ok) {
    return { ok: false, httpOk: false, status: r.status, reason: "http_error", data };
  }

  return { ok: true, httpOk: true, status: r.status, reason: "ok", data };
}

async function fetchOkaneDaily(ticker, startDate, endDate, email) {
  if (!email) throw new Error("OKANE_EMAIL ausente.");
  const url = `${OKANE_BASE}/acoes/hist/${encodeURIComponent(ticker)}/${ymdCompact(startDate)}/${ymdCompact(endDate)}/`;
  const response = await fetchJsonStrict(url, {
    Authorization: `Bearer ${email}`,
    Accept: "application/json",
  });

  if (!response.ok) throw new Error(`OkaneBox history falhou: ${JSON.stringify(response, null, 2)}`);

  const data = response.data;
  const arr = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.results)
    ? data.results
    : Array.isArray(data?.historico)
    ? data.historico
    : [];

  return sortCandlesAsc(
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
}

function normalizeHgSplitEvent(event) {
  const ratio = toNumber(event?.ratio);
  const comDate = normalizeDate(event?.com_date);
  const effectiveDate = normalizeDate(event?.effective_date);
  if (!ratio || ratio <= 0 || !comDate) return null;
  return {
    type: event?.type || null,
    factor_from: toNumber(event?.factor_from),
    factor_to: toNumber(event?.factor_to),
    ratio,
    com_date: comDate,
    effective_date: effectiveDate,
    status: event?.status || null,
  };
}

function interpretHgSplitsResponse(response) {
  if (!response?.ok || !response?.httpOk) {
    return {
      splitStatus: "splits_unavailable",
      splitAdjusted: false,
      reason: response?.reason || "fetch_failed",
      splitsApplied: [],
      allEvents: [],
      validation: { httpOk: !!response?.httpOk, keyStatusValid: false, eventsIsArray: false },
    };
  }

  const data = response.data;
  const keyStatusValid = data?.metadata?.key_status === "valid";
  const events = data?.results?.[0]?.events;
  const eventsIsArray = Array.isArray(events);

  if (!keyStatusValid || !eventsIsArray) {
    return {
      splitStatus: "splits_unavailable",
      splitAdjusted: false,
      reason: !keyStatusValid ? "invalid_key_status" : "events_not_array",
      splitsApplied: [],
      allEvents: [],
      validation: { httpOk: true, keyStatusValid, eventsIsArray },
    };
  }

  const confirmed = events
    .filter((e) => e?.status === "confirmed")
    .map(normalizeHgSplitEvent)
    .filter(Boolean)
    .sort((a, b) => String(b.com_date).localeCompare(String(a.com_date)));

  if (confirmed.length === 0) {
    return {
      splitStatus: "no_events_reported",
      splitAdjusted: true,
      reason: "valid_response_no_confirmed_events",
      splitsApplied: [],
      allEvents: events,
      validation: { httpOk: true, keyStatusValid: true, eventsIsArray: true },
    };
  }

  return {
    splitStatus: "confirmed_events_applied",
    splitAdjusted: true,
    reason: "confirmed_events_available",
    splitsApplied: confirmed,
    allEvents: events,
    validation: { httpOk: true, keyStatusValid: true, eventsIsArray: true },
  };
}

async function fetchHgSplits(ticker, key) {
  if (!key) {
    return interpretHgSplitsResponse({ ok: false, httpOk: false, reason: "missing_hg_key", data: null });
  }
  const url = `${HG_BASE}/splits?tickers=B3:${encodeURIComponent(ticker)}&key=${encodeURIComponent(key)}`;
  return interpretHgSplitsResponse(await fetchJsonStrict(url, { Accept: "application/json" }));
}

function applySplitAdjustments(candles = [], splitInfo) {
  const validCandles = sortCandlesAsc(candles).filter((c) => c.date && c.close !== null);

  if (!validCandles.length) {
    return { ok: false, splitAdjusted: false, splitStatus: "splits_unavailable", reason: "empty_history", candles: [], splitsApplied: [], diagnostics: [] };
  }

  if (!splitInfo?.splitAdjusted) {
    return {
      ok: false,
      splitAdjusted: false,
      splitStatus: splitInfo?.splitStatus || "splits_unavailable",
      reason: splitInfo?.reason || "splits_unavailable",
      candles: validCandles,
      splitsApplied: [],
      diagnostics: [],
    };
  }

  const splits = splitInfo.splitsApplied || [];

  if (splitInfo.splitStatus === "no_events_reported" && splits.length === 0) {
    return { ok: true, splitAdjusted: true, splitStatus: "no_events_reported", reason: "no_adjustment_needed", candles: validCandles, splitsApplied: [], diagnostics: [] };
  }

  const adjusted = validCandles.map((c) => {
    let cumulativeRatio = 1;
    for (const s of splits) {
      if (String(c.date) < String(s.com_date)) cumulativeRatio *= Number(s.ratio);
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

  const diagnostics = [];
  for (const s of splits) {
    const beforeRaw = [...validCandles].reverse().find((c) => String(c.date) < String(s.com_date) && c.close !== null);
    const beforeAdj = beforeRaw ? adjusted.find((c) => c.date === beforeRaw.date) : null;
    if (beforeRaw && beforeAdj) {
      diagnostics.push({
        type: s.type,
        com_date: s.com_date,
        effective_date: s.effective_date,
        ratioRead: s.ratio,
        sampleDateBeforeComDate: beforeRaw.date,
        rawClose: round(beforeRaw.close, 6),
        adjustedClose: round(beforeAdj.close, 6),
        effectiveFactorApplied: round(beforeAdj.close / beforeRaw.close, 6),
        expectedEffectiveFactor: round(1 / s.ratio, 6),
        rule: "closeAdjusted = closeRaw / ratio; volumeAdjusted = volumeRaw * ratio",
      });
    }
  }

  return {
    ok: true,
    splitAdjusted: true,
    splitStatus: splitInfo.splitStatus,
    reason: "split_adjusted_or_no_events",
    candles: adjusted,
    splitsApplied: splits,
    diagnostics,
  };
}

function candlesByteIdentical(a = [], b = []) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function maxDrawdown(candles = []) {
  const arr = sortCandlesAsc(candles).filter((c) => c.close !== null);
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

function cagr(candles = []) {
  const arr = sortCandlesAsc(candles).filter((c) => c.close !== null);
  if (arr.length < 2) return null;
  const first = arr[0];
  const last = arr[arr.length - 1];
  const days = (new Date(last.date) - new Date(first.date)) / (1000 * 60 * 60 * 24);
  const years = days / 365.25;
  if (years <= 0 || first.close <= 0) return null;
  return ((last.close / first.close) ** (1 / years) - 1) * 100;
}

function ulcerIndex(candles = []) {
  const arr = sortCandlesAsc(candles).filter((c) => c.close !== null);
  if (arr.length < 2) return null;
  let peak = arr[0].close;
  const squaredDrawdowns = [];
  for (const c of arr) {
    if (c.close > peak) peak = c.close;
    const ddPercent = ((c.close / peak) - 1) * 100;
    squaredDrawdowns.push(ddPercent * ddPercent);
  }
  const avg = squaredDrawdowns.reduce((sum, v) => sum + v, 0) / squaredDrawdowns.length;
  return Math.sqrt(avg);
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
    trajectoryReason: "split_adjusted_or_no_events_confirmed",
    maxDrawdownPercent: dd ? round(dd.percent, 2) : null,
    maxDrawdownPeakDate: dd?.peakDate || null,
    maxDrawdownTroughDate: dd?.troughDate || null,
    cagrPercent: round(cagr(candles), 2),
    ulcerIndex: round(ulcerIndex(candles), 2),
  };
}

function print(label, value) {
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(value, null, 2));
}

function runUnavailableMocks(rawCandles) {
  const mocks = [
    { name: "invalid_json", response: { ok: false, httpOk: true, status: 200, reason: "invalid_json", data: null } },
    {
      name: "invalid_key_status",
      response: { ok: true, httpOk: true, status: 200, reason: "ok", data: { metadata: { key_status: "invalid" }, results: [{ events: [] }] } },
    },
    {
      name: "events_absent",
      response: { ok: true, httpOk: true, status: 200, reason: "ok", data: { metadata: { key_status: "valid" }, results: [{}] } },
    },
    { name: "http_500", response: { ok: false, httpOk: false, status: 500, reason: "http_error", data: { error: "server error" } } },
  ];

  return mocks.map((m) => {
    const splitInfo = interpretHgSplitsResponse(m.response);
    const adjusted = applySplitAdjustments(rawCandles, splitInfo);
    const metrics = computeTrajectoryMetrics(adjusted.candles, adjusted.splitAdjusted);
    return {
      mock: m.name,
      splitStatus: splitInfo.splitStatus,
      splitAdjusted: splitInfo.splitAdjusted,
      reason: splitInfo.reason,
      trustedHistoryDepthScore: trustedHistoryDepthScore({ candlesCount: rawCandles.length, splitAdjusted: splitInfo.splitAdjusted }),
      metrics,
    };
  });
}

async function runTickerCase(ticker, { expectedRealNoEvents = false } = {}) {
  const raw = await fetchOkaneDaily(ticker, DEFAULT_START, DEFAULT_END, process.env.OKANE_EMAIL);
  const realSplitInfo = await fetchHgSplits(ticker, process.env.HG_BRASIL_KEY);
  const adjusted = applySplitAdjustments(raw, realSplitInfo);
  const rawMetrics = computeTrajectoryMetrics(raw, false);
  const adjustedMetrics = computeTrajectoryMetrics(adjusted.candles, adjusted.splitAdjusted);

  const summary = {
    ticker,
    rawHistory: {
      source: "OkaneBox",
      splitAdjusted: false,
      candlesCount: raw.length,
      firstDate: raw[0]?.date || null,
      lastDate: raw[raw.length - 1]?.date || null,
      firstClose: raw[0]?.close ?? null,
      lastClose: raw[raw.length - 1]?.close ?? null,
      trustedHistoryDepthScore: trustedHistoryDepthScore({ candlesCount: raw.length, splitAdjusted: false }),
    },
    hgSplits: {
      splitStatus: realSplitInfo.splitStatus,
      splitAdjusted: realSplitInfo.splitAdjusted,
      reason: realSplitInfo.reason,
      validation: realSplitInfo.validation,
      allEventsCount: realSplitInfo.allEvents?.length ?? null,
      splitsApplied: realSplitInfo.splitsApplied,
    },
    adjustedHistory: {
      splitStatus: adjusted.splitStatus,
      splitAdjusted: adjusted.splitAdjusted,
      candlesCount: adjusted.candles.length,
      firstDate: adjusted.candles[0]?.date || null,
      lastDate: adjusted.candles[adjusted.candles.length - 1]?.date || null,
      firstClose: adjusted.candles[0]?.close ?? null,
      lastClose: adjusted.candles[adjusted.candles.length - 1]?.close ?? null,
      trustedHistoryDepthScore: trustedHistoryDepthScore({ candlesCount: adjusted.candles.length, splitAdjusted: adjusted.splitAdjusted }),
      diagnostics: adjusted.diagnostics,
    },
    rawMetrics,
    adjustedMetrics,
  };

  if (expectedRealNoEvents) {
    const mockInfo = { splitStatus: "no_events_reported", splitAdjusted: true, splitsApplied: [], reason: "mock_no_events" };
    const mockAdjusted = applySplitAdjustments(raw, mockInfo);
    summary.mockNoEvents = {
      splitStatus: mockAdjusted.splitStatus,
      splitAdjusted: mockAdjusted.splitAdjusted,
      byteIdentical: candlesByteIdentical(raw, mockAdjusted.candles),
      trustedHistoryDepthScore: trustedHistoryDepthScore({ candlesCount: mockAdjusted.candles.length, splitAdjusted: mockAdjusted.splitAdjusted }),
    };
  }

  return summary;
}

function acceptanceChecklist(tims, sapr, unavailableMocks) {
  const timsRawOk =
    tims.rawHistory.trustedHistoryDepthScore === 50 &&
    tims.rawMetrics.maxDrawdownPercent === null &&
    tims.rawMetrics.trajectoryReason === "history_not_split_adjusted";

  const noEventsMockOk =
    sapr.mockNoEvents?.splitStatus === "no_events_reported" &&
    sapr.mockNoEvents?.splitAdjusted === true &&
    sapr.mockNoEvents?.byteIdentical === true;

  const timsConfirmedOk =
    tims.hgSplits.splitStatus === "confirmed_events_applied" &&
    tims.adjustedHistory.splitAdjusted === true &&
    tims.adjustedHistory.diagnostics?.length > 0;

  const timsFactorOk = (tims.adjustedHistory.diagnostics || []).every((d) => {
    return Math.abs(d.effectiveFactorApplied - d.expectedEffectiveFactor) < 0.0001;
  });

  const timsMetricsReleased =
    tims.adjustedMetrics.splitAdjusted === true &&
    tims.adjustedMetrics.maxDrawdownPercent !== null &&
    tims.adjustedMetrics.cagrPercent !== null &&
    tims.adjustedMetrics.ulcerIndex !== null &&
    tims.adjustedHistory.trustedHistoryDepthScore >= 85;

  const unavailableOk = unavailableMocks.every(
    (m) =>
      m.splitStatus === "splits_unavailable" &&
      m.splitAdjusted === false &&
      m.trustedHistoryDepthScore === 50 &&
      m.metrics.maxDrawdownPercent === null &&
      m.metrics.trajectoryReason === "history_not_split_adjusted"
  );

  return {
    A_raw_long_history_does_not_buy_depth: timsRawOk,
    B_no_events_mock_keeps_series_identical: noEventsMockOk,
    C_confirmed_event_applies_and_logs_factor: timsConfirmedOk && timsFactorOk,
    D_adjusted_series_releases_depth_and_metrics: timsMetricsReleased,
    E_failures_become_splits_unavailable: unavailableOk,
    approved: timsRawOk && noEventsMockOk && timsConfirmedOk && timsFactorOk && timsMetricsReleased && unavailableOk,
  };
}

async function main() {
  console.log("\nNEXO OkaneBox Splits A/B Test v2");
  console.log("Valida: confirmed_events_applied, no_events_reported e splits_unavailable.");
  console.log("Ticker principal com evento real: TIMS3.");
  console.log("Ticker sem evento real/mock: SAPR11.");

  if (!process.env.OKANE_EMAIL) throw new Error('OKANE_EMAIL ausente. Rode: export OKANE_EMAIL="pilla.vinicius@gmail.com"');
  if (!process.env.HG_BRASIL_KEY) throw new Error('HG_BRASIL_KEY ausente. Rode: export HG_BRASIL_KEY="sua-chave"');

  const tims = await runTickerCase("TIMS3");
  const sapr = await runTickerCase("SAPR11", { expectedRealNoEvents: true });
  const rawForMocks = await fetchOkaneDaily("SAPR11", DEFAULT_START, DEFAULT_END, process.env.OKANE_EMAIL);
  const unavailableMocks = runUnavailableMocks(rawForMocks);

  print("Caso TIMS3 real / confirmed_events_applied", tims);
  print("Caso SAPR11 real + mock no_events_reported", sapr);
  print("Mocks de splits_unavailable", unavailableMocks);
  print("Checklist de aceitação A/B v2", acceptanceChecklist(tims, sapr, unavailableMocks));
}

main().catch((err) => {
  console.error("\nERRO:");
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
