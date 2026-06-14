export const dynamic = "force-dynamic";
export const maxDuration = 30;

function todayBR() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function daysAgoBR(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function mmddyyyy(date) {
  const d = new Date(date);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;
}

function safeNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  const text = await r.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Resposta não-JSON: " + text.slice(0, 300));
  }

  if (!r.ok) {
    throw new Error("HTTP " + r.status + ": " + (data?.message || data?.error || "erro desconhecido"));
  }

  return data;
}

async function fetchText(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.text();
}

function item(label, value, date, source, extra = {}) {
  const ok = value !== null && value !== undefined && value !== "";
  return {
    label,
    value: ok ? safeNumber(value) : null,
    date: date || null,
    source,
    ok,
    mode: ok ? "automatic" : "manual_fallback",
    ...extra,
  };
}

async function getSGS(code, label, days = 60) {
  try {
    const url =
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados?` +
      `formato=json&dataInicial=${daysAgoBR(days)}&dataFinal=${todayBR()}`;

    const data = await fetchJSON(url);
    const last = Array.isArray(data) ? data[data.length - 1] : null;
    return item(label, last?.valor ?? null, last?.data ?? null, "BCB SGS");
  } catch (e) {
    return {
      label,
      value: null,
      date: null,
      source: "BCB SGS",
      ok: false,
      mode: "manual_fallback",
      error: e.message,
    };
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

    const json = await fetchJSON(url);
    const arr = Array.isArray(json?.value) ? json.value : [];
    const last = arr[arr.length - 1];

    return item("USD PTAX venda", last?.cotacaoVenda ?? null, last?.dataHoraCotacao ?? null, "BCB PTAX");
  } catch (e) {
    return {
      label: "USD PTAX venda",
      value: null,
      date: null,
      source: "BCB PTAX",
      ok: false,
      mode: "manual_fallback",
      error: e.message,
    };
  }
}

async function getFredCSV(series, label) {
  try {
    const csv = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`);
    const lines = csv.trim().split("\n").slice(1).filter(Boolean);

    for (let i = lines.length - 1; i >= 0; i--) {
      const [date, value] = lines[i].split(",");
      const n = safeNumber(value);
      if (n !== null) return item(label, n, date, "FRED");
    }

    throw new Error("sem valor válido");
  } catch (e) {
    return {
      label,
      value: null,
      date: null,
      source: "FRED",
      ok: false,
      mode: "manual_fallback",
      error: e.message,
    };
  }
}

async function getHGFinance() {
  try {
    const key = process.env.HG_BRASIL_KEY || "";
    const url = new URL("https://api.hgbrasil.com/finance");
    if (key) url.searchParams.set("key", key);

    const data = await fetchJSON(url.href);

    return {
      ok: true,
      source: "HG Brasil Finance",
      results: data?.results || {},
      valid_key: data?.valid_key ?? null,
      from_cache: data?.from_cache ?? null,
    };
  } catch (e) {
    return {
      ok: false,
      source: "HG Brasil Finance",
      error: e.message,
      results: {},
    };
  }
}

function hgIndex(hg, key, label) {
  const it = hg?.results?.stocks?.[key];

  if (!it) {
    return {
      label,
      value: null,
      date: null,
      source: "HG Brasil Finance",
      ok: false,
      mode: "manual_fallback",
      error: `${key} não retornou na HG`,
    };
  }

  return item(label, it.points, new Date().toISOString(), "HG Brasil Finance", {
    variation: safeNumber(it.variation),
    name: it.name || null,
    location: it.location || null,
  });
}

function hgUSD(hg) {
  const usd = hg?.results?.currencies?.USD;
  if (!usd) {
    return {
      label: "USD HG",
      value: null,
      date: null,
      source: "HG Brasil Finance",
      ok: false,
      mode: "manual_fallback",
      error: "USD não retornou na HG",
    };
  }

  return item("USD HG", safeNumber(usd.sell) ?? safeNumber(usd.buy), new Date().toISOString(), "HG Brasil Finance", {
    buy: safeNumber(usd.buy),
    sell: safeNumber(usd.sell),
    variation: safeNumber(usd.variation),
  });
}

function hgRates(hg) {
  const t = Array.isArray(hg?.results?.taxes) ? hg.results.taxes[0] : null;

  if (!t) return {};

  return {
    selic_meta: item("Selic Meta % a.a.", t.selic, t.date || null, "HG Brasil Finance"),
    selic_diaria: item("Selic diária", t.selic_daily, t.date || null, "HG Brasil Finance"),
    cdi_diario: item("CDI diário", safeNumber(t.cdi_daily) ?? safeNumber(t.cdi), t.date || null, "HG Brasil Finance"),
  };
}

async function getStooqSP500() {
  try {
    const today = new Date();
    const past = new Date();
    past.setDate(today.getDate() - 20);

    const d1 = `${past.getFullYear()}${String(past.getMonth() + 1).padStart(2, "0")}${String(past.getDate()).padStart(2, "0")}`;
    const d2 = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

    for (const symbol of ["^spx", "spy.us", "voo.us", "ivv.us"]) {
      try {
        const csv = await fetchText(`https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&d1=${d1}&d2=${d2}&i=d`);
        if (csv.toLowerCase().includes("no data")) continue;
        const lines = csv.trim().split("\n").filter(Boolean);
        if (lines.length < 2) continue;

        const last = lines[lines.length - 1].split(",");
        const close = safeNumber(last[4]);
        if (close !== null) return item("S&P 500 pontos", close, last[0], "Stooq", { symbol });
      } catch (_) {}
    }

    throw new Error("não encontrado");
  } catch (e) {
    return {
      label: "S&P 500 pontos",
      value: null,
      date: null,
      source: "Stooq",
      ok: false,
      mode: "manual_fallback",
      error: e.message,
    };
  }
}

function prefer(primary, fallback) {
  return primary?.ok ? primary : fallback;
}

export async function GET() {
  try {
    const [hg, bcbSelicMeta, bcbSelicDiaria, bcbCdi, bcbIpca, bcbUsd, fedFunds, sp500] =
      await Promise.all([
        getHGFinance(),
        getSGS(432, "Selic Meta % a.a.", 180),
        getSGS(11, "Selic diária", 60),
        getSGS(12, "CDI diário", 60),
        getSGS(433, "IPCA mensal", 180),
        getPTAXUSD(),
        getFredCSV("FEDFUNDS", "Fed Funds Rate"),
        getStooqSP500(),
      ]);

    const hgR = hgRates(hg);

    return Response.json({
      ok: true,
      updated_at: new Date().toISOString(),
      sources: {
        primary_official: ["BCB SGS", "BCB PTAX", "FRED"],
        market_fallback: ["HG Brasil Finance", "Stooq"],
        hg_valid_key: hg.valid_key,
        hg_ok: hg.ok,
        hg_error: hg.error || null,
      },
      automatic: {
        selic_meta: prefer(bcbSelicMeta, hgR.selic_meta),
        selic_diaria: prefer(bcbSelicDiaria, hgR.selic_diaria),
        cdi_diario: prefer(bcbCdi, hgR.cdi_diario),
        ipca_mensal: bcbIpca,
        usd_ptax: prefer(bcbUsd, hgUSD(hg)),
        fed_funds: fedFunds,
        sp500_pontos: sp500,
        ibovespa_pontos: hgIndex(hg, "IBOVESPA", "Ibovespa pontos"),
        ifix_pontos: hgIndex(hg, "IFIX", "IFIX pontos"),
        nasdaq_pontos: hgIndex(hg, "NASDAQ", "NASDAQ pontos"),
        dowjones_pontos: hgIndex(hg, "DOWJONES", "Dow Jones pontos"),
      },
      manual_required: {
        pl_ibovespa: "manual",
        pl_sp500: "manual",
        top10_ibovespa: "manual/futuro",
        top10_sp500: "manual/futuro",
        juros_futuro_brasil: "manual/futuro",
      },
      priority_rule:
        "Se o usuário informar valor manual, usar o manual. Se manual vazio, usar automático. Se automático indisponível, marcar como não informado.",
      note:
        "BCB/FRED são priorizados para taxas oficiais. HG Brasil é usada para IBOVESPA/IFIX e fallback de mercado. Stooq segue como fallback do S&P 500.",
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err.message,
      },
      { status: 500 }
    );
  }
}
