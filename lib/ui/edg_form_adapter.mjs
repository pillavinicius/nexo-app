export const EDGE_TYPE_DESCRIPTIONS = Object.freeze({
  nenhum:
    "Declara honestamente que a tese ainda não possui uma vantagem verificável. A regra D2 limita a classificação a Watchlist.",
  informacional:
    "Existe informação pública relevante que o mercado ainda não incorporou ou interpretou adequadamente.",
  analitico:
    "Os dados são conhecidos, mas a leitura NEXO chega a uma conclusão diferente por um método reproduzível.",
  estrutural:
    "Uma restrição de mandato, vendedor forçado ou perímetro institucional cria a distorção observada.",
  temporal:
    "A vantagem vem de um horizonte de análise maior do que o horizonte do participante marginal.",
});

export const EDGE_INSUMO_METADATA = Object.freeze({
  IQD: {
    description:
      "Mede qualidade, completude e confiabilidade dos dados recebidos. Não mede qualidade do ativo nem valuation.",
    available: true,
  },
  NMI: {
    description:
      "Fornece o contexto macro validado e o regime vigente. Não substitui os dados específicos do ativo.",
    available: true,
  },
  SEE: {
    description:
      "Combina qualidade econômica dos fundamentos com eficiência da trajetória do ativo.",
    available: true,
  },
  FDM: {
    description:
      "Organiza forças, fragilidades e direcionadores materiais dos fundamentos do modelo de negócio.",
    available: true,
  },
  CNE: {
    description:
      "Testa se a narrativa da tese permanece coerente com fatos, números e contexto econômico.",
    available: true,
  },
  PIJR: {
    description:
      "Confronta o prêmio implícito da tese com os juros e riscos exigidos no cenário analisado.",
    available: true,
  },
  TNH: {
    description:
      "Situa o preço atual dentro da trajetória histórica e mede sua temperatura relativa.",
    available: true,
  },
  PIN: {
    description:
      "Avalia se uma narrativa de prêmio, negligência ou punição é coerente com a trajetória observada.",
    available: true,
  },
  RES: {
    description:
      "Avalia resiliência a choques por drawdown, volatilidade, recuperação e liquidez.",
    available: true,
  },
  ECS: {
    description:
      "Avalia estrutura de capital, caixa, dívida, liquidez e capacidade de solvência.",
    available: true,
  },
  "ICN-D": {
    description:
      "Testa a coerência da narrativa com os dados e documentos que deveriam sustentá-la.",
    available: true,
  },
  "ICN-R": {
    description:
      "Testa a coerência da narrativa com os resultados que foram efetivamente realizados.",
    available: true,
  },
  GNP: {
    description:
      "Mede qualidade da trajetória e risco comportamental sem substituir valor intrínseco ou valuation.",
    available: true,
  },
  HDL: {
    description:
      "Compara a TIR esperada com o juro real soberano. Será habilitado quando o módulo F1 estiver disponível.",
    available: false,
  },
  NFI: {
    description:
      "Mede fluxo como explicação de deslocamento de preço. Será habilitado quando o módulo F1 estiver disponível.",
    available: false,
  },
  TDN: {
    description:
      "Testa empiricamente a proteção inflacionária em janelas fixas. Será habilitado após a Biblioteca mínima.",
    available: false,
  },
  BJR: {
    description:
      "Mede risco de perímetro em recuperação judicial. Será habilitado após banco curado e calibração.",
    available: false,
  },
  NCS: {
    description:
      "Aplica portões sequenciais a situações especiais de crédito. Será habilitado após o BJR.",
    available: false,
  },
  NALM: {
    description:
      "Mapeia camadas da cadeia de IA e a durabilidade do spread. Será habilitado na fase F4.",
    available: false,
  },
});

const SHARED_CUSTOM_EVIDENCE = Object.freeze({
  id: "custom",
  label: "Outra evidência (avançado)",
  statement: "",
});

export const EDGE_EVIDENCE_TEMPLATES = Object.freeze({
  informacional: Object.freeze([
    {
      id: "public_data_not_priced",
      label: "Dado público não precificado",
      statement:
        "um dado público material ainda não foi incorporado adequadamente pelo mercado",
    },
    {
      id: "official_document_misread",
      label: "Leitura incompleta de documento",
      statement:
        "um documento oficial contém implicação econômica material ainda interpretada de forma incompleta",
    },
    SHARED_CUSTOM_EVIDENCE,
  ]),
  analitico: Object.freeze([
    {
      id: "benchmark_divergence",
      label: "Resultado diverge do benchmark",
      statement:
        "o resultado mensurável do módulo diverge do benchmark relevante para a tese",
    },
    {
      id: "combined_signals",
      label: "Combinação de sinais",
      statement:
        "a combinação reproduzível de sinais leva a uma conclusão diferente da leitura predominante",
    },
    {
      id: "historical_asymmetry",
      label: "Assimetria histórica",
      statement:
        "a comparação histórica pré-definida revela uma assimetria não explicada pelo cenário-base",
    },
    SHARED_CUSTOM_EVIDENCE,
  ]),
  estrutural: Object.freeze([
    {
      id: "forced_seller",
      label: "Vendedor forçado identificado",
      statement:
        "há vendedor forçado negociando por restrição e não por mudança equivalente nos fundamentos",
    },
    {
      id: "mandate_restriction",
      label: "Restrição de mandato",
      statement:
        "uma restrição objetiva de mandato cria a distorção observada",
    },
    {
      id: "perimeter_restriction",
      label: "Restrição de perímetro",
      statement:
        "o perímetro institucional ou contratual cria uma distorção verificável",
    },
    SHARED_CUSTOM_EVIDENCE,
  ]),
  temporal: Object.freeze([
    {
      id: "horizon_mismatch",
      label: "Horizonte NEXO mais longo",
      statement:
        "o horizonte necessário para realização da tese é maior que o horizonte do participante marginal",
    },
    {
      id: "temporary_pressure",
      label: "Pressão temporária",
      statement:
        "a pressão observada possui janela limitada enquanto o fundamento mensurado permanece preservado",
    },
    {
      id: "dated_catalyst",
      label: "Catalisador com data",
      statement:
        "há um catalisador documentado com janela objetiva diferente da expectativa predominante",
    },
    SHARED_CUSTOM_EVIDENCE,
  ]),
});

export const EDGE_EVIDENCE_BASES = Object.freeze([
  { id: "module_output", label: "Resultado do módulo", phrase: "resultado versionado do módulo" },
  { id: "official_statement", label: "Resultado oficial", phrase: "demonstração ou resultado oficial" },
  { id: "validated_series", label: "Série histórica validada", phrase: "série histórica validada" },
  { id: "sector_benchmark", label: "Benchmark setorial explícito", phrase: "benchmark setorial explícito" },
  { id: "official_document", label: "Documento oficial", phrase: "documento oficial ou regulatório" },
  { id: "official_flow", label: "Fluxo oficial de mercado", phrase: "fluxo oficial de mercado" },
  { id: "curated_database", label: "Banco curado NEXO", phrase: "banco curado NEXO" },
]);

export const EDGE_EVIDENCE_WINDOWS = Object.freeze([
  { id: "latest_result", label: "Último resultado disponível", phrase: "último resultado disponível" },
  { id: "two_quarters", label: "Últimos 2 trimestres", phrase: "últimos dois trimestres" },
  { id: "twelve_months", label: "Últimos 12 meses", phrase: "últimos doze meses" },
  { id: "twenty_four_months", label: "Últimos 24 meses", phrase: "últimos vinte e quatro meses" },
  { id: "fixed_windows", label: "Janelas fixas do módulo", phrase: "janelas fixas pré-comprometidas do módulo" },
  { id: "current_regime", label: "Regime atual", phrase: "regime atual validado" },
]);

export const EDGE_EXPIRY_TEMPLATES = Object.freeze([
  { id: "metric_below", label: "Métrica abaixo do limite" },
  { id: "metric_above", label: "Métrica acima do limite" },
  { id: "objective_event", label: "Evento objetivo ocorre" },
  { id: "deadline_unconfirmed", label: "Prazo vence sem confirmação" },
  { id: "custom", label: "Outra condição (avançado)" },
]);

export const EDGE_EXPIRY_METRICS = Object.freeze([
  { id: "gross_margin", label: "Margem bruta" },
  { id: "operating_margin", label: "Margem operacional" },
  { id: "roic", label: "ROIC" },
  { id: "roe", label: "ROE" },
  { id: "revenue", label: "Receita" },
  { id: "ebitda", label: "EBITDA" },
  { id: "profit", label: "Lucro" },
  { id: "leverage", label: "Alavancagem" },
  { id: "payout", label: "Payout" },
  { id: "vacancy", label: "Vacância" },
  { id: "delinquency", label: "Inadimplência" },
  { id: "ltv", label: "LTV" },
  { id: "spread", label: "Spread" },
  { id: "flow", label: "Fluxo" },
  { id: "iqd_score", label: "Score IQD" },
  { id: "nmi_confidence", label: "Confiabilidade NMI" },
  { id: "market_share", label: "Participação de mercado" },
  { id: "volume", label: "Volume" },
]);

export const EDGE_EXPIRY_UNITS = Object.freeze([
  { id: "percent", label: "%", suffix: "%" },
  { id: "multiple", label: "x", suffix: "x" },
  { id: "percentage_points", label: "p.p.", suffix: " p.p." },
  { id: "brl", label: "R$", prefix: "R$ " },
  { id: "usd", label: "USD", prefix: "USD " },
  { id: "points", label: "pontos", suffix: " pontos" },
  { id: "score", label: "score", suffix: " pontos de score" },
]);

export const EDGE_EXPIRY_PERIODS = Object.freeze([
  { id: "observation", singular: "observação consecutiva", plural: "observações consecutivas" },
  { id: "month", singular: "mês consecutivo", plural: "meses consecutivos" },
  { id: "quarter", singular: "trimestre consecutivo", plural: "trimestres consecutivos" },
  { id: "year", singular: "ano consecutivo", plural: "anos consecutivos" },
]);

export const EDGE_EXPIRY_EVENTS = Object.freeze([
  { id: "contract_cancelled", label: "Contrato material encerrado", condition: "Quando o contrato material for cancelado ou rescindido." },
  { id: "concession_revoked", label: "Concessão material revogada", condition: "Quando a concessão material for revogada." },
  { id: "license_revoked", label: "Licença material revogada", condition: "Quando a licença material for revogada." },
  { id: "guidance_withdrawn", label: "Guidance retirado", condition: "Quando o guidance material for retirado oficialmente." },
  { id: "rating_downgrade", label: "Rating rebaixado", condition: "Quando o rating for rebaixado pela agência responsável." },
  { id: "regulation_revoked", label: "Regulação revogada", condition: "Quando a regulação determinante for revogada." },
  { id: "forced_seller_ends", label: "Fim do vendedor forçado", condition: "Quando o vendedor forçado deixar de atuar no mercado." },
  { id: "perimeter_changed", label: "Perímetro alterado", condition: "Quando o perímetro institucional ou contratual for alterado oficialmente." },
]);

export const EDGE_DEADLINE_OBJECTS = Object.freeze([
  { id: "contract", label: "contrato material" },
  { id: "concession", label: "concessão ou licença" },
  { id: "guidance", label: "guidance divulgado" },
  { id: "regulation", label: "evento regulatório" },
  { id: "catalyst", label: "catalisador operacional" },
]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function byId(items, id) {
  return items.find((item) => item.id === id);
}

export function evidenceOptionsForType(edgeType) {
  return EDGE_EVIDENCE_TEMPLATES[edgeType] || [];
}

export function buildGuidedEdgeEvidence({
  edgeType,
  edgeInsumo,
  templateId,
  basisId,
  windowId,
  customText,
} = {}) {
  const template = byId(evidenceOptionsForType(edgeType), templateId);
  const basis = byId(EDGE_EVIDENCE_BASES, basisId);
  const window = byId(EDGE_EVIDENCE_WINDOWS, windowId);
  const insumo = clean(edgeInsumo);

  if (!template || !basis || !window || !insumo) return "";

  const prefix = `O módulo ${insumo}, com base em ${basis.phrase} e na janela ${window.phrase}, sustenta que`;

  if (template.id === "custom") {
    const custom = clean(customText);
    return custom ? `${prefix} ${custom.replace(/[.\s]+$/g, "")}.` : "";
  }

  return `${prefix} ${template.statement}.`;
}

function formattedThreshold(value, unitId) {
  const threshold = clean(value);
  const unit = byId(EDGE_EXPIRY_UNITS, unitId);
  if (!/^-?\d+(?:[.,]\d+)?$/.test(threshold) || !unit) return "";
  return `${unit.prefix || ""}${threshold}${unit.suffix || ""}`;
}

export function buildGuidedExpiryCondition({
  templateId,
  metricId,
  threshold,
  unitId,
  persistence,
  periodId,
  eventId,
  deadlineObjectId,
  deadlineDate,
  customText,
} = {}) {
  if (templateId === "custom") return clean(customText);

  if (templateId === "objective_event") {
    return byId(EDGE_EXPIRY_EVENTS, eventId)?.condition || "";
  }

  if (templateId === "deadline_unconfirmed") {
    const object = byId(EDGE_DEADLINE_OBJECTS, deadlineObjectId);
    const date = clean(deadlineDate);
    return object && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? `Quando o prazo de confirmação de ${object.label} vencer em ${date} sem confirmação documental.`
      : "";
  }

  if (!["metric_below", "metric_above"].includes(templateId)) return "";

  const metric = byId(EDGE_EXPIRY_METRICS, metricId);
  const value = formattedThreshold(threshold, unitId);
  const count = Number.parseInt(clean(persistence), 10);
  const period = byId(EDGE_EXPIRY_PERIODS, periodId);

  if (!metric || !value || !Number.isInteger(count) || count < 1 || count > 8 || !period) {
    return "";
  }

  const direction = templateId === "metric_below" ? "para baixo" : "para cima";
  const periodLabel = count === 1 ? period.singular : period.plural;
  return `Quando ${metric.label} cruzar ${value} ${direction} por ${count} ${periodLabel}.`;
}
