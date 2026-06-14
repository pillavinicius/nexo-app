export const dynamic = "force-dynamic";
export const maxDuration = 45;

const HG = "https://api.hgbrasil.com";
const AV = "https://www.alphavantage.co/query";

function tk(raw) {
  return String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
}

function isB3(ticker) {
  return /^[A-Z]{4}[0-9]{1,2}$/.test(tk(ticker));
}

function n(v) {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(String(v).replace(",", ".").replace("%", ""));
  return Number.isFinite(x) ? x : null;
}

async function json(url) {
  const r = await fetch(url, { cache: "no-store" });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Resposta não-JSON: " + text.slice(0, 250));
  }
  if (!r.ok) throw new Error("HTTP " + r.status + ": " + (data?.message || data?.error || "erro desconhecido"));
  return data;
}

function hgUrl(path, ticker, extra = {}) {
  const url = new URL(path, HG);
  url.searchParams.set("tickers", isB3(ticker) ? `B3:${tk(ticker)}` : tk(ticker));
  if (process.env.HG_BRASIL_KEY) url.searchParams.set("key", process.env.HG_BRASIL_KEY);
  Object.entries(extra).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });
  return url.href;
}

function avUrl(params) {
  const url = new URL(AV);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });
  if (process.env.ALPHA_VANTAGE_KEY) url.searchParams.set("apikey", process.env.ALPHA_VANTAGE_KEY);
  return url.href;
}

function first(data) {
  if (Array.isArray(data?.results)) return data.results[0] || null;
  if (data?.results && typeof data.results === "object") return Object.values(data.results)[0] || null;
  return null;
}

async function hgQuote(ticker) {
  const data = await json(hgUrl("/v2/finance/quotes", ticker));
  const raw = first(data);
  if (!raw) return { ok: false, source: "HG Brasil Quotes", error: "Ticker não encontrado" };
  return { ok: true, source: "HG Brasil Quotes", raw, metadata: data?.metadata || null };
}

async function hgFundamentals(ticker) {
  try {
    const data = await json(hgUrl("/v2/finance/fundamentals", ticker, { period: "annual" }));
    const raw = first(data);
    if (!raw) return { ok: false, source: "HG Brasil Fundamentals", error: "Sem resultados" };
    return { ok: true, source: "HG Brasil Fundamentals", raw };
  } catch (e) {
    return { ok: false, source: "HG Brasil Fundamentals", error: e.message };
  }
}

async function alphaQuote(ticker) {
  try {
    const data = await json(avUrl({ function: "GLOBAL_QUOTE", symbol: ticker }));
    const raw = data?.["Global Quote"];
    if (!raw || Object.keys(raw).length === 0) {
      return { ok: false, source: "Alpha Vantage Quote", error: data?.Note || data?.Information || "Sem cotação" };
    }
    return { ok: true, source: "Alpha Vantage Quote", raw };
  } catch (e) {
    return { ok: false, source: "Alpha Vantage Quote", error: e.message };
  }
}

async function alphaOverview(ticker) {
  try {
    const raw = await json(avUrl({ function: "OVERVIEW", symbol: ticker }));
    if (!raw?.Symbol) return { ok: false, source: "Alpha Vantage Overview", error: raw?.Note || raw?.Information || "Overview indisponível" };
    return { ok: true, source: "Alpha Vantage Overview", raw };
  } catch (e) {
    return { ok: false, source: "Alpha Vantage Overview", error: e.message };
  }
}

async function alphaETF(ticker) {
  try {
    const raw = await json(avUrl({ function: "ETF_PROFILE", symbol: ticker }));
    if (!raw?.symbol) return { ok: false, source: "Alpha Vantage ETF Profile", error: raw?.Note || raw?.Information || "ETF profile indisponível" };
    return { ok: true, source: "Alpha Vantage ETF Profile", raw };
  } catch (e) {
    return { ok: false, source: "Alpha Vantage ETF Profile", error: e.message };
  }
}

async function alphaStatement(ticker, fn, label) {
  try {
    const raw = await json(avUrl({ function: fn, symbol: ticker }));
    const annual = Array.isArray(raw?.annualReports) ? raw.annualReports.slice(0, 5) : [];
    const quarter = Array.isArray(raw?.quarterlyReports) ? raw.quarterlyReports.slice(0, 8) : [];
    if (!annual.length && !quarter.length) return { ok: false, source: label, error: raw?.Note || raw?.Information || "Sem relatórios" };
    return { ok: true, source: label, annualReports: annual, quarterlyReports: quarter };
  } catch (e) {
    return { ok: false, source: label, error: e.message };
  }
}

function b3Asset(ticker, q) {
  const r = q?.raw || {};
  const quote = r.quote || {};
  const market = r.market || {};
  const div = r.dividends || {};
  const cls = r.classification || {};
  const logos = r.logos || {};
  return {
    ok: true,
    source: q.source,
    dataProvider: "HG Brasil",
    ticker,
    fullTicker: r.ticker || `B3:${ticker}`,
    symbol: r.symbol || ticker,
    name: r.name || ticker,
    fullName: r.full_name || null,
    taxId: r.tax_id || null,
    assetType: r.kind || "unknown",
    currency: r.currency || "BRL",
    sharesOutstanding: n(r.shares_outstanding),
    sector: cls.sector || null,
    subsector: cls.subsector || null,
    segment: cls.segment || null,
    price: n(quote.value),
    changeValue: n(quote.change_value),
    changePercent: n(quote.change_percent),
    marketCap: n(quote.market_cap),
    updatedAt: quote.updated_at || market.updated_at || new Date().toISOString(),
    market: {
      isOpen: market.is_open ?? null,
      previousValue: n(market.previous_value),
      open: n(market.open),
      close: n(market.close),
      high: n(market.high),
      low: n(market.low),
      volume: n(market.volume),
      updatedAt: market.updated_at || null
    },
    dividends: {
      yield12mPercent: n(div.yield_12m_percent),
      yield12mCash: n(div.yield_12m_cash)
    },
    related: Array.isArray(r.related) ? r.related : [],
    logo: logos.square_large || logos.square_small || null
  };
}

function b3Fundamentals(f) {
  if (!f?.ok) return { ok: false, source: f?.source || "HG Brasil Fundamentals", error: f?.error || "Indisponível" };
  const reports = Array.isArray(f.raw?.statements) ? f.raw.statements : [];
  const last = reports[0] || {};
  return {
    ok: reports.length > 0,
    source: f.source,
    period: {
      type: last.period_type || null,
      fiscalYear: last.fiscal_year || null,
      fiscalPeriod: last.fiscal_period || null,
      startDate: last.start_date || null,
      endDate: last.end_date || null
    },
    valuation: last.valuation || {},
    leverage: last.leverage || {},
    margins: last.margins || {},
    profitability: last.profitability || {},
    dividends: last.dividends || {}
  };
}

function alphaAsset(ticker, quote, overview, etf) {
  const q = quote?.raw || {};
  const o = overview?.raw || {};
  const e = etf?.raw || {};
  const isETF = !!etf?.ok || String(o.AssetType || "").toLowerCase().includes("etf");
  return {
    ok: !!quote?.ok,
    source: quote?.source || null,
    dataProvider: "Alpha Vantage",
    ticker,
    fullTicker: ticker,
    symbol: ticker,
    name: o.Name || e.name || ticker,
    fullName: o.Name || e.name || null,
    assetType: isETF ? "etf-intl" : (o.AssetType || "stock-intl"),
    currency: o.Currency || "USD",
    sector: o.Sector || e.sector || null,
    subsector: o.Industry || null,
    price: n(q["05. price"]),
    changeValue: n(q["09. change"]),
    changePercent: n(q["10. change percent"]),
    marketCap: n(o.MarketCapitalization),
    updatedAt: q["07. latest trading day"] || new Date().toISOString(),
    market: {
      previousValue: n(q["08. previous close"]),
      open: n(q["02. open"]),
      close: n(q["05. price"]),
      high: n(q["03. high"]),
      low: n(q["04. low"]),
      volume: n(q["06. volume"]),
      updatedAt: q["07. latest trading day"] || null
    },
    dividends: {
      yield12mPercent: n(o.DividendYield) !== null ? n(o.DividendYield) * 100 : null,
      yield12mCash: n(o.DividendPerShare)
    },
    international: {
      peRatio: n(o.PERatio),
      pegRatio: n(o.PEGRatio),
      priceToBookRatio: n(o.PriceToBookRatio),
      eps: n(o.EPS),
      beta: n(o.Beta),
      profitMargin: n(o.ProfitMargin),
      operatingMarginTTM: n(o.OperatingMarginTTM),
      returnOnAssetsTTM: n(o.ReturnOnAssetsTTM),
      returnOnEquityTTM: n(o.ReturnOnEquityTTM),
      revenueTTM: n(o.RevenueTTM),
      ebitda: n(o.EBITDA),
      grossProfitTTM: n(o.GrossProfitTTM),
      analystTargetPrice: n(o.AnalystTargetPrice),
      week52High: n(o["52WeekHigh"]),
      week52Low: n(o["52WeekLow"]),
      expenseRatio: n(e.expense_ratio),
      netAssets: n(e.net_assets),
      holdingsCount: n(e.holdings_count),
      topHoldings: Array.isArray(e.holdings) ? e.holdings.slice(0, 10) : [],
      sectors: e.sectors || null
    }
  };
}

function alphaFundamentals(overview, income, balance, cashflow) {
  const o = overview?.raw || {};
  return {
    ok: !!overview?.ok || !!income?.ok || !!balance?.ok || !!cashflow?.ok,
    source: "Alpha Vantage",
    overview: {
      ok: !!overview?.ok,
      peRatio: n(o.PERatio),
      priceToBookRatio: n(o.PriceToBookRatio),
      dividendYieldPercent: n(o.DividendYield) !== null ? n(o.DividendYield) * 100 : null,
      eps: n(o.EPS),
      beta: n(o.Beta),
      marketCap: n(o.MarketCapitalization),
      revenueTTM: n(o.RevenueTTM),
      ebitda: n(o.EBITDA),
      profitMargin: n(o.ProfitMargin),
      returnOnAssetsTTM: n(o.ReturnOnAssetsTTM),
      returnOnEquityTTM: n(o.ReturnOnEquityTTM),
      week52High: n(o["52WeekHigh"]),
      week52Low: n(o["52WeekLow"])
    },
    income_statement: {
      ok: !!income?.ok,
      annualReports: income?.annualReports || [],
      quarterlyReports: income?.quarterlyReports || [],
      error: income?.error || null
    },
    balance_sheet: {
      ok: !!balance?.ok,
      annualReports: balance?.annualReports || [],
      quarterlyReports: balance?.quarterlyReports || [],
      error: balance?.error || null
    },
    cash_flow: {
      ok: !!cashflow?.ok,
      annualReports: cashflow?.annualReports || [],
      quarterlyReports: cashflow?.quarterlyReports || [],
      error: cashflow?.error || null
    }
  };
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const ticker = tk(searchParams.get("ticker"));
    const includeFundamentals = searchParams.get("fundamentals") !== "0";
    const includeStatements = searchParams.get("statements") !== "0";

    if (!ticker) {
      return Response.json({ ok: false, error: "Informe o ticker em /api/asset?ticker=BBSE3", manualFallback: true }, { status: 400 });
    }

    const errors = [];

    if (isB3(ticker)) {
      const quote = await hgQuote(ticker).catch(e => ({ ok: false, source: "HG Brasil Quotes", error: e.message }));
      if (quote.error) errors.push("HG Quotes: " + quote.error);

      const fundamentals = includeFundamentals
        ? await hgFundamentals(ticker)
        : { ok: false, source: "HG Brasil Fundamentals", error: "Não solicitado" };

      if (fundamentals.error) errors.push("HG Fundamentals: " + fundamentals.error);

      const asset = quote.ok ? b3Asset(ticker, quote) : {
        ok: false, source: "manual", ticker, error: "Dados automáticos indisponíveis", manualFallback: true
      };

      return Response.json({
        ok: true,
        requestedTicker: ticker,
        route: "B3_HG_BRASIL",
        updatedAt: new Date().toISOString(),
        priorityRule: "Se o usuário informar valor manual, usar o manual. Se manual vazio, usar automático. Se automático indisponível, marcar como não informado.",
        asset,
        fundamentals: b3Fundamentals(fundamentals),
        raw: { quote: quote.raw || null, fundamentals: fundamentals.raw || null },
        manualFallback: !asset.ok,
        errors
      });
    }

    const [quote, overview, etf] = await Promise.all([
      alphaQuote(ticker),
      alphaOverview(ticker),
      alphaETF(ticker)
    ]);

    if (quote.error) errors.push("Alpha Quote: " + quote.error);
    if (overview.error) errors.push("Alpha Overview: " + overview.error);
    if (etf.error) errors.push("Alpha ETF Profile: " + etf.error);

    const [income, balance, cashflow] = includeStatements
      ? await Promise.all([
          alphaStatement(ticker, "INCOME_STATEMENT", "Alpha Income Statement"),
          alphaStatement(ticker, "BALANCE_SHEET", "Alpha Balance Sheet"),
          alphaStatement(ticker, "CASH_FLOW", "Alpha Cash Flow")
        ])
      : [
          { ok: false, source: "Alpha Income Statement", error: "Não solicitado" },
          { ok: false, source: "Alpha Balance Sheet", error: "Não solicitado" },
          { ok: false, source: "Alpha Cash Flow", error: "Não solicitado" }
        ];

    if (income.error) errors.push("Alpha Income: " + income.error);
    if (balance.error) errors.push("Alpha Balance: " + balance.error);
    if (cashflow.error) errors.push("Alpha Cash Flow: " + cashflow.error);

    const asset = quote.ok ? alphaAsset(ticker, quote, overview, etf) : {
      ok: false, source: "manual", ticker, error: "Dados automáticos internacionais indisponíveis", manualFallback: true
    };

    return Response.json({
      ok: true,
      requestedTicker: ticker,
      route: "INTERNATIONAL_ALPHA_VANTAGE",
      updatedAt: new Date().toISOString(),
      priorityRule: "Se o usuário informar valor manual, usar o manual. Se manual vazio, usar automático. Se automático indisponível, marcar como não informado.",
      asset,
      fundamentals: alphaFundamentals(overview, income, balance, cashflow),
      raw: {
        quote: quote.raw || null,
        overview: overview.raw || null,
        etfProfile: etf.raw || null
      },
      manualFallback: !asset.ok,
      errors
    });
  } catch (err) {
    return Response.json({ ok: false, error: err.message, manualFallback: true }, { status: 500 });
  }
}
