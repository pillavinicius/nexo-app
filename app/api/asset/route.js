export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * NEXO Asset Route — Data Core V1
 *
 * Fontes:
 * - B3 / Brasil: HG Brasil
 *   - /v2/finance/quotes
 *   - /v2/finance/fundamentals
 *   - /v2/finance/history
 *   - /v2/finance/balance-sheets
 *   - /v2/finance/income-statements
 *   - /v2/finance/cash-flows
 *
 * - Internacional: Twelve Data
 *   - /price
 *   - /time_series
 *
 * Alpha Vantage removido.
 */

function normalizeTicker(raw) {
  return String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
}

function isB3Ticker(ticker) {
  return /^[A-Z]{4}[0-9]{1,2}$/.test(normalizeTicker(ticker));
}

function hgTicker(ticker) {
  const tk = normalizeTicker(ticker);
  return isB3Ticker(tk) ? `B3:${tk}` : tk;
}

function safeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(",", ".").replace("%", ""));
  return Number.isFinite(number) ? number : null;
}

function round(value, decimals = 2) {
  const n = safeNumber(value);
  if (n === null) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

function nowISO() {
  return new Date().toISOString();
}

function isoDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function getPeriodDays(period) {
  const p = String(period || "1y").toLowerCase();
  if (p === "1m") return 30;
  if (p === "3m") return 90;
  if (p === "6m") return 180;
  if (p === "1y") return 365;
  if (p === "2y") return 730;
  if (p === "3y") return 1095;
  if (p === "5y") return 1825;
  return 365;
}

async function fetchJSON(url) {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Resposta não-JSON: " + text.slice(0, 300));
  }

  if (!response.ok) {
    throw new Error(
      "HTTP " +
        response.status +
        ": " +
        (data?.message ||
          data?.error ||
          data?.metadata?.message ||
          data?.status ||
          "erro desconhecido")
    );
  }

  return data;
}

function makeHGUrl(path, ticker, extra = {}) {
  const key = process.env.HG_BRASIL_KEY || "";
  const url = new URL(path, "https://api.hgbrasil.com");

  url.searchParams.set("tickers", hgTicker(ticker));
  if (key) url.searchParams.set("key", key);

  for (const [k, v] of Object.entries(extra)) {
    if (v !== null && v !== undefined && v !== "") {
      url.searchParams.set(k, String(v));
    }
  }

  return url.href;
}

function makeTwelveUrl(path, ticker, extra = {}) {
  const key = process.env.TWELVEDATA_API_KEY || "";
  const url = new URL(path, "https://api.twelvedata.com");

  if (key) url.searchParams.set("apikey", key);

  url.searchParams.set("symbol", normalizeTicker(ticker));
  url.searchParams.set("format", "JSON");

  for (const [k, v] of Object.entries(extra)) {
    if (v !== null && v !== undefined && v !== "") {
      url.searchParams.set(k, String(v));
    }
  }

  return url.href;
}

function firstResult(data) {
  if (Array.isArray(data?.results) && data.results.length > 0) return data.results[0];

  if (data?.results && typeof data.results === "object") {
    const vals = Object.values(data.results);
    if (vals.length > 0) return vals[0];
  }

  return null;
}

async function getHGQuote(ticker) {
  const data = await fetchJSON(makeHGUrl("/v2/finance/quotes", ticker));
  const item = firstResult(data);

  if (!item) {
    return {
      ok: false,
      source: "HG Brasil Finance - Quotes",
      error: "Ticker não encontrado em /v2/finance/quotes",
      metadata: data?.metadata || null,
    };
  }

  return {
    ok: true,
    source: "HG Brasil Finance - Quotes",
    metadata: data?.metadata || null,
    raw: item,
  };
}

async function getHGFundamentals(ticker) {
  try {
    const data = await fetchJSON(
      makeHGUrl("/v2/finance/fundamentals", ticker, { period: "annual" })
    );

    const item = firstResult(data);

    if (!item) {
      return {
        ok: false,
        source: "HG Brasil Finance - Fundamentals",
        error: "Sem resultados",
        metadata: data?.metadata || null,
      };
    }

    return {
      ok: true,
      source: "HG Brasil Finance - Fundamentals",
      metadata: data?.metadata || null,
      raw: item,
    };
  } catch (error) {
    return {
      ok: false,
      source: "HG Brasil Finance - Fundamentals",
      error: error.message,
    };
  }
}

async function getHGHistory(ticker) {
  try {
    const data = await fetchJSON(makeHGUrl("/v2/finance/history", ticker));
    const item = firstResult(data);
    const samples = Array.isArray(item?.samples) ? item.samples : [];

    if (!item || samples.length === 0) {
      return {
        ok: false,
        source: "HG Brasil Finance - History",
        error: "Histórico indisponível ou vazio",
        metadata: data?.metadata || null,
        samples: [],
      };
    }

    return {
      ok: true,
      source: "HG Brasil Finance - History",
      metadata: data?.metadata || null,
      raw: item,
      samples,
    };
  } catch (error) {
    return {
      ok: false,
      source: "HG Brasil Finance - History",
      error: error.message,
      samples: [],
    };
  }
}

async function getHGFinancialStatement(ticker, endpoint, label) {
  try {
    const data = await fetchJSON(makeHGUrl(`/v2/finance/${endpoint}`, ticker));
    const item = firstResult(data);
    const statements = Array.isArray(item?.statements) ? item.statements : [];

    if (!item || statements.length === 0) {
      return {
        ok: false,
        source: `HG Brasil Finance - ${label}`,
        error: "Statements indisponíveis ou vazios",
        metadata: data?.metadata || null,
        statements: [],
        raw: item || null,
      };
    }

    return {
      ok: true,
      source: `HG Brasil Finance - ${label}`,
      metadata: data?.metadata || null,
      raw: item,
      statements,
    };
  } catch (error) {
    return {
      ok: false,
      source: `HG Brasil Finance - ${label}`,
      error: error.message,
      statements: [],
    };
  }
}

async function getTwelvePrice(ticker) {
  try {
    const data = await fetchJSON(
      makeTwelveUrl("/price", ticker, {
        interval: "1day",
      })
    );

    const price = safeNumber(data?.price);

    if (price === null) {
      return {
        ok: false,
        source: "Twelve Data - Price",
        error: data?.message || data?.status || "Preço indisponível",
        raw: data,
      };
    }

    return {
      ok: true,
      source: "Twelve Data - Price",
      price,
      raw: data,
    };
  } catch (error) {
    return {
      ok: false,
      source: "Twelve Data - Price",
      error: error.message,
    };
  }
}

async function getTwelveTimeSeries(ticker, period = "1y") {
  try {
    const days = getPeriodDays(period);
    const start = daysAgoISO(days);
    const end = new Date().toISOString().slice(0, 10);

    const data = await fetchJSON(
      makeTwelveUrl("/time_series", ticker, {
        interval: "1day",
        start_date: start,
        end_date: end,
        outputsize: 5000,
      })
    );

    if (data?.status === "error") {
      return {
        ok: false,
        source: "Twelve Data - Time Series",
        error: data?.message || "Erro Twelve Data",
        raw: data,
        values: [],
      };
    }

    const values = Array.isArray(data?.values) ? data.values : [];

    if (values.length === 0) {
      return {
        ok: false,
        source: "Twelve Data - Time Series",
        error: "Série histórica vazia",
        meta: data?.meta || null,
        raw: data,
        values: [],
      };
    }

    return {
      ok: true,
      source: "Twelve Data - Time Series",
      meta: data?.meta || null,
      values,
      raw: data,
    };
  } catch (error) {
    return {
      ok: false,
      source: "Twelve Data - Time Series",
      error: error.message,
      values: [],
    };
  }
}

function summarizeHGQuote(result, ticker) {
  const item = result?.raw || {};
  const quote = item.quote || {};
  const market = item.market || {};
  const dividends = item.dividends || {};
  const classification = item.classification || {};
  const logos = item.logos || {};

  return {
    ok: !!result?.ok,
    source: result?.source || null,
    dataProvider: "HG Brasil",
    ticker,
    fullTicker: item.ticker || hgTicker(ticker),
    symbol: item.symbol || ticker,
    name: item.name || ticker,
    fullName: item.full_name || null,
    taxId: item.tax_id || null,
    isin: item.isin || null,
    assetType: item.kind || item.type || "unknown",
    currency: item.currency || "BRL",
    unit: item.unit || "currency",
    sharesOutstanding: safeNumber(item.shares_outstanding),
    sector: classification.sector || null,
    subsector: classification.subsector || null,
    segment: classification.segment || null,
    price: safeNumber(quote.value),
    changeValue: safeNumber(quote.change_value),
    changePercent: safeNumber(quote.change_percent),
    marketCap: safeNumber(quote.market_cap),
    updatedAt: quote.updated_at || market.updated_at || nowISO(),
    market: {
      isOpen: market.is_open ?? null,
      previousValue: safeNumber(market.previous_value),
      open: safeNumber(market.open),
      close: safeNumber(market.close),
      high: safeNumber(market.high),
      low: safeNumber(market.low),
      volume: safeNumber(market.volume),
      updatedAt: market.updated_at || null,
    },
    dividends: {
      yield12mPercent: safeNumber(dividends.yield_12m_percent),
      yield12mCash: safeNumber(dividends.yield_12m_cash),
    },
    related: Array.isArray(item.related) ? item.related : [],
    logo: logos.square_large || logos.square_small || null,
    rawAvailableFields: Object.keys(item || {}).slice(0, 100),
  };
}

function summarizeHGFundamentals(result) {
  if (!result?.ok) {
    return {
      ok: false,
      source: result?.source || "HG Brasil Finance - Fundamentals",
      error: result?.error || "Indisponível",
    };
  }

  const raw = result.raw || {};
  const statements = Array.isArray(raw.statements) ? raw.statements : [];
  const st = statements[0] || {};

  return {
    ok: statements.length > 0,
    source: result.source,
    period: {
      type: st.period_type || null,
      fiscalYear: st.fiscal_year || null,
      fiscalPeriod: st.fiscal_period || null,
      startDate: st.start_date || null,
      endDate: st.end_date || null,
    },
    valuation: st.valuation || {},
    leverage: st.leverage || {},
    margins: st.margins || {},
    profitability: st.profitability || {},
    dividends: st.dividends || {},
    rawStatementKeys: Object.keys(st || {}),
  };
}

function pickStatement(statements, kind) {
  const list = Array.isArray(statements) ? statements : [];

  if (kind === "ttm") {
    return list.find((s) => String(s.period_type).toLowerCase() === "ttm") || null;
  }

  if (kind === "latestFY") {
    return (
      list.find(
        (s) =>
          String(s.period_type).toLowerCase() === "annual" ||
          String(s.fiscal_period).toUpperCase() === "FY"
      ) || null
    );
  }

  if (kind === "previousFY") {
    const annuals = list.filter(
      (s) =>
        String(s.period_type).toLowerCase() === "annual" ||
        String(s.fiscal_period).toUpperCase() === "FY"
    );
    return annuals[1] || null;
  }

  return null;
}

function summarizeStatementBlock(result, type) {
  const statements = Array.isArray(result?.statements) ? result.statements : [];

  return {
    ok: !!result?.ok,
    source: result?.source || null,
    type,
    error: result?.error || null,
    count: statements.length,
    latestTTM: pickStatement(statements, "ttm"),
    latestFY: pickStatement(statements, "latestFY"),
    previousFY: pickStatement(statements, "previousFY"),
    statements,
  };
}

function buildFinancialStatements(balanceSheet, incomeStatement, cashFlow) {
  return {
    ok: !!(balanceSheet?.ok || incomeStatement?.ok || cashFlow?.ok),
    source: "HG Brasil Finance + CVM",
    balanceSheet: summarizeStatementBlock(balanceSheet, "balance_sheet"),
    incomeStatement: summarizeStatementBlock(incomeStatement, "income_statement"),
    cashFlow: summarizeStatementBlock(cashFlow, "cash_flow"),
  };
}

function buildKeyIndicators(asset, fundamentals) {
  const valuation = fundamentals?.valuation || {};
  const leverage = fundamentals?.leverage || {};
  const profitability = fundamentals?.profitability || {};
  const dividends = fundamentals?.dividends || {};

  const dividendYield =
    safeNumber(asset?.dividends?.yield12mPercent) ??
    safeNumber(dividends?.yield_percent);

  return {
    ok: !!(asset?.ok || fundamentals?.ok),
    price: safeNumber(asset?.price),
    currency: asset?.currency || null,
    marketCap: safeNumber(asset?.marketCap),
    volume: safeNumber(asset?.market?.volume),
    dividendYieldPercent: dividendYield,
    dividends12mCash: safeNumber(asset?.dividends?.yield12mCash),
    pe: safeNumber(valuation.price_to_earnings_ratio),
    pb: safeNumber(valuation.price_to_book_ratio),
    evEbitda: safeNumber(valuation.ev_to_ebitda),
    evEbit: safeNumber(valuation.ev_to_ebit),
    priceToEbitda: safeNumber(valuation.price_to_ebitda),
    priceToFcf: safeNumber(valuation.price_to_free_cash_flow_ratio),
    eps: safeNumber(valuation.earnings_per_share),
    bookValuePerShare: safeNumber(valuation.book_value_per_share),
    roe: safeNumber(profitability.return_on_equity),
    roa: safeNumber(profitability.return_on_assets),
    roic: safeNumber(profitability.return_on_invested_capital),
    roce: safeNumber(profitability.return_on_capital_employed),
    currentRatio: safeNumber(leverage.current_ratio),
    debtToEquity: safeNumber(leverage.debt_to_equity_ratio),
    netDebtToEbitda: safeNumber(leverage.net_debt_to_ebitda_ratio),
    netDebtToEbit: safeNumber(leverage.net_debt_to_ebit_ratio),
    note:
      "Indicadores consolidados para uso rápido pelo NEXO. Alguns campos podem ser nulos para FIIs, ETFs e ativos internacionais no plano atual.",
  };
}

function groupIntradaySamplesByDay(samples) {
  const map = new Map();

  for (const s of samples || []) {
    const date = isoDateOnly(s.date);
    if (!date) continue;

    const open = safeNumber(s.open);
    const close = safeNumber(s.close);
    const high = safeNumber(s.high);
    const low = safeNumber(s.low);
    const volume = safeNumber(s.volume) || 0;

    if (open === null && close === null && high === null && low === null) continue;

    if (!map.has(date)) {
      map.set(date, { date, open, close, high, low, volume });
      continue;
    }

    const day = map.get(date);
    if (day.open === null && open !== null) day.open = open;
    day.close = close !== null ? close : day.close;
    day.high = day.high == null ? high : high == null ? day.high : Math.max(day.high, high);
    day.low = day.low == null ? low : low == null ? day.low : Math.min(day.low, low);
    day.volume += volume;
  }

  return Array.from(map.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function normalizeTwelveCandles(values) {
  return (values || [])
    .map((v) => ({
      date: isoDateOnly(v.datetime),
      open: safeNumber(v.open),
      close: safeNumber(v.close),
      high: safeNumber(v.high),
      low: safeNumber(v.low),
      volume: safeNumber(v.volume) || 0,
    }))
    .filter((v) => v.date && (v.open !== null || v.close !== null || v.high !== null || v.low !== null))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function calculateDerivedFromDailyCandles(candles, currentPrice, period = "1y") {
  const clean = (candles || [])
    .filter((c) => c?.date && (safeNumber(c.high) !== null || safeNumber(c.low) !== null || safeNumber(c.close) !== null))
    .map((c) => ({
      date: c.date,
      open: safeNumber(c.open),
      close: safeNumber(c.close),
      high: safeNumber(c.high),
      low: safeNumber(c.low),
      volume: safeNumber(c.volume) || 0,
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  if (clean.length === 0) {
    return { ok: false, period, error: "Sem candles suficientes para cálculo" };
  }

  const first = clean[0];
  const last = clean[clean.length - 1];
  let maxPrice = null, maxDate = null, minPrice = null, minDate = null;
  let volumeSum = 0, volumeCount = 0;

  for (const c of clean) {
    const h = safeNumber(c.high) ?? safeNumber(c.close);
    const l = safeNumber(c.low) ?? safeNumber(c.close);

    if (h !== null && (maxPrice === null || h > maxPrice)) { maxPrice = h; maxDate = c.date; }
    if (l !== null && (minPrice === null || l < minPrice)) { minPrice = l; minDate = c.date; }

    const v = safeNumber(c.volume);
    if (v !== null && v > 0) { volumeSum += v; volumeCount += 1; }
  }

  const startPrice = safeNumber(first.open) ?? safeNumber(first.close) ?? safeNumber(first.low) ?? safeNumber(first.high);
  const lastPrice = safeNumber(currentPrice) ?? safeNumber(last.close) ?? safeNumber(last.open) ?? safeNumber(last.low) ?? safeNumber(last.high);

  return {
    ok: true,
    period,
    candlesCount: clean.length,
    firstDate: first.date,
    lastDate: last.date,
    currentPrice: round(lastPrice, 4),
    startPrice: round(startPrice, 4),
    maxPrice: round(maxPrice, 4),
    maxDate,
    minPrice: round(minPrice, 4),
    minDate,
    returnPercent: startPrice && lastPrice !== null ? round((lastPrice / startPrice - 1) * 100, 2) : null,
    drawdownFromHighPercent: maxPrice && lastPrice !== null ? round((lastPrice / maxPrice - 1) * 100, 2) : null,
    amplitudePercent: maxPrice && minPrice ? round((maxPrice / minPrice - 1) * 100, 2) : null,
    averageVolume: volumeCount > 0 ? Math.round(volumeSum / volumeCount) : null,
    explanation: "Cálculos derivados automaticamente da série histórica diária. Para B3, os candles intradiários da HG foram agrupados por dia antes do cálculo.",
  };
}

function simpleMovingAverage(candles, days) {
  const clean = (candles || []).filter((c) => safeNumber(c.close) !== null);
  if (clean.length < days) return null;
  const slice = clean.slice(-days);
  return slice.reduce((acc, c) => acc + safeNumber(c.close), 0) / days;
}

function returnOverDays(candles, days, currentPrice) {
  const clean = (candles || []).filter((c) => safeNumber(c.close) !== null);
  if (clean.length < days + 1) return null;
  const base = safeNumber(clean[clean.length - 1 - days]?.close);
  const last = safeNumber(currentPrice) ?? safeNumber(clean[clean.length - 1]?.close);
  if (base === null || base === 0 || last === null) return null;
  return (last / base - 1) * 100;
}

function volatilityAnnualized(candles, days) {
  const clean = (candles || []).filter((c) => safeNumber(c.close) !== null);
  if (clean.length < days + 1) return null;
  const slice = clean.slice(-(days + 1));
  const returns = [];
  for (let i = 1; i < slice.length; i++) {
    const prev = safeNumber(slice[i - 1].close);
    const curr = safeNumber(slice[i].close);
    if (prev && curr) returns.push(Math.log(curr / prev));
  }
  if (returns.length < 2) return null;
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((acc, r) => acc + Math.pow(r - avg, 2), 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function calculateDerivedAdvanced(candles, currentPrice) {
  const clean = (candles || [])
    .filter((c) => c?.date && safeNumber(c.close) !== null)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  if (clean.length === 0) {
    return { ok: false, error: "Sem candles suficientes para métricas avançadas" };
  }

  const price = safeNumber(currentPrice) ?? safeNumber(clean[clean.length - 1]?.close);
  const sma20 = simpleMovingAverage(clean, 20);
  const sma50 = simpleMovingAverage(clean, 50);
  const sma200 = simpleMovingAverage(clean, 200);

  function distanceFrom(value) {
    if (price === null || value === null || value === 0) return null;
    return (price / value - 1) * 100;
  }

  return {
    ok: true,
    candlesCount: clean.length,
    sma20: round(sma20, 4),
    sma50: round(sma50, 4),
    sma200: round(sma200, 4),
    distanceFromSma20Percent: round(distanceFrom(sma20), 2),
    distanceFromSma50Percent: round(distanceFrom(sma50), 2),
    distanceFromSma200Percent: round(distanceFrom(sma200), 2),
    return30dPercent: round(returnOverDays(clean, 21, price), 2),
    return90dPercent: round(returnOverDays(clean, 63, price), 2),
    return180dPercent: round(returnOverDays(clean, 126, price), 2),
    return1yPercent: round(returnOverDays(clean, 252, price), 2),
    volatility30dAnnualizedPercent: round(volatilityAnnualized(clean, 21), 2),
    volatility90dAnnualizedPercent: round(volatilityAnnualized(clean, 63), 2),
    volatility1yAnnualizedPercent: round(volatilityAnnualized(clean, 252), 2),
    note: "Métricas avançadas calculadas localmente a partir de candles diários. Campos podem ser nulos quando a série histórica disponível for curta.",
  };
}

function buildNexoMetrics(asset, derived, derivedAdvanced) {
  const price = safeNumber(asset?.price);
  const max = safeNumber(derived?.maxPrice);
  const min = safeNumber(derived?.minPrice);
  let pricePositionPercent = null;
  if (price !== null && max !== null && min !== null && max !== min) {
    pricePositionPercent = ((price - min) / (max - min)) * 100;
  }
  return {
    ok: !!(asset?.ok && derived?.ok),
    pricePositionPercent: round(pricePositionPercent, 2),
    distanceFromHighPercent: round(derived?.drawdownFromHighPercent, 2),
    distanceFromLowPercent: price !== null && min !== null && min !== 0 ? round((price / min - 1) * 100, 2) : null,
    historicalAmplitudePercent: round(derived?.amplitudePercent, 2),
    momentumPeriodPercent: round(derived?.returnPercent, 2),
    averageVolume: safeNumber(derived?.averageVolume),
    trendVsSma20Percent: derivedAdvanced?.distanceFromSma20Percent ?? null,
    trendVsSma50Percent: derivedAdvanced?.distanceFromSma50Percent ?? null,
    trendVsSma200Percent: derivedAdvanced?.distanceFromSma200Percent ?? null,
    volatility90dAnnualizedPercent: derivedAdvanced?.volatility90dAnnualizedPercent ?? null,
    liquidityHint: safeNumber(derived?.averageVolume) === null ? "indisponível" : safeNumber(derived.averageVolume) >= 1000000 ? "alta" : safeNumber(derived.averageVolume) >= 300000 ? "média" : "baixa",
    note: "Métricas auxiliares para TNH, PIN, GNP, filtros de liquidez e contexto histórico do NEXO.",
  };
}

function summarizeTwelveAsset(ticker, priceResult, timeSeriesResult) {
  const meta = timeSeriesResult?.meta || {};
  const values = normalizeTwelveCandles(timeSeriesResult?.values || []);
  const last = values[values.length - 1] || null;
  const currentPrice = safeNumber(priceResult?.price) ?? safeNumber(last?.close) ?? safeNumber(last?.open);
  return {
    ok: !!(priceResult?.ok || timeSeriesResult?.ok),
    source: [priceResult?.ok ? priceResult.source : null, timeSeriesResult?.ok ? timeSeriesResult.source : null].filter(Boolean).join(" + "),
    dataProvider: "Twelve Data",
    ticker,
    fullTicker: ticker,
    symbol: ticker,
    name: meta?.symbol || ticker,
    fullName: null,
    taxId: null,
    isin: null,
    assetType: meta?.type || "international_asset",
    currency: meta?.currency || "USD",
    unit: "currency",
    sharesOutstanding: null,
    sector: null,
    subsector: null,
    segment: null,
    price: currentPrice,
    changeValue: null,
    changePercent: null,
    marketCap: null,
    updatedAt: last?.date || nowISO(),
    market: {
      isOpen: null,
      previousValue: null,
      open: safeNumber(last?.open),
      close: safeNumber(last?.close),
      high: safeNumber(last?.high),
      low: safeNumber(last?.low),
      volume: safeNumber(last?.volume),
      updatedAt: last?.date || null,
    },
    dividends: { yield12mPercent: null, yield12mCash: null },
    international: {
      exchange: meta?.exchange || null,
      exchangeTimezone: meta?.exchange_timezone || null,
      micCode: meta?.mic_code || null,
      type: meta?.type || null,
      note: "Plano gratuito Twelve Data: fundamentos contábeis, profile/statistics, press releases e holdings ficam para fase futura.",
    },
    related: [],
    logo: null,
    rawAvailableFields: {
      price: priceResult?.raw ? Object.keys(priceResult.raw).slice(0, 40) : [],
      timeSeriesMeta: Object.keys(meta || {}).slice(0, 40),
    },
  };
}

function buildDataCoverage({ asset, fundamentals, historyOk, balanceSheet, incomeStatement, cashFlow, route }) {
  return {
    route,
    quotes: !!asset?.ok,
    fundamentals: !!fundamentals?.ok,
    history: !!historyOk,
    balanceSheet: !!balanceSheet?.ok,
    incomeStatement: !!incomeStatement?.ok,
    cashFlow: !!cashFlow?.ok,
    b3FinancialStatementsComplete: !!(balanceSheet?.ok && incomeStatement?.ok && cashFlow?.ok),
    note: "Cobertura real do payload. FIIs/ETFs B3 e ativos internacionais podem ter statements vazios sem caracterizar erro.",
  };
}

async function handleB3Asset(ticker, period, includeRaw) {
  const errors = [];
  let quote = null;
  try {
    quote = await getHGQuote(ticker);
    if (!quote.ok) errors.push("HG Quote: " + quote.error);
  } catch (error) {
    errors.push("HG Quote: " + error.message);
  }

  const [fundamentalsRaw, historyRaw, balanceSheetRaw, incomeStatementRaw, cashFlowRaw] = await Promise.all([
    getHGFundamentals(ticker),
    getHGHistory(ticker),
    getHGFinancialStatement(ticker, "balance-sheets", "Balance Sheets"),
    getHGFinancialStatement(ticker, "income-statements", "Income Statements"),
    getHGFinancialStatement(ticker, "cash-flows", "Cash Flows"),
  ]);

  for (const item of [fundamentalsRaw, historyRaw, balanceSheetRaw, incomeStatementRaw, cashFlowRaw]) {
    if (item?.error) errors.push(`${item.source}: ${item.error}`);
  }

  const asset = quote?.ok ? summarizeHGQuote(quote, ticker) : { ok: false, source: "manual", dataProvider: "manual", ticker, error: "Dados automáticos indisponíveis", manualFallback: true };
  const fundamentals = summarizeHGFundamentals(fundamentalsRaw);
  const keyIndicators = buildKeyIndicators(asset, fundamentals);
  const dailyCandles = historyRaw?.ok ? groupIntradaySamplesByDay(historyRaw.samples) : [];
  const derived = calculateDerivedFromDailyCandles(dailyCandles, asset?.price, period);
  const derivedAdvanced = calculateDerivedAdvanced(dailyCandles, asset?.price);
  const nexoMetrics = buildNexoMetrics(asset, derived, derivedAdvanced);
  const financialStatements = buildFinancialStatements(balanceSheetRaw, incomeStatementRaw, cashFlowRaw);
  const dataCoverage = buildDataCoverage({ asset, fundamentals, historyOk: historyRaw?.ok, balanceSheet: balanceSheetRaw, incomeStatement: incomeStatementRaw, cashFlow: cashFlowRaw, route: "B3_HG_BRASIL" });

  return Response.json({
    ok: true,
    requestedTicker: ticker,
    route: "B3_HG_BRASIL",
    updatedAt: nowISO(),
    priorityRule: "Se o usuário informar valor manual, usar o manual. Se manual vazio, usar automático. Se automático indisponível, marcar como não informado.",
    asset,
    keyIndicators,
    fundamentals,
    financialStatements,
    history: {
      ok: !!historyRaw?.ok,
      source: historyRaw?.source || "HG Brasil Finance - History",
      samplesType: historyRaw?.ok ? "intraday_15min_grouped_to_daily" : null,
      rawSamplesCount: Array.isArray(historyRaw?.samples) ? historyRaw.samples.length : 0,
      dailyCandlesCount: dailyCandles.length,
      error: historyRaw?.error || null,
    },
    derived,
    derivedAdvanced,
    nexoMetrics,
    dataCoverage,
    manualFallback: !asset.ok,
    errors,
    raw: includeRaw ? { quote: quote?.raw || null, fundamentals: fundamentalsRaw?.raw || null, balanceSheet: balanceSheetRaw?.raw || null, incomeStatement: incomeStatementRaw?.raw || null, cashFlow: cashFlowRaw?.raw || null, history: historyRaw?.raw || null, dailyCandles } : undefined,
  });
}

async function handleInternationalAsset(ticker, period, includeRaw) {
  const errors = [];
  const [priceResult, timeSeriesResult] = await Promise.all([getTwelvePrice(ticker), getTwelveTimeSeries(ticker, period)]);
  if (priceResult?.error) errors.push("Twelve Price: " + priceResult.error);
  if (timeSeriesResult?.error) errors.push("Twelve Time Series: " + timeSeriesResult.error);

  const asset = priceResult?.ok || timeSeriesResult?.ok ? summarizeTwelveAsset(ticker, priceResult, timeSeriesResult) : { ok: false, source: "manual", dataProvider: "manual", ticker, error: "Dados automáticos internacionais indisponíveis", manualFallback: true };
  const dailyCandles = timeSeriesResult?.ok ? normalizeTwelveCandles(timeSeriesResult.values) : [];
  const derived = calculateDerivedFromDailyCandles(dailyCandles, asset?.price, period);
  const derivedAdvanced = calculateDerivedAdvanced(dailyCandles, asset?.price);
  const nexoMetrics = buildNexoMetrics(asset, derived, derivedAdvanced);

  const fundamentals = { ok: false, source: "Twelve Data", error: "Fundamentos contábeis, profile/statistics, press releases e holdings ficam para fase futura.", futureEndpoints: ["profile", "statistics", "income_statement", "balance_sheet", "cash_flow", "press_releases", "etf"] };
  const financialStatements = {
    ok: false,
    source: "Twelve Data",
    balanceSheet: { ok: false, type: "balance_sheet", error: "Fase futura", count: 0, latestTTM: null, latestFY: null, previousFY: null, statements: [] },
    incomeStatement: { ok: false, type: "income_statement", error: "Fase futura", count: 0, latestTTM: null, latestFY: null, previousFY: null, statements: [] },
    cashFlow: { ok: false, type: "cash_flow", error: "Fase futura", count: 0, latestTTM: null, latestFY: null, previousFY: null, statements: [] },
  };
  const keyIndicators = buildKeyIndicators(asset, fundamentals);
  const dataCoverage = buildDataCoverage({ asset, fundamentals, historyOk: timeSeriesResult?.ok, balanceSheet: null, incomeStatement: null, cashFlow: null, route: "INTERNATIONAL_TWELVE_DATA" });

  return Response.json({
    ok: true,
    requestedTicker: ticker,
    route: "INTERNATIONAL_TWELVE_DATA",
    updatedAt: nowISO(),
    priorityRule: "Se o usuário informar valor manual, usar o manual. Se manual vazio, usar automático. Se automático indisponível, marcar como não informado.",
    asset,
    keyIndicators,
    fundamentals,
    financialStatements,
    history: { ok: !!timeSeriesResult?.ok, source: timeSeriesResult?.source || "Twelve Data - Time Series", samplesType: "daily", dailyCandlesCount: dailyCandles.length, error: timeSeriesResult?.error || null },
    derived,
    derivedAdvanced,
    nexoMetrics,
    dataCoverage,
    manualFallback: !asset.ok,
    errors,
    raw: includeRaw ? { price: priceResult?.raw || null, timeSeries: timeSeriesResult?.raw || null, dailyCandles } : undefined,
  });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = normalizeTicker(searchParams.get("ticker"));
    const period = String(searchParams.get("period") || "1y").toLowerCase();
    const includeRaw = searchParams.get("raw") === "1";

    if (!ticker) {
      return Response.json(
        {
          ok: false,
          error: "Informe o ticker em /api/asset?ticker=BBSE3",
          examples: [
            "/api/asset?ticker=BBSE3",
            "/api/asset?ticker=GGRC11",
            "/api/asset?ticker=BOVA11",
            "/api/asset?ticker=XLE",
            "/api/asset?ticker=VOO",
            "/api/asset?ticker=AAPL",
            "/api/asset?ticker=BBSE3&period=3m",
            "/api/asset?ticker=BBSE3&raw=1",
          ],
          manualFallback: true,
        },
        { status: 400 }
      );
    }

    if (isB3Ticker(ticker)) return await handleB3Asset(ticker, period, includeRaw);
    return await handleInternationalAsset(ticker, period, includeRaw);
  } catch (error) {
    return Response.json({ ok: false, error: error.message, manualFallback: true }, { status: 500 });
  }
}
