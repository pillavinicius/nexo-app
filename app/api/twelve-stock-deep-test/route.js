export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
    keys: json && typeof json === "object" ? Object.keys(json).slice(0, 50) : [],
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

function extractQuickView(endpoint, json) {
  if (!json || typeof json !== "object") return null;

  if (endpoint === "quote") {
    return {
      name: json.name,
      exchange: json.exchange,
      currency: json.currency,
      close: json.close,
      previous_close: json.previous_close,
      change: json.change,
      percent_change: json.percent_change,
      volume: json.volume,
      average_volume: json.average_volume,
      fifty_two_week: json.fifty_two_week,
    };
  }

  if (endpoint === "profile") {
    return {
      name: json.name,
      sector: json.sector,
      industry: json.industry,
      employees: json.employees,
      CEO: json.CEO,
      country: json.country,
      website: json.website,
      descriptionPreview: json.description
        ? String(json.description).slice(0, 300)
        : null,
    };
  }

  if (endpoint === "statistics") {
    const stats = json.statistics || {};

    return {
      valuations_metrics: stats.valuations_metrics || null,
      financials: stats.financials
        ? {
            gross_margin: stats.financials.gross_margin,
            profit_margin: stats.financials.profit_margin,
            operating_margin: stats.financials.operating_margin,
            return_on_assets_ttm: stats.financials.return_on_assets_ttm,
            return_on_equity_ttm: stats.financials.return_on_equity_ttm,
            revenue_ttm:
              stats.financials.income_statement?.revenue_ttm ?? null,
            ebitda: stats.financials.income_statement?.ebitda ?? null,
            net_income_to_common_ttm:
              stats.financials.income_statement?.net_income_to_common_ttm ??
              null,
            diluted_eps_ttm:
              stats.financials.income_statement?.diluted_eps_ttm ?? null,
            total_cash_mrq:
              stats.financials.balance_sheet?.total_cash_mrq ?? null,
            total_debt_mrq:
              stats.financials.balance_sheet?.total_debt_mrq ?? null,
            current_ratio_mrq:
              stats.financials.balance_sheet?.current_ratio_mrq ?? null,
            operating_cash_flow_ttm:
              stats.financials.cash_flow?.operating_cash_flow_ttm ?? null,
            levered_free_cash_flow_ttm:
              stats.financials.cash_flow?.levered_free_cash_flow_ttm ?? null,
          }
        : null,
      stock_statistics: stats.stock_statistics || null,
      stock_price_summary: stats.stock_price_summary || null,
      dividends_and_splits: stats.dividends_and_splits || null,
    };
  }

  if (endpoint === "income_statement") {
    const rows = Array.isArray(json.income_statement)
      ? json.income_statement
      : [];

    return {
      count: rows.length,
      latest: rows[0]
        ? {
            fiscal_date: rows[0].fiscal_date,
            year: rows[0].year,
            sales: rows[0].sales,
            gross_profit: rows[0].gross_profit,
            operating_income: rows[0].operating_income,
            net_income: rows[0].net_income,
            eps_basic: rows[0].eps_basic,
            eps_diluted: rows[0].eps_diluted,
            ebit: rows[0].ebit,
            ebitda: rows[0].ebitda,
          }
        : null,
    };
  }

  if (endpoint === "balance_sheet") {
    const rows = Array.isArray(json.balance_sheet) ? json.balance_sheet : [];

    return {
      count: rows.length,
      latest: rows[0]
        ? {
            fiscal_date: rows[0].fiscal_date,
            year: rows[0].year,
            total_assets: rows[0].assets?.total_assets ?? null,
            total_current_assets:
              rows[0].assets?.current_assets?.total_current_assets ?? null,
            cash_and_cash_equivalents:
              rows[0].assets?.current_assets?.cash_and_cash_equivalents ??
              null,
            total_liabilities: rows[0].liabilities?.total_liabilities ?? null,
            total_current_liabilities:
              rows[0].liabilities?.current_liabilities
                ?.total_current_liabilities ?? null,
            short_term_debt:
              rows[0].liabilities?.current_liabilities?.short_term_debt ??
              null,
            long_term_debt:
              rows[0].liabilities?.non_current_liabilities?.long_term_debt ??
              null,
            total_shareholders_equity:
              rows[0].shareholders_equity?.total_shareholders_equity ?? null,
          }
        : null,
    };
  }

  if (endpoint === "cash_flow") {
    const rows = Array.isArray(json.cash_flow) ? json.cash_flow : [];

    return {
      count: rows.length,
      latest: rows[0]
        ? {
            fiscal_date: rows[0].fiscal_date,
            year: rows[0].year,
            operating_cash_flow:
              rows[0].operating_activities?.operating_cash_flow ?? null,
            capital_expenditures:
              rows[0].investing_activities?.capital_expenditures ?? null,
            free_cash_flow: rows[0].free_cash_flow ?? null,
            dividends_paid:
              rows[0].financing_activities?.cash_dividends_paid ?? null,
            repurchase_of_capital_stock:
              rows[0].financing_activities?.repurchase_of_capital_stock ??
              null,
            net_change_in_cash: rows[0].net_change_in_cash ?? null,
          }
        : null,
    };
  }

  if (endpoint === "time_series") {
    const values = Array.isArray(json.values) ? json.values : [];

    return {
      meta: json.meta || null,
      count: values.length,
      latest: values[0] || null,
    };
  }

  if (endpoint === "dividends") {
    const rows = Array.isArray(json.dividends) ? json.dividends : [];

    return {
      count: rows.length,
      latest: rows[0] || null,
    };
  }

  if (endpoint === "earnings") {
    const rows = Array.isArray(json.earnings) ? json.earnings : [];

    return {
      count: rows.length,
      latest: rows[0] || null,
    };
  }

  return null;
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
      : ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"];

    const endpointParam = searchParams.get("endpoint");

    const defaultEndpoints = [
      "quote",
      "profile",
      "statistics",
      "income_statement",
      "balance_sheet",
      "cash_flow",
      "time_series",
      "dividends",
      "earnings",
    ];

    const endpoints = endpointParam
      ? [String(endpointParam).trim()]
      : defaultEndpoints;

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
          const row = summarize(endpoint, symbol, result, url, apiKey);

          row.quickView = extractQuickView(endpoint, result.json);

          results.push(row);
        } catch (error) {
          results.push({
            symbol,
            endpoint,
            available: false,
            error: error.message,
            requestUrl: maskKey(url, apiKey),
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }

    const summary = symbols.map((symbol) => {
      const rows = results.filter((r) => r.symbol === symbol);

      return {
        symbol,
        availableEndpoints: rows
          .filter((r) => r.available)
          .map((r) => r.endpoint),
        blockedOrUnavailableEndpoints: rows
          .filter((r) => !r.available)
          .map((r) => ({
            endpoint: r.endpoint,
            httpStatus: r.httpStatus,
            error: r.error,
          })),
        endpoints: rows.map((r) => ({
          endpoint: r.endpoint,
          available: r.available,
          httpStatus: r.httpStatus,
          keys: r.keys,
          error: r.error,
          quickView: r.quickView,
        })),
      };
    });

    return Response.json({
      ok: true,
      provider: "Twelve Data",
      purpose: "International stock deep capability test",
      testedSymbols: symbols,
      testedEndpoints: endpoints,
      updatedAt: new Date().toISOString(),
      summary,
      results,
      notes: [
        "Use ?ticker=AAPL para testar apenas um ativo.",
        "Use ?endpoint=statistics para testar apenas um endpoint.",
        "O delay interno reduz risco de limite por minuto, mas endpoints premium podem retornar 403.",
      ],
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
