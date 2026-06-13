export const dynamic = "force-dynamic";
export const maxDuration = 30;

function todayBR() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function daysAgoBR(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function mmddyyyy(date) {
  const d = new Date(date);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}-${dd}-${yyyy}`;
}

function safeNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}

async function fetchText(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.text();
}

async function getSGS(code, label, days = 45) {
  try {
    const url =
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados?` +
      `formato=json&dataInicial=${daysAgoBR(days)}&dataFinal=${todayBR()}`;

    const data = await fetchJSON(url);
    const last = Array.isArray(data) ? data[data.length - 1] : null;

    return {
      label,
      value: last ? safeNumber(last.valor) : null,
      date: last?.data || null,
      source: "BCB SGS",
      ok: !!last,
    };
  } catch (e) {
    return {
      label,
      value: null,
      date: null,
      source: "BCB SGS",
      ok: false,
      error: e.message,
    };
  }
}

async function getPTAXUSD() {
  try {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 10);

    const dataInicial = mmddyyyy(start);
    const dataFinal = mmddyyyy(end);

    const url =
      "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
      `CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?` +
      `@dataInicial='${dataInicial}'&@dataFinalCotacao='${dataFinal}'&$top=100&$format=json`;

    const json = await fetchJSON(url);
    const arr = Array.isArray(json?.value) ? json.value : [];
    const last = arr[arr.length - 1];

    return {
      label: "USD PTAX venda",
      value: last ? safeNumber(last.cotacaoVenda) : null,
      date: last?.dataHoraCotacao || null,
      source: "BCB PTAX",
      ok: !!last,
    };
  } catch (e) {
    return {
      label: "USD PTAX venda",
      value: null,
      date: null,
      source: "BCB PTAX",
      ok: false,
      error: e.message,
    };
  }
}

async function getStooqDaily(symbols, label) {
  for (const symbol of symbols) {
    try {
      const today = new Date();
      const past = new Date();
      past.setDate(today.getDate() - 15);

      const d1 =
        past.getFullYear() +
        String(past.getMonth() + 1).padStart(2, "0") +
        String(past.getDate()).padStart(2, "0");

      const d2 =
        today.getFullYear() +
        String(today.getMonth() + 1).padStart(2, "0") +
        String(today.getDate()).padStart(2, "0");

      const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&d1=${d1}&d2=${d2}&i=d`;

      const csv = await fetchText(url);
      const lines = csv.trim().split("\n");

      if (lines.length < 2 || csv.toLowerCase().includes("no data")) continue;

      const last = lines[lines.length - 1].split(",");
      const date = last[0];
      const close = safeNumber(last[4]);

      if (close === null) continue;

      return {
        label,
        symbol,
        value: close,
        date,
        source: "Stooq",
        ok: true,
      };
    } catch (_) {}
  }

  return {
    label,
    symbol: symbols.join(" | "),
    value: null,
    date: null,
    source: "Stooq",
    ok: false,
    error: "Não encontrado nos símbolos testados",
  };
}

async function getFredCSV(series, label) {
  try {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`;
    const csv = await fetchText(url);
    const lines = csv.trim().split("\n").slice(1).filter(Boolean);

    for (let i = lines.length - 1; i >= 0; i--) {
      const [date, value] = lines[i].split(",");
      const n = safeNumber(value);
      if (n !== null) {
        return {
          label,
          value: n,
          date,
          source: "FRED",
          ok: true,
        };
      }
    }

    throw new Error("sem valor válido");
  } catch (e) {
    return {
      label,
      value: null,
      date: null,
      source: "FRED",
      ok: false,
      error: e.message,
    };
  }
}

export async function GET() {
  try {
    const [
      selicMeta,
      selicDiaria,
      cdi,
      ipca,
      usd,
      sp500,
      ibov,
      ifix,
      fedFunds,
    ] = await Promise.all([
      getSGS(432, "Selic Meta % a.a.", 120),
      getSGS(11, "Selic diária", 45),
      getSGS(12, "CDI diário", 45),
      getSGS(433, "IPCA mensal", 120),
      getPTAXUSD(),
      getStooqDaily(["^spx"], "S&P 500 pontos"),
      getStooqDaily(["^bvsp", "^ibov", "bvsp", "ibov"], "Ibovespa pontos"),
      getStooqDaily(["ifix", "^ifix"], "IFIX pontos"),
      getFredCSV("FEDFUNDS", "Fed Funds Rate"),
    ]);

    return Response.json({
      ok: true,
      updated_at: new Date().toISOString(),
      automatic: {
        selic_meta: selicMeta,
        selic_diaria: selicDiaria,
        cdi_diario: cdi,
        ipca_mensal: ipca,
        usd_ptax: usd,
        sp500_pontos: sp500,
        ibovespa_pontos: ibov,
        ifix_pontos: ifix,
        fed_funds: fedFunds,
      },
      manual_required: {
        pl_ibovespa: "manual",
        pl_sp500: "manual",
        top10_ibovespa: "manual/futuro",
        top10_sp500: "manual/futuro",
        juros_futuro_brasil: "manual/futuro",
      },
      note:
        "Dados gratuitos coletados de fontes públicas. P/L, composição top 10 e juros futuros permanecem manuais por enquanto.",
    });
  } catch (err) {
    return Response.json({
      ok: false,
      error: err.message,
    });
  }
}
