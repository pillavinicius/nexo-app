export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * NEXO Asset Route definitivo
 *
 * Estrutura:
 * - Ativos B3: HG Brasil
 *   - quote
 *   - fundamentals
 *   - history
 *
 * - Ativos internacionais: Twelve Data
 *   - price
 *   - time_series
 *
 * Alpha Vantage removido.
 */

function normalizeTicker(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
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
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function round(value, decimals = 2) {
  const n = safeNumber(value);
  if (n === null) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
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

function nowISO() {
  return new Date().toISOString();
}

function getPeriodDays(period) {
  const p = String(period || "1y").toLowerCase();
  if (p === "3m") return 90;
  if (p === "6m") return 180;
  if (p === "1y") return 365;
  if (p === "2y") return 730;
  if (p === "3y") return 1095;
  if (p === "5y") return 1825;
  return 365;
}

async function fetchJSON(url) {
  const response = await fetch(url, { method: "GET", cache: "no-store" });
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
    if (v !== null && v !== undefined && v !== "") url.searchParams.set(k, String(v));
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
    if (v !== null && v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  return url.href;
}

function firstResult(data) {
  if (Array.isArray(data?.results) && data.results.length > 0) return data.results[0];
  if (data?.results && typeof data.results === "object") {
    const values = Object.values(data.results);
    if (values.length > 0) return values[0];
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

  return { ok: true, source: "HG Brasil Finance - Quotes", metadata: data?.metadata || null, raw: item };
}

async function getHGFundamentals(ticker) {
  try {
    const data = await fetchJSON(makeHGUrl("/v2/finance/fundamentals", ticker, { period: "annual" }));
    const item = firstResult(data);

    if (!item) {
      return {
        ok: false,
        source: "HG Brasil Finance - Fundamentals",
        error: "Sem resultados",
        metadata: data?.metadata || null,
      };
    }

    return { ok: true, source: "HG Brasil Finance - Fundamentals", metadata: data?.metadata || null, raw: item };
  } catch (error) {
    return { ok: false, source: "HG Brasil Finance - Fundamentals", error: error.message };
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
    return { ok: false, source: "HG Brasil Finance - History", error: error.message, samples: [] };
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
    rawAvailableFields: Object.keys(item || {}).slice(0, 80),
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
      map.set(date, { date, open, close, high, low, volume, firstTimestamp: s.date, lastTimestamp: s.date });
      continue;
    }

    const day = map.get(date);
    if ((day.open === null || day.open === undefined) && open !== null) day.open = open;
    day.close = close !== null ? close : day.close;
    day.high = day.high === null || day.high === undefined ? high : high === null ? day.high : Math.max(day.high, high);
    day.low = day.low === null || day.low === undefined ? low : low === null ? day.low : Math.min(day.low, low);
    day.volume += volume;
    day.lastTimestamp = s.date;
  }

  return Array.from(map.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

async function getTwelvePrice(ticker) {
  try {
    const data = await fetchJSON(makeTwelveUrl("/price", ticker, { interval: "1day" }));
    const price = safeNumber(data?.price);

    if (price === null) {
      return { ok: false, source: "Twelve Data - Price", error: data?.message || data?.status || "Preço indisponível", raw: data };
    }

    return { ok: true, source: "Twelve Data - Price", price, raw: data };
  } catch (error) {
    return { ok: false, source: "Twelve Data - Price", error: error.message };
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
      return { ok: false, source: "Twelve Data - Time Series", error: data?.message || "Erro Twelve Data", raw: data };
    }

    const values = Array.isArray(data?.values) ? data.values : [];

    if (values.length === 0) {
      return { ok: false, source: "Twelve Data - Time Series", error: "Série histórica vazia", meta: data?.meta || null, raw: data };
    }

    return { ok: true, source: "Twelve Data - Time Series", meta: data?.meta || null, values, raw: data };
  } catch (error) {
    return { ok: false, source: "Twelve Data - Time Series", error: error.message, values: [] };
  }
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

function summarizeTwelveAsset(ticker, priceResult, timeSeriesResult) {
  const meta = timeSeriesResult?.meta || {};
  const values = normalizeTwelveCandles(timeSeriesResult?.values || []);
  const last = values[values.length - 1] || null;
  const currentPrice = safeNumber(priceResult?.price) ?? safeNumber(last?.close) ?? safeNumber(last?.open);

  return {
    ok: priceResult?.ok || timeSeriesResult?.ok || false,
    source: [priceResult?.ok ? priceResult.source : null, timeSeriesResult?.ok ? timeSeriesResult.source : null]
      .filter(Boolean)
      .join(" + "),
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
    dividends: {
      yield12mPercent: null,
      yield12mCash: null,
    },
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

  let maxPrice = null;
  let maxDate = null;
  let minPrice = null;
  let minDate = null;
  let volumeSum = 0;
  let volumeCount = 0;

  for (const c of clean) {
    const h = safeNumber(c.high) ?? safeNumber(c.close);
    const l = safeNumber(c.low) ?? safeNumber(c.close);

    if (h !== null && (maxPrice === null || h > maxPrice)) {
      maxPrice = h;
      maxDate = c.date;
    }

    if (l !== null && (minPrice === null || l < minPrice)) {
      minPrice = l;
      minDate = c.date;
    }

    const v = safeNumber(c.volume);
    if (v !== null && v > 0) {
      volumeSum += v;
      volumeCount += 1;
    }
  }

  const startPrice = safeNumber(first.open) ?? safeNumber(first.close) ?? safeNumber(first.low) ?? safeNumber(first.high);
  const lastPrice = safeNumber(currentPrice) ?? safeNumber(last.close) ?? safeNumber(last.open) ?? safeNumber(last.low) ?? safeNumber(last.high);

  const returnPercent = startPrice !== null && startPrice !== 0 && lastPrice !== null ? ((lastPrice / startPrice) - 1) * 100 : null;
  const drawdownFromHighPercent = maxPrice !== null && maxPrice !== 0 && lastPrice !== null ? ((lastPrice / maxPrice) - 1) * 100 : null;
  const amplitudePercent = maxPrice !== null && minPrice !== null && minPrice !== 0 ? ((maxPrice / minPrice) - 1) * 100 : null;
  const averageVolume = volumeCount > 0 ? volumeSum / volumeCount : null;

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
    returnPercent: round(returnPercent, 2),
    drawdownFromHighPercent: round(drawdownFromHighPercent, 2),
    amplitudePercent: round(amplitudePercent, 2),
    averageVolume: averageVolume !== null ? Math.round(averageVolume) : null,
    explanation: "Cálculos derivados automaticamente da série histórica diária. Para B3, os candles intradiários da HG foram agrupados por dia antes do cálculo.",
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

  const [fundamentals, history] = await Promise.all([getHGFundamentals(ticker), getHGHistory(ticker)]);

  if (fundamentals?.error) errors.push("HG Fundamentals: " + fundamentals.error);
  if (history?.error) errors.push("HG History: " + history.error);

  const asset = quote?.ok
    ? summarizeHGQuote(quote, ticker)
    : {
        ok: false,
        source: "manual",
        dataProvider: "manual",
        ticker,
        error: "Dados automáticos indisponíveis",
        manualFallback: true,
      };

  const dailyCandles = history?.ok ? groupIntradaySamplesByDay(history.samples) : [];
  const derived = calculateDerivedFromDailyCandles(dailyCandles, asset?.price, period);

  return Response.json({
    ok: true,
    requestedTicker: ticker,
    route: "B3_HG_BRASIL",
    updatedAt: nowISO(),
    priorityRule: "Se o usuário informar valor manual, usar o manual. Se manual vazio, usar automático. Se automático indisponível, marcar como não informado.",
    asset,
    fundamentals: summarizeHGFundamentals(fundamentals),
    history: {
      ok: !!history?.ok,
      source: history?.source || "HG Brasil Finance - History",
      samplesType: history?.ok ? "intraday_15min_grouped_to_daily" : null,
      rawSamplesCount: Array.isArray(history?.samples) ? history.samples.length : 0,
      dailyCandlesCount: dailyCandles.length,
      error: history?.error || null,
    },
    derived,
    manualFallback: !asset.ok,
    errors,
    raw: includeRaw
      ? {
          quote: quote?.raw || null,
          fundamentals: fundamentals?.raw || null,
          history: history?.raw || null,
          dailyCandles,
        }
      : undefined,
  });
}

async function handleInternationalAsset(ticker, period, includeRaw) {
  const errors = [];
  const [priceResult, timeSeriesResult] = await Promise.all([getTwelvePrice(ticker), getTwelveTimeSeries(ticker, period)]);

  if (priceResult?.error) errors.push("Twelve Price: " + priceResult.error);
  if (timeSeriesResult?.error) errors.push("Twelve Time Series: " + timeSeriesResult.error);

  const asset =
    priceResult?.ok || timeSeriesResult?.ok
      ? summarizeTwelveAsset(ticker, priceResult, timeSeriesResult)
      : {
          ok: false,
          source: "manual",
          dataProvider: "manual",
          ticker,
          error: "Dados automáticos internacionais indisponíveis",
          manualFallback: true,
        };

  const dailyCandles = timeSeriesResult?.ok ? normalizeTwelveCandles(timeSeriesResult.values) : [];
  const derived = calculateDerivedFromDailyCandles(dailyCandles, asset?.price, period);

  return Response.json({
    ok: true,
    requestedTicker: ticker,
    route: "INTERNATIONAL_TWELVE_DATA",
    updatedAt: nowISO(),
    priorityRule: "Se o usuário informar valor manual, usar o manual. Se manual vazio, usar automático. Se automático indisponível, marcar como não informado.",
    asset,
    fundamentals: {
      ok: false,
      source: "Twelve Data",
      error: "Fundamentos contábeis, profile/statistics, press releases e holdings ficam para fase futura.",
      futureEndpoints: ["profile", "statistics", "income_statement", "balance_sheet", "cash_flow", "press_releases", "etf"],
    },
    history: {
      ok: !!timeSeriesResult?.ok,
      source: timeSeriesResult?.source || "Twelve Data - Time Series",
      samplesType: "daily",
      dailyCandlesCount: dailyCandles.length,
      error: timeSeriesResult?.error || null,
    },
    derived,
    manualFallback: !asset.ok,
    errors,
    raw: includeRaw
      ? {
          price: priceResult?.raw || null,
          timeSeries: timeSeriesResult?.raw || null,
          dailyCandles,
        }
      : undefined,
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
          ],
          manualFallback: true,
        },
        { status: 400 }
      );
    }

    if (isB3Ticker(ticker)) return await handleB3Asset(ticker, period, includeRaw);
    return await handleInternationalAsset(ticker, period, includeRaw);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error.message,
        manualFallback: true,
      },
      { status: 500 }
    );
  }
}
