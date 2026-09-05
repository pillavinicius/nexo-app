const string = { type: "string" };
const number = { type: "number" };

function object(properties, required = Object.keys(properties)) {
  return { type: "object", properties, required, additionalProperties: false };
}

function array(items) {
  return { type: "array", items };
}

const scanSchema = object({
  ticker: string,
  nome: string,
  segmento: string,
  veredito: { type: "string", enum: ["APROVADO", "WATCHLIST", "VETADO"] },
  motivo_veto: { type: ["string", "null"] },
  score_total: number,
  score_max: number,
  score_resumo: string,
  filtros: array(object({
    nome: string,
    valor: string,
    status: { type: "string", enum: ["PASS", "FAIL"] },
    nota: string,
  })),
  governanca: array(object({ dimensao: string, nota: number, obs: string })),
  kpis: array(object({
    nome: string,
    valor: string,
    benchmark: string,
    status: { type: "string", enum: ["PASS", "FAIL", "ALERTA"] },
  })),
  score_dimensoes: array(object({ nome: string, nota: number, obs: string })),
  tese: string,
  catalisadores: array(object({ descricao: string, prazo: string, impacto: string })),
  riscos: array(object({
    descricao: string,
    severidade: { type: "string", enum: ["ALTO", "MEDIO", "BAIXO"] },
    probabilidade: string,
  })),
  lacunas_deep: array(string),
});

const valuationItem = object({
  modelo: string,
  valor_justo: string,
  metodologia: string,
  premissas: string,
});

const deepSchema = object({
  ticker: string,
  veredito_final: { type: "string", enum: ["COMPRAR", "MONITORAR", "AGUARDAR", "EVITAR"] },
  lacunas: array(object({ q: string, r: string })),
  preco: array(object({ c: string, vj: string, met: string, prem: string })),
  valuations_classicos: array(valuationItem),
  zona: string,
  besst: string,
  desconto: string,
  macro: array(object({ s: string, i: string })),
  catalisadores: array(object({ d: string, p: string })),
  riscos: array(object({
    d: string,
    sev: { type: "string", enum: ["ALTO", "MEDIO", "BAIXO"] },
    g: string,
  })),
  passos: array(string),
});

const finalSchema = object({
  ticker: string,
  classificacao_final: { type: "string", enum: ["COMPRAR", "MONITORAR", "AGUARDAR", "EVITAR", "VETADO"] },
  veredito_anterior: string,
  veredito_reclassificado: string,
  score_original: number,
  score_revisado: number,
  score_max: number,
  mudanca_score: string,
  mudanca_veredito: { type: "string", enum: ["MANTEVE", "MELHOROU", "PIOROU"] },
  riscos_incorporados: array(object({
    descricao: string,
    impacto_score: string,
    severidade: { type: "string", enum: ["ALTO", "MEDIO", "BAIXO"] },
  })),
  ajustes_score: array(object({
    dimensao: string,
    antes: number,
    depois: number,
    motivo: string,
  })),
  tese_final: string,
  preco_final: object({
    zona_convergencia: string,
    besst: string,
    margem_seguranca: string,
    observacao: string,
  }),
  conclusao: string,
  proximos_passos: array(string),
});

export const ANALYSIS_OUTPUT_SCHEMAS = Object.freeze({
  scan: scanSchema,
  deep: deepSchema,
  final: finalSchema,
});

export function outputConfigForPhase(phase) {
  const schema = ANALYSIS_OUTPUT_SCHEMAS[phase] || scanSchema;
  return {
    format: {
      type: "json_schema",
      schema,
    },
  };
}
