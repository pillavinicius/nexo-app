import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/page.jsx", import.meta.url), "utf8");
const manual = readFileSync(new URL("../app/nfi-manual/page.jsx", import.meta.url), "utf8");
const pdf = readFileSync(new URL("../lib/reporting/nexo_pdf_report.mjs", import.meta.url), "utf8");

for (const token of [
  "NFI · NEXO Flow Intelligence · F1b",
  "Abrir mini manual NFI ↗",
  "NFI INDISPONÍVEL PARA ATIVOS NO EXTERIOR",
  "nexoModules?.NFI",
  "Percentil provisório",
  "não altera score nem veredito",
]) assert.ok(page.includes(token), `UI NFI ausente: ${token}`);

for (const token of ["t2_official", "t2_pending", "Extremo confirmado", "24 meses oficiais completos", "ativos no exterior"]) {
  assert.ok(manual.includes(token), `manual NFI ausente: ${token}`);
}
assert.ok(pdf.includes("writeNfi"));
assert.ok(pdf.includes("O NFI explica deslocamento de preço"));
console.log("NFI UI/PDF contract: 13/13 checks passed");
