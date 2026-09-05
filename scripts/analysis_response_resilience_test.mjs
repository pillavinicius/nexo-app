import assert from "node:assert/strict";
import http from "node:http";
import { POST, maxDuration, parseModelJSON } from "../app/api/analyze/route.js";
import { readApiJsonResponse } from "../lib/ui/api_response_adapter.mjs";

const validScan = {
  ticker: "BBAS3",
  nome: "Banco do Brasil S.A.",
  segmento: "Banco Público - Setor Financeiro",
  veredito: "WATCHLIST",
  motivo_veto: null,
  score_total: 19,
  score_max: 30,
  score_resumo: "Fundamentos sólidos com riscos macro acompanhados.",
  filtros: [{ nome: "Liquidez", valor: "Adequada", status: "PASS", nota: "Sem veto" }],
  governanca: [],
  kpis: [{ nome: "P/L", valor: "10,49x", benchmark: "Setorial", status: "PASS" }],
  score_dimensoes: [],
  tese: "Tese concisa para a simulação BBAS3.",
  catalisadores: [],
  riscos: [],
  lacunas_deep: ["Validar qualidade de crédito.", "Validar custo de funding."],
};

assert.equal(maxDuration, 120, "a rota deve suportar a latência completa da análise");

const malformedLikeProduction = JSON.stringify(validScan).replace(
  ',"segmento":"Banco Público - Setor Financeiro","veredito"',
  ',"segmento":"Banco Público - Setor Financeiro" "veredito"'
);
const repaired = parseModelJSON(malformedLikeProduction);
assert.equal(repaired.ok, true);
assert.equal(repaired.repaired, true);
assert.equal(repaired.data.ticker, "BBAS3");
assert.equal(repaired.data.veredito, "WATCHLIST");

const capturedRequests = [];
const originalFetch = globalThis.fetch;
let server;
let upstreamTexts = [malformedLikeProduction];

try {
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("api.anthropic.com")) {
      capturedRequests.push(JSON.parse(options.body));
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: upstreamTexts.shift() || JSON.stringify(validScan) }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return originalFetch(url, options);
  };

  server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const routeResponse = await POST(new Request("http://localhost/api/analyze", {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      body,
    }));
    response.writeHead(routeResponse.status, Object.fromEntries(routeResponse.headers.entries()));
    response.end(Buffer.from(await routeResponse.arrayBuffer()));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const httpResponse = await originalFetch(`http://127.0.0.1:${address.port}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phase: "scan",
      assetType: "acao-br",
      ticker: "BBAS3",
      extraCtx: "Valuations clássicos: SIM",
      edgeLedger: { edge_type: "nenhum", edge_status: "nao_declarado" },
    }),
  });
  const result = await readApiJsonResponse(httpResponse);

  assert.equal(httpResponse.status, 200);
  assert.match(httpResponse.headers.get("content-type") || "", /application\/json/);
  assert.equal(capturedRequests.length, 1, "reparo local não deve consumir segunda chamada");
  assert.equal("output_config" in capturedRequests[0], false, "rota não depende do modo estruturado externo");
  assert.equal(result.ticker, "BBAS3");
  assert.equal(result.veredito, "WATCHLIST");
  assert.equal(result.nexoModules.EDG.version, "EDG_v1.0");

  upstreamTexts = ["resposta totalmente irrecuperável", JSON.stringify(validScan)];
  const retriedResponse = await originalFetch(`http://127.0.0.1:${address.port}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phase: "scan",
      assetType: "acao-br",
      ticker: "BBAS3",
      extraCtx: "Valuations clássicos: SIM",
      edgeLedger: { edge_type: "nenhum", edge_status: "nao_declarado" },
    }),
  });
  const retriedResult = await readApiJsonResponse(retriedResponse);
  assert.equal(capturedRequests.length, 3, "falha irrecuperável deve fazer somente uma nova tentativa");
  assert.match(capturedRequests[2].messages[0].content, /tentativa anterior apresentou JSON inválido/);
  assert.equal(retriedResult.ticker, "BBAS3");
  assert.equal(retriedResult.veredito, "WATCHLIST");

  await assert.rejects(
    () => readApiJsonResponse(new Response("FUNCTION_INVOCATION_TIMEOUT", { status: 504 })),
    /tempo limite do servidor/
  );
  await assert.rejects(
    () => readApiJsonResponse(new Response("Internal Server Error", { status: 500 })),
    /HTTP 500/
  );
} finally {
  globalThis.fetch = originalFetch;
  if (server) await new Promise((resolve) => server.close(resolve));
}

console.log("analysis response resilience: 18/18 checks passed");
