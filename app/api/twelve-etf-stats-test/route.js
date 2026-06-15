export const dynamic = "force-dynamic";
export const maxDuration = 60;

function maskKey(url, key) {
  if (!key) return url;
  return url.replaceAll(key, "***");
}

function normalizeTicker(raw) {
  return String(raw || "").trim().toUpperCase();
}

function makeUrl(endpoint, params) {
  const url = new URL(`https://api.twelvedata.com/${endpoint}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  const text = await response.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    json,
    textPreview: text.slice(0, 500),
  };
}

function isErrorPayload(json) {
  if (!json) return true;
  if (json.status === "error") return true;
  if (json.code && Number(json.code) >= 400) return true;
  if (json.message && String(json.message).toLowerCase().includes("api")) {
    return true;
  }
  return false;
}

function summarize(endpoint, symbol, result, url, apiKey) {
  const json = result.json;

  const available =
    result.ok &&
    json &&
    !isErrorPayload(json) &&
    Object.keys(json || {}).length > 0;

  return {
    symbol,
    endpoint,
    available,
    httpStatus: result.status,
    requestUrl: maskKey(url, apiKey),
    keys: json && typeof json === "object" ? Object.keys(json).slice(0, 40) : [],
    error: available
      ? null
      : json?.message ||
        json?.status ||
        json?.code ||
        result.textPreview ||
        "Indisponível",
    sample: json || result.textPreview,
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const apiKey = process.env.TWELVEDATA_API_KEY;

    if (!apiKey) {
      return Response.json(
        {
          ok: false,
          error: "TWELVEDATA_API_KEY não encontrada",
        },
        { status: 500 }
      );
    }

    const tickerParam = searchParams.get("ticker");

    const symbols = tickerParam
      ? [normalizeTicker(tickerParam)]
      : ["VOO", "VTI", "VXUS", "SGOV", "SCHD", "JEPI", "XLE", "XLK", "QQQ", "SPY"];

    const endpoints = [
      "quote",
      "profile",
      "statistics",
      "etf",
      "time_series",
      "dividends",
    ];

    const results = [];

    for (const symbol of symbols) {
      for (const endpoint of endpoints) {
        const params = {
          apikey: apiKey,
          symbol,
          format: "JSON",
        };

        if (endpoint === "time_series") {
          params.interval = "1day";
          params.outputsize = 250;
        }

        const url = makeUrl(endpoint, params);

        try {
          const result = await fetchJson(url);
          results.push(summarize(endpoint, symbol, result, url, apiKey));
        } catch (error) {
          results.push({
            symbol,
            endpoint,
            available: false,
            error: error.message,
            requestUrl: maskKey(url, apiKey),
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 1300));
      }
    }

    const summary = symbols.map((symbol) => {
      const rows = results.filter((r) => r.symbol === symbol);

      return {
        symbol,
        endpoints: rows.map((r) => ({
          endpoint: r.endpoint,
          available: r.available,
          httpStatus: r.httpStatus,
          error: r.error,
          keys: r.keys,
        })),
      };
    });

    return Response.json({
      ok: true,
      provider: "Twelve Data",
      purpose: "ETF capability test",
      testedSymbols: symbols,
      testedEndpoints: endpoints,
      updatedAt: new Date().toISOString(),
      summary,
      results,
      note:
        "Este teste verifica se quote/profile/statistics/etf/time_series/dividends retornam dados úteis para ETFs. Se statistics vier vazio ou genérico, holdings/composição ainda dependerão de outra fonte ou add-on.",
    });
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
