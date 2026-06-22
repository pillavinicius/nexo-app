export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * NEXO Data Core - Asset Route V2.4.5
 *
 * V2.4.5 (fio do risk-free fechado):
 * - Lê data/nexo_macro.csv (gerado pelo coletor offline, commitado no repo)
 * - Passa Selic vigente (BRL) / Fed Funds vigente (USD) ao computeMarketDerived
 *   no lugar do macro=null -> mata o fallback_zero do Sharpe/Sortino.
 * - Expoe nexoMacroRegime no payload (consciencia de ciclo p/ a Claude).
 * - Falha graciosa: sem CSV, volta ao fallback_zero honesto (nao quebra).
 *
 * Arquitetura atual:
 * - Ações BR: HG Brasil
 * - FIIs / ETFs BR: HG Brasil básico + histórico, com Partnr futura
 * - Ações EUA: Twelve Data com quote + time_series + statistics no modo padrão
 * - ETFs EUA: Twelve Data com quote + time_series + etf registry no modo padrão
 *
 * Objetivo desta revisão:
 * - Consolidar as melhorias descobertas no Twelve Data
 * - Reduzir chamadas no plano free
 * - Concentrar cálculos NEXO localmente
 * - Adicionar bloco nexoMethodology para a Claude interpretar os indicadores proprietários
 * - Deixar Partnr pronta como fase futura, sem quebrar o core atual
 * - Adicionar Quant Engine local: Max Drawdown, Recovery, Sharpe, Sortino, CAGR, Ulcer, Calmar e ICR NEXO
 */

const HG_BASE_URL = "https://api.hgbrasil.com/v2/finance";
const TWELVE_BASE_URL = "https://api.twelvedata.com";

/**
 * CORRECAO HISTORICO HG (v2.4.4):
 * O endpoint /history do HG retorna intraday (5min) por padrao, o que
 * limitava o historico a ~63 candles diarios apos agrupamento.
 * Pedindo sample_by=1d + days_ago, trazemos candle diario ja pronto
 * e janela longa o suficiente para SMA200/Sharpe/CAGR terem significancia.
 * Ajuste HISTORY_DAYS_AGO se o teste mostrar poucos candles (teto do plano).
 */
const HG_HISTORY_SAMPLE_BY = "1d";
const HG_HISTORY_DAYS_AGO = 400;

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, decimals = 2) {
  const n = toNumber(value);
  if (n === null) return null;
  return Number(n.toFixed(decimals));
}

function maskKey(url, key) {
  if (!url || !key) return url;
  return url.replaceAll(key, "***");
}

function normalizeTicker(raw) {
  return String(raw || "").trim().toUpperCase().replace(/^B3:/, "");
}

function isB3Ticker(ticker) {
  return /\d/.test(ticker);
}

function isLikelyFiiOrFund(ticker, assetType) {
  const t = String(ticker || "").toUpperCase();
  const type = String(assetType || "").toLowerCase();
  return (
    t.endsWith("11") ||
    type.includes("fii") ||
    type.includes("fundo") ||
    type.includes("fund")
  );
}

function isLikelyB3Etf(assetType) {
  return String(assetType || "").toLowerCase().includes("etf");
}

function buildUrl(base, params) {
  const url = new URL(base);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    ...options,
  });

  const text = await response.text();

  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    json,
    textPreview: text.slice(0, 700),
  };
}

function isErrorPayload(json) {
  if (!json) return true;
  if (json.status === "error") return true;
  if (json.code && Number(json.code) >= 400) return true;
  if (json.error) return true;
  return false;
}

function extractFirstHgResult(json) {
  if (!json) return null;

  if (Array.isArray(json.results)) return json.results[0] || null;

  if (json.results && typeof json.results === "object") {
    const values = Object.values(json.results);
    return values[0] || null;
  }

  return null;
}

function pickLatestByPeriod(statements = [], preferredPeriod = "ttm") {
  if (!Array.isArray(statements) || statements.length === 0) return null;

  const preferred = statements.find(
    (s) => String(s.period_type || "").toLowerCase() === preferredPeriod
  );
  if (preferred) return preferred;

  return statements[0] || null;
}

function pickLatestFY(statements = []) {
  if (!Array.isArray(statements) || statements.length === 0) return null;
  return (
    statements.find(
      (s) =>
        String(s.period_type || "").toLowerCase() === "annual" ||
        String(s.fiscal_period || "").toUpperCase() === "FY"
    ) || null
  );
}

function pickPreviousFY(statements = []) {
  if (!Array.isArray(statements) || statements.length < 2) return null;
  const annuals = statements.filter(
    (s) =>
      String(s.period_type || "").toLowerCase() === "annual" ||
      String(s.fiscal_period || "").toUpperCase() === "FY"
  );
  return annuals[1] || null;
}

function candlesFromTwelve(json) {
  const values = Array.isArray(json?.values) ? json.values : [];
  return values
    .map((v) => ({
      date: String(v.datetime || "").slice(0, 10),
      open: toNumber(v.open),
      high: toNumber(v.high),
      low: toNumber(v.low),
      close: toNumber(v.close),
      volume: toNumber(v.volume),
    }))
    .filter((c) => c.date && c.close !== null)
    .reverse();
}

function groupHgIntradayToDaily(samples = []) {
  const byDate = new Map();

  for (const s of samples || []) {
    const date = String(s.date || s.datetime || "").slice(0, 10);
    if (!date) continue;

    const row = {
      date,
      open: toNumber(s.open),
      high: toNumber(s.high),
      low: toNumber(s.low),
      close: toNumber(s.close),
      volume: toNumber(s.volume),
    };

    if (row.close === null) continue;

    const existing = byDate.get(date);

    if (!existing) {
      byDate.set(date, {
        date,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume || 0,
      });
    } else {
      existing.high =
        existing.high === null
          ? row.high
          : Math.max(existing.high, row.high ?? existing.high);
      existing.low =
        existing.low === null
          ? row.low
          : Math.min(existing.low, row.low ?? existing.low);
      existing.close = row.close;
      existing.volume = (existing.volume || 0) + (row.volume || 0);
    }
  }

  return Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}

function average(values) {
  const nums = values.map(toNumber).filter((v) => v !== null);
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function pct(a, b) {
  const x = toNumber(a);
  const y = toNumber(b);
  if (x === null || y === null || y === 0) return null;
  return ((x - y) / y) * 100;
}

function annualizedVolatility(candles, period = 90) {
  if (!Array.isArray(candles) || candles.length < 3) return null;
  const slice = candles.slice(-period);
  if (slice.length < Math.min(period, 20)) return null;

  const returns = [];
  for (let i = 1; i < slice.length; i++) {
    const prev = slice[i - 1].close;
    const curr = slice[i].close;
    if (prev && curr) returns.push(Math.log(curr / prev));
  }

  if (returns.length < 2) return null;

  const avg = average(returns);
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - avg, 2), 0) /
    (returns.length - 1);

  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}


function computeMaxDrawdownPercent(closes = []) {
  const values = (closes || []).map(toNumber).filter((v) => v !== null && v > 0);
  if (values.length < 2) return null;

  let peak = values[0];
  let maxDrawdown = 0;

  for (const value of values) {
    if (value > peak) peak = value;
    const drawdown = ((value - peak) / peak) * 100;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
  }

  return maxDrawdown;
}

function computeCagrPercent(firstPrice, lastPrice, years) {
  const first = toNumber(firstPrice);
  const last = toNumber(lastPrice);
  const y = toNumber(years);

  if (first === null || last === null || y === null || first <= 0 || last <= 0 || y <= 0) {
    return null;
  }

  return (Math.pow(last / first, 1 / y) - 1) * 100;
}

function computeDailyLogReturns(candles = []) {
  const values = (candles || [])
    .map((c) => toNumber(c?.close))
    .filter((v) => v !== null && v > 0);

  const returns = [];

  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0 && values[i] > 0) {
      returns.push(Math.log(values[i] / values[i - 1]));
    }
  }

  return returns;
}

function computeSharpeRatio(candles = [], riskFreeRateAnnualPercent = 0) {
  const returns = computeDailyLogReturns(candles);
  if (returns.length < 2) return null;

  const avgDailyReturn = average(returns);
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - avgDailyReturn, 2), 0) /
    (returns.length - 1);

  const annualizedReturnPercent = avgDailyReturn * 252 * 100;
  const annualizedVolatilityPercent = Math.sqrt(variance) * Math.sqrt(252) * 100;

  if (!annualizedVolatilityPercent) return null;

  return (annualizedReturnPercent - riskFreeRateAnnualPercent) / annualizedVolatilityPercent;
}

function computeSortinoRatio(candles = [], riskFreeRateAnnualPercent = 0) {
  const returns = computeDailyLogReturns(candles);
  if (returns.length < 2) return null;

  const avgDailyReturn = average(returns);
  const negativeReturns = returns.filter((r) => r < 0);

  if (negativeReturns.length < 1) return null;

  const downsideVariance =
    negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) /
    negativeReturns.length;

  const downsideDeviationPercent = Math.sqrt(downsideVariance) * Math.sqrt(252) * 100;
  const annualizedReturnPercent = avgDailyReturn * 252 * 100;

  if (!downsideDeviationPercent) return null;

  return (annualizedReturnPercent - riskFreeRateAnnualPercent) / downsideDeviationPercent;
}

function computeUlcerIndex(closes = []) {
  const values = (closes || []).map(toNumber).filter((v) => v !== null && v > 0);
  if (values.length < 2) return null;

  let peak = values[0];
  const squaredDrawdowns = [];

  for (const value of values) {
    if (value > peak) peak = value;
    const drawdownPercent = ((value - peak) / peak) * 100;
    squaredDrawdowns.push(drawdownPercent * drawdownPercent);
  }

  return Math.sqrt(
    squaredDrawdowns.reduce((sum, value) => sum + value, 0) /
      squaredDrawdowns.length
  );
}

function computeRecoveryRatio(totalReturnPercent, maxDrawdownPercent) {
  const ret = toNumber(totalReturnPercent);
  const dd = toNumber(maxDrawdownPercent);

  if (ret === null || dd === null || dd === 0) return null;

  return ret / Math.abs(dd);
}

function computeCalmarRatio(cagrPercent, maxDrawdownPercent) {
  const cagr = toNumber(cagrPercent);
  const dd = toNumber(maxDrawdownPercent);

  if (cagr === null || dd === null || dd === 0) return null;

  return cagr / Math.abs(dd);
}

function computeIcrNexoPercent(candles = []) {
  const values = (candles || [])
    .map((c) => toNumber(c?.close))
    .filter((v) => v !== null && v > 0);

  if (values.length < 2) return null;

  const returns = [];

  for (let i = 1; i < values.length; i++) {
    returns.push((values[i] - values[i - 1]) / values[i - 1]);
  }

  if (!returns.length) return null;

  const positivePeriods = returns.filter((r) => r > 0).length;

  return (positivePeriods / returns.length) * 100;
}


function averageCloseSlice(candles = [], start = 0, length = 5) {
  const slice = (candles || [])
    .slice(start, start + length)
    .map((c) => toNumber(c?.close))
    .filter((v) => v !== null && v > 0);

  return average(slice);
}

function computeSmoothedCagrPercent(candles = [], currentPrice = null, years = null, endpointWindow = 5) {
  const valid = (candles || []).filter((c) => {
    const close = toNumber(c?.close);
    return close !== null && close > 0;
  });

  const y = toNumber(years);
  const window = Math.max(1, Math.min(endpointWindow, valid.length || endpointWindow));

  if (!valid.length || y === null || y <= 0) {
    return {
      value: null,
      method: "unavailable",
      startAnchor: null,
      endAnchor: null,
      endpointWindow: window,
    };
  }

  const startAnchor = averageCloseSlice(valid, 0, window);

  const endSlice = valid
    .slice(Math.max(0, valid.length - window))
    .map((c) => toNumber(c?.close))
    .filter((v) => v !== null && v > 0);

  let endAnchor = average(endSlice);

  const current = toNumber(currentPrice);
  if (current !== null && current > 0 && endAnchor !== null) {
    endAnchor = average([endAnchor, current]);
  }

  if (startAnchor === null || endAnchor === null || startAnchor <= 0 || endAnchor <= 0) {
    return {
      value: null,
      method: "unavailable",
      startAnchor,
      endAnchor,
      endpointWindow: window,
    };
  }

  return {
    value: (Math.pow(endAnchor / startAnchor, 1 / y) - 1) * 100,
    method: `smoothed_endpoint_average_${window}_candles`,
    startAnchor,
    endAnchor,
    endpointWindow: window,
  };
}

/* =========================
   NEXO MACRO — leitura do banco macro (v2.4.5)
   Fonte: data/nexo_macro.csv, gerado pelo coletor offline (Cloud Shell) e
   commitado no repo. O app NUNCA executa o coletor; só lê a tabela pronta.
   Devolve a Selic / Fed Funds vigentes (juro_fim do mandato atual) + o regime,
   no formato que o resolveRiskFreeRateAnnualPercent já sabe ler.
   Cache de 1 leitura por cold start. Falha graciosa -> null -> fallback_zero.
========================= */
let _nexoMacroCache;

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        q = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      q = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function buildRegimeView(r) {
  if (!r) return null;
  return {
    gestao: r.gestao || null,
    regime_juro: r.regime_juro || null,
    regime_inflacao: r.regime_inflacao || null,
    regime_credito: r.regime_credito || null,
    regime_cambial: r.regime_cambial || null,
    fase_ciclo: r.fase_ciclo || null,
    data_quality: r.data_quality || null,
  };
}

function loadNexoMacro() {
  if (_nexoMacroCache !== undefined) return _nexoMacroCache;
  try {
    const csv = readFileSync(
      join(process.cwd(), "data", "nexo_macro.csv"),
      "utf8"
    );
    const lines = csv.trim().split("\n");
    const head = lines[0].split(",");
    const rows = lines.slice(1).map((line) => {
      const cells = splitCsvLine(line);
      const row = {};
      head.forEach((h, i) => {
        row[h] = cells[i] ?? "";
      });
      return row;
    });

    // mandato atual de cada país = o de maior data de início (ini)
    const latest = (pais) =>
      rows
        .filter((r) => r.pais === pais)
        .sort((a, b) => String(b.ini).localeCompare(String(a.ini)))[0] || null;

    const br = latest("BR");
    const us = latest("US");
    const n = (v) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : undefined;
    };

    _nexoMacroCache = {
      // campos lidos pelo resolveRiskFreeRateAnnualPercent:
      selicMetaPercent: n(br?.juro_fim), // BRL
      fedFundsPercent: n(us?.juro_fim), // internacional (USD)
      // contexto de ciclo (Marks: consciência de ciclo, não timing):
      regime: {
        br: buildRegimeView(br),
        us: buildRegimeView(us),
      },
      source: "nexo_macro.csv",
    };
  } catch {
    _nexoMacroCache = null; // CSV ausente/ilegível -> fallback_zero honesto
  }
  return _nexoMacroCache;
}

function resolveRiskFreeRateAnnualPercent(currency = "BRL", macro = null) {
  const curr = String(currency || "").toUpperCase();

  const candidatesBR = [
    macro?.riskFreeRateAnnualPercent,
    macro?.riskFreeRatePercent,
    macro?.cdiAnnualPercent,
    macro?.cdiPercent,
    macro?.selicAnnualPercent,
    macro?.selicMetaPercent,
    macro?.selicPercent,
  ];

  const candidatesInternational = [
    macro?.riskFreeRateAnnualPercent,
    macro?.riskFreeRatePercent,
    macro?.tBill3mAnnualPercent,
    macro?.treasury3mAnnualPercent,
    macro?.us3mTreasuryPercent,
    macro?.fedFundsPercent,
  ];

  const candidates = curr === "BRL" ? candidatesBR : candidatesInternational;

  const value = candidates
    .map(toNumber)
    .find((v) => v !== null && Number.isFinite(v) && v >= 0);

  if (value !== undefined) {
    return {
      value,
      source:
        curr === "BRL"
          ? "macro_input_cdi_selic"
          : "macro_input_tbill_or_short_treasury",
      status: "applied_from_macro",
    };
  }

  return {
    value: 0,
    source:
      curr === "BRL"
        ? "fallback_zero_pending_cdi_selic"
        : "fallback_zero_pending_tbill",
    status: "fallback_zero",
  };
}

function computeMarketDerived(candles, currentPrice, currency = "BRL", macro = null) {
  const valid = (candles || []).filter((c) => c.close !== null);
  const count = valid.length;

  if (!count) {
    return {
      ok: false,
      error: "Histórico indisponível ou vazio",
    };
  }

  const first = valid[0];
  const last = valid[count - 1];
  const closes = valid.map((c) => c.close);
  const highs = valid.map((c) => c.high ?? c.close);
  const lows = valid.map((c) => c.low ?? c.close);
  const volumes = valid.map((c) => c.volume).filter((v) => v !== null);
  const avgFinancialVolume = computeAverageFinancialVolume(valid);

  const price = toNumber(currentPrice) ?? last.close;

  const maxPrice = Math.max(...highs);
  const minPrice = Math.min(...lows);

  const maxRow = valid.find((c) => (c.high ?? c.close) === maxPrice);
  const minRow = valid.find((c) => (c.low ?? c.close) === minPrice);

  const sma20 = count >= 20 ? average(closes.slice(-20)) : null;
  const sma50 = count >= 50 ? average(closes.slice(-50)) : null;
  const sma200 = count >= 200 ? average(closes.slice(-200)) : null;

  const closeNDaysAgo = (n) => {
    if (count <= n) return null;
    return valid[count - 1 - n]?.close ?? null;
  };

  const pricePositionPercent =
    maxPrice !== minPrice ? ((price - minPrice) / (maxPrice - minPrice)) * 100 : null;

  const totalReturnPercent = pct(price, first.close);
  const years = count / 252;
  const riskFreeRate = resolveRiskFreeRateAnnualPercent(currency, macro);
  const maxDrawdownPercent = computeMaxDrawdownPercent(closes);
  const smoothedCagr = computeSmoothedCagrPercent(valid, price, years, 5);
  const cagrPercent = smoothedCagr.value;
  const sharpeRatio = computeSharpeRatio(valid, riskFreeRate.value);
  const sortinoRatio = computeSortinoRatio(valid, riskFreeRate.value);
  const ulcerIndex = computeUlcerIndex(closes);
  const recoveryRatio = computeRecoveryRatio(totalReturnPercent, maxDrawdownPercent);
  const calmarRatio = computeCalmarRatio(cagrPercent, maxDrawdownPercent);
  const icrNexoPercent = computeIcrNexoPercent(valid);

  const derived = {
    ok: true,
    period: "available_history",
    candlesCount: count,
    firstDate: first.date,
    lastDate: last.date,
    currentPrice: round(price, 4),
    startPrice: round(first.close, 4),
    maxPrice: round(maxPrice, 4),
    maxDate: maxRow?.date || null,
    minPrice: round(minPrice, 4),
    minDate: minRow?.date || null,
    returnPercent: round(totalReturnPercent, 2),
    drawdownFromHighPercent: round(pct(price, maxPrice), 2),
    amplitudePercent: round(pct(maxPrice, minPrice), 2),
    averageVolume: round(average(volumes), 0),
    averageFinancialVolume: round(avgFinancialVolume, 0),
    explanation:
      "Cálculos derivados automaticamente da série histórica diária normalizada.",
  };

  const derivedAdvanced = {
    ok: true,
    candlesCount: count,
    sma20: round(sma20, 4),
    sma50: round(sma50, 4),
    sma200: round(sma200, 4),
    distanceFromSma20Percent: round(pct(price, sma20), 2),
    distanceFromSma50Percent: round(pct(price, sma50), 2),
    distanceFromSma200Percent: round(pct(price, sma200), 2),
    return30dPercent: round(pct(price, closeNDaysAgo(30)), 2),
    return90dPercent: round(pct(price, closeNDaysAgo(90)), 2),
    return180dPercent: round(pct(price, closeNDaysAgo(180)), 2),
    return1yPercent: round(pct(price, closeNDaysAgo(252)), 2),
    volatility30dAnnualizedPercent: round(annualizedVolatility(valid, 30), 2),
    volatility90dAnnualizedPercent: round(annualizedVolatility(valid, 90), 2),
    volatility1yAnnualizedPercent: round(annualizedVolatility(valid, 252), 2),
    maxDrawdownPercent: round(maxDrawdownPercent, 2),
    recoveryRatio: round(recoveryRatio, 2),
    sharpeRatio: round(sharpeRatio, 2),
    sortinoRatio: round(sortinoRatio, 2),
    cagrPercent: round(cagrPercent, 2),
    cagrMethod: smoothedCagr.method,
    riskFreeRateUsedPercent: round(riskFreeRate.value, 2),
    riskFreeRateSource: riskFreeRate.source,
    riskFreeRateStatus: riskFreeRate.status,
    cagrMethod: smoothedCagr.method,
    cagrStartAnchor: round(smoothedCagr.startAnchor, 4),
    cagrEndAnchor: round(smoothedCagr.endAnchor, 4),
    riskFreeRateUsedPercent: round(riskFreeRate.value, 2),
    riskFreeRateSource: riskFreeRate.source,
    riskFreeRateStatus: riskFreeRate.status,
    ulcerIndex: round(ulcerIndex, 2),
    calmarRatio: round(calmarRatio, 2),
    icrNexoPercent: round(icrNexoPercent, 2),
    note:
      "Métricas avançadas calculadas localmente para reduzir dependência de endpoints pagos.",
  };

  const nexoMetrics = {
    ok: true,
    pricePositionPercent: round(pricePositionPercent, 2),
    distanceFromHighPercent: round(pct(price, maxPrice), 2),
    distanceFromLowPercent: round(pct(price, minPrice), 2),
    historicalAmplitudePercent: round(pct(maxPrice, minPrice), 2),
    momentumPeriodPercent: round(totalReturnPercent, 2),
    averageVolume: round(average(volumes), 0),
    averageFinancialVolume: round(avgFinancialVolume, 0),
    trendVsSma20Percent: derivedAdvanced.distanceFromSma20Percent,
    trendVsSma50Percent: derivedAdvanced.distanceFromSma50Percent,
    trendVsSma200Percent: derivedAdvanced.distanceFromSma200Percent,
    volatility90dAnnualizedPercent:
      derivedAdvanced.volatility90dAnnualizedPercent,
    maxDrawdownPercent: round(maxDrawdownPercent, 2),
    recoveryRatio: round(recoveryRatio, 2),
    sharpeRatio: round(sharpeRatio, 2),
    sortinoRatio: round(sortinoRatio, 2),
    cagrPercent: round(cagrPercent, 2),
    ulcerIndex: round(ulcerIndex, 2),
    calmarRatio: round(calmarRatio, 2),
    icrNexoPercent: round(icrNexoPercent, 2),
    liquidityHint: classifyLiquidityByFinancialVolume(avgFinancialVolume, currency),
    note:
      "Métricas auxiliares para TNH, PIN, GNP, filtros de liquidez e contexto histórico do NEXO.",
  };

  return { derived, derivedAdvanced, nexoMetrics };
}



function computeAverageFinancialVolume(candles = []) {
  const values = (candles || [])
    .map((c) => {
      const close = toNumber(c?.close);
      const volume = toNumber(c?.volume);
      if (close === null || volume === null || close <= 0 || volume < 0) return null;
      return close * volume;
    })
    .filter((v) => v !== null);

  return average(values);
}

function classifyLiquidityByFinancialVolume(avgFinancialVolume, currency = "BRL") {
  const value = toNumber(avgFinancialVolume);
  if (value === null) return "indefinida";

  const curr = String(currency || "").toUpperCase();

  if (curr === "BRL") {
    if (value >= 5_000_000) return "alta";
    if (value >= 300_000) return "média";
    return "baixa";
  }

  if (curr === "USD") {
    if (value >= 10_000_000) return "alta";
    if (value >= 1_000_000) return "média";
    return "baixa";
  }

  if (value >= 5_000_000) return "alta";
  if (value >= 300_000) return "média";
  return "baixa";
}

function buildNexoMethodology(assetContext = {}) {
  return {
    version: "2.2",
    purpose:
      "Bloco metodológico enviado junto com os dados para que a IA interprete corretamente os indicadores proprietários do NEXO, mesmo sem conhecimento prévio do método.",
    assetContext: {
      ticker: assetContext.ticker || null,
      assetType: assetContext.assetType || null,
      route: assetContext.route || null,
      currency: assetContext.currency || null,
    },
    interpretationRules: {
      general:
        "A análise deve separar qualidade econômica do ativo, momento de mercado, risco de trajetória e suficiência de dados. Indicadores quantitativos não são recomendação automática.",
      missingData:
        "Campos nulos devem ser tratados como dado indisponível, não como zero. Para FIIs/ETFs, ausência de demonstrativos no HG Brasil é esperada no modo econômico.",
      periodWarning:
        "Os indicadores derivados usam o histórico disponível no payload. Se candlesCount for inferior a 252, CAGR, Sharpe, Sortino, Calmar e ICR devem ser interpretados como leitura parcial, não como histórico anual completo.",
      negativeRatios:
        "Sharpe, Sortino, Calmar e Recovery negativos indicam retorno negativo no período analisado ou retorno insuficiente para compensar risco/drawdown.",
    },
    hierarchyRule: {
      principle: "Trajetória de preço não é valuation.",
      description:
        "Sharpe, Sortino, Calmar, Ulcer, Max Drawdown, Recovery, ICR e volatilidade descrevem a trajetória histórica do preço. Eles não determinam isoladamente se um ativo está barato, caro, bom ou ruim.",
      decisionHierarchy: [
        "1. Valor econômico e valor intrínseco",
        "2. Qualidade econômica e geração de caixa",
        "3. Estrutura de capital e sobrevivência",
        "4. Narrativa e percepção de mercado",
        "5. Trajetória histórica e risco comportamental",
      ],
      warning:
        "Um ativo pode ter Sharpe baixo e ainda ser uma oportunidade se houver grande desconto econômico e sobrevivência adequada. Um ativo pode ter Sharpe alto e ainda estar caro se o preço estiver acima do valor intrínseco.",
    },
    icrRule: {
      description:
        "ICR NEXO mede consistência direcional da série, não qualidade econômica e não magnitude do retorno.",
      warning:
        "ICR nunca deve ser interpretado isoladamente. Um ativo pode ter muitos dias positivos pequenos e poucos dias negativos grandes, resultando em ICR razoável e retorno ruim.",
      mustCombineWith: [
        "momentumPeriodPercent",
        "cagrPercent",
        "sharpeRatio",
        "sortinoRatio",
        "maxDrawdownPercent",
        "ulcerIndex",
        "retorno acumulado",
      ],
    },
    liquidityRule: {
      description:
        "Liquidez deve priorizar volume financeiro médio, calculado como média de close × volume, e não apenas quantidade negociada.",
      averageFinancialVolume:
        "averageFinancialVolume = média(close × volume) no histórico disponível.",
      brFilter:
        "Para ativos B3, a régua NEXO mínima de triagem é aproximadamente R$ 300.000/dia de volume financeiro médio.",
    },
    riskFreeRule: {
      currentStatus:
        "Na V2.4, Sharpe e Sortino recebem riskFreeRateAnnualPercent via computeMarketDerived. Quando macro não estiver disponível, o payload informa fallback_zero em riskFreeRateStatus.",
      futureRuleBR:
        "No trilho Brasil, o Sharpe Econômico NEXO deve usar CDI/Selic como custo de oportunidade.",
      futureRuleInternational:
        "No trilho internacional, o Sharpe Econômico NEXO deve usar T-Bill curto, Treasury 3M ou proxy equivalente como custo de oportunidade.",
      warning:
        "Quando riskFreeRateStatus for fallback_zero, a IA deve tratar Sharpe/Sortino como preliminares e menos confiáveis, especialmente em ambientes de juros altos.",
    },
    metricsDictionary: {
      pricePositionPercent:
        "Posição do preço atual dentro do intervalo mínimo-máximo do histórico analisado. Escala 0-100. Quanto maior, mais perto da máxima do período.",
      distanceFromHighPercent:
        "Distância percentual do preço atual em relação à máxima do período analisado. Valores negativos indicam queda desde o topo.",
      distanceFromLowPercent:
        "Distância percentual do preço atual em relação à mínima do período analisado. Valores positivos indicam recuperação desde o fundo.",
      historicalAmplitudePercent:
        "Amplitude percentual entre máxima e mínima do período analisado. Mede a largura do intervalo de negociação.",
      momentumPeriodPercent:
        "Retorno percentual entre o primeiro candle disponível e o preço atual. Mede o momentum acumulado do período.",
      volatility90dAnnualizedPercent:
        "Volatilidade anualizada calculada a partir dos retornos diários recentes. Mede intensidade de oscilação.",
      maxDrawdownPercent:
        "Maior queda percentual entre um topo anterior e um fundo posterior dentro da série analisada. Quanto mais negativo, maior o estresse de trajetória.",
      recoveryRatio:
        "Retorno acumulado dividido pelo módulo do máximo drawdown. Mede quanto retorno foi obtido para cada unidade de drawdown sofrida.",
      sharpeRatio:
        "Retorno anualizado excedente dividido pela volatilidade anualizada. Mede eficiência retorno/risco total. Na V2.4 usa a taxa livre de risco recebida no cálculo local; se macro não estiver disponível, o payload sinaliza fallback_zero.",
      sortinoRatio:
        "Retorno anualizado excedente dividido pela volatilidade negativa anualizada. Mede eficiência considerando apenas oscilações negativas.",
      cagrPercent:
        "Taxa composta anualizada estimada por média suavizada dos candles iniciais e finais do histórico disponível. O campo cagrMethod informa o método usado. Deve ser interpretada com cautela quando o histórico tiver menos de 252 candles.",
      ulcerIndex:
        "Índice de dor da trajetória. Mede profundidade e persistência dos drawdowns. Quanto menor, menor a dor do investidor ao longo do caminho.",
      calmarRatio:
        "CAGR dividido pelo módulo do máximo drawdown. Mede retorno composto em relação ao pior drawdown do período.",
      icrNexoPercent:
        "Índice de Consistência de Retorno NEXO. Mede a proporção de períodos diários positivos no histórico analisado. Escala 0-100. Quanto maior, mais consistente foi a trajetória positiva.",
      averageFinancialVolume:
        "Volume financeiro médio do histórico disponível, calculado como média de close × volume. Deve ser usado preferencialmente para filtros de liquidez.",
      liquidityHint:
        "Classificação simples de liquidez baseada no volume financeiro médio. Ajuda a filtrar ativos com risco operacional de entrada/saída.",
    },
    nexoModuleMapping: {
      TNH:
        "Usar pricePositionPercent, distanceFromHighPercent, distanceFromLowPercent, historicalAmplitudePercent e momentumPeriodPercent para avaliar temperatura histórica do preço.",
      PIN:
        "Usar momentumPeriodPercent, maxDrawdownPercent, recoveryRatio e pricePositionPercent para contextualizar narrativa de prêmio, negligência ou punição. O PIN não deve substituir o valor intrínseco.",
      GNP:
        "Usar Sharpe, Sortino, Calmar, Ulcer Index e ICR NEXO para medir a qualidade da trajetória e risco comportamental, sem substituir valuation ou valor intrínseco.",
      RES:
        "Usar maxDrawdownPercent, ulcerIndex, volatility90dAnnualizedPercent, recoveryRatio e liquidityHint para avaliar resiliência de mercado.",
      SEE:
        "Combinar qualidade econômica dos fundamentals com eficiência de trajetória. Uma empresa pode ter SEE forte e momento de mercado fraco.",
      ECS:
        "Usar indicadores de dívida, liquidez, caixa, netDebtToEbitda e dados de balanço/DFC quando disponíveis.",
      IQD:
        "Usar qualidade, completude e consistência dos dados. Penalizar análises quando dados essenciais estiverem ausentes.",
      WACC:
        "O route apenas prepara insumos. O WACC deve ser calculado em motor separado usando taxa livre de risco, prêmio de risco, beta, custo da dívida e estrutura de capital.",
    },
    claudeInstructions:
      "Ao analisar este payload, use os dados numéricos e este dicionário metodológico. Não trate indicadores proprietários como métricas conhecidas externamente; interprete-os conforme as definições fornecidas. Preserve a hierarquia NEXO: trajetória de preço é contexto de risco/comportamento, não valuation. Nunca conclua que um ativo está barato/caro apenas por Sharpe, Sortino, Calmar, Ulcer, Drawdown, Recovery ou ICR. Sempre destaque limitações de dados, principalmente em FIIs, ETFs e ativos sem statements/fundamentals.",
  };
}

function computeGrowth(latest, previous, fields) {
  const result = {};
  for (const field of fields) {
    result[`${field}_growth_percent`] = round(pct(latest?.[field], previous?.[field]), 2);
  }
  return result;
}

function safeDivide(a, b) {
  const x = toNumber(a);
  const y = toNumber(b);
  if (x === null || y === null || y === 0) return null;
  return x / y;
}

/* =========================
   HG BRASIL
========================= */

async function hgFetch(endpoint, params, key) {
  const url = buildUrl(`${HG_BASE_URL}/${endpoint}`, {
    ...params,
    key,
  });

  const result = await fetchJson(url);

  return {
    ...result,
    requestUrl: maskKey(url, key),
  };
}

async function fetchHgQuote(ticker, key) {
  const fullTicker = `B3:${ticker}`;

  /**
   * Mantém fallbacks porque a HG já mudou nomes de rotas em diferentes versões.
   * O route usa a primeira resposta que trouxer results.
   */
  const attempts = [
    {
      endpoint: "quotes",
      params: { tickers: fullTicker },
    },
    {
      endpoint: "stock_price",
      params: { tickers: fullTicker },
    },
    {
      endpoint: "stock_price",
      params: { symbol: fullTicker },
    },
  ];

  const errors = [];

  for (const attempt of attempts) {
    const result = await hgFetch(attempt.endpoint, attempt.params, key);
    const first = extractFirstHgResult(result.json);

    if (result.ok && first) {
      return {
        ok: true,
        source: `HG Brasil Finance - ${attempt.endpoint}`,
        requestUrl: result.requestUrl,
        raw: result.json,
        data: first,
      };
    }

    errors.push({
      endpoint: attempt.endpoint,
      status: result.status,
      message:
        result.json?.message || result.json?.error || result.textPreview || "sem results",
    });
  }

  return {
    ok: false,
    source: "HG Brasil Finance - Quotes",
    error: "Não foi possível obter cotação na HG",
    attempts: errors,
  };
}

function normalizeHgAsset(raw, ticker) {
  if (!raw) {
    return {
      ok: false,
      ticker,
      error: "Quote HG ausente",
    };
  }

  const quote = raw.quote || raw.market || {};
  const market = raw.market || raw.quote || {};
  const classification = raw.classification || {};

  const assetType =
    raw.kind ||
    raw.type ||
    raw.asset_type ||
    classification.kind ||
    classification.type ||
    null;

  const price =
    toNumber(quote.price) ??
    toNumber(quote.close) ??
    toNumber(market.close) ??
    toNumber(raw.price) ??
    toNumber(raw.close);

  return {
    ok: true,
    source: "HG Brasil Finance - Quotes",
    dataProvider: "HG Brasil",
    ticker,
    fullTicker: raw.ticker || `B3:${ticker}`,
    symbol: raw.symbol || ticker,
    name: raw.name || null,
    fullName: raw.full_name || raw.fullName || null,
    taxId: raw.tax_id || null,
    isin: raw.isin || null,
    assetType,
    currency: raw.currency || "BRL",
    unit: raw.unit || "currency",
    sharesOutstanding: toNumber(raw.shares_outstanding),
    sector:
      classification.sector ||
      raw.sector ||
      raw.segment ||
      raw.subsector ||
      null,
    subsector: classification.subsector || raw.subsector || null,
    segment: classification.segment || raw.segment || null,
    price,
    changeValue: toNumber(quote.change) ?? toNumber(quote.change_value),
    changePercent:
      toNumber(quote.change_percent) ??
      toNumber(quote.percent_change) ??
      toNumber(quote.changePercent),
    marketCap: toNumber(raw.market_cap) ?? toNumber(raw.marketCap),
    updatedAt:
      quote.updated_at ||
      market.updated_at ||
      raw.updated_at ||
      raw.updatedAt ||
      null,
    market: {
      isOpen: market.is_open ?? quote.is_open ?? null,
      previousValue:
        toNumber(quote.previous_close) ??
        toNumber(market.previous_close) ??
        toNumber(raw.previous_close),
      open: toNumber(quote.open) ?? toNumber(market.open),
      close: toNumber(quote.close) ?? toNumber(market.close) ?? price,
      high: toNumber(quote.high) ?? toNumber(market.high),
      low: toNumber(quote.low) ?? toNumber(market.low),
      volume:
        toNumber(quote.volume) ??
        toNumber(market.volume) ??
        toNumber(raw.volume),
      updatedAt:
        quote.updated_at ||
        market.updated_at ||
        raw.updated_at ||
        raw.updatedAt ||
        null,
    },
    dividends: {
      yield12mPercent:
        toNumber(raw.dividends?.yield_12m) ??
        toNumber(raw.dividends?.yield12mPercent) ??
        toNumber(raw.dividends?.yield_percent),
      yield12mCash:
        toNumber(raw.dividends?.cash_12m) ??
        toNumber(raw.dividends?.yield_12m_cash) ??
        toNumber(raw.dividends?.yield_currency),
    },
    related: raw.related || [],
    logo: raw.logos?.big || raw.logo || null,
    rawAvailableFields: Object.keys(raw || {}),
  };
}

async function fetchHgFundamentals(ticker, key) {
  const result = await hgFetch(
    "fundamentals",
    { tickers: `B3:${ticker}` },
    key
  );

  const first = extractFirstHgResult(result.json);
  const statement =
    first?.statements?.[0] ||
    first?.statement ||
    first?.fundamentals ||
    first ||
    null;

  const ok = result.ok && statement && Object.keys(statement || {}).length > 0;

  return {
    ok,
    source: "HG Brasil Finance - Fundamentals",
    requestUrl: result.requestUrl,
    raw: first || result.json,
    statement,
    error: ok ? null : result.json?.message || "Fundamentals indisponíveis",
  };
}

function normalizeHgFundamentals(statement) {
  const s = statement || {};
  return {
    ok: !!statement,
    source: "HG Brasil Finance - Fundamentals",
    period: {
      type: s.period_type || null,
      fiscalYear: s.fiscal_year || null,
      fiscalPeriod: s.fiscal_period || null,
      startDate: s.start_date || null,
      endDate: s.end_date || null,
    },
    valuation: s.valuation || {},
    leverage: s.leverage || {},
    margins: s.margins || {},
    profitability: s.profitability || {},
    dividends: s.dividends || {},
    rawStatementKeys: Object.keys(s),
  };
}

async function fetchHgStatement(endpoint, ticker, key, type) {
  const result = await hgFetch(endpoint, { tickers: `B3:${ticker}` }, key);
  const first = extractFirstHgResult(result.json);
  const statements = Array.isArray(first?.statements) ? first.statements : [];
  const ok = result.ok && statements.length > 0;

  return {
    ok,
    source: `HG Brasil Finance - ${endpoint}`,
    requestUrl: result.requestUrl,
    type,
    error: ok ? null : "Statements indisponíveis ou vazios",
    count: statements.length,
    latestTTM: pickLatestByPeriod(statements, "ttm"),
    latestFY: pickLatestFY(statements),
    previousFY: pickPreviousFY(statements),
    statements,
  };
}

async function fetchHgHistory(ticker, key, options = {}) {
  // v2.4.4: pede candle diario (sample_by=1d) com janela longa (days_ago)
  // para superar o limite de ~63 candles do modo intraday padrao.
  const sampleBy = options.historySampleBy || HG_HISTORY_SAMPLE_BY;
  const daysAgo = options.historyDaysAgo || HG_HISTORY_DAYS_AGO;

  const result = await hgFetch(
    "history",
    {
      tickers: `B3:${ticker}`,
      sample_by: sampleBy,
      days_ago: daysAgo,
    },
    key
  );

  const first = extractFirstHgResult(result.json);
  const samples = Array.isArray(first?.samples) ? first.samples : [];

  // groupHgIntradayToDaily continua seguro: com sample_by=1d cada sample
  // ja eh 1 candle/dia, e o agrupamento por data apenas confirma isso.
  const candles = groupHgIntradayToDaily(samples);

  return {
    ok: result.ok && candles.length > 0,
    source: "HG Brasil Finance - History",
    requestUrl: result.requestUrl,
    samplesType: sampleBy === "1d" ? "daily_native" : "intraday_grouped_to_daily",
    sampleBy,
    daysAgo,
    rawSamplesCount: samples.length,
    dailyCandlesCount: candles.length,
    error: candles.length ? null : "Histórico indisponível",
    candles,
  };
}

function keyIndicatorsFromHg(asset, fundamentals) {
  const valuation = fundamentals?.valuation || {};
  const leverage = fundamentals?.leverage || {};
  const profitability = fundamentals?.profitability || {};
  const dividends = fundamentals?.dividends || {};

  return {
    ok: true,
    price: asset?.price ?? null,
    currency: asset?.currency || "BRL",
    marketCap: asset?.marketCap ?? null,
    volume: asset?.market?.volume ?? null,
    dividendYieldPercent:
      asset?.dividends?.yield12mPercent ??
      dividends.yield_percent ??
      dividends.yieldPercent ??
      null,
    dividends12mCash:
      asset?.dividends?.yield12mCash ??
      dividends.yield_currency ??
      dividends.yieldCurrency ??
      null,
    pe: valuation.price_to_earnings_ratio ?? null,
    pb: valuation.price_to_book_ratio ?? null,
    evEbitda: valuation.ev_to_ebitda ?? null,
    evEbit: valuation.ev_to_ebit ?? null,
    priceToEbitda: valuation.price_to_ebitda ?? null,
    priceToFcf: valuation.price_to_free_cash_flow_ratio ?? null,
    eps: valuation.earnings_per_share ?? null,
    bookValuePerShare: valuation.book_value_per_share ?? null,
    roe: profitability.return_on_equity ?? null,
    roa: profitability.return_on_assets ?? null,
    roic: profitability.return_on_invested_capital ?? null,
    roce: profitability.return_on_capital_employed ?? null,
    currentRatio: leverage.current_ratio ?? null,
    debtToEquity: leverage.debt_to_equity_ratio ?? null,
    netDebtToEbitda: leverage.net_debt_to_ebitda_ratio ?? null,
    netDebtToEbit: leverage.net_debt_to_ebit_ratio ?? null,
    note:
      "Indicadores consolidados para uso rápido pelo NEXO. Campos podem ser nulos para FIIs/ETFs.",
  };
}

async function buildB3Asset(ticker, options) {
  const key = process.env.HG_BRASIL_KEY || process.env.HG_API_KEY;
  const errors = [];

  if (!key) {
    return {
      ok: false,
      requestedTicker: ticker,
      route: "B3_HG_BRASIL",
      error: "HG_BRASIL_KEY não encontrada",
    };
  }

  const quoteResult = await fetchHgQuote(ticker, key);

  if (!quoteResult.ok) {
    return {
      ok: false,
      requestedTicker: ticker,
      route: "B3_HG_BRASIL",
      updatedAt: nowIso(),
      error: quoteResult.error,
      details: quoteResult,
    };
  }

  const asset = normalizeHgAsset(quoteResult.data, ticker);
  const assetType = String(asset.assetType || "").toLowerCase();

  const history = await fetchHgHistory(ticker, key, options);
  if (!history.ok && history.error) errors.push(`HG History: ${history.error}`);

  const derivedPackage = computeMarketDerived(history.candles || [], asset.price, asset.currency, loadNexoMacro());

  const shouldFetchCorporateFinancials =
    assetType.includes("stock") ||
    assetType.includes("ação") ||
    assetType.includes("acao") ||
    (!isLikelyFiiOrFund(ticker, assetType) && !isLikelyB3Etf(assetType));

  let fundamentals = {
    ok: false,
    source: "HG Brasil Finance - Fundamentals",
    period: {},
    valuation: {},
    leverage: {},
    margins: {},
    profitability: {},
    dividends: {},
    rawStatementKeys: [],
    error: shouldFetchCorporateFinancials
      ? "Não consultado"
      : "Não aplicável para FII/ETF no modo econômico",
  };

  let financialStatements = {
    ok: false,
    source: "HG Brasil Finance + CVM",
    balanceSheet: {
      ok: false,
      type: "balance_sheet",
      error: shouldFetchCorporateFinancials
        ? "Não consultado"
        : "Não aplicável para FII/ETF no modo econômico",
      count: 0,
      statements: [],
    },
    incomeStatement: {
      ok: false,
      type: "income_statement",
      error: shouldFetchCorporateFinancials
        ? "Não consultado"
        : "Não aplicável para FII/ETF no modo econômico",
      count: 0,
      statements: [],
    },
    cashFlow: {
      ok: false,
      type: "cash_flow",
      error: shouldFetchCorporateFinancials
        ? "Não consultado"
        : "Não aplicável para FII/ETF no modo econômico",
      count: 0,
      statements: [],
    },
  };

  if (shouldFetchCorporateFinancials || options.forceStatements) {
    const fundamentalsRaw = await fetchHgFundamentals(ticker, key);
    if (fundamentalsRaw.ok) {
      fundamentals = normalizeHgFundamentals(fundamentalsRaw.statement);
    } else {
      fundamentals.error = fundamentalsRaw.error;
      errors.push(`HG Fundamentals: ${fundamentalsRaw.error}`);
    }

    const [balanceSheet, incomeStatement, cashFlow] = await Promise.all([
      fetchHgStatement("balance-sheets", ticker, key, "balance_sheet"),
      fetchHgStatement("income-statements", ticker, key, "income_statement"),
      fetchHgStatement("cash-flows", ticker, key, "cash_flow"),
    ]);

    financialStatements = {
      ok: balanceSheet.ok || incomeStatement.ok || cashFlow.ok,
      source: "HG Brasil Finance + CVM",
      balanceSheet,
      incomeStatement,
      cashFlow,
    };

    for (const item of [balanceSheet, incomeStatement, cashFlow]) {
      if (!item.ok && item.error) errors.push(`${item.source}: ${item.error}`);
    }
  }

  const keyIndicators = keyIndicatorsFromHg(asset, fundamentals);

  const nexoFinancialDerived =
    financialStatements?.incomeStatement?.latestFY ||
    financialStatements?.cashFlow?.latestFY
      ? {
          ok: true,
          source: "NEXO local calculations from HG statements",
          growth: {
            incomeFY: computeGrowth(
              financialStatements.incomeStatement.latestFY,
              financialStatements.incomeStatement.previousFY,
              ["revenue", "ebit", "net_income"]
            ),
          },
          cash: {
            operatingCashFlow:
              financialStatements.cashFlow.latestFY?.operating?.total ?? null,
            capex:
              financialStatements.cashFlow.latestFY?.investing
                ?.capital_expenditures ?? null,
            freeCashFlow:
              (financialStatements.cashFlow.latestFY?.operating?.total ?? null) !== null &&
              (financialStatements.cashFlow.latestFY?.investing
                ?.capital_expenditures ?? null) !== null
                ? financialStatements.cashFlow.latestFY.operating.total +
                  financialStatements.cashFlow.latestFY.investing.capital_expenditures
                : null,
            dividendsPaid:
              financialStatements.cashFlow.latestFY?.financing?.dividends_paid ??
              null,
          },
          note:
            "Cálculos locais reduzem chamadas adicionais e preparam insumos para SEE, RES, ECS e futuro WACC.",
        }
      : {
          ok: false,
          reason: "financial_statements_unavailable",
        };

  return {
    ok: true,
    requestedTicker: ticker,
    route: "B3_HG_BRASIL",
    updatedAt: nowIso(),
    priorityRule:
      "Se o usuário informar valor manual, usar manual. Se manual vazio, usar automático. Se automático indisponível, marcar como não informado.",
    asset,
    keyIndicators,
    fundamentals,
    financialStatements,
    history: {
      ok: history.ok,
      source: history.source,
      samplesType: history.samplesType,
      rawSamplesCount: history.rawSamplesCount,
      dailyCandlesCount: history.dailyCandlesCount,
      error: history.error,
    },
    derived: derivedPackage.derived || derivedPackage,
    derivedAdvanced: derivedPackage.derivedAdvanced || null,
    nexoMetrics: derivedPackage.nexoMetrics || null,
    nexoFinancialDerived,
    nexoMethodology: buildNexoMethodology({
      ticker,
      assetType: asset.assetType,
      route: "B3_HG_BRASIL",
      currency: asset.currency,
    }),
    nexoMacroRegime: loadNexoMacro()?.regime || null,
    dataCoverage: {
      route: "B3_HG_BRASIL",
      quotes: !!asset.ok,
      fundamentals: !!fundamentals.ok,
      history: !!history.ok,
      balanceSheet: !!financialStatements.balanceSheet?.ok,
      incomeStatement: !!financialStatements.incomeStatement?.ok,
      cashFlow: !!financialStatements.cashFlow?.ok,
      b3FinancialStatementsComplete:
        !!financialStatements.balanceSheet?.ok &&
        !!financialStatements.incomeStatement?.ok &&
        !!financialStatements.cashFlow?.ok,
      optimizedMode:
        !shouldFetchCorporateFinancials && !options.forceStatements
          ? "FII/ETF B3: statements HG pulados para economizar chamadas"
          : "Ação B3: fundamentals/statements consultados",
      note:
        "FIIs/ETFs B3 recebem dados profundos futuramente via Partnr. Hoje HG cobre preço, histórico, DY e liquidez.",
    },
    manualFallback: false,
    errors,
  };
}

/* =========================
   TWELVE DATA
========================= */

async function twelveFetch(endpoint, params, key) {
  const url = buildUrl(`${TWELVE_BASE_URL}/${endpoint}`, {
    ...params,
    apikey: key,
    format: "JSON",
  });

  const result = await fetchJson(url);

  return {
    ...result,
    requestUrl: maskKey(url, key),
  };
}

function normalizeTwelveQuote(json, ticker) {
  if (!json || isErrorPayload(json)) return null;

  return {
    symbol: json.symbol || ticker,
    name: json.name || ticker,
    exchange: json.exchange || null,
    micCode: json.mic_code || null,
    currency: json.currency || "USD",
    datetime: json.datetime || null,
    timestamp: json.timestamp || null,
    open: toNumber(json.open),
    high: toNumber(json.high),
    low: toNumber(json.low),
    close: toNumber(json.close),
    volume: toNumber(json.volume),
    previousClose: toNumber(json.previous_close),
    changeValue: toNumber(json.change),
    changePercent: toNumber(json.percent_change),
    averageVolume: toNumber(json.average_volume),
    isMarketOpen: json.is_market_open ?? null,
    fiftyTwoWeek: json.fifty_two_week || null,
  };
}

function normalizeTwelveProfile(json) {
  if (!json || isErrorPayload(json)) return null;
  return {
    ok: true,
    symbol: json.symbol || null,
    name: json.name || null,
    sector: json.sector || null,
    industry: json.industry || null,
    employees: toNumber(json.employees),
    website: json.website || null,
    description: json.description || null,
    type: json.type || null,
    CEO: json.CEO || null,
    country: json.country || null,
  };
}

function normalizeTwelveStatistics(json) {
  if (!json || isErrorPayload(json)) return null;
  const stats = json.statistics || {};
  const valuation = stats.valuations_metrics || {};
  const financials = stats.financials || {};
  const income = financials.income_statement || {};
  const balance = financials.balance_sheet || {};
  const cashFlow = financials.cash_flow || {};
  const stockStats = stats.stock_statistics || {};
  const stockPrice = stats.stock_price_summary || {};
  const dividends = stats.dividends_and_splits || {};

  return {
    ok: true,
    source: "Twelve Data - Statistics",
    meta: json.meta || {},
    valuation,
    financials: {
      grossMargin: toNumber(financials.gross_margin),
      profitMargin: toNumber(financials.profit_margin),
      operatingMargin: toNumber(financials.operating_margin),
      returnOnAssetsTtm: toNumber(financials.return_on_assets_ttm),
      returnOnEquityTtm: toNumber(financials.return_on_equity_ttm),
      revenueTtm: toNumber(income.revenue_ttm),
      revenuePerShareTtm: toNumber(income.revenue_per_share_ttm),
      quarterlyRevenueGrowth: toNumber(income.quarterly_revenue_growth),
      grossProfitTtm: toNumber(income.gross_profit_ttm),
      ebitda: toNumber(income.ebitda),
      netIncomeToCommonTtm: toNumber(income.net_income_to_common_ttm),
      dilutedEpsTtm: toNumber(income.diluted_eps_ttm),
      quarterlyEarningsGrowthYoy: toNumber(
        income.quarterly_earnings_growth_yoy
      ),
      totalCashMrq: toNumber(balance.total_cash_mrq),
      totalCashPerShareMrq: toNumber(balance.total_cash_per_share_mrq),
      totalDebtMrq: toNumber(balance.total_debt_mrq),
      totalDebtToEquityMrq: toNumber(balance.total_debt_to_equity_mrq),
      currentRatioMrq: toNumber(balance.current_ratio_mrq),
      bookValuePerShareMrq: toNumber(balance.book_value_per_share_mrq),
      operatingCashFlowTtm: toNumber(cashFlow.operating_cash_flow_ttm),
      leveredFreeCashFlowTtm: toNumber(cashFlow.levered_free_cash_flow_ttm),
    },
    stockStatistics: stockStats,
    stockPriceSummary: stockPrice,
    dividendsAndSplits: dividends,
  };
}

function keyIndicatorsFromTwelve(asset, statistics) {
  const valuation = statistics?.valuation || {};
  const f = statistics?.financials || {};
  const stockPrice = statistics?.stockPriceSummary || {};
  const dividends = statistics?.dividendsAndSplits || {};

  return {
    ok: true,
    price: asset?.price ?? null,
    currency: asset?.currency || "USD",
    marketCap: toNumber(valuation.market_capitalization),
    enterpriseValue: toNumber(valuation.enterprise_value),
    volume: asset?.market?.volume ?? null,
    averageVolume: asset?.market?.averageVolume ?? null,
    dividendYieldPercent:
      toNumber(dividends.trailing_annual_dividend_yield) !== null
        ? toNumber(dividends.trailing_annual_dividend_yield) * 100
        : null,
    forwardDividendYieldPercent:
      toNumber(dividends.forward_annual_dividend_yield) !== null
        ? toNumber(dividends.forward_annual_dividend_yield) * 100
        : null,
    dividends12mCash: toNumber(dividends.trailing_annual_dividend_rate),
    forwardAnnualDividendRate: toNumber(dividends.forward_annual_dividend_rate),
    pe: toNumber(valuation.trailing_pe),
    forwardPe: toNumber(valuation.forward_pe),
    pegRatio: toNumber(valuation.peg_ratio),
    pb: toNumber(valuation.price_to_book_mrq),
    ps: toNumber(valuation.price_to_sales_ttm),
    evRevenue: toNumber(valuation.enterprise_to_revenue),
    evEbitda: toNumber(valuation.enterprise_to_ebitda),
    eps: f.dilutedEpsTtm,
    bookValuePerShare: f.bookValuePerShareMrq,
    grossMargin: f.grossMargin,
    operatingMargin: f.operatingMargin,
    profitMargin: f.profitMargin,
    roe: f.returnOnEquityTtm !== null ? f.returnOnEquityTtm * 100 : null,
    roa: f.returnOnAssetsTtm !== null ? f.returnOnAssetsTtm * 100 : null,
    currentRatio: f.currentRatioMrq,
    debtToEquity: f.totalDebtToEquityMrq,
    beta: toNumber(stockPrice.beta),
    fiftyTwoWeekLow: toNumber(stockPrice.fifty_two_week_low),
    fiftyTwoWeekHigh: toNumber(stockPrice.fifty_two_week_high),
    sma50: toNumber(stockPrice.day_50_ma),
    sma200: toNumber(stockPrice.day_200_ma),
    note:
      "Indicadores internacionais consolidados via Twelve Data Statistics. Para reduzir chamadas, este route usa statistics como fonte principal de fundamentals no modo padrão.",
  };
}

function normalizeTwelveStatements(json, fieldName) {
  if (!json || isErrorPayload(json)) {
    return {
      ok: false,
      count: 0,
      latest: null,
      previous: null,
      statements: [],
      error: json?.message || "Indisponível",
    };
  }

  const rows = Array.isArray(json[fieldName]) ? json[fieldName] : [];

  return {
    ok: rows.length > 0,
    count: rows.length,
    latest: rows[0] || null,
    previous: rows[1] || null,
    statements: rows,
    error: rows.length ? null : "Lista vazia",
  };
}

function extractTwelveDividends(json) {
  if (!json || isErrorPayload(json)) {
    return {
      ok: false,
      count: 0,
      latest: null,
      dividends: [],
      error: json?.message || "Indisponível",
    };
  }

  const rows = Array.isArray(json.dividends) ? json.dividends : [];
  return {
    ok: rows.length > 0,
    count: rows.length,
    latest: rows[0] || null,
    dividends: rows,
  };
}

function normalizeTwelveEtfRegistry(json, ticker) {
  if (!json || isErrorPayload(json)) {
    return {
      ok: false,
      count: 0,
      matches: [],
      preferred: null,
      error: json?.message || "Indisponível",
    };
  }

  const rows = Array.isArray(json.data) ? json.data : [];
  const preferred =
    rows.find(
      (r) =>
        String(r.symbol || "").toUpperCase() === ticker &&
        String(r.country || "").toLowerCase() === "united states" &&
        String(r.currency || "").toUpperCase() === "USD"
    ) ||
    rows.find((r) => String(r.currency || "").toUpperCase() === "USD") ||
    rows[0] ||
    null;

  return {
    ok: rows.length > 0,
    count: rows.length,
    matches: rows,
    preferred,
    note:
      "Endpoint ETF da Twelve Data funciona como registry/cadastro, não como holdings/composição no plano atual.",
  };
}

function computeTwelveFinancialDerived(statistics, statements) {
  const valuation = statistics?.valuation || {};
  const f = statistics?.financials || {};

  const marketCap = toNumber(valuation.market_capitalization);
  const enterpriseValue = toNumber(valuation.enterprise_value);
  const totalDebt = f.totalDebtMrq;
  const totalCash = f.totalCashMrq;
  const ebitda = f.ebitda;
  const fcf = f.leveredFreeCashFlowTtm;
  const ocf = f.operatingCashFlowTtm;
  const netIncome = f.netIncomeToCommonTtm;
  const revenue = f.revenueTtm;

  const netDebt =
    totalDebt !== null && totalCash !== null ? totalDebt - totalCash : null;

  const fcfYieldPercent =
    fcf !== null && marketCap ? (fcf / marketCap) * 100 : null;

  const netDebtToEbitda =
    netDebt !== null && ebitda ? netDebt / ebitda : null;

  const fcfConversion =
    fcf !== null && netIncome ? (fcf / netIncome) * 100 : null;

  const ocfMargin =
    ocf !== null && revenue ? (ocf / revenue) * 100 : null;

  let statementGrowth = null;

  const latestIncome = statements?.incomeStatement?.latest;
  const prevIncome = statements?.incomeStatement?.previous;

  if (latestIncome && prevIncome) {
    statementGrowth = {
      salesGrowthPercent: round(pct(latestIncome.sales, prevIncome.sales), 2),
      ebitdaGrowthPercent: round(pct(latestIncome.ebitda, prevIncome.ebitda), 2),
      ebitGrowthPercent: round(pct(latestIncome.ebit, prevIncome.ebit), 2),
      netIncomeGrowthPercent: round(
        pct(latestIncome.net_income, prevIncome.net_income),
        2
      ),
      epsDilutedGrowthPercent: round(
        pct(latestIncome.eps_diluted, prevIncome.eps_diluted),
        2
      ),
    };
  }

  return {
    ok: !!statistics?.ok,
    source: "NEXO local calculations from Twelve Data",
    capitalStructure: {
      marketCap: round(marketCap, 0),
      enterpriseValue: round(enterpriseValue, 0),
      totalDebt: round(totalDebt, 0),
      totalCash: round(totalCash, 0),
      netDebt: round(netDebt, 0),
      netDebtToEbitda: round(netDebtToEbitda, 2),
    },
    cashGeneration: {
      revenueTtm: round(revenue, 0),
      ebitda: round(ebitda, 0),
      netIncome: round(netIncome, 0),
      operatingCashFlow: round(ocf, 0),
      leveredFreeCashFlow: round(fcf, 0),
      fcfYieldPercent: round(fcfYieldPercent, 2),
      fcfConversionPercent: round(fcfConversion, 2),
      ocfMarginPercent: round(ocfMargin, 2),
    },
    quality: {
      grossMarginPercent:
        f.grossMargin !== null ? round(f.grossMargin * 100, 2) : null,
      operatingMarginPercent:
        f.operatingMargin !== null ? round(f.operatingMargin * 100, 2) : null,
      profitMarginPercent:
        f.profitMargin !== null ? round(f.profitMargin * 100, 2) : null,
      roePercent:
        f.returnOnEquityTtm !== null ? round(f.returnOnEquityTtm * 100, 2) : null,
      roaPercent:
        f.returnOnAssetsTtm !== null ? round(f.returnOnAssetsTtm * 100, 2) : null,
      currentRatio: round(f.currentRatioMrq, 2),
    },
    growth: statementGrowth,
    waccInputs: {
      beta: toNumber(statistics?.stockPriceSummary?.beta),
      marketCap: round(marketCap, 0),
      totalDebt: round(totalDebt, 0),
      totalCash: round(totalCash, 0),
      note:
        "WACC será calculado no NEXO Cost of Capital Engine. Este route apenas prepara os insumos.",
    },
    note:
      "Cálculos locais reduzem chamadas extras e entregam insumos prontos para SEE, ECS, RES, PIJR, DCF e futuro WACC.",
  };
}

async function buildInternationalAsset(ticker, options) {
  const key = process.env.TWELVEDATA_API_KEY;

  if (!key) {
    return {
      ok: false,
      requestedTicker: ticker,
      route: "INTERNATIONAL_TWELVE_DATA",
      error: "TWELVEDATA_API_KEY não encontrada",
    };
  }

  const errors = [];
  const requests = [];

  async function safeTwelve(endpoint, params = {}) {
    const result = await twelveFetch(endpoint, { symbol: ticker, ...params }, key);
    requests.push({
      endpoint,
      status: result.status,
      ok: result.ok && !isErrorPayload(result.json),
      requestUrl: result.requestUrl,
      error:
        result.ok && !isErrorPayload(result.json)
          ? null
          : result.json?.message || result.textPreview || "Erro",
    });
    return result;
  }

  /**
   * MODO ECONÔMICO PADRÃO:
   * - quote: preço, volume, 52 semanas
   * - time_series: histórico para cálculos NEXO
   * - statistics: fundamentals internacionais em uma única chamada
   *
   * profile/statements/dividends entram apenas quando:
   * - deep=true
   * ou quando statistics estiver disponível e o usuário quiser relatório mais completo.
   */
  const quoteResult = await safeTwelve("quote");
  const timeSeriesResult = await safeTwelve("time_series", {
    interval: "1day",
    outputsize: options.outputsize || 250,
  });

  const quote = normalizeTwelveQuote(quoteResult.json, ticker);
  const candles = candlesFromTwelve(timeSeriesResult.json);
  const meta = timeSeriesResult.json?.meta || {};
  const assetType = meta.type || null;
  const isEtf = String(assetType || "").toLowerCase().includes("etf");

  let statistics = null;
  let profile = null;
  let etfRegistry = null;
  let dividends = null;

  let statements = {
    ok: false,
    source: "Twelve Data",
    incomeStatement: {
      ok: false,
      error: "Não consultado no modo econômico",
      count: 0,
      statements: [],
    },
    balanceSheet: {
      ok: false,
      error: "Não consultado no modo econômico",
      count: 0,
      statements: [],
    },
    cashFlow: {
      ok: false,
      error: "Não consultado no modo econômico",
      count: 0,
      statements: [],
    },
  };

  if (!isEtf || options.forceStatistics) {
    const statisticsResult = await safeTwelve("statistics");

    if (statisticsResult.ok && !isErrorPayload(statisticsResult.json)) {
      statistics = normalizeTwelveStatistics(statisticsResult.json);
    } else {
      errors.push(`Twelve statistics: ${statisticsResult.json?.message || "indisponível"}`);
    }
  }

  if (isEtf) {
    const etfResult = await safeTwelve("etf");
    etfRegistry = normalizeTwelveEtfRegistry(etfResult.json, ticker);
    if (!etfRegistry.ok && etfRegistry.error) {
      errors.push(`Twelve ETF registry: ${etfRegistry.error}`);
    }
  }

  if (options.deep && !isEtf) {
    const [profileResult, incomeResult, balanceResult, cashResult, dividendsResult] =
      await Promise.all([
        safeTwelve("profile"),
        safeTwelve("income_statement"),
        safeTwelve("balance_sheet"),
        safeTwelve("cash_flow"),
        safeTwelve("dividends"),
      ]);

    profile = normalizeTwelveProfile(profileResult.json);

    const incomeStatement = normalizeTwelveStatements(
      incomeResult.json,
      "income_statement"
    );
    const balanceSheet = normalizeTwelveStatements(
      balanceResult.json,
      "balance_sheet"
    );
    const cashFlow = normalizeTwelveStatements(cashResult.json, "cash_flow");

    statements = {
      ok: incomeStatement.ok || balanceSheet.ok || cashFlow.ok,
      source: "Twelve Data",
      incomeStatement,
      balanceSheet,
      cashFlow,
    };

    dividends = extractTwelveDividends(dividendsResult.json);

    for (const item of [
      { name: "profile", value: profile },
      { name: "income_statement", value: incomeStatement },
      { name: "balance_sheet", value: balanceSheet },
      { name: "cash_flow", value: cashFlow },
      { name: "dividends", value: dividends },
    ]) {
      if (!item.value?.ok && item.value?.error) {
        errors.push(`Twelve ${item.name}: ${item.value.error}`);
      }
    }
  }

  const price = quote?.close ?? (candles.length ? candles[candles.length - 1].close : null);
  const derivedPackage = computeMarketDerived(candles, price, quote?.currency || "USD", loadNexoMacro());

  const asset = {
    ok: !!quote,
    source: "Twelve Data - Quote + Time Series",
    dataProvider: "Twelve Data",
    ticker,
    fullTicker: ticker,
    symbol: ticker,
    name: quote?.name || ticker,
    fullName: profile?.name || quote?.name || null,
    taxId: null,
    isin: etfRegistry?.preferred?.isin || null,
    assetType: assetType || profile?.type || null,
    currency: quote?.currency || meta.currency || "USD",
    unit: "currency",
    sharesOutstanding: statistics?.stockStatistics?.shares_outstanding ?? null,
    sector: profile?.sector || null,
    subsector: profile?.industry || null,
    segment: null,
    price,
    changeValue: quote?.changeValue ?? null,
    changePercent: quote?.changePercent ?? null,
    marketCap: statistics?.valuation?.market_capitalization ?? null,
    updatedAt: quote?.datetime || null,
    market: {
      isOpen: quote?.isMarketOpen ?? null,
      previousValue: quote?.previousClose ?? null,
      open: quote?.open ?? null,
      close: quote?.close ?? null,
      high: quote?.high ?? null,
      low: quote?.low ?? null,
      volume: quote?.volume ?? null,
      averageVolume: quote?.averageVolume ?? null,
      updatedAt: quote?.datetime || null,
      fiftyTwoWeek: quote?.fiftyTwoWeek || null,
    },
    dividends: {
      yield12mPercent:
        statistics?.dividendsAndSplits?.trailing_annual_dividend_yield !==
          undefined &&
        statistics?.dividendsAndSplits?.trailing_annual_dividend_yield !== null
          ? statistics.dividendsAndSplits.trailing_annual_dividend_yield * 100
          : null,
      yield12mCash:
        statistics?.dividendsAndSplits?.trailing_annual_dividend_rate ?? null,
    },
    international: {
      exchange: quote?.exchange || meta.exchange || null,
      exchangeTimezone: meta.exchange_timezone || null,
      micCode: quote?.micCode || meta.mic_code || null,
      type: assetType || profile?.type || null,
      profileAvailable: !!profile,
      statisticsAvailable: !!statistics,
      etfRegistryAvailable: !!etfRegistry?.ok,
      note: isEtf
        ? "ETF internacional: modo econômico usa quote + time_series + etf registry. Holdings/composição dependem de fonte futura/add-on."
        : "Ação internacional: modo econômico usa quote + time_series + statistics. Use deep=true para DRE/Balanço/DFC completos.",
    },
    related: [],
    logo: null,
    rawAvailableFields: {
      quote: quoteResult.json ? Object.keys(quoteResult.json) : [],
      timeSeriesMeta: meta ? Object.keys(meta) : [],
      statistics: statistics ? Object.keys(statistics) : [],
    },
  };

  const keyIndicators = statistics
    ? keyIndicatorsFromTwelve(asset, statistics)
    : {
        ok: true,
        price,
        currency: asset.currency,
        marketCap: null,
        volume: asset.market.volume,
        dividendYieldPercent: null,
        dividends12mCash: null,
        pe: null,
        pb: null,
        evEbitda: null,
        eps: null,
        beta: null,
        note:
          "Statistics indisponível ou não consultado. Indicadores limitados ao quote/time_series.",
      };

  const nexoFinancialDerived = statistics
    ? computeTwelveFinancialDerived(statistics, statements)
    : {
        ok: false,
        reason: "statistics_unavailable_or_skipped",
      };

  return {
    ok: true,
    requestedTicker: ticker,
    route: "INTERNATIONAL_TWELVE_DATA",
    updatedAt: nowIso(),
    priorityRule:
      "Se o usuário informar valor manual, usar manual. Se manual vazio, usar automático. Se automático indisponível, marcar como não informado.",
    asset,
    keyIndicators,
    profile: profile || {
      ok: false,
      source: "Twelve Data",
      error: options.deep
        ? "Profile indisponível"
        : "Não consultado no modo econômico para economizar créditos",
    },
    fundamentals: statistics || {
      ok: false,
      source: "Twelve Data - Statistics",
      error: isEtf
        ? "Statistics bloqueado/limitado para ETFs no plano atual; usar quote/time_series/etf registry."
        : "Statistics indisponível",
    },
    financialStatements: statements,
    dividends: dividends || {
      ok: false,
      source: "Twelve Data - Dividends",
      error: options.deep
        ? "Dividendos indisponíveis"
        : "Não consultado no modo econômico para economizar créditos",
    },
    etfRegistry: etfRegistry || {
      ok: false,
      source: "Twelve Data - ETF Registry",
      error: isEtf
        ? "ETF registry indisponível"
        : "Não aplicável para ação comum",
    },
    history: {
      ok: candles.length > 0,
      source: "Twelve Data - Time Series",
      samplesType: "daily",
      dailyCandlesCount: candles.length,
      error: candles.length ? null : "Histórico indisponível",
    },
    derived: derivedPackage.derived || derivedPackage,
    derivedAdvanced: derivedPackage.derivedAdvanced || null,
    nexoMetrics: derivedPackage.nexoMetrics || null,
    nexoFinancialDerived,
    nexoMethodology: buildNexoMethodology({
      ticker,
      assetType: asset.assetType,
      route: "INTERNATIONAL_TWELVE_DATA",
      currency: asset.currency,
    }),
    nexoMacroRegime: loadNexoMacro()?.regime || null,
    dataCoverage: {
      route: "INTERNATIONAL_TWELVE_DATA",
      quotes: !!quote,
      profile: !!profile,
      statistics: !!statistics,
      history: candles.length > 0,
      dividends: !!dividends?.ok,
      balanceSheet: !!statements.balanceSheet?.ok,
      incomeStatement: !!statements.incomeStatement?.ok,
      cashFlow: !!statements.cashFlow?.ok,
      etfRegistry: !!etfRegistry?.ok,
      internationalStatementsComplete:
        !!statements.balanceSheet?.ok &&
        !!statements.incomeStatement?.ok &&
        !!statements.cashFlow?.ok,
      optimizedMode: options.deep
        ? "deep=true: chama statements/profile/dividends para ação internacional"
        : isEtf
        ? "ETF free-mode: quote + time_series + etf registry"
        : "Stock free-mode: quote + time_series + statistics",
      callsMade: requests.length,
      note:
        "Modo padrão reduz chamadas para evitar limite free. Use deep=true somente para relatórios completos.",
    },
    apiRequests: requests,
    manualFallback: false,
    errors,
  };
}

/* =========================
   ROUTE
========================= */

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const ticker = normalizeTicker(searchParams.get("ticker") || "");
    const market = String(searchParams.get("market") || "").toLowerCase();

    const deep = searchParams.get("deep") === "true";
    const forceStatements = searchParams.get("forceStatements") === "true";
    const forceStatistics = searchParams.get("forceStatistics") === "true";
    const outputsize = toNumber(searchParams.get("outputsize")) || 250;

    if (!ticker) {
      return Response.json(
        {
          ok: false,
          error: "Informe ticker. Ex: /api/asset?ticker=BBSE3 ou /api/asset?ticker=AAPL",
        },
        { status: 400 }
      );
    }

    const routeIsB3 =
      market === "br" ||
      market === "b3" ||
      (market !== "intl" && market !== "international" && isB3Ticker(ticker));

    const options = {
      deep,
      forceStatements,
      forceStatistics,
      outputsize,
    };

    const data = routeIsB3
      ? await buildB3Asset(ticker, options)
      : await buildInternationalAsset(ticker, options);

    return Response.json(data);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
