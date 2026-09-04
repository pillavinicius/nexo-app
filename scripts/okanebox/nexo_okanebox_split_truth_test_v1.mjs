/**
 * NEXO OkaneBox Split Truth Test v1
 *
 * Pergunta única:
 * - A série histórica da OkaneBox parece crua ou já ajustada/contínua em torno de eventos de split?
 *
 * Este teste NÃO aplica ajuste.
 * Ele apenas observa a série bruta da OkaneBox em torno da com_date dos eventos HG.
 *
 * Uso:
 *   export OKANE_EMAIL="pilla.vinicius@gmail.com"
 *   export HG_BRASIL_KEY="sua-chave-hg"
 *   node nexo_okanebox_split_truth_test_v1.mjs
 *
 * Opcional:
 *   node nexo_okanebox_split_truth_test_v1.mjs TIMS3
 *   node nexo_okanebox_split_truth_test_v1.mjs TIMS3 ENJU3
 */

const OKANE_BASE = "https://www.okanebox.com.br/api";
const HG_BASE = "https://api.hgbrasil.com/v2/finance";
const DEFAULT_START = "2017-01-01";
const DEFAULT_END = new Date().toISOString().slice(0, 10);

const DEFAULT_TICKERS = [
  "TIMS3",
  "MGLU3",
  "AMER3",
  "BHIA3",
  "VAMO3",
  "RAIL3",
  "WEGE3",
  "LREN3",
  "PETR4",
  "VALE3",
  "ITUB4",
  "BBDC4",
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

  if (!r.ok) return { ok: false, httpOk: false, status: r.status, reason: "http_error", data };
  return { ok: true, httpOk: true, status: r.status, reason: "ok", data };
}

async function fetchOkaneDaily(ticker, startDate, endDate, email) {
  if (!email) throw new Error("OKANE_EMAIL ausente.");
  const url = `${OKANE_BASE}/acoes/hist/${encodeURIComponent(ticker)}/${ymdCompact(startDate)}/${ymdCompact(endDate)}/`;

  const response = await fetchJsonStrict(url, {
    Authorization: `Bearer ${email}`,
    Accept: "application/json",
  });

  if (!response.ok) {
    return {
      ok: false,
      reason: response.reason,
      candles: [],
      error: response,
    };
  }

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

  const candles = sortCandlesAsc(
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

  return { ok: true, candles };
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
      ok: false,
      splitStatus: "splits_unavailable",
      reason: response?.reason || "fetch_failed",
      events: [],
      validation: { httpOk: !!response?.httpOk, keyStatusValid: false, eventsIsArray: false },
    };
  }

  const data = response.data;
  const keyStatusValid = data?.metadata?.key_status === "valid";
  const events = data?.results?.[0]?.events;
  const eventsIsArray = Array.isArray(events);

  if (!keyStatusValid || !eventsIsArray) {
    return {
      ok: false,
      splitStatus: "splits_unavailable",
      reason: !keyStatusValid ? "invalid_key_status" : "events_not_array",
      events: [],
      validation: { httpOk: true, keyStatusValid, eventsIsArray },
    };
  }

  const confirmed = events
    .filter((e) => e?.status === "confirmed")
    .map(normalizeHgSplitEvent)
    .filter(Boolean)
    .sort((a, b) => String(a.com_date).localeCompare(String(b.com_date)));

  return {
    ok: true,
    splitStatus: confirmed.length ? "confirmed_events_reported" : "no_events_reported",
    reason: confirmed.length ? "confirmed_events_available" : "valid_response_no_confirmed_events",
    events: confirmed,
    rawEvents: events,
    validation: { httpOk: true, keyStatusValid: true, eventsIsArray: true },
  };
}

async function fetchHgSplits(ticker, key) {
  if (!key) {
    return { ok: false, splitStatus: "splits_unavailable", reason: "missing_hg_key", events: [] };
  }
  const url = `${HG_BASE}/splits?tickers=B3:${encodeURIComponent(ticker)}&key=${encodeURIComponent(key)}`;
  const response = await fetchJsonStrict(url, { Accept: "application/json" });
  return interpretHgSplitsResponse(response);
}

function findLastBefore(candles, date) {
  return [...candles].reverse().find((c) => String(c.date) < String(date) && c.close !== null) || null;
}

function findFirstOnOrAfter(candles, date) {
  return candles.find((c) => String(c.date) >= String(date) && c.close !== null) || null;
}

function findWindow(candles, date, radius = 5) {
  const idx = candles.findIndex((c) => String(c.date) >= String(date));
  if (idx === -1) return [];
  const start = Math.max(0, idx - radius);
  const end = Math.min(candles.length, idx + radius + 1);
  return candles.slice(start, end).map((c) => ({ date: c.date, close: c.close }));
}

function classifyContinuity({ observedRatio, eventRatio }) {
  if (!observedRatio || !eventRatio) {
    return { verdict: "insufficient_data", reason: "missing_ratio" };
  }

  const inverseRatio = 1 / eventRatio;
  const distanceTo1 = Math.abs(Math.log(observedRatio));
  const distanceToEvent = Math.abs(Math.log(observedRatio / eventRatio));
  const distanceToInverse = Math.abs(Math.log(observedRatio / inverseRatio));

  const nearContinuous = distanceTo1 < Math.log(1.25);
  const nearEvent = distanceToEvent < Math.log(1.35);
  const nearInverse = distanceToInverse < Math.log(1.35);

  if (nearContinuous) {
    return {
      verdict: "likely_already_adjusted_or_event_not_reflected",
      reason: "raw_series_continuous_around_com_date",
      distances: {
        toContinuous1x: round(distanceTo1, 6),
        toEventRatio: round(distanceToEvent, 6),
        toInverseRatio: round(distanceToInverse, 6),
      },
    };
  }

  if (nearEvent || nearInverse) {
    return {
      verdict: "likely_raw_needs_adjustment",
      reason: nearEvent ? "observed_jump_matches_event_ratio" : "observed_jump_matches_inverse_event_ratio",
      distances: {
        toContinuous1x: round(distanceTo1, 6),
        toEventRatio: round(distanceToEvent, 6),
        toInverseRatio: round(distanceToInverse, 6),
      },
    };
  }

  return {
    verdict: "event_inconsistent_with_price_series",
    reason: "jump_does_not_match_continuity_or_event_ratio",
    distances: {
      toContinuous1x: round(distanceTo1, 6),
      toEventRatio: round(distanceToEvent, 6),
      toInverseRatio: round(distanceToInverse, 6),
    },
  };
}

function analyzeEventContinuity(ticker, candles, event) {
  const before = findLastBefore(candles, event.com_date);
  const after = findFirstOnOrAfter(candles, event.com_date);
  const observedRatio = before?.close && after?.close ? after.close / before.close : null;
  const classification = classifyContinuity({ observedRatio, eventRatio: event.ratio });

  return {
    ticker,
    event: {
      type: event.type,
      status: event.status,
      ratio: event.ratio,
      factor_from: event.factor_from,
      factor_to: event.factor_to,
      com_date: event.com_date,
      effective_date: event.effective_date,
      note: "Este teste usa com_date como fronteira. effective_date é informativo.",
    },
    beforeComDate: before ? { date: before.date, close: before.close } : null,
    firstOnOrAfterComDate: after ? { date: after.date, close: after.close } : null,
    observedRatioAfterBefore: round(observedRatio, 6),
    expectedEventRatio: event.ratio,
    expectedInverseRatio: round(1 / event.ratio, 6),
    classification,
    localWindowAroundComDate: findWindow(candles, event.com_date, 5),
  };
}

async function analyzeTicker(ticker) {
  const okane = await fetchOkaneDaily(ticker, DEFAULT_START, DEFAULT_END, process.env.OKANE_EMAIL);
  const splits = await fetchHgSplits(ticker, process.env.HG_BRASIL_KEY);

  if (!okane.ok) {
    return { ticker, ok: false, reason: "okane_history_failed", okaneError: okane.error };
  }

  const candles = okane.candles;

  const base = {
    ticker,
    ok: true,
    candlesCount: candles.length,
    firstDate: candles[0]?.date || null,
    lastDate: candles[candles.length - 1]?.date || null,
    firstClose: candles[0]?.close ?? null,
    lastClose: candles[candles.length - 1]?.close ?? null,
    hgSplits: {
      ok: splits.ok,
      splitStatus: splits.splitStatus,
      reason: splits.reason,
      validation: splits.validation,
      confirmedEventsCount: splits.events?.length || 0,
      events: splits.events,
    },
  };

  if (!splits.ok) return { ...base, finalVerdict: "cannot_determine_splits_unavailable" };
  if (!splits.events.length) return { ...base, finalVerdict: "no_events_reported_by_hg" };

  const eventAnalyses = splits.events.map((event) => analyzeEventContinuity(ticker, candles, event));
  const verdicts = eventAnalyses.map((e) => e.classification.verdict);

  let finalVerdict = "mixed_or_inconclusive";
  if (verdicts.every((v) => v === "likely_already_adjusted_or_event_not_reflected")) {
    finalVerdict = "okane_likely_already_adjusted_or_hg_event_not_price_relevant";
  } else if (verdicts.every((v) => v === "likely_raw_needs_adjustment")) {
    finalVerdict = "okane_likely_raw_needs_split_adjustment";
  } else if (verdicts.some((v) => v === "event_inconsistent_with_price_series")) {
    finalVerdict = "event_inconsistent_with_price_series";
  }

  return { ...base, eventAnalyses, finalVerdict };
}

async function findTickersWithHgEvents(candidateTickers) {
  const found = [];
  for (const ticker of candidateTickers) {
    const splits = await fetchHgSplits(ticker, process.env.HG_BRASIL_KEY);
    if (splits.ok && splits.events.length) found.push({ ticker, events: splits.events });
  }
  return found;
}

function print(label, value) {
  console.log(`\\n--- ${label} ---`);
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  console.log("\\nNEXO OkaneBox Split Truth Test v1");
  console.log("Pergunta: a OkaneBox parece crua ou já ajustada/contínua em eventos HG?");
  console.log("Este teste NÃO aplica ajuste; ele só observa continuidade em torno da com_date.");

  if (!process.env.OKANE_EMAIL) throw new Error('OKANE_EMAIL ausente. Rode: export OKANE_EMAIL="pilla.vinicius@gmail.com"');
  if (!process.env.HG_BRASIL_KEY) throw new Error('HG_BRASIL_KEY ausente. Rode: export HG_BRASIL_KEY="sua-chave"');

  const tickersFromArgs = process.argv.slice(2).map((x) => String(x).toUpperCase());
  const tickers = tickersFromArgs.length ? tickersFromArgs : DEFAULT_TICKERS;

  const eventTickers = await findTickersWithHgEvents(tickers);
  print("Tickers com eventos confirmed no HG entre os candidatos", eventTickers);

  const tickersToAnalyze = eventTickers.length ? eventTickers.map((x) => x.ticker) : tickers;
  const results = [];
  for (const ticker of tickersToAnalyze) results.push(await analyzeTicker(ticker));

  print("Análise por ticker", results);

  const summary = {
    analyzedTickers: results.length,
    verdictCounts: results.reduce((acc, r) => {
      const key = r.finalVerdict || "unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    routeImplication:
      "Se a maioria dos eventos reais mostrar série contínua, OkaneBox provavelmente já vem ajustada ou os eventos HG não são relevantes para preço; nesse caso, aplicar splits cegamente é perigoso. Se mostrar saltos compatíveis com ratio/inverso, OkaneBox é crua e precisa de ajuste.",
  };

  print("Resumo final", summary);
}

main().catch((err) => {
  console.error("\\nERRO:");
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
