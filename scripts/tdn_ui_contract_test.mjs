import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/page.jsx", import.meta.url), "utf8");
const pdf = readFileSync(new URL("../lib/reporting/nexo_pdf_report.mjs", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/analyze/route.js", import.meta.url), "utf8");
const health = readFileSync(new URL("../app/api/health/route.js", import.meta.url), "utf8");
const nextConfig = readFileSync(new URL("../next.config.js", import.meta.url), "utf8");

for (const token of ["function TdnAudit", "TDN · Teste de Defesa Nominal", "tdn_conclusao", "point-in-time"]) {
  assert.ok(page.includes(token), `Tela deve conter ${token}`);
}
assert.ok(page.includes('className="btn-manual" href="/tdn-manual"'), "Mini manual TDN deve usar o mesmo botão visual dos demais módulos");
assert.ok(page.includes("Abrir mini manual TDN ↗"), "Botão do manual deve identificar o módulo TDN");
assert.ok(page.includes("<TdnAudit result={r} showUnavailable />"), "Scan deve exibir inclusive TDN não aplicável");
for (const token of ["function writeTdn", "writeTdn(writer, deep", "writeTdn(writer, final"]) {
  assert.ok(pdf.includes(token), `PDF deve conter ${token}`);
}
for (const token of ["loadTdnInput", "computeTDN", "buildTdnPromptContext", "applyTdnToAnalysis", "tdn_edge_unavailable"]) {
  assert.ok(route.includes(token), `API deve conter ${token}`);
}
for (const asset of ["tdn_sector_matrix.json", "tdn_fatos.json.gz"]) {
  assert.ok(nextConfig.includes(asset), `Deploy deve empacotar ${asset}`);
}
for (const token of ["loadTdnSectorMatrix", "loadVersionedTdnFacts", "tdnReady"]) {
  assert.ok(health.includes(token), `Health deve certificar ${token}`);
}

console.log("TDN UI/PDF/API/deploy: 19 verificações aprovadas.");
