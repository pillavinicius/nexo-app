export const dynamic = "force-dynamic";
export const maxDuration = 30;

function normalizeTicker(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
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
    throw new Error("HTTP " + res.status + ": " + (data?.message || data?.error || "erro desconhecido"));
  }

  return data;
}

function extractHGResult(data, ticker) {
  const results = data?.results || {};
  const normalized = normalizeTicker(ticker);

  if (results[normalized]) return results[normalized];

  const keys = Object.keys(results);
  for (const key of keys) {
    if (normalizeTicker(key) === normalized) return results[key];
  }

  return null;
}

function normalizeHGAsset(raw, ticker) {
  if (!raw) {
    return {
      ok: false,
      source: "HG Brasil Finance",
      ticker,
      error: "Ticker não encontrado",
      manualFallback: true,
    };
  }

  const price =
    safeNumber(raw.price) ??
    safeNumber(raw.close) ??
    safeNumber(raw.regularMarketPrice);

  const changePercent =
    safeNumber(raw.change_percent) ??
    safeNumber(raw.changePercent) ??
    safeNumber(raw.variation);

  const dayHigh =
    safeNumber(raw.high) ??
    safeNumber(raw.day_high) ??
    safeNumber(raw.regularMarketDayHigh);

  const dayLow =
    safeNumber(raw.low) ??
    safeNumber(raw.day_low) ??
    safeNumber(raw.regularMarketDayLow);

  const volume =
    safeNumber(raw.volume) ??
    safeNumber(raw.regularMarketVolume);

  const marketCap =
    safeNumber(raw.market_cap) ??
    safeNumber(raw.marketCap);

  return {
    ok: true,
    source: "HG Brasil Finance",
    ticker,
    symbol: raw.symbol || ticker,
    name: raw.name || raw.company_name || raw.longName || raw.shortName || ticker,
    assetType: raw.kind || raw.type || raw.stock_type || "unknown",
    currency: raw.currency || "BRL",
    price,
    changePercent,
    dayHigh,
    dayLow,
    volume,
    marketCap,
    sector: raw.sector || null,
    industry: raw.industry || null,
    updatedAt: raw.updated_at || raw.updatedAt || new Date().toISOString(),
    indicators: {
      priceEarnings: safeNumber(raw.price_earnings) ?? safeNumber(raw.pl) ?? safeNumber(raw.pe),
      priceToBook: safeNumber(raw.price_to_book) ?? safeNumber(raw.pvp) ?? safeNumber(raw.pb),
      dividendYield: safeNumber(raw.dividend_yield) ?? safeNumber(raw.dy),
      earningsPerShare: safeNumber(raw.earnings_per_share) ?? safeNumber(raw.eps),
      roe: safeNumber(raw.roe),
      roa: safeNumber(raw.roa),
    },
    rawAvailableFields: Object.keys(raw || {}).slice(0, 80),
  };
}

async function getHGAsset(ticker) {
  const key = process.env.HG_BRASIL_KEY || "";

  const params = new URLSearchParams({
    symbol: ticker,
  });

  if (key) params.set("key", key);

  const url = `https://api.hgbrasil.com/finance/stock_price?${params.toString()}`;
  const data = await fetchJSON(url);
  const raw = extractHGResult(data, ticker);

  return normalizeHGAsset(raw, ticker);
}

async function getStooqFallback(ticker) {
  try {
    const symbols = [];

    if (/^[A-Z]{4}[0-9]{1,2}$/.test(ticker)) {
      symbols.push(ticker.toLowerCase() + ".sa");
    }

    symbols.push(ticker.toLowerCase());

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
        ticker,
        symbol,
        name: ticker,
        assetType: "unknown",
        currency: ticker.match(/^[A-Z]{4}[0-9]/) ? "BRL" : "USD",
        price: close,
        changePercent: null,
        dayHigh: safeNumber(last[2]),
        dayLow: safeNumber(last[3]),
        volume: safeNumber(last[5]),
        marketCap: null,
        sector: null,
        industry: null,
        updatedAt: last[0],
        indicators: {},
        rawAvailableFields: ["Date", "Open", "High", "Low", "Close", "Volume"],
      };
    }

    return null;
  } catch {
    return null;
  }
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const ticker = normalizeTicker(searchParams.get("ticker"));

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

    let asset = null;
    let errors = [];

    try {
      asset = await getHGAsset(ticker);
    } catch (err) {
      errors.push("HG Brasil: " + err.message);
    }

    if (!asset || !asset.ok || asset.price === null) {
      const fallback = await getStooqFallback(ticker);
      if (fallback?.ok) asset = fallback;
    }

    if (!asset || !asset.ok) {
      return Response.json({
        ok: true,
        requestedTicker: ticker,
        updatedAt: new Date().toISOString(),
        asset: {
          ok: false,
          source: "manual",
          ticker,
          error: errors.join(" | ") || "Dados automáticos indisponíveis",
          manualFallback: true,
        },
        manualFallback: true,
        errors,
      });
    }

    return Response.json({
      ok: true,
      requestedTicker: ticker,
      updatedAt: new Date().toISOString(),
      priorityRule:
        "Se o usuário informar valor manual, usar o manual. Se manual vazio, usar automático. Se automático indisponível, marcar como não informado.",
      asset,
      manualFallback: false,
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
