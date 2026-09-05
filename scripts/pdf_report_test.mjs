import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { renderNexoReportPdf } from "../lib/reporting/nexo_pdf_report.mjs";

const fixture = {
  generatedAt: "2026-09-05T14:00:00.000Z",
  ticker: "TEST3",
  assetType: "acao-br",
  currency: "BRL",
  asset: {
    ticker: "TEST3",
    name: "Companhia de Teste NEXO",
    assetType: "Ação BR",
    currency: "BRL",
    price: 42.156,
    provider: "Provedor de homologação",
    updatedAt: "2026-09-05",
    history: { firstDate: "2021-01-04", lastDate: "2026-09-04", minPrice: 24.5, maxPrice: 48.91 },
  },
  macro: { nmi: { regimeLabel: "juros_restritivos", overallConfidence: 0.87 } },
  edge: {
    edge_type: "analitico",
    edge_status: "ativo",
    edge_evidence: "Margem operacional comparada ao histórico auditado.",
    edge_expiry_condition: "Margem abaixo do limite por dois trimestres consecutivos.",
  },
  scan: {
    ticker: "TEST3",
    veredito: "APROVADO",
    score_total: 24,
    score_max: 30,
    score_resumo: "Qualidade operacional consistente, com riscos explicitamente acompanhados.",
    tese: "Tese de teste construída para validar a paginação e a hierarquia do relatório.",
    filtros: [{ nome: "Liquidez", status: "PASS", valor: "Acima do mínimo" }],
    governanca: [{ dimensao: "Alocação", nota: 4, obs: "Sem veto" }],
    kpis: [{ nome: "ROIC", valor: "18,4%", benchmark: "12%" }],
    catalisadores: [{ descricao: "Expansão de margem", impacto: "Médio", prazo: "12 meses" }],
    riscos: [{ descricao: "Compressão setorial", severidade: "MÉDIO", probabilidade: "Moderada" }],
    lacunas_deep: ["Validar a sustentabilidade da margem em uma janela mais longa."],
  },
  deep: {
    ticker: "TEST3",
    veredito_final: "MONITORAR",
    score_original: 24,
    score_revisado: 23,
    score_max: 30,
    mudanca_score: "-1",
    ajustes_score: [{
      dimensao: "Execução",
      antes: 4,
      depois: 3,
      motivo: "O Deep confirmou um risco ainda não resolvido.",
      fonte_nova: "DEEP",
    }],
    lacunas: [{ q: "A margem é sustentável?", r: "O histórico indica estabilidade, sujeita ao gatilho de acompanhamento." }],
    preco: [
      { c: "C1 · Conservador", vj: "R$ 38,20", met: "Fluxo normalizado", prem: "Crescimento baixo" },
      { c: "C2 · Base", vj: "R$ 42,70", met: "Múltiplos e fundamentos", prem: "Cenário central" },
      { c: "C3 · Otimista", vj: "R$ 47,40", met: "Fluxo descontado", prem: "Expansão moderada" },
    ],
    valuations_classicos: [
      { modelo: "Graham", valor_justo: "R$ 39,90", metodologia: "Fórmula de Graham", premissas: "Referência auxiliar" },
      { modelo: "Peter Lynch", valor_justo: "R$ 44,10", metodologia: "PEG normalizado", premissas: "Referência auxiliar" },
    ],
    zona: "R$ 39,00 a R$ 43,00",
    besst: "R$ 29,25 a R$ 36,55",
    desconto: "2,0%",
    integridade_analise: {
      besst_corrected: true,
      besst_previous_value: "R$ 36,50",
    },
    macro: [{ s: "Juros altos", i: "Pressão moderada sobre múltiplos" }],
    catalisadores: [{ d: "Eficiência", impacto: "Positivo", p: "12 a 18 meses" }],
    riscos: [{ d: "Execução", sev: "MÉDIO", g: "Duas revisões negativas" }],
    passos: ["Acompanhar o próximo resultado trimestral."],
  },
  deepAdds: [],
  final: {
    ticker: "TEST3",
    classificacao_final: "MONITORAR",
    score_original: 23,
    score_revisado: 23,
    score_max: 30,
    mudanca_veredito: "MANTEVE",
    mudanca_score: "0",
    veredito_anterior: "MONITORAR",
    veredito_reclassificado: "MONITORAR",
    riscos_incorporados: [],
    ajustes_score: [],
    integridade_reclassificacao: {
      mode: "deterministic_consolidation",
      baseline_phase: "deep",
    },
    tese_final: "A qualidade permanece, mas a relação entre preço, cenário e risco exige acompanhamento.",
    preco_final: { zona_convergencia: "R$ 39,00 a R$ 43,00", besst: "R$ 29,25 a R$ 36,55", margem_seguranca: "15%", observacao: "Faixa de referência, não decisão automática." },
    conclusao: "Manter em acompanhamento até que a evidência observável confirme a tese.",
    proximos_passos: ["Revisar o próximo balanço.", "Atualizar o contrato de edge."],
  },
  options: { classicValuations: "SIM" },
};

const pdf = await renderNexoReportPdf(fixture);
assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
assert.ok(pdf.length > 10_000, `PDF inesperadamente pequeno: ${pdf.length} bytes`);

if (process.env.NEXO_PDF_OUTPUT) {
  await mkdir(dirname(process.env.NEXO_PDF_OUTPUT), { recursive: true });
  await writeFile(process.env.NEXO_PDF_OUTPUT, pdf);
  console.log(`pdf report sample: ${process.env.NEXO_PDF_OUTPUT}`);
}

console.log(`pdf report: 3/3 checks passed (${pdf.length} bytes)`);
