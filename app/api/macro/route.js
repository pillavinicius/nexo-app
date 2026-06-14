export const dynamic = "force-dynamic";
export const maxDuration = 30;

function dmy(d) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function todayBR() {
  return dmy(new Date());
}

function daysAgoBR(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return dmy(d);
}

function mmddyyyy(date) {
  const d = new Date(date);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;
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

async function text(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.text();
}

function item(label, value, date, source, extra = {}) {
  const valueNumber = n(value);
  const ok = valueNumber !== null;
  return {
    label,
    value: valueNumber,
    date: date || null,
    source,
    ok,
    mode: ok ? "automatic" : "manual_fallback",
    ...extra
  };
}

function alphaUrl(params) {
  const url = new URL("https://www.alphavantage.co/query");
  Object.entries(params).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== "") url.searchParams.set(k, String(v));
  });
  if (process.env.ALPHA_VANTAGE_KEY) url.searchParams.set("apikey", process.env.ALPHA_VANTAGE_KEY);
  return url.href;
}

async function alphaQuote(symbol, label) {
  try {
    const data = await json(alphaUrl({ function: "GLOBAL_QUOTE", symbol }));
    const q = data?.["Global Quote"];
    if (!q || Object.keys(q).length === 0) {
      throw new Error(data?.Note || data?.Information || "sem cotação");
    }
    return item(label, q["05. price"], q["07. latest trading day"], "Alpha Vantage", {
      symbol,
      change: n(q["09. change"]),
      changePercent: n(q["10. change percent"]),
      proxy: true
    });
  } catch (e) {
    return {
      label,
      value: null,
      date: null,
      source: "Alpha Vantage",
      ok: false,
      mode: "manual_fallback",
      symbol,
      proxy: true,
      error: e.message
    };
  }
}

async function getSGS(code, label, days = 60) {
  try {
    const url =
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados?` +
      `formato=json&dataInicial=${daysAgoBR(days)}&dataFinal=${todayBR()}`;
    const data = await json(url);
    const last = Array.isArray(data) ? data[data.length - 1] : null;
    return item(label, last?.valor ?? null, last?.data ?? null, "BCB SGS");
  } catch (e) {
    return { label, value: null, date: null, source: "BCB SGS", ok: false, mode: "manual_fallback", error: e.message };
  }
}

async function getPTAXUSD() {
  try {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 10);
    const url =
      "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
      `CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?` +
      `@dataInicial='${mmddyyyy(start)}'&@dataFinalCotacao='${mmddyyyy(end)}'&$top=100&$format=json`;
    const data = await json(url);
    const arr = Array.isArray(data?.value) ? data.value : [];
    const last = arr[arr.length - 1];
    return item("USD PTAX venda", last?.cotacaoVenda ?? null, last?.dataHoraCotacao ?? null, "BCB PTAX");
  } catch (e) {
    return { label: "USD PTAX venda", value: null, date: null, source: "BCB PTAX", ok: false, mode: "manual_fallback", error: e.message };
  }
}

async function getFredCSV(series, label) {
  try {
    const csv = await text(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`);
    const lines = csv.trim().split("\n").slice(1).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const [date, value] = lines[i].split(",");
      if (n(value) !== null) return item(label, value, date, "FRED");
    }
    throw new Error("sem valor válido");
  } catch (e) {
    return { label, value: null, date: null, source: "FRED", ok: false, mode: "manual_fallback", error: e.message };
  }
}

async function getHGFinance() {
  try {
    const url = new URL("https://api.hgbrasil.com/finance");
    if (process.env.HG_BRASIL_KEY) url.searchParams.set("key", process.env.HG_BRASIL_KEY);
    const data = await json(url.href);
    return {
      ok: true,
      source: "HG Brasil Finance",
      results: data?.results || {},
      valid_key: data?.valid_key ?? null,
      from_cache: data?.from_cache ?? null
    };
  } catch (e) {
    return { ok: false, source: "HG Brasil Finance", error: e.message, results: {} };
  }
}

function hgIndex(hg, key, label) {
  const it = hg?.results?.stocks?.[key];
  if (!it) {
    return { label, value: null, date: null, source: "HG Brasil Finance", ok: false, mode: "manual_fallback", error: `${key} não retornou na HG` };
  }
  return item(label, it.points, new Date().toISOString(), "HG Brasil Finance", {
    variation: n(it.variation),
    name: it.name || null,
    location: it.location || null
  });
}

function hgUSD(hg) {
  const usd = hg?.results?.currencies?.USD;
  if (!usd) {
    return { label: "USD HG", value: null, date: null, source: "HG Brasil Finance", ok: false, mode: "manual_fallback", error: "USD não retornou na HG" };
  }
  return item("USD HG", n(usd.sell) ?? n(usd.buy), new Date().toISOString(), "HG Brasil Finance", {
    buy: n(usd.buy),
    sell: n(usd.sell),
    variation: n(usd.variation)
  });
}

function hgRates(hg) {
  const t = Array.isArray(hg?.results?.taxes) ? hg.results.taxes[0] : null;
  if (!t) return {};
  return {
    selic_meta: item("Selic Meta % a.a.", t.selic, t.date || null, "HG Brasil Finance"),
    selic_diaria: item("Selic diária", t.selic_daily, t.date || null, "HG Brasil Finance"),
    cdi_diario: item("CDI diário", n(t.cdi_daily) ?? n(t.cdi), t.date || null, "HG Brasil Finance")
  };
}

function prefer(primary, fallback) {
  return primary?.ok ? primary : fallback;
}

export async function GET() {
  try {
    const [
      hg,
      bcbSelicMeta,
      bcbSelicDiaria,
      bcbCdi,
      bcbIpca,
      bcbUsd,
      fedFunds,
      spy,
      qqq,
      dia,
      iwm,
      vti
    ] = await Promise.all([
      getHGFinance(),
      getSGS(432, "Selic Meta % a.a.", 180),
      getSGS(11, "Selic diária", 60),
      getSGS(12, "CDI diário", 60),
      getSGS(433, "IPCA mensal", 180),
      getPTAXUSD(),
      getFredCSV("FEDFUNDS", "Fed Funds Rate"),
      alphaQuote("SPY", "S&P 500 proxy - SPY"),
      alphaQuote("QQQ", "Nasdaq 100 proxy - QQQ"),
      alphaQuote("DIA", "Dow Jones proxy - DIA"),
      alphaQuote("IWM", "Russell 2000 proxy - IWM"),
      alphaQuote("VTI", "US Total Market proxy - VTI")
    ]);

    const hgR = hgRates(hg);

    return Response.json({
      ok: true,
      updated_at: new Date().toISOString(),
      sources: {
        primary_official: ["BCB SGS", "BCB PTAX", "FRED"],
        market_fallback: ["HG Brasil Finance", "Alpha Vantage"],
        hg_valid_key: hg.valid_key,
        hg_ok: hg.ok,
        hg_error: hg.error || null,
        alpha_note: "Para índices dos EUA, o fallback gratuito usa ETFs líquidos como proxy: SPY, QQQ, DIA, IWM e VTI."
      },
      automatic: {
        selic_meta: prefer(bcbSelicMeta, hgR.selic_meta),
        selic_diaria: prefer(bcbSelicDiaria, hgR.selic_diaria),
        cdi_diario: prefer(bcbCdi, hgR.cdi_diario),
        ipca_mensal: bcbIpca,
        usd_ptax: prefer(bcbUsd, hgUSD(hg)),
        fed_funds: fedFunds,

        ibovespa_pontos: hgIndex(hg, "IBOVESPA", "Ibovespa pontos"),
        ifix_pontos: hgIndex(hg, "IFIX", "IFIX pontos"),
        nasdaq_pontos: hgIndex(hg, "NASDAQ", "NASDAQ pontos"),
        dowjones_pontos: hgIndex(hg, "DOWJONES", "Dow Jones pontos"),

        sp500_proxy_spy: spy,
        nasdaq100_proxy_qqq: qqq,
        dowjones_proxy_dia: dia,
        russell2000_proxy_iwm: iwm,
        us_total_market_proxy_vti: vti,

        sp500_pontos: {
          label: "S&P 500 pontos",
          value: null,
          date: null,
          source: "manual",
          ok: false,
          mode: "manual_fallback",
          error: "Alpha Vantage normalmente retorna ETF proxy gratuito, não o ponto oficial do índice. Use SPY como proxy ou preencha manualmente."
        }
      },
      manual_required: {
        pl_ibovespa: "manual",
        pl_sp500: "manual",
        top10_ibovespa: "manual/futuro",
        top10_sp500: "manual/futuro",
        juros_futuro_brasil: "manual/futuro"
      },
      priority_rule:
        "Se o usuário informar valor manual, usar o manual. Se manual vazio, usar automático. Se automático indisponível, marcar como não informado.",
      note:
        "BCB/FRED são priorizados para taxas oficiais. HG Brasil é usada para IBOVESPA/IFIX. Alpha Vantage entra como camada internacional e proxy de índices via ETFs."
    });
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
