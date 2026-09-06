#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/page.jsx", import.meta.url), "utf8");

for (const expected of [
  "HDL · Hurdle do Leviatã · F1a",
  "TIR real esperada · % a.a.",
  "Horizonte · anos",
  "hdlExpectedRealReturn",
  "hdlHorizonYears",
  "const canDeep = hasScan && !hasDeep && !isVeto && hdlInputReady",
  "hdlRequiredForScan && !hdlInputReady",
  "sem extrapolação além da curva",
  "nexoModules?.HDL",
  "Conclusão HDL no Deep",
  "o módulo não altera score nem veredito",
]) {
  assert.ok(source.includes(expected), `contrato visual HDL ausente: ${expected}`);
}

assert.match(source, /hdlInput:\s*\{\s*tir_esperada_pct: hdlExpectedRealReturn,/);
assert.match(source, /setHdlExpectedRealReturn\(""\)/);
assert.match(source, /setHdlHorizonYears\(""\)/);
assert.match(source, /NÃO APLICÁVEL NESTA FASE/);

console.log("HDL UI contract: 15/15 checks passed");
