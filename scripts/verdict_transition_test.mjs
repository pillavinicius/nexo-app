import assert from "node:assert/strict";
import {
  deriveVerdictChange,
  reconcileFinalVerdictChange,
} from "../lib/nexo/analysis/verdict_transition.mjs";

assert.equal(deriveVerdictChange("EVITAR", "EVITAR", "MELHOROU"), "MANTEVE");
assert.equal(deriveVerdictChange("MONITORAR", "COMPRAR", "PIOROU"), "MELHOROU");
assert.equal(deriveVerdictChange("COMPRAR", "MONITORAR", "MELHOROU"), "PIOROU");
assert.equal(deriveVerdictChange("AGUARDAR", "MONITORAR"), "MELHOROU");
assert.equal(deriveVerdictChange("MONITORAR", "EVITAR"), "PIOROU");
assert.equal(deriveVerdictChange("WATCHLIST", "AGUARDAR", "PIOROU"), "MANTEVE");

const bbas3 = reconcileFinalVerdictChange("final", {
  veredito_anterior: "EVITAR",
  veredito_reclassificado: "EVITAR",
  score_original: 14,
  score_revisado: 16,
  mudanca_veredito: "MELHOROU",
});
assert.equal(bbas3.mudanca_veredito, "MANTEVE");
assert.equal(bbas3.score_revisado - bbas3.score_original, 2);

const untouchedScan = { veredito: "WATCHLIST" };
assert.equal(reconcileFinalVerdictChange("scan", untouchedScan), untouchedScan);

console.log("verdict transition: 9/9 checks passed");
