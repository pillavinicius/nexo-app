export const NFI_VERSION = "NFI_v1.0";

const round = (value, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function percentileRank(values, current) {
  if (!values.length || current === null) return null;
  const below = values.filter((value) => value < current).length;
  const equal = values.filter((value) => value === current).length;
  return round((below + Math.max(0, equal - 1) / 2) / Math.max(1, values.length - 1));
}

function pressureFromPercentile(percentile) {
  if (percentile === null) return "neutra";
  if (percentile > 0.6) return "compradora";
  if (percentile < 0.4) return "vendedora";
  return "neutra";
}

function base(overrides = {}) {
  return {
    version: NFI_VERSION,
    status: "unavailable",
    segmento: "acoes",
    janela_dias: 30,
    fluxo_liquido_janela_brl: null,
    fluxo_parcial_mes_brl: null,
    fluxo_percentil_24m: null,
    fluxo_percentil_disponivel: null,
    pressao: "neutra",
    status_fonte: "unavailable",
    explica_deslocamento: false,
    history_months: 0,
    history_complete: false,
    source_as_of: null,
    window_reference_date: null,
    partial_as_of: null,
    source: "B3",
    valuation_effect: "none",
    note: null,
    ...overrides,
  };
}

export function notApplicableNFI(reason = "O NFI está restrito ao mercado brasileiro nesta fase.") {
  return base({ status: "not_applicable", note: reason });
}

export function computeNFI({ segmento = "acoes", janela_dias = 30, fluxo = [] } = {}) {
  const windowDays = Math.max(1, Math.round(finite(janela_dias) || 30));
  const windowMonths = Math.max(1, Math.ceil(windowDays / 30));
  const rows = (Array.isArray(fluxo) ? fluxo : [])
    .map((row) => ({
      data_ref: String(row?.data_ref || ""),
      segmento: String(row?.segmento || ""),
      fluxo_liquido_brl: finite(row?.fluxo_liquido_brl),
      tipo_investidor: String(row?.tipo_investidor || ""),
      status: String(row?.status || ""),
    }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.data_ref))
    .filter((row) => row.segmento === segmento && row.tipo_investidor === "estrangeiro")
    .filter((row) => row.fluxo_liquido_brl !== null)
    .sort((a, b) => a.data_ref.localeCompare(b.data_ref));

  if (!rows.length) return base({ segmento, janela_dias: windowDays });
  const latest = rows.at(-1);
  if (latest.status === "t2_pending") {
    return base({
      status: "pending",
      segmento,
      janela_dias: windowDays,
      status_fonte: "t2_pending",
      source_as_of: latest.data_ref,
      note: "Fluxo oficial ainda não publicado. null não é convertido em estimativa.",
    });
  }

  const isMonthEnd = (date) => {
    const parsed = new Date(`${date}T00:00:00Z`);
    return parsed.getUTCDate() === new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0)).getUTCDate();
  };
  const completeRows = rows.filter((row) => isMonthEnd(row.data_ref));
  const partialRow = isMonthEnd(latest.data_ref) ? null : latest;
  const values = completeRows.map((row) => row.fluxo_liquido_brl);
  if (!values.length) {
    return base({
      status: "insufficient_history",
      segmento,
      janela_dias: windowDays,
      status_fonte: latest.status,
      source_as_of: latest.data_ref,
      fluxo_parcial_mes_brl: partialRow?.fluxo_liquido_brl ?? null,
      partial_as_of: partialRow?.data_ref ?? null,
      note: "Ainda não há mês fechado suficiente para formar a distribuição.",
    });
  }
  const rolling = [];
  for (let index = windowMonths - 1; index < values.length; index += 1) {
    rolling.push(values.slice(index - windowMonths + 1, index + 1).reduce((sum, value) => sum + value, 0));
  }
  const current = rolling.at(-1);
  const availableHistory = Math.min(24, rolling.length);
  const distribution = rolling.slice(-availableHistory);
  const provisional = percentileRank(distribution, current);
  const historyComplete = distribution.length >= 24;
  const canonical = historyComplete ? provisional : null;
  const pressurePercentile = canonical ?? provisional;

  return base({
    status: historyComplete ? "ok" : "insufficient_history",
    segmento,
    janela_dias: windowDays,
    fluxo_liquido_janela_brl: round(current, 2),
    fluxo_parcial_mes_brl: partialRow?.fluxo_liquido_brl ?? null,
    fluxo_percentil_24m: canonical,
    fluxo_percentil_disponivel: provisional,
    pressao: pressureFromPercentile(pressurePercentile),
    status_fonte: latest.status,
    explica_deslocamento: historyComplete && (canonical < 0.1 || canonical > 0.9),
    history_months: distribution.length,
    history_complete: historyComplete,
    source_as_of: latest.data_ref,
    window_reference_date: completeRows.at(-1)?.data_ref || null,
    partial_as_of: partialRow?.data_ref ?? null,
    note: historyComplete
      ? "Percentil calculado sobre 24 observações mensais oficiais."
      : `Percentil provisório sobre ${distribution.length} observações; extremos só são ativados com 24 meses completos.`,
  });
}

export function buildNfiPromptContext(nfi) {
  if (!nfi || nfi.status === "not_applicable") {
    return "NFI não aplicável a ativos no exterior nesta fase. Não estime fluxo equivalente.";
  }
  if (nfi.status === "pending" || nfi.status === "unavailable") {
    return `NFI ${nfi.status}: fluxo oficial indisponível. Não estime nem use proxy silencioso.`;
  }
  return [
    "NFI calculado deterministicamente pelo servidor:",
    JSON.stringify({
      janela_dias: nfi.janela_dias,
      fluxo_liquido_janela_brl: nfi.fluxo_liquido_janela_brl,
      fluxo_parcial_mes_brl: nfi.fluxo_parcial_mes_brl,
      fluxo_percentil_24m: nfi.fluxo_percentil_24m,
      fluxo_percentil_disponivel: nfi.fluxo_percentil_disponivel,
      pressao: nfi.pressao,
      explica_deslocamento: nfi.explica_deslocamento,
      history_months: nfi.history_months,
      status_fonte: nfi.status_fonte,
      window_reference_date: nfi.window_reference_date,
      partial_as_of: nfi.partial_as_of,
    }),
    nfi.explica_deslocamento
      ? "O extremo autoriza citar fluxo como causa provável do deslocamento de preço."
      : "Não classifique o fluxo como extremo nem como causa comprovada do deslocamento.",
    "REGRA INVIOLÁVEL: NFI explica deslocamento; nunca altera valor intrínseco, score ou veredito e nunca é motivo isolado de compra.",
  ].join("\n");
}

export function applyNfiToAnalysis({ result, nfi } = {}) {
  const source = result && typeof result === "object" ? result : {};
  return {
    ...source,
    nexoModules: { ...(source.nexoModules || {}), NFI: nfi },
  };
}

function selfTest() {
  const flow = Array.from({ length: 24 }, (_, index) => ({
    data_ref: new Date(Date.UTC(2024, index + 2, 0)).toISOString().slice(0, 10),
    segmento: "acoes",
    fluxo_liquido_brl: index + 1,
    tipo_investidor: "estrangeiro",
    status: "t2_official",
  }));
  const extreme = computeNFI({ fluxo: flow });
  if (!extreme.history_complete || extreme.fluxo_percentil_24m !== 1 || !extreme.explica_deslocamento) {
    throw new Error("NFI extreme gate failed");
  }
  const short = computeNFI({ fluxo: flow.slice(-21) });
  if (short.fluxo_percentil_24m !== null || short.explica_deslocamento) throw new Error("NFI history gate failed");
  const pending = computeNFI({ fluxo: [{ ...flow[0], status: "t2_pending" }] });
  if (pending.fluxo_liquido_janela_brl !== null) throw new Error("NFI pending null rule failed");
  const governed = applyNfiToAnalysis({ result: { score_total: 21, veredito: "APROVADO" }, nfi: extreme });
  if (governed.score_total !== 21 || governed.veredito !== "APROVADO") throw new Error("NFI governance boundary failed");
  console.log("NFI self-test: OK");
}

if (process.env.NEXO_SELFTEST === "1") selfTest();
