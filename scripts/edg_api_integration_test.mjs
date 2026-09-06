#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let assertions = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  assertions += 1;
};
const equal = (actual, expected, message) => {
  assert.equal(actual, expected, message);
  assertions += 1;
};

const schema = JSON.parse(
  readFileSync(new URL("../contracts/edge-ledger.schema.json", import.meta.url), "utf8")
);
equal(schema.title, "NEXO EDG Edge Ledger v1.0", "contrato EDG canônico existe");

const activeEdge = {
  edge_type: "analitico",
  edge_evidence: "Margem bruta auditada permaneceu acima da média setorial.",
  edge_insumo: "IQD",
  edge_expiry_condition: "Quando a margem bruta cruzar 17% para baixo por dois trimestres.",
  edge_declared_at: "2026-09-04",
  edge_status: "ativo",
};

const modelOutputs = [
  { ticker: "TEST3", veredito: "APROVADO", score_resumo: "Teste D2" },
  {
    ticker: "TEST3",
    veredito_final: "COMPRAR",
    hdl_conclusao: "O alfa positivo supera o soberano, condicionado à manutenção das premissas da TIR.",
  },
  {
    ticker: "TEST3",
    classificacao_final: "COMPRAR",
    veredito_anterior: "EVITAR",
    veredito_reclassificado: "COMPRAR",
    mudanca_veredito: "PIOROU",
  },
];
const capturedRequests = [];
const originalFetch = globalThis.fetch;

try {
  globalThis.fetch = async (_url, options) => {
    capturedRequests.push(JSON.parse(options.body));
    const output = modelOutputs.shift();
    return new Response(
      JSON.stringify({ content: [{ text: JSON.stringify(output) }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const { POST } = await import("../app/api/analyze/route.js");

  async function analyze(phase, edgeLedger) {
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase,
          assetType: "acao-br",
          ticker: "TEST3",
          extraCtx: "contexto de integração EDG",
          edgeLedger,
          hdlInput: { tir_esperada_pct: 9, horizonte_anos: 5 },
        }),
      })
    );
    equal(response.status, 200, `${phase} responde HTTP 200`);
    return response.json();
  }

  const scan = await analyze("scan", {
    edge_type: "nenhum",
    edge_status: "nao_declarado",
  });
  equal(scan.veredito, "WATCHLIST", "D2 limita Scan sem edge");
  equal(scan.nexoModules.EDG.version, "EDG_v1.0", "Scan expõe módulo versionado");
  equal(scan.nexoModules.EDG.max_allowed_classification, "watchlist", "Scan expõe teto D2");
  equal(scan.edg_governance.rule, "D2", "Scan registra regra aplicada");

  const deep = await analyze("deep", activeEdge);
  equal(deep.veredito_final, "COMPRAR", "edge ativo válido não altera saída do modelo");
  equal(deep.nexoModules.EDG.has_declared_edge, true, "Deep recebe edge válido");
  equal(deep.edg_governance.applied, false, "Deep registra ausência de intervenção");

  const final = await analyze("final", {
    ...activeEdge,
    edge_status: "expirado",
  });
  equal(final.classificacao_final, "EVITAR", "D3 prevalece na classificação final");
  equal(final.veredito_reclassificado, "EVITAR", "D3 prevalece no veredito reclassificado");
  equal(final.mudanca_veredito, "MANTEVE", "vereditos iguais prevalecem sobre o rótulo produzido pelo modelo");
  equal(final.nexoModules.EDG.exit_signal, "edge_expired", "Final expõe sinal de expiração");
  equal(final.edg_governance.rule, "D3", "Final registra regra D3");

  equal(capturedRequests.length, 3, "três fases chamaram a Estação 3");
  const prompts = capturedRequests.map((request) => request.messages[0].content);
  check(prompts.every((prompt) => prompt.includes("--- GOVERNANÇA DE EDGE ---")), "todas as fases recebem bloco EDG");
  check(prompts.every((prompt) => prompt.includes("veredito analítico bruto")), "todas as fases pedem saída anterior à governança");
  check(prompts.every((prompt) => !prompt.includes("REGRA D2 RATIFICADA")), "modelo não antecipa a aplicação D2");
  check(prompts[1].includes(activeEdge.edge_evidence), "Deep recebe evidência declarada");
  check(prompts[1].includes(activeEdge.edge_expiry_condition), "Deep recebe condição observável");
  check(!prompts[2].includes("REGRA D3 RATIFICADA"), "modelo não antecipa a aplicação D3");
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`EDG API integration: ${assertions} assertions OK`);
