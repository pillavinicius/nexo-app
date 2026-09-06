#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/page.jsx", import.meta.url), "utf8");
const manual = readFileSync(new URL("../app/hdl-manual/page.jsx", import.meta.url), "utf8");

for (const expected of [
  "HDL · Hurdle do Leviatã · F1a",
  "Abrir mini manual HDL ↗",
  'href="/hdl-manual"',
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

for (const expected of [
  "Como aplicar o Hurdle do Leviatã",
  "Aplicação por classe e perfil econômico",
  "Ações maduras",
  "Bancos e seguradoras",
  "Cíclicas e commodities",
  "Empresas de crescimento",
  "FIIs",
  "Ativos internacionais",
  "Leitura conforme o cenário macro",
  "Evite dupla contagem",
  "Sem extrapolação",
  "O Scan continua permitido; o Deep brasileiro fica bloqueado.",
  "ALFA PRÓXIMO DE ZERO",
  "não altera score ou veredito de forma automática",
]) {
  assert.ok(manual.includes(expected), `manual HDL incompleto: ${expected}`);
}

console.log("HDL UI contract: 31/31 checks passed");
