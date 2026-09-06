#!/usr/bin/env node

import assert from "node:assert/strict";

const originalFetch = globalThis.fetch;
const capturedRequests = [];
let upstreamCalls = 0;

const activeEdge = {
  edge_type: "analitico",
  edge_evidence: "A rentabilidade real esperada foi comparada com a curva soberana oficial.",
  edge_insumo: "IQD",
  edge_expiry_condition: "Quando a taxa real ficar abaixo de 7% por dois trimestres consecutivos.",
  edge_declared_at: "2026-09-06",
  edge_status: "ativo",
};

const scan = {
  ticker: "BBAS3",
  veredito: "APROVADO",
  score_total: 20,
  score_max: 30,
  score_dimensoes: [{ nome: "Qualidade", nota: 4, obs: "Base determinística" }],
  tese: "Tese usada exclusivamente no teste de integração.",
};

const deepNegative = {
  ticker: "BBAS3",
  veredito_final: "MONITORAR",
  score_original: 20,
  score_revisado: 20,
  score_max: 30,
  ajustes_score: [],
  hdl_conclusao:
    "Não supera o soberano porque a TIR real estimada fica abaixo do hurdle; a tese só permanece em acompanhamento pela assimetria operacional declarada.",
  zona: "R$ 20,00 a R$ 24,00",
  besst: "R$ 15,00 a R$ 20,40",
  passos: [],
};

const deepIncomplete = {
  ...deepNegative,
  veredito_final: "COMPRAR",
  hdl_conclusao: "",
};

const deepPositive = {
  ...deepNegative,
  veredito_final: "COMPRAR",
  hdl_conclusao:
    "O alfa supera o soberano, condicionado à validade das premissas usadas para estimar a TIR real.",
};

const deepExternal = {
  ticker: "MSFT",
  veredito_final: "MONITORAR",
  score_original: 30,
  score_revisado: 30,
  score_max: 50,
  ajustes_score: [],
  hdl_conclusao: "",
  passos: [],
};

try {
  const outputs = [deepIncomplete, deepPositive, deepNegative];
  globalThis.fetch = async (_url, options) => {
    upstreamCalls += 1;
    capturedRequests.push(JSON.parse(options.body));
    return new Response(
      JSON.stringify({ content: [{ type: "text", text: JSON.stringify(outputs.shift()) }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const { POST } = await import("../app/api/analyze/route.js");

  const request = (payload) =>
    POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );

  const missing = await request({
    phase: "deep",
    assetType: "acao-br",
    ticker: "BBAS3",
    edgeLedger: activeEdge,
    analysisHistory: { scan },
  });
  assert.equal(missing.status, 422);
  assert.equal((await missing.json()).error.code, "hdl_input_required");
  assert.equal(upstreamCalls, 0, "Deep incompleto não pode consumir a API analítica");

  const extrapolated = await request({
    phase: "deep",
    assetType: "acao-br",
    ticker: "BBAS3",
    edgeLedger: activeEdge,
    hdlInput: { tir_esperada_pct: 9, horizonte_anos: 40 },
    analysisHistory: { scan },
  });
  assert.equal(extrapolated.status, 422);
  assert.equal((await extrapolated.json()).error.code, "hdl_extrapolation_forbidden");
  assert.equal(upstreamCalls, 0, "Extrapolação proibida não pode consumir a API analítica");

  const edgeWithoutHdl = await request({
    phase: "scan",
    assetType: "acao-br",
    ticker: "BBAS3",
    edgeLedger: { ...activeEdge, edge_insumo: "HDL" },
  });
  assert.equal(edgeWithoutHdl.status, 422);
  assert.equal((await edgeWithoutHdl.json()).error.code, "hdl_input_required");
  assert.equal(upstreamCalls, 0, "HDL usado como edge precisa existir antes do Scan");

  const prematureNfiEdge = await request({
    phase: "scan",
    assetType: "acao-br",
    ticker: "BBAS3",
    edgeLedger: { ...activeEdge, edge_insumo: "NFI" },
  });
  assert.equal(prematureNfiEdge.status, 422);
  assert.equal((await prematureNfiEdge.json()).error.code, "nfi_edge_unavailable");
  assert.equal(upstreamCalls, 0, "NFI sem 24 meses não pode lastrear Edge");

  const semanticRetryResponse = await request({
    phase: "deep",
    assetType: "acao-br",
    ticker: "BBAS3",
    edgeLedger: activeEdge,
    hdlInput: { tir_esperada_pct: 9, horizonte_anos: 5 },
    analysisHistory: { scan },
  });
  const semanticRetryResult = await semanticRetryResponse.json();
  assert.equal(semanticRetryResponse.status, 200);
  assert.equal(upstreamCalls, 2, "Conclusão HDL incompleta deve consumir uma única correção semântica");
  assert.equal(semanticRetryResult.hdl_integrity.complete, true);
  assert.equal(semanticRetryResult.veredito_final, "COMPRAR");
  assert.match(capturedRequests[1].messages[0].content, /não completou hdl_conclusao/);

  const negativeResponse = await request({
    phase: "deep",
    assetType: "acao-br",
    ticker: "BBAS3",
    edgeLedger: activeEdge,
    hdlInput: { tir_esperada_pct: 6.5, horizonte_anos: 5 },
    analysisHistory: { scan },
  });
  const negative = await negativeResponse.json();
  assert.equal(negativeResponse.status, 200);
  assert.equal(upstreamCalls, 3);
  assert.equal(negative.nexoModules.HDL.version, "HDL_v1.0");
  assert.equal(negative.nexoModules.HDL.status, "ok");
  assert.equal(negative.nexoModules.HDL.hurdle_real_pct, 7.9001);
  assert.equal(negative.nexoModules.HDL.alfa_vs_classe_pp, -1.4001);
  assert.equal(negative.nexoModules.HDL.supera_hurdle, false);
  assert.equal(negative.nexoModules.HDL.requires_justification, true);
  assert.equal(negative.nexoModules.NFI.version, "NFI_v1.0");
  assert.equal(negative.nexoModules.NFI.history_months, 20);
  assert.equal(negative.nexoModules.NFI.fluxo_percentil_24m, null);
  assert.equal(negative.nexoModules.NFI.fluxo_percentil_disponivel, 0);
  assert.equal(negative.nexoModules.NFI.explica_deslocamento, false);
  assert.equal(negative.hdl_integrity.complete, true);
  assert.equal(negative.score_revisado, 20, "HDL não altera score");
  assert.equal(negative.veredito_final, "MONITORAR", "HDL não altera veredito");
  const negativePrompt = capturedRequests.at(-1).messages[0].content;
  assert.match(negativePrompt, /HDL · HURDLE DO LEVIATÃ/);
  assert.match(negativePrompt, /"alfa_vs_classe_pp":-1\.4001/);
  assert.match(negativePrompt, /imutáveis/);
  assert.match(negativePrompt, /NFI · NEXO FLOW INTELLIGENCE/);
  assert.match(negativePrompt, /nunca altera valor intrínseco, score ou veredito/);

  globalThis.fetch = async () => {
    throw new Error("A finalização determinística não pode chamar a IA.");
  };
  const finalResponse = await request({
    phase: "final",
    assetType: "acao-br",
    ticker: "BBAS3",
    edgeLedger: activeEdge,
    hdlInput: { tir_esperada_pct: 6.5, horizonte_anos: 5 },
    analysisHistory: { scan, deep: negative },
  });
  const final = await finalResponse.json();
  assert.equal(finalResponse.status, 200);
  assert.equal(upstreamCalls, 3);
  assert.equal(final.nexoModules.HDL.alfa_vs_classe_pp, -1.4001);
  assert.equal(final.hdl_conclusao, deepNegative.hdl_conclusao);
  assert.equal(final.score_revisado, 20);
  assert.equal(final.classificacao_final, "MONITORAR");

  globalThis.fetch = async (_url, options) => {
    upstreamCalls += 1;
    capturedRequests.push(JSON.parse(options.body));
    return new Response(
      JSON.stringify({ content: [{ type: "text", text: JSON.stringify(deepExternal) }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  const externalResponse = await request({
    phase: "deep",
    assetType: "stock-ext",
    ticker: "MSFT",
    edgeLedger: activeEdge,
    analysisHistory: {
      scan: { ...scan, ticker: "MSFT", score_total: 30, score_max: 50 },
    },
  });
  const external = await externalResponse.json();
  assert.equal(externalResponse.status, 200);
  assert.equal(external.nexoModules.HDL.status, "not_applicable");
  assert.equal(external.nexoModules.HDL.hurdle_real_pct, null);
  assert.equal(external.nexoModules.NFI.status, "not_applicable");
  assert.equal(external.nexoModules.EDG.has_declared_edge, false);
  assert.equal(external.nexoModules.EDG.max_allowed_classification, "watchlist");
  assert.match(capturedRequests.at(-1).messages[0].content, /não aplicável/i);

  console.log("HDL API integration: semantic and boundary checks passed");
} finally {
  globalThis.fetch = originalFetch;
}
