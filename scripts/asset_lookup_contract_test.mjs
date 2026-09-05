#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  ASSET_LOOKUP_ERROR,
  ASSET_LOOKUP_STATUS,
  assetLookupFailurePayload,
  classifyProviderLookupAttempts,
  resolveAssetLookupState,
} from "../lib/nexo/data/asset_lookup_contract.mjs";

let assertions = 0;
const equal = (actual, expected, message) => {
  assert.equal(actual, expected, message);
  assertions += 1;
};

equal(
  classifyProviderLookupAttempts([{ status: 200, message: "sem results" }]),
  ASSET_LOOKUP_STATUS.NOT_FOUND,
  "resposta válida vazia classifica ticker inexistente"
);
equal(
  classifyProviderLookupAttempts([{ status: 404, message: "symbol not found" }]),
  ASSET_LOOKUP_STATUS.NOT_FOUND,
  "símbolo explicitamente inexistente é reconhecido"
);
equal(
  classifyProviderLookupAttempts([{ status: 429, message: "rate limit" }]),
  ASSET_LOOKUP_STATUS.UNAVAILABLE,
  "limite do provedor não vira ticker inexistente"
);
equal(
  classifyProviderLookupAttempts([{ status: 500, message: "internal error" }]),
  ASSET_LOOKUP_STATUS.UNAVAILABLE,
  "falha de infraestrutura não vira ticker inexistente"
);
equal(
  classifyProviderLookupAttempts([
    { status: 200, message: "sem results" },
    { status: 503, message: "temporarily unavailable" },
  ]),
  ASSET_LOOKUP_STATUS.UNAVAILABLE,
  "falha de infraestrutura impede falso negativo"
);

const missing = assetLookupFailurePayload({
  ticker: "NAOEXISTE3",
  route: "B3_HG_BRASIL",
  attempts: [{ status: 200, message: "sem results" }],
});
equal(missing.error, "Ticker inexistente", "mensagem canônica é objetiva");
equal(missing.tickerExists, false, "ticker inexistente é marcado explicitamente");
equal(missing.manualFallback, false, "ticker inexistente nunca libera fallback");
equal(missing.errorCode, ASSET_LOOKUP_ERROR.TICKER_NOT_FOUND, "erro inexistente possui código estável");

equal(
  resolveAssetLookupState({ responseOk: true, data: { ok: true, tickerExists: true }, hasAutomaticPrice: true }),
  ASSET_LOOKUP_STATUS.FOUND,
  "ticker com preço carrega dados automáticos"
);
equal(
  resolveAssetLookupState({ responseOk: true, data: { ok: true, tickerExists: true }, hasAutomaticPrice: false }),
  ASSET_LOOKUP_STATUS.MANUAL_FALLBACK,
  "ticker confirmado sem preço libera fallback"
);
equal(
  resolveAssetLookupState({ responseOk: false, data: missing, hasAutomaticPrice: false }),
  ASSET_LOOKUP_STATUS.NOT_FOUND,
  "cliente preserva estado inexistente"
);
equal(
  resolveAssetLookupState({ responseOk: false, data: { ok: false, tickerExists: null }, hasAutomaticPrice: false }),
  ASSET_LOOKUP_STATUS.UNAVAILABLE,
  "falha sem confirmação mantém campos bloqueados"
);
equal(
  resolveAssetLookupState({
    responseOk: false,
    data: { ok: false, tickerExists: true, manualFallback: true },
    hasAutomaticPrice: false,
  }),
  ASSET_LOOKUP_STATUS.MANUAL_FALLBACK,
  "fallback exige confirmação positiva do ticker"
);

const originalFetch = globalThis.fetch;
const originalHgKey = process.env.HG_BRASIL_KEY;
process.env.HG_BRASIL_KEY = "test-key";

try {
  const { GET } = await import("../app/api/asset/route.js");

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  const missingResponse = await GET(
    new Request("http://localhost/api/asset?ticker=NAOEXISTE3")
  );
  const missingBody = await missingResponse.json();
  equal(missingResponse.status, 404, "route responde 404 para ticker inexistente");
  equal(missingBody.error, "Ticker inexistente", "route devolve a mensagem solicitada");
  equal(missingBody.tickerExists, false, "route não confirma ticker inexistente");
  equal(missingBody.manualFallback, false, "route não libera manual para ticker inexistente");

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "temporarily unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  const unavailableResponse = await GET(
    new Request("http://localhost/api/asset?ticker=TEST3")
  );
  const unavailableBody = await unavailableResponse.json();
  equal(unavailableResponse.status, 503, "route distingue indisponibilidade técnica");
  equal(unavailableBody.tickerExists, null, "falha técnica não presume existência");
  equal(unavailableBody.manualFallback, false, "falha sem confirmação não libera manual");

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const payload = calls === 1
      ? { results: [{ ticker: "B3:TEST3", name: "Ativo teste", currency: "BRL", quote: {} }] }
      : { results: [] };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const fallbackResponse = await GET(
    new Request("http://localhost/api/asset?ticker=TEST3")
  );
  const fallbackBody = await fallbackResponse.json();
  equal(fallbackResponse.status, 200, "ticker confirmado mantém resposta válida");
  equal(fallbackBody.tickerExists, true, "route confirma a existência antes do fallback");
  equal(fallbackBody.manualFallback, true, "ticker confirmado sem cotação libera manual");
} finally {
  globalThis.fetch = originalFetch;
  if (originalHgKey === undefined) delete process.env.HG_BRASIL_KEY;
  else process.env.HG_BRASIL_KEY = originalHgKey;
}

console.log(`Asset lookup contract: ${assertions} assertions OK`);
