#!/usr/bin/env node

import assert from "node:assert/strict";

const originalFetch = globalThis.fetch;
let calls = 0;
const requests = [];

const edge = {
  edge_type: "analitico",
  edge_evidence: "A evidência foi confrontada com séries oficiais versionadas do NEXO.",
  edge_insumo: "IQD",
  edge_expiry_condition: "Quando a margem operacional cair abaixo de 8% por dois trimestres consecutivos.",
  edge_declared_at: "2026-09-06",
  edge_status: "ativo",
};
const scan = {
  ticker: "WEGE3",
  veredito: "APROVADO",
  score_total: 22,
  score_max: 30,
  score_dimensoes: [{ nome: "Qualidade", nota: 4, obs: "Base do teste" }],
  lacunas_deep: ["A empresa preservou sua economia real nos choques inflacionários?"],
};
const baseDeep = {
  ticker: "WEGE3",
  veredito_final: "MONITORAR",
  score_original: 22,
  score_revisado: 22,
  score_max: 30,
  ajustes_score: [],
  lacunas: [{ q: scan.lacunas_deep[0], r: "Resposta documental do teste." }],
  lacunas_documentais: [{ lacuna: scan.lacunas_deep[0], status: "aberta", evidencia_documental: [] }],
  hdl_conclusao: "A TIR real supera o hurdle informado, sem promover automaticamente a classificação global.",
  tdn_conclusao: "",
  zona: "R$ 40 a R$ 50",
  besst: "R$ 30 a R$ 42,50",
  passos: [],
};

try {
  const outputs = [baseDeep, { ...baseDeep, tdn_conclusao: "O histórico mostra defesa mista entre as duas janelas, com preservação desigual das margens e da receita real." }];
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(outputs.shift()) }] }), { status: 200 });
  };

  const { POST } = await import("../app/api/analyze/route.js");
  const request = (payload) => POST(new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));

  const response = await request({
    phase: "deep",
    assetType: "acao-br",
    ticker: "WEGE3",
    edgeLedger: edge,
    hdlInput: { tir_esperada_pct: 9, horizonte_anos: 5 },
    analysisHistory: { scan },
  });
  const deep = await response.json();
  assert.equal(response.status, 200);
  assert.equal(calls, 2, "conclusão TDN ausente deve consumir uma única correção semântica");
  assert.equal(deep.nexoModules.TDN.status, "ok");
  assert.equal(deep.nexoModules.TDN.janelas_cobertas, 2);
  assert.equal(deep.nexoModules.TDN.score_nominalidade, 3.44);
  assert.equal(deep.nexoModules.TDN.veredito, "misto");
  assert.equal(deep.tdn_integrity.complete, true);
  assert.equal(deep.score_revisado, 22, "TDN não altera score do Deep");
  assert.equal(deep.veredito_final, "MONITORAR", "TDN não altera veredito do Deep");
  assert.match(requests[0].messages[0].content, /TDN · TESTE DE DEFESA NOMINAL/);
  assert.match(requests[0].messages[0].content, /"score_nominalidade":3\.44/);
  assert.match(requests[1].messages[0].content, /tdn_conclusao/);

  globalThis.fetch = async () => { throw new Error("finalização determinística não pode chamar a IA"); };
  const finalResponse = await request({
    phase: "final",
    assetType: "acao-br",
    ticker: "WEGE3",
    edgeLedger: edge,
    hdlInput: { tir_esperada_pct: 9, horizonte_anos: 5 },
    analysisHistory: { scan, deep },
  });
  const final = await finalResponse.json();
  assert.equal(finalResponse.status, 200);
  assert.equal(calls, 2);
  assert.equal(final.nexoModules.TDN.score_nominalidade, 3.44);
  assert.equal(final.tdn_conclusao, deep.tdn_conclusao);
  assert.equal(final.classificacao_final, "MONITORAR");

  const invalidEdge = await request({
    phase: "scan",
    assetType: "acao-br",
    ticker: "BBAS3",
    edgeLedger: { ...edge, edge_insumo: "TDN" },
  });
  assert.equal(invalidEdge.status, 422);
  assert.equal((await invalidEdge.json()).error.code, "tdn_edge_unavailable");
  assert.equal(calls, 2);

  console.log("TDN API integration: 18 verificações aprovadas.");
} finally {
  globalThis.fetch = originalFetch;
}
