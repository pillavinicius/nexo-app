export const dynamic = "force-dynamic";
export const maxDuration = 45;

function normalizeTicker(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function hgTicker(ticker) {
  const tk = normalizeTicker(ticker);
  if (/^[A-Z]{4}[0-9]{1,2}$/.test(tk)) return `B3:${tk}`;
  return tk;
}

function safeNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Resposta não-JSON: " + text.slice(0, 300));
  }

  if (!res.ok) {
    throw new Error(
      "HTTP " +
        res.status +
        ": " +
        (data?.message || data?.error || data?.metadata?.message || "erro desconhecido")
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

function firstResult(data) {
  if (Array.isArray(data?.results) && data.results.length > 0) return data.results[0];
  if (data?.results && typeof data.results === "object") {
    const vals = Object.values(data.results);
    if (vals.length > 0) return vals[0];
  }
  return null;
}

async function getHGQuotes(ticker) {
  const url = makeHGUrl("/v2/finance/quotes", ticker);
  const data = await fetchJSON(url);
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
    const url = makeHGUrl("/v2/finance/fundamentals", ticker, { period: "annual" });
    const data = await fetchJSON(url);
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
  } catch (e) {
    return {
      ok: false,
      source: "HG Brasil Finance - Fundamentals",
      error: e.message,
    };
  }
}

async function getStooqFallback(ticker) {
  try {
    const tk = normalizeTicker(ticker);
    const symbols = [];

    if (/^[A-Z]{4}[0-9]{1,2}$/.test(tk)) symbols.push(tk.toLowerCase() + ".sa");
    symbols.push(tk.toLowerCase());

    const today = new Date();
    const past = new Date();
    past.setDate(today.getDate() - 20);

    const d1 =
      past.getFullYear() +
      String(past.getMonth() + 1).padStart(2, "0") +
      String(past.getDate()).padStart(2, "0");

    const d2 =
      today.getFullYear() +
      String(today.getMonth() + 1).padStart(2, "0") +
      String(today.getDate()).padStart(2, "0");

    for (const symbol of symbols) {
      const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&d1=${d1}&d2=${d2}&i=d`;
      const res = await fetch(url, { cache: "no-store" });
      const csv = await res.text();

      if (!res.ok || csv.toLowerCase().includes("no data")) continue;

      const lines = csv.trim().split("\n").filter(Boolean);
      if (lines.length < 2) continue;

      const last = lines[lines.length - 1].split(",");
      const close = safeNumber(last[4]);

      if (close === null) continue;

      return {
        ok: true,
        source: "Stooq fallback",
        ticker: tk,
        symbol,
        name: tk,
        assetType: "unknown",
        currency: tk.match(/^[A-Z]{4}[0-9]/) ? "BRL" : "USD",
        price: close,
        updatedAt: last[0],
        market: {
          high: safeNumber(last[2]),
          low: safeNumber(last[3]),
          volume: safeNumber(last[5]),
        },
      };
    }

    return null;
  } catch {
    return null;
  }
}

function summarizeQuote(q, ticker) {
  const item = q?.raw || {};
  const quote = item.quote || {};
  const market = item.market || {};
  const dividends = item.dividends || {};
  const classification = item.classification || {};
  const logos = item.logos || {};

  return {
    ok: !!q?.ok,
    source: q?.source || null,
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
    updatedAt: quote.updated_at || market.updated_at || new Date().toISOString(),
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

function summarizeFundamentals(f) {
  if (!f?.ok) {
    return {
      ok: false,
      source: f?.source || "HG Brasil Finance - Fundamentals",
      error: f?.error || "Indisponível",
    };
  }

  const raw = f.raw || {};
  const statements = Array.isArray(raw.statements) ? raw.statements : [];
  const st = statements[0] || {};

  return {
    ok: statements.length > 0,
    source: f.source,
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

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const ticker = normalizeTicker(searchParams.get("ticker"));
    const includeFundamentals = searchParams.get("fundamentals") !== "0";

    if (!ticker) {
      return Response.json(
        {
          ok: false,
          error: "Informe o ticker em /api/asset?ticker=BBSE3",
          manualFallback: true,
        },
        { status: 400 }
      );
    }

    const errors = [];

    let quote = null;
    try {
      quote = await getHGQuotes(ticker);
      if (!quote.ok) errors.push("Quotes: " + quote.error);
    } catch (e) {
      errors.push("Quotes: " + e.message);
    }

    let fallback = null;
    if (!quote?.ok) fallback = await getStooqFallback(ticker);

    const fundamentals = includeFundamentals
      ? await getHGFundamentals(ticker)
      : { ok: false, source: "HG Brasil Finance - Fundamentals", error: "Não solicitado" };

    if (fundamentals?.error) errors.push("Fundamentals: " + fundamentals.error);

    const asset = quote?.ok
      ? summarizeQuote(quote, ticker)
      : fallback?.ok
      ? {
          ok: true,
          source: fallback.source,
          ticker,
          fullTicker: fallback.symbol,
          symbol: ticker,
          name: ticker,
          fullName: null,
          taxId: null,
          isin: null,
          assetType: fallback.assetType,
          currency: fallback.currency,
          unit: "currency",
          price: fallback.price,
          changeValue: null,
          changePercent: null,
          marketCap: null,
          updatedAt: fallback.updatedAt,
          market: fallback.market,
          dividends: {},
          related: [],
          logo: null,
          rawAvailableFields: [],
        }
      : {
          ok: false,
          source: "manual",
          ticker,
          error: "Dados automáticos indisponíveis",
          manualFallback: true,
        };

    return Response.json({
      ok: true,
      requestedTicker: ticker,
      updatedAt: new Date().toISOString(),
      priorityRule:
        "Se o usuário informar valor manual, usar o manual. Se manual vazio, usar automático. Se automático indisponível, marcar como não informado.",
      asset,
      fundamentals: summarizeFundamentals(fundamentals),
      raw: {
        quote: quote?.raw || null,
        fundamentals: fundamentals?.raw || null,
      },
      manualFallback: !asset.ok,
      errors,
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err.message,
        manualFallback: true,
      },
      { status: 500 }
    );
  }
}
