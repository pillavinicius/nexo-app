import assert from "node:assert/strict";
import { POST } from "../app/api/export/pdf/route.js";

const request = new Request("http://localhost/api/export/pdf", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    generatedAt: "2026-09-05T14:00:00.000Z",
    ticker: "TEST3",
    asset: { name: "Ativo de teste", currency: "BRL", price: 10 },
    scan: { veredito: "WATCHLIST", score_total: 18, score_max: 30 },
    deep: { veredito_final: "MONITORAR" },
    final: { classificacao_final: "WATCHLIST", score_original: 18, score_revisado: 18, score_max: 30 },
    options: { classicValuations: "NAO" },
  }),
});

const response = await POST(request);
assert.equal(response.status, 200);
assert.equal(response.headers.get("content-type"), "application/pdf");
assert.match(response.headers.get("content-disposition") || "", /^attachment; filename="NEXO_TEST3_/);
const bytes = Buffer.from(await response.arrayBuffer());
assert.equal(bytes.subarray(0, 4).toString(), "%PDF");

const invalid = await POST(new Request("http://localhost/api/export/pdf", {
  method: "POST",
  body: JSON.stringify({ ticker: "TEST3" }),
}));
assert.equal(invalid.status, 400);

console.log("pdf route contract: 5/5 checks passed");
