import assert from "node:assert/strict";
import { outputConfigForPhase } from "../lib/nexo/analysis/analysis_output_schemas.mjs";

for (const phase of ["scan", "deep", "final"]) {
  const config = outputConfigForPhase(phase);
  assert.equal(config.format.type, "json_schema");
  assert.equal(config.format.schema.type, "object");
  assert.equal(config.format.schema.additionalProperties, false);
  assert.deepEqual(
    new Set(config.format.schema.required),
    new Set(Object.keys(config.format.schema.properties))
  );
}

assert.ok(outputConfigForPhase("deep").format.schema.properties.valuations_classicos);

const validScan = {
  ticker: "BBAS3",
  nome: "Banco do Brasil S.A.",
  segmento: "Bancos",
  veredito: "WATCHLIST",
  motivo_veto: null,
  score_total: 19,
  score_max: 30,
  score_resumo: "Resposta regenerada de forma estruturada.",
  filtros: [],
  governanca: [],
  kpis: [],
  score_dimensoes: [],
  tese: "Tese concisa para o teste de recuperação.",
  catalisadores: [],
  riscos: [],
  lacunas_deep: ["Validar qualidade de crédito.", "Validar custo de funding."],
};

const captured = [];
const originalFetch = globalThis.fetch;

try {
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    captured.push(request);
    const text = captured.length === 1
      ? '{"ticker":"BBAS3" "nome":"Banco do Brasil"}'
      : JSON.stringify(validScan);
    return new Response(JSON.stringify({ content: [{ type: "text", text }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const { POST } = await import("../app/api/analyze/route.js");
  const response = await POST(new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phase: "scan",
      assetType: "acao-br",
      ticker: "BBAS3",
      extraCtx: "Valuations clássicos: SIM",
      edgeLedger: { edge_type: "nenhum", edge_status: "nao_declarado" },
    }),
  }));
  const result = await response.json();

  assert.equal(captured.length, 2, "JSON inválido deve gerar uma única nova tentativa");
  assert.equal(captured[0].output_config.format.type, "json_schema");
  assert.equal(captured[1].output_config.format.type, "json_schema");
  assert.match(captured[1].messages[0].content, /tentativa anterior apresentou JSON inválido/);
  assert.equal(result.ticker, "BBAS3");
  assert.equal(result.veredito, "WATCHLIST");
  assert.equal(result.nexoModules.EDG.version, "EDG_v1.0");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("analysis structured output: 15/15 checks passed");
