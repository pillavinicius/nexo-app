/**
 * NEXO OkaneBox Splits A/B Test v1
 *
 * Objetivo:
 * - Validar, fora do route.js, se o histórico longo nominal da OkaneBox pode ser usado
 *   com segurança no Quant Engine depois de ajuste por splits.
 * - Provar que série longa crua NÃO deve alimentar Max Drawdown/CAGR/Ulcer.
 *
 * Uso:
 *   export OKANE_EMAIL="seu-email-cadastrado"
 *   node nexo_okanebox_splits_ab_test_v1.mjs SAPR11
 *   node nexo_okanebox_splits_ab_test_v1.mjs KLBN11
 */

const OKANE_BASE = "https://www.okanebox.com.br/api";
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

async function fetchText(url, headers = {}) {
  const r = await fetch(url, { cache: "no-store", headers });
  const body = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}: ${body.slice(0, 300)}`);
  return body;
}

async function fetchJson(url, headers = {}) {
  const body = await fetchText(url, headers);
  try { return JSON.parse(body); }
  catch { throw new Error(`Resposta não-JSON em ${url}: ${body.slice(0, 300)}`); }
}

async function fetchOkaneDaily(ticker, startDate, endDate, email) {
  if (!email) throw new Error('OKANE_EMAIL ausente. Rode: export OKANE_EMAIL="seu-email"');
  const url = `${OKANE_BASE}/acoes/hist/${encodeURIComponent(ticker)}/${ymdCompact(startDate)}/${ymdCompact(endDate)}/`;
  const data = await fetchJson(url, {
    Authorization: `Bearer ${email}`,
    Accept: "application/json",
  });
  const arr = Array.isArray(data) ? data
    : Array.isArray(data?.data) ? data.data
    : Array.isArray(data?.results) ? data.results
    : Array.isArray(data?.historico) ? data.historico
    : [];
  return sortCandlesAsc(arr.map((q) => ({
    date: normalizeDate(q.DATPRG),
    open: toNumber(q.PREABE),
    high: toNumber(q.PREMAX),
    low: toNumber(q.PREMIN),
    close: toNumber(q.PREULT),
    volume: toNumber(q.VOLTOT ?? q.QUATOT),
  })).filter((c) => c.date && c.close !== null));
}

/**
 * Fonte manual opcional para splits.
 * Enquanto o endpoint /splits do HG não estiver disponível na chave atual,
 * você pode validar o mecanismo colocando eventos manualmente aqui.
 * Formato: { date: "YYYY-MM-DD", factor: 2, source: "manual_test" }
 */
const MANUAL_SPLITS = {
  // SAPR11: [{ date: "YYYY-MM-DD", factor: 2, source: "manual_test" }],
  // KLBN11: [{ date: "YYYY-MM-DD", factor: 2, source: "manual_test" }],
};

function getManualSplits(ticker) {
  return (MANUAL_SPLITS[String(ticker || "").toUpperCase()] || [])
    .map((s) => ({
      date: normalizeDate(s.date),
      factor: toNumber(s.factor),
      source: s.source || "manual_test",
    }))
    .filter((s) => s.date && s.factor && s.factor > 0);
}

/**
 * Ajuste retroativo:
 * - Para cada split de fator F na data D:
 *   - OHLC anteriores a D são divididos por F.
 *   - volume anterior a D é multiplicado por F.
 */
function applySplitAdjustments(candles = [], splits = []) {
  const validCandles = sortCandlesAsc(candles).filter((c) => c.date && c.close !== null);
  const validSplits = [...splits]
    .filter((s) => s.date && toNumber(s.factor) !== null && toNumber(s.factor) > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  if (!validCandles.length) {
    return { ok: false, splitAdjusted: false, reason: "empty_history", candles: [], splitsApplied: [] };
  }

  if (!validSplits.length) {
    return { ok: false, splitAdjusted: false, reason: "splits_unavailable", candles: validCandles, splitsApplied: [] };
  }

  const adjusted = validCandles.map((c) => {
    let cumulativeFactor = 1;
    for (const s of validSplits) {
      if (String(c.date) < String(s.date)) cumulativeFactor *= Number(s.factor);
    }
    return {
      ...c,
      open: c.open === null ? null : c.open / cumulativeFactor,
      high: c.high === null ? null : c.high / cumulativeFactor,
      low: c.low === null ? null : c.low / cumulativeFactor,
      close: c.close === null ? null : c.close / cumulativeFactor,
      volume: c.volume === null ? null : c.volume * cumulativeFactor,
      adjustmentFactor: cumulativeFactor,
    };
  });

  return { ok: true, splitAdjusted: true, reason: "split_adjusted", candles: adjusted, splitsApplied: validSplits };
}

function maxDrawdown(candles = []) {
  const arr = sortCandlesAsc(candles).filter((c) => c.close !== null);
  if (arr.length < 2) return null;
  let peak = arr[0].close;
  let peakDate = arr[0].date;
  let troughDate = arr[0].date;
  let maxDd = 0;
  for (const c of arr) {
    if (c.close > peak) { peak = c.close; peakDate = c.date; }
    const dd = c.close / peak - 1;
    if (dd < maxDd) { maxDd = dd; troughDate = c.date; }
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
    trajectoryReason: "split_adjusted_history",
    maxDrawdownPercent: dd ? round(dd.percent, 2) : null,
    maxDrawdownPeakDate: dd?.peakDate || null,
    maxDrawdownTroughDate: dd?.troughDate || null,
    cagrPercent: round(cagr(candles), 2),
    ulcerIndex: round(ulcerIndex(candles), 2),
  };
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

function printBlock(label, result) {
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const ticker = String(process.argv[2] || "SAPR11").toUpperCase();
  const start = process.argv[3] || DEFAULT_START;
  const end = process.argv[4] || DEFAULT_END;
  const email = process.env.OKANE_EMAIL;

  console.log(`\nNEXO OkaneBox Splits A/B Test v1`);
  console.log(`Ticker: ${ticker}`);
  console.log(`Período: ${start} até ${end}`);

  const raw = await fetchOkaneDaily(ticker, start, end, email);
  const manualSplits = getManualSplits(ticker);
  const adjustedResult = applySplitAdjustments(raw, manualSplits);

  const rawMetrics = computeTrajectoryMetrics(raw, false);
  const adjustedMetrics = computeTrajectoryMetrics(adjustedResult.candles, adjustedResult.splitAdjusted);

  const summary = {
    ticker,
    period: { start, end },
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
    splitAdjustment: {
      ok: adjustedResult.ok,
      splitAdjusted: adjustedResult.splitAdjusted,
      reason: adjustedResult.reason,
      splitsApplied: adjustedResult.splitsApplied,
      note: adjustedResult.splitAdjusted
        ? "Série ajustada liberada para métricas longas."
        : "Sem splits válidos; métricas longas permanecem null por segurança.",
    },
    adjustedHistory: {
      splitAdjusted: adjustedResult.splitAdjusted,
      candlesCount: adjustedResult.candles.length,
      firstDate: adjustedResult.candles[0]?.date || null,
      lastDate: adjustedResult.candles[adjustedResult.candles.length - 1]?.date || null,
      firstClose: adjustedResult.candles[0]?.close ?? null,
      lastClose: adjustedResult.candles[adjustedResult.candles.length - 1]?.close ?? null,
      trustedHistoryDepthScore: trustedHistoryDepthScore({ candlesCount: adjustedResult.candles.length, splitAdjusted: adjustedResult.splitAdjusted }),
    },
  };

  printBlock("Resumo", summary);
  printBlock("Métricas longas sobre série crua", rawMetrics);
  printBlock("Métricas longas sobre série ajustada", adjustedMetrics);

  console.log(`\nValidação esperada:`);
  console.log(`- Série crua longa: métricas longas = null e reason = history_not_split_adjusted.`);
  console.log(`- Série ajustada sem splits disponíveis: continua bloqueada.`);
  console.log(`- Série ajustada com splits manuais/fonte válida: métricas aparecem e historyDepth pode subir.`);
}
main().catch((err) => {
  console.error("\nERRO:");
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});

