import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/page.jsx", import.meta.url), "utf8");
const pdf = readFileSync(new URL("../lib/reporting/nexo_pdf_report.mjs", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/analyze/route.js", import.meta.url), "utf8");

for (const token of ["function TdnAudit", "TDN · Teste de Defesa Nominal", "tdn_conclusao", "point-in-time"]) {
  assert.ok(page.includes(token), `Tela deve conter ${token}`);
}
for (const token of ["function writeTdn", "writeTdn(writer, deep", "writeTdn(writer, final"]) {
  assert.ok(pdf.includes(token), `PDF deve conter ${token}`);
}
for (const token of ["loadTdnInput", "computeTDN", "buildTdnPromptContext", "applyTdnToAnalysis", "tdn_edge_unavailable"]) {
  assert.ok(route.includes(token), `API deve conter ${token}`);
}

console.log("TDN UI/PDF/API: 12 verificações aprovadas.");
