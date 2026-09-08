import assert from "node:assert/strict";
import { POST } from "../app/api/analyze/route.js";

const scan = {
  ticker: "BBAS3",
  veredito: "APROVADO",
  score_total: 21,
  score_max: 30,
  score_dimensoes: [
    { nome: "Qualidade do Negócio", nota: 4, obs: "Base Scan" },
    { nome: "Governança Corporativa", nota: 3, obs: "Base Scan" },
  ],
  tese: "Tese do Scan.",
  lacunas_deep: ["Validar inadimplência."],
};

const activeEdge = {
  edge_type: "analitico",
  edge_evidence: "Margem auditada permaneceu acima da média setorial.",
  edge_insumo: "IQD",
  edge_expiry_condition: "Quando a margem cruzar 10% para baixo por dois trimestres.",
  edge_declared_at: "2026-09-05",
  edge_status: "ativo",
};

let upstreamCalls = 0;
let capturedPrompt = "";
let capturedSystemPrompt = "";
const originalFetch = globalThis.fetch;

try {
  let scanCalls = 0;
  globalThis.fetch = async () => {
    scanCalls += 1;
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({
      ticker: "VALE3",
      nome: "Vale",
      segmento: "Novo Mercado",
      veredito: "APROVADO",
      score_total: 20,
      score_max: 30,
      filtros: [],
      governanca: [],
      kpis: [],
      score_dimensoes: [],
      tese: "Tese preliminar.",
      catalisadores: [],
      riscos: [
        { descricao: "volatilidade do minério sem evidência primária atualizada", severidade: "ALTO", probabilidade: "Moderada" },
        { descricao: "execução de projetos sem cronograma confirmado", severidade: "MEDIO", probabilidade: "Moderada" },
      ],
      lacunas_deep: [],
    }) }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const scanGapResponse = await POST(new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phase: "scan", assetType: "acao-br", ticker: "VALE3" }),
  }));
  const scanGapResult = await scanGapResponse.json();
  assert.equal(scanGapResponse.status, 200);
  assert.equal(scanCalls, 1, "reconciliação de lacunas não pode refazer a chamada externa");
  assert.equal(scanGapResult.lacunas_deep.length, 2, "a rota deve devolver duas lacunas mesmo se o modelo retornar nenhuma");
  assert.equal(scanGapResult.integridade_analise.gap_integrity_version, "GAP_v1.0");

  globalThis.fetch = async (_url, options) => {
    upstreamCalls += 1;
    const request = JSON.parse(options.body);
    capturedPrompt = request.messages[0].content;
    capturedSystemPrompt = request.system;
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({
      ticker: "BBAS3",
      veredito_final: "MONITORAR",
      score_original: 18,
      score_revisado: 17,
      score_max: 30,
      mudanca_score: "-1",
      ajustes_score: [
        { dimensao: "Qualidade do Negócio", antes: 1, depois: 3, motivo: "Evidência nova confirmou deterioração." },
        { dimensao: "Dimensão inventada", antes: 5, depois: 0, motivo: "Não pertence ao score anterior." },
      ],
      tese_final: "Tese atualizada pelo Deep.",
      preco: [
        { c: "C1", vj: "R$ 19,00", met: "Valor unitário", prem: "Direto.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 19, multiplo: 1 } },
        { c: "C2", vj: "R$ 21,00", met: "Valor unitário", prem: "Direto.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 21, multiplo: 1 } },
      ],
      zona: "R$ 19,00 a R$ 21,00",
      zona_calc: { camadas_incluidas: ["C1", "C2"], justificativa_exclusoes: "" },
      besst: "R$ 24,50 a R$ 26,00",
      desconto: "10%",
      hdl_conclusao: "Não supera o soberano porque a TIR real esperada permanece abaixo do hurdle oficial.",
      passos: ["Acompanhar divulgação."],
    }) }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const deepResponse = await POST(new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phase: "deep",
      assetType: "acao-br",
      ticker: "BBAS3",
      extraCtx: "- Moeda selecionada: BRL\n- Valor atual/cota atual: 20,00\n",
      edgeLedger: activeEdge,
      hdlInput: { tir_esperada_pct: 6.5, horizonte_anos: 5 },
      analysisHistory: { scan },
    }),
  }));
  const deep = await deepResponse.json();

  assert.equal(deepResponse.status, 200);
  assert.equal(upstreamCalls, 1);
  assert.match(capturedPrompt, /BASE ANALÍTICA ANTERIOR/);
  assert.match(capturedPrompt, /Qualidade do Negócio/);
  assert.match(capturedSystemPrompt, /Every C1\/C2\/C3 layer must include calc/);
  assert.match(capturedSystemPrompt, /server independently verifies derivation, layer arithmetic, convergence and BESST/);
  assert.match(capturedSystemPrompt, /MEDIA_PONDERADA_X_MULTIPLO/);
  assert.match(capturedSystemPrompt, /Preserve exact metric semantics and windows/);
  assert.equal(deep.score_original, 21);
  assert.equal(deep.score_revisado, 20);
  assert.equal(deep.ajustes_score.length, 1);
  assert.equal(deep.ajustes_score[0].antes, 4);
  assert.equal(deep.ajustes_score[0].depois, 3);
  assert.equal(deep.besst, "R$ 14,25 a R$ 16,15");
  assert.match(deep.desconto, /Preço atual R\$ 20,00 está dentro da zona de convergência/);
  assert.equal(deep.integridade_analise.price_narrative_status, "server_calculated");
  assert.equal(deep.integridade_analise.reference_price, 20);

  let semanticCalls = 0;
  globalThis.fetch = async () => {
    semanticCalls += 1;
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({
      ticker: "BANK3",
      veredito_final: "MONITORAR",
      score_original: 21,
      score_revisado: 21,
      score_max: 30,
      mudanca_score: "0",
      ajustes_score: [],
      tese_final: "Tese mantida com contenção semântica local.",
      lacunas: [{ q: "Validar inadimplência.", r: "Agro: INAD = 1,37%." }],
      lacunas_documentais: [{ lacuna: "Validar inadimplência.", status: "resolvida", evidencia_documental: [] }],
      preco: [
        { c: "C1", vj: "R$ 19,00", met: "Valor unitário", prem: "Direto.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 19, multiplo: 1 } },
        { c: "C2", vj: "R$ 21,00", met: "Valor unitário", prem: "Direto.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 21, multiplo: 1 } },
      ],
      zona: "R$ 19,00 a R$ 21,00",
      zona_calc: { camadas_incluidas: ["C1", "C2"], justificativa_exclusoes: "" },
      besst: "R$ 14,25 a R$ 16,15",
      desconto: "",
      hdl_conclusao: "",
      riscos: [],
      passos: [],
    }) }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const semanticResponse = await POST(new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phase: "deep",
      assetType: "acao-br",
      ticker: "BANK3",
      extraCtx: "- Moeda selecionada: BRL\n- Valor atual/cota atual: 20,00\n",
      edgeLedger: activeEdge,
      hdlInput: { tir_esperada_pct: 6.5, horizonte_anos: 5 },
      analysisHistory: { scan: { ...scan, ticker: "BANK3" } },
    }),
  }));
  const semanticDeep = await semanticResponse.json();
  assert.equal(semanticResponse.status, 200);
  assert.equal(semanticCalls, 1, "falha semântica do Deep deve ser contida localmente sem segunda chamada");
  assert.match(semanticDeep.lacunas[0].r, /inadimplência com janela não especificada/);
  assert.doesNotMatch(semanticDeep.lacunas[0].r, /suprimido pelo servidor/i);
  assert.equal(semanticDeep.integridade_analise.biblioteca_metric_conflicts_reconciled.length, 1);
  assert.equal(semanticDeep.hdl_integrity.complete, false);

  globalThis.fetch = async () => {
    throw new Error("A finalização determinística não pode chamar a IA.");
  };

  const scanOnlyFinalResponse = await POST(new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phase: "final",
      assetType: "acao-br",
      ticker: "BBAS3",
      edgeLedger: activeEdge,
      hdlInput: { tir_esperada_pct: 6.5, horizonte_anos: 5 },
      analysisHistory: { scan },
    }),
  }));
  const scanOnlyFinal = await scanOnlyFinalResponse.json();

  assert.equal(scanOnlyFinalResponse.status, 200);
  assert.equal(upstreamCalls, 1);
  assert.equal(scanOnlyFinal.classificacao_final, "APROVADO");
  assert.equal(scanOnlyFinal.veredito_anterior, "APROVADO");
  assert.equal(scanOnlyFinal.veredito_reclassificado, "APROVADO");
  assert.equal(scanOnlyFinal.score_original, 21);
  assert.equal(scanOnlyFinal.score_revisado, 21);
  assert.equal(scanOnlyFinal.mudanca_veredito, "MANTEVE");
  assert.equal(scanOnlyFinal.integridade_reclassificacao.baseline_phase, "scan");

  const finalResponse = await POST(new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phase: "final",
      assetType: "acao-br",
      ticker: "BBAS3",
      edgeLedger: activeEdge,
      hdlInput: { tir_esperada_pct: 6.5, horizonte_anos: 5 },
      analysisHistory: { scan, deep },
    }),
  }));
  const final = await finalResponse.json();

  assert.equal(finalResponse.status, 200);
  assert.equal(upstreamCalls, 1);
  assert.equal(final.classificacao_final, "MONITORAR");
  assert.equal(final.veredito_anterior, "MONITORAR");
  assert.equal(final.veredito_reclassificado, "MONITORAR");
  assert.equal(final.score_original, 20);
  assert.equal(final.score_revisado, 20);
  assert.equal(final.mudanca_veredito, "MANTEVE");
  assert.equal(final.integridade_reclassificacao.mode, "deterministic_consolidation");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("reclassification API integration: 37/37 checks passed");
