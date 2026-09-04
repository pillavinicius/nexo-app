export const EDG_VERSION = "EDG_v1.0";

export const EDGE_TYPES = Object.freeze([
  "informacional",
  "analitico",
  "estrutural",
  "temporal",
  "nenhum",
]);

export const EDGE_STATUSES = Object.freeze([
  "ativo",
  "expirado",
  "nao_declarado",
]);

export const EDGE_INSUMOS = Object.freeze([
  "IQD",
  "NMI",
  "SEE",
  "FDM",
  "CNE",
  "PIJR",
  "TNH",
  "PIN",
  "RES",
  "ECS",
  "ICN-D",
  "ICN-R",
  "GNP",
  "HDL",
  "NFI",
  "TDN",
  "BJR",
  "NCS",
  "NALM",
]);

const RECORD_FIELDS = Object.freeze([
  "edge_type",
  "edge_evidence",
  "edge_insumo",
  "edge_expiry_condition",
  "edge_declared_at",
  "edge_status",
]);

const VAGUE_EXPIRY_PATTERNS = Object.freeze([
  /tese (nao )?(fizer|faca|faz) (mais )?sentido/,
  /tese deixar de fazer sentido/,
  /tese nao se confirmar/,
  /quando (o )?cenario mudar/,
  /quando (o )?fundamento mudar/,
  /quando perder fundamento/,
  /quando (nao )?for mais atrativ[oa]/,
  /quando piorar/,
]);

const METRIC_TERMS = Object.freeze([
  "margem",
  "receita",
  "lucro",
  "ebitda",
  "ebit",
  "divida",
  "alavancagem",
  "payout",
  "vacancia",
  "inadimplencia",
  "roe",
  "roic",
  "spread",
  "taxa",
  "volume",
  "market share",
  "fluxo",
  "preco",
  "cota",
]);

const COMPARISON_TERMS = Object.freeze([
  "acima",
  "abaixo",
  "cruzar",
  "atingir",
  "superar",
  "exceder",
  "cair",
  "subir",
  "romper",
  "reduzir",
  "aumentar",
]);

const EVENT_TERMS = Object.freeze([
  "contrato",
  "concessao",
  "licenca",
  "patente",
  "regulacao",
  "guidance",
  "rating",
  "downgrade",
  "default",
  "vencimento",
  "aprovacao",
  "rejeicao",
  "revogacao",
  "cancelamento",
  "rescisao",
]);

const EVENT_ACTIONS = Object.freeze([
  "revogar",
  "revogado",
  "cancelar",
  "cancelado",
  "rescindir",
  "rescindido",
  "aprovar",
  "aprovado",
  "rejeitar",
  "rejeitado",
  "perder",
  "expirar",
  "vencer",
  "ocorrer",
]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function canonicalText(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function isIsoDate(value) {
  const text = clean(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;

  const date = new Date(`${text}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3])
  );
}

export function isObservableExpiryCondition(value) {
  const text = canonicalText(value);
  if (text.length < 20) return false;
  if (VAGUE_EXPIRY_PATTERNS.some((pattern) => pattern.test(text))) return false;

  const hasNumber = /\d/.test(text);
  const hasMetric = hasAny(text, METRIC_TERMS);
  const hasComparison = hasAny(text, COMPARISON_TERMS);
  const hasMeasuredWindow = /(dia|dias|mes|meses|trimestre|trimestres|ano|anos)/.test(text);
  const hasConcreteEvent = hasAny(text, EVENT_TERMS) && hasAny(text, EVENT_ACTIONS);

  return (hasNumber && hasMetric && (hasComparison || hasMeasuredWindow)) || hasConcreteEvent;
}

export function normalizeEdgeRecord(record = {}) {
  return Object.fromEntries(RECORD_FIELDS.map((field) => [field, clean(record?.[field])]));
}

export function validateEdgeRecord(record = {}, { availableModules = EDGE_INSUMOS } = {}) {
  const normalized = normalizeEdgeRecord(record);
  const errors = [];
  const type = normalized.edge_type;

  if (!type) {
    errors.push("edge_type_required");
  } else if (!EDGE_TYPES.includes(type)) {
    errors.push("edge_type_invalid");
  }

  if (type === "nenhum") {
    if (normalized.edge_status && normalized.edge_status !== "nao_declarado") {
      errors.push("edge_status_must_be_nao_declarado");
    }
    return { valid: errors.length === 0, errors, record: normalized };
  }

  if (type && EDGE_TYPES.includes(type)) {
    if (normalized.edge_evidence.length < 12) {
      errors.push("edge_evidence_not_verifiable");
    }

    if (!normalized.edge_insumo) {
      errors.push("edge_insumo_required");
    } else if (!availableModules.includes(normalized.edge_insumo)) {
      errors.push("edge_insumo_unknown");
    }

    if (!normalized.edge_expiry_condition) {
      errors.push("edge_expiry_condition_required");
    } else if (!isObservableExpiryCondition(normalized.edge_expiry_condition)) {
      errors.push("edge_expiry_condition_not_observable");
    }

    if (!isIsoDate(normalized.edge_declared_at)) {
      errors.push("edge_declared_at_invalid");
    }

    if (!normalized.edge_status) {
      errors.push("edge_status_required");
    } else if (!["ativo", "expirado"].includes(normalized.edge_status)) {
      errors.push("edge_status_invalid");
    }
  }

  return { valid: errors.length === 0, errors, record: normalized };
}

export function computeEDG(record = {}, options = {}) {
  const normalized = normalizeEdgeRecord(record);
  const validation = validateEdgeRecord(normalized, options);
  const filledFields = RECORD_FIELDS.filter((field) => normalized[field] !== "").length;
  const declaredType = EDGE_TYPES.includes(normalized.edge_type)
    ? normalized.edge_type
    : "nenhum";
  const hasDeclaredEdge =
    validation.valid && declaredType !== "nenhum" && ["ativo", "expirado"].includes(normalized.edge_status);
  const expiryTriggered = hasDeclaredEdge && normalized.edge_status === "expirado";

  return {
    version: EDG_VERSION,
    edge_type: declaredType,
    edge_status: hasDeclaredEdge ? normalized.edge_status : "nao_declarado",
    has_declared_edge: hasDeclaredEdge,
    expiry_triggered: expiryTriggered,
    max_allowed_classification: hasDeclaredEdge ? "posicao" : "watchlist",
    exit_signal: expiryTriggered ? "edge_expired" : "none",
    ledger_completeness: round(filledFields / RECORD_FIELDS.length),
    validation: {
      valid: validation.valid,
      errors: validation.errors,
    },
    policy: {
      d2_watchlist_ceiling_ratified: true,
      d3_edge_stop_precedence_ratified: true,
    },
  };
}

export function buildEdgPromptContext(edg, record = {}) {
  const normalized = normalizeEdgeRecord(record);
  const result = edg || computeEDG(normalized);
  const lines = [
    `EDG VALIDADO — ${result.version}`,
    `Tipo: ${result.edge_type}; status: ${result.edge_status}`,
    `Edge declarado e verificável: ${result.has_declared_edge ? "sim" : "não"}`,
    `Completude do ledger: ${(result.ledger_completeness * 100).toFixed(2)}%`,
    `Classificação máxima: ${result.max_allowed_classification}`,
    `Sinal de saída: ${result.exit_signal}`,
  ];

  if (result.has_declared_edge) {
    lines.push(
      `Evidência: ${normalized.edge_evidence}`,
      `Insumo NEXO: ${normalized.edge_insumo}`,
      `Condição observável de expiração: ${normalized.edge_expiry_condition}`,
      `Declarado em: ${normalized.edge_declared_at}`
    );
  }

  if (result.validation.errors.length) {
    lines.push(`Falhas do contrato: ${result.validation.errors.join(", ")}.`);
  }

  if (!result.has_declared_edge) {
    lines.push(
      "REGRA D2 RATIFICADA: sem edge válido, o Scan não pode superar WATCHLIST e Deep/Final não podem emitir COMPRAR."
    );
  }

  if (result.exit_signal === "edge_expired") {
    lines.push(
      "REGRA D3 RATIFICADA: o edge expirou; o sinal de saída precede qualquer leitura favorável de preço."
    );
  }

  lines.push(
    "O EDG não cria recomendação de compra. Ele apenas limita classificações de outros módulos e mantém a decisão auditável."
  );

  return lines.join("\n");
}

function classificationFieldsForPhase(phase) {
  if (phase === "scan") return ["veredito"];
  if (phase === "deep") return ["veredito_final"];
  if (phase === "final") return ["classificacao_final", "veredito_reclassificado"];
  return [];
}

function limitedClassification({ phase, current, edg }) {
  if (typeof current !== "string") return current;
  const value = current.toUpperCase();

  if (edg.exit_signal === "edge_expired") {
    if (phase === "scan" && value === "APROVADO") return "WATCHLIST";
    if (["deep", "final"].includes(phase) && ["COMPRAR", "MONITORAR", "AGUARDAR"].includes(value)) {
      return "EVITAR";
    }
    return current;
  }

  if (!edg.has_declared_edge) {
    if (phase === "scan" && value === "APROVADO") return "WATCHLIST";
    if (["deep", "final"].includes(phase) && value === "COMPRAR") return "MONITORAR";
  }

  return current;
}

export function applyEdgGuardrails({ phase, result, edg }) {
  const source = result && typeof result === "object" ? result : {};
  const governed = {
    ...source,
    nexoModules: {
      ...(source.nexoModules || {}),
      EDG: edg,
    },
  };
  const changes = [];

  for (const field of classificationFieldsForPhase(phase)) {
    const before = governed[field];
    const after = limitedClassification({ phase, current: before, edg });
    if (before !== after) {
      governed[field] = after;
      changes.push({ field, before, after });
    }
  }

  governed.edg_governance = {
    applied: changes.length > 0,
    rule: edg.exit_signal === "edge_expired" ? "D3" : !edg.has_declared_edge ? "D2" : "none",
    changes,
  };

  return governed;
}

function validRecord(overrides = {}) {
  return {
    edge_type: "analitico",
    edge_evidence: "Margem bruta permaneceu acima da média setorial em dados auditados.",
    edge_insumo: "IQD",
    edge_expiry_condition: "Quando a margem bruta cruzar 17% para baixo por dois trimestres.",
    edge_declared_at: "2026-09-04",
    edge_status: "ativo",
    ...overrides,
  };
}

function assertEqual(actual, expected) {
  if (!Object.is(actual, expected)) {
    throw new Error(`esperado ${JSON.stringify(expected)}, recebido ${JSON.stringify(actual)}`);
  }
}

function assertOk(value, message = "condição esperada não foi satisfeita") {
  if (!value) throw new Error(message);
}

export function selfTest() {
  let passed = 0;
  let failed = 0;

  const test = (name, fn) => {
    try {
      fn();
      passed += 1;
      console.log(`PASS  ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL  ${name}: ${error.message}`);
    }
  };

  test("tese completa declara edge e libera classificacao", () => {
    const result = computeEDG(validRecord());
    assertEqual(result.has_declared_edge, true);
    assertEqual(result.max_allowed_classification, "posicao");
    assertEqual(result.validation.valid, true);
  });

  test("tese sem edge_type vira nao_declarado e teto watchlist", () => {
    const result = computeEDG(validRecord({ edge_type: "" }));
    assertEqual(result.edge_status, "nao_declarado");
    assertEqual(result.has_declared_edge, false);
    assertEqual(result.max_allowed_classification, "watchlist");
  });

  test("expiracao vaga e rejeitada", () => {
    const result = computeEDG(
      validRecord({ edge_expiry_condition: "Quando a tese não fizer mais sentido." })
    );
    assertEqual(result.validation.valid, false);
    assertOk(result.validation.errors.includes("edge_expiry_condition_not_observable"));
    assertEqual(result.has_declared_edge, false);
  });

  test("edge expirado emite sinal D3", () => {
    const result = computeEDG(validRecord({ edge_status: "expirado" }));
    assertEqual(result.expiry_triggered, true);
    assertEqual(result.exit_signal, "edge_expired");
  });

  test("completude parcial e calculada", () => {
    const result = computeEDG({
      edge_type: "analitico",
      edge_evidence: "Evidência mensurável",
      edge_status: "ativo",
    });
    assertEqual(result.ledger_completeness, 0.5);
  });

  test("nenhum e uma declaracao honesta valida", () => {
    const result = computeEDG({ edge_type: "nenhum", edge_status: "nao_declarado" });
    assertEqual(result.validation.valid, true);
    assertEqual(result.has_declared_edge, false);
    assertEqual(result.max_allowed_classification, "watchlist");
  });

  test("insumo inexistente invalida o edge", () => {
    const result = computeEDG(validRecord({ edge_insumo: "INTUICAO" }));
    assertOk(result.validation.errors.includes("edge_insumo_unknown"));
    assertEqual(result.has_declared_edge, false);
  });

  test("D2 rebaixa Scan aprovado para watchlist", () => {
    const edg = computeEDG({ edge_type: "nenhum", edge_status: "nao_declarado" });
    const result = applyEdgGuardrails({ phase: "scan", result: { veredito: "APROVADO" }, edg });
    assertEqual(result.veredito, "WATCHLIST");
    assertEqual(result.edg_governance.rule, "D2");
  });

  test("D2 rebaixa Deep comprar para monitorar", () => {
    const edg = computeEDG({ edge_type: "nenhum", edge_status: "nao_declarado" });
    const result = applyEdgGuardrails({ phase: "deep", result: { veredito_final: "COMPRAR" }, edg });
    assertEqual(result.veredito_final, "MONITORAR");
  });

  test("D3 prevalece sobre classificacao favoravel", () => {
    const edg = computeEDG(validRecord({ edge_status: "expirado" }));
    const result = applyEdgGuardrails({
      phase: "final",
      result: { classificacao_final: "COMPRAR", veredito_reclassificado: "COMPRAR" },
      edg,
    });
    assertEqual(result.classificacao_final, "EVITAR");
    assertEqual(result.veredito_reclassificado, "EVITAR");
    assertEqual(result.edg_governance.rule, "D3");
  });

  test("prompt EDG inclui evidencia e politicas ratificadas", () => {
    const record = validRecord();
    const prompt = buildEdgPromptContext(computeEDG(record), record);
    assertOk(prompt.includes("Evidência:"));
    assertOk(prompt.includes(EDG_VERSION));
  });

  console.log(`\n=== EDG SELF-TEST: ${passed} passou, ${failed} falhou ===`);
  return { passed, failed };
}

if (typeof process !== "undefined" && process.env?.NEXO_SELFTEST === "1") {
  const result = selfTest();
  if (result.failed > 0) process.exitCode = 1;
}
