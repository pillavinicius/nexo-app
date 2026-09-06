export const HDL_VERSION = "HDL_v1.0";

const STATUS = Object.freeze({
  OK: "ok",
  MISSING_INPUT: "missing_input",
  INVALID_INPUT: "invalid_input",
  CURVE_UNAVAILABLE: "curve_unavailable",
  OUT_OF_CURVE: "out_of_curve",
  NOT_APPLICABLE: "not_applicable",
});

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "string" ? value.trim().replace(",", ".") : value;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function validIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function baseResult(overrides = {}) {
  return {
    version: HDL_VERSION,
    status: STATUS.CURVE_UNAVAILABLE,
    hurdle_real_pct: null,
    alfa_vs_classe_pp: null,
    supera_hurdle: null,
    vertice_usado_anos: null,
    curva_as_of: null,
    tir_esperada_pct: null,
    horizonte_anos: null,
    selection_method: null,
    vertices_base_anos: [],
    source: null,
    source_status: null,
    requires_justification: null,
    error_code: null,
    units: {
      tir_esperada_pct: "% real a.a.",
      hurdle_real_pct: "% real a.a.",
      alfa_vs_classe_pp: "p.p.",
      horizonte_anos: "anos",
      vertice_usado_anos: "anos",
    },
    ...overrides,
  };
}

function normalizeCurve(curve) {
  const rows = (Array.isArray(curve) ? curve : [])
    .map((row) => ({
      data_ref: String(row?.data_ref || "").trim(),
      vertice_anos: finiteNumber(row?.vertice_anos),
      taxa_real_pct: finiteNumber(row?.taxa_real_pct),
      fonte: String(row?.fonte || "").trim() || null,
      status: String(row?.status || "").trim() || null,
    }))
    .filter(
      (row) =>
        validIsoDate(row.data_ref) &&
        row.vertice_anos !== null &&
        row.vertice_anos > 0 &&
        row.taxa_real_pct !== null
    );

  if (!rows.length) return [];
  const latestDate = rows.reduce(
    (latest, row) => (row.data_ref > latest ? row.data_ref : latest),
    rows[0].data_ref
  );
  const unique = new Map();
  for (const row of rows.filter((item) => item.data_ref === latestDate)) {
    unique.set(row.vertice_anos, row);
  }
  return [...unique.values()].sort((a, b) => a.vertice_anos - b.vertice_anos);
}

export function notApplicableHDL(reason = "A curva HDL F1a é denominada em BRL e não se aplica a ativos no exterior.") {
  return baseResult({
    status: STATUS.NOT_APPLICABLE,
    error_code: "hdl_not_applicable",
    note: reason,
  });
}

export function computeHDL({ tir_esperada_pct, horizonte_anos, curva } = {}) {
  const tir = finiteNumber(tir_esperada_pct);
  const horizon = finiteNumber(horizonte_anos);

  if (tir === null || horizon === null) {
    return baseResult({
      status: STATUS.MISSING_INPUT,
      tir_esperada_pct: tir,
      horizonte_anos: horizon,
      error_code: "hdl_input_required",
    });
  }

  if (horizon <= 0 || tir <= -100) {
    return baseResult({
      status: STATUS.INVALID_INPUT,
      tir_esperada_pct: tir,
      horizonte_anos: horizon,
      error_code: "hdl_input_invalid",
    });
  }

  const points = normalizeCurve(curva);
  if (!points.length) {
    return baseResult({
      status: STATUS.CURVE_UNAVAILABLE,
      tir_esperada_pct: tir,
      horizonte_anos: horizon,
      error_code: "hdl_curve_unavailable",
    });
  }

  const first = points[0];
  const last = points.at(-1);
  const common = {
    tir_esperada_pct: round(tir),
    horizonte_anos: round(horizon),
    curva_as_of: last.data_ref,
    source: last.fonte,
    source_status: last.status,
    curve_min_vertex_years: first.vertice_anos,
    curve_max_vertex_years: last.vertice_anos,
  };

  if (horizon > last.vertice_anos) {
    return baseResult({
      ...common,
      status: STATUS.OUT_OF_CURVE,
      error_code: "hdl_extrapolation_forbidden",
      curve_max_vertex_years: last.vertice_anos,
    });
  }

  let hurdle;
  let selectionMethod;
  let baseVertices;

  if (horizon <= first.vertice_anos) {
    hurdle = first.taxa_real_pct;
    selectionMethod = horizon === first.vertice_anos ? "exact_vertex" : "shortest_vertex_floor";
    baseVertices = [first.vertice_anos];
  } else {
    const exact = points.find((point) => Math.abs(point.vertice_anos - horizon) < 1e-9);
    if (exact) {
      hurdle = exact.taxa_real_pct;
      selectionMethod = "exact_vertex";
      baseVertices = [exact.vertice_anos];
    } else {
      const upperIndex = points.findIndex((point) => point.vertice_anos > horizon);
      const lower = points[upperIndex - 1];
      const upper = points[upperIndex];
      const weight = (horizon - lower.vertice_anos) / (upper.vertice_anos - lower.vertice_anos);
      hurdle = lower.taxa_real_pct + weight * (upper.taxa_real_pct - lower.taxa_real_pct);
      selectionMethod = "linear_interpolation";
      baseVertices = [lower.vertice_anos, upper.vertice_anos];
    }
  }

  const roundedHurdle = round(hurdle);
  const alpha = round(tir - roundedHurdle);
  return baseResult({
    ...common,
    status: STATUS.OK,
    hurdle_real_pct: roundedHurdle,
    alfa_vs_classe_pp: alpha,
    supera_hurdle: alpha > 0,
    vertice_usado_anos: round(horizon),
    selection_method: selectionMethod,
    vertices_base_anos: baseVertices,
    requires_justification: alpha <= 0,
  });
}

export function buildHdlPromptContext(hdl) {
  if (!hdl || hdl.status === STATUS.NOT_APPLICABLE) {
    return [
      "HDL não aplicável a este ativo nesta fase.",
      "Não compare retornos em moedas diferentes e não invente uma curva equivalente.",
    ].join("\n");
  }

  if (hdl.status !== STATUS.OK) {
    return `HDL indisponível: ${hdl.error_code || hdl.status}. Não estime valores ausentes.`;
  }

  return [
    "Valores HDL calculados deterministicamente pelo servidor (imutáveis):",
    JSON.stringify({
      tir_esperada_pct: hdl.tir_esperada_pct,
      horizonte_anos: hdl.horizonte_anos,
      hurdle_real_pct: hdl.hurdle_real_pct,
      alfa_vs_classe_pp: hdl.alfa_vs_classe_pp,
      supera_hurdle: hdl.supera_hurdle,
      curva_as_of: hdl.curva_as_of,
    }),
    "Preencha hdl_conclusao em português, interpretando a comparação sem recalcular os números.",
    hdl.requires_justification
      ? "Como alfa_vs_classe_pp <= 0, declare explicitamente por que a tese ainda mereceria acompanhamento ou reconheça que não supera o soberano."
      : "Explique de forma breve o que o alfa positivo representa e quais premissas precisam permanecer válidas.",
    "O HDL não altera score ou veredito; ele apenas qualifica a conclusão.",
  ].join("\n");
}

function hasExplicitJustification(text) {
  const normalized = String(text || "").trim();
  if (normalized.length < 36) return false;
  return /(porque|apesar|justific|risco|premissa|catalis|assimetr|não supera|nao supera|inferior|soberan|hurdle)/i.test(
    normalized
  );
}

export function applyHdlToAnalysis({ phase, result, hdl }) {
  const source = result && typeof result === "object" ? result : {};
  const module = hdl || source?.nexoModules?.HDL || null;
  if (!module) return source;

  const conclusion = String(source.hdl_conclusao || "").trim();
  const conclusionRequired = phase === "deep" && module.status === STATUS.OK;
  const hasConclusion = conclusion.length >= 20;
  const justificationRequired = conclusionRequired && module.requires_justification === true;
  const hasJustification = !justificationRequired || hasExplicitJustification(conclusion);

  return {
    ...source,
    hdl_conclusao: conclusion || null,
    hdl_integrity: {
      version: HDL_VERSION,
      complete: !conclusionRequired || (hasConclusion && hasJustification),
      conclusion_required: conclusionRequired,
      justification_required: justificationRequired,
      conclusion_present: hasConclusion,
      explicit_justification_present: hasJustification,
      score_untouched: true,
      verdict_untouched: true,
    },
    nexoModules: {
      ...(source.nexoModules || {}),
      HDL: module,
    },
  };
}

export function selfTest() {
  const curve = [
    { data_ref: "2026-09-04", vertice_anos: 1, taxa_real_pct: 7, fonte: "anbima_ettj", status: "official" },
    { data_ref: "2026-09-04", vertice_anos: 5, taxa_real_pct: 8, fonte: "anbima_ettj", status: "official" },
    { data_ref: "2026-09-04", vertice_anos: 10, taxa_real_pct: 7, fonte: "anbima_ettj", status: "official" },
  ];
  const exact = computeHDL({ tir_esperada_pct: 9, horizonte_anos: 5, curva: curve });
  if (exact.hurdle_real_pct !== 8 || exact.alfa_vs_classe_pp !== 1 || !exact.supera_hurdle) {
    throw new Error("HDL exact vertex failed");
  }
  for (const field of [
    "version",
    "hurdle_real_pct",
    "alfa_vs_classe_pp",
    "supera_hurdle",
    "vertice_usado_anos",
    "curva_as_of",
  ]) {
    if (!(field in exact)) throw new Error(`HDL contract field missing: ${field}`);
  }
  for (const forbidden of ["score", "veredito", "classificacao"]) {
    if (forbidden in exact) throw new Error(`HDL cannot produce ${forbidden}`);
  }
  const interpolation = computeHDL({ tir_esperada_pct: 7.5, horizonte_anos: 7.5, curva: curve });
  if (interpolation.hurdle_real_pct !== 7.5 || interpolation.alfa_vs_classe_pp !== 0) {
    throw new Error("HDL interpolation failed");
  }
  const outside = computeHDL({ tir_esperada_pct: 9, horizonte_anos: 11, curva: curve });
  if (outside.status !== STATUS.OUT_OF_CURVE || outside.hurdle_real_pct !== null) {
    throw new Error("HDL extrapolation guard failed");
  }
  const governed = applyHdlToAnalysis({
    phase: "deep",
    result: { score_revisado: 12, veredito_final: "MONITORAR", hdl_conclusao: "Não supera o soberano porque a TIR estimada permanece inferior ao hurdle." },
    hdl: interpolation,
  });
  if (!governed.hdl_integrity.complete || governed.score_revisado !== 12 || governed.veredito_final !== "MONITORAR") {
    throw new Error("HDL governance boundary failed");
  }
  return true;
}

if (process.env.NEXO_SELFTEST === "1") {
  selfTest();
  console.log("HDL self-test: OK");
}
