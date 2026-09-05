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
const originalFetch = globalThis.fetch;

try {
  globalThis.fetch = async (_url, options) => {
    upstreamCalls += 1;
    const request = JSON.parse(options.body);
    capturedPrompt = request.messages[0].content;
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
      zona: "R$ 19,00 a R$ 21,00",
      besst: "R$ 24,50 a R$ 26,00",
      desconto: "10%",
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
      edgeLedger: activeEdge,
      analysisHistory: { scan },
    }),
  }));
  const deep = await deepResponse.json();

  assert.equal(deepResponse.status, 200);
  assert.equal(upstreamCalls, 1);
  assert.match(capturedPrompt, /BASE ANALÍTICA ANTERIOR/);
  assert.match(capturedPrompt, /Qualidade do Negócio/);
  assert.equal(deep.score_original, 21);
  assert.equal(deep.score_revisado, 20);
  assert.equal(deep.ajustes_score.length, 1);
  assert.equal(deep.ajustes_score[0].antes, 4);
  assert.equal(deep.ajustes_score[0].depois, 3);
  assert.equal(deep.besst, "R$ 14,25 a R$ 17,85");

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

console.log("reclassification API integration: 28/28 checks passed");
