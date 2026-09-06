import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/page.jsx", import.meta.url), "utf8");
const resetStart = source.indexOf("function resetToInitial()");
const resetEnd = source.indexOf("async function loadMacro()", resetStart);
assert.ok(resetStart > -1 && resetEnd > resetStart);
const resetBody = source.slice(resetStart, resetEnd);

for (const requiredReset of [
  'setTicker("")',
  "setScanResult(null)",
  "setDeepResult(null)",
  "setDeepAdds([])",
  "setFinalResult(null)",
  'setEdgeType("nenhum")',
  'setClassicValuations("NAO")',
  'setHdlExpectedRealReturn("")',
  'setHdlHorizonYears("")',
  'setUseComplementaryData("NAO")',
  "setAssetData(null)",
  'setPhase("initial")',
  "window.scrollTo({ top: 0",
]) {
  assert.ok(resetBody.includes(requiredReset), `reset ausente: ${requiredReset}`);
}

assert.ok((source.match(/Reset e nova análise/g) || []).length >= 3);
assert.match(source, /Exportar PDF/);
assert.match(source, /onClick=\{resetToInitial\} disabled=\{pdfLoading\}>Nova análise/);

console.log("UI reset contract: 15/15 checks passed");
