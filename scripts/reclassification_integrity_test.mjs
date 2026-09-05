import assert from "node:assert/strict";
import {
  buildDeterministicFinal,
  reconcileBesst,
  reconcileDeepIntegrity,
  RECLASSIFICATION_INTEGRITY_VERSION,
} from "../lib/nexo/analysis/reclassification_integrity.mjs";

const scan = {
  ticker: "BBAS3",
  veredito: "APROVADO",
  score_total: 21,
  score_max: 30,
  tese: "Tese registrada no Scan.",
  lacunas_deep: ["Validar inadimplência."],
};

const scanOnly = buildDeterministicFinal({ ticker: "BBAS3", history: { scan } });
assert.equal(scanOnly.classificacao_final, "APROVADO");
assert.equal(scanOnly.veredito_anterior, "APROVADO");
assert.equal(scanOnly.veredito_reclassificado, "APROVADO");
assert.equal(scanOnly.score_original, 21);
assert.equal(scanOnly.score_revisado, 21);
assert.equal(scanOnly.mudanca_score, "0");
assert.equal(scanOnly.mudanca_veredito, "MANTEVE");
assert.equal(scanOnly.preco_final.zona_convergencia, "N/D — Deep não realizado");
assert.equal(scanOnly.integridade_reclassificacao.version, RECLASSIFICATION_INTEGRITY_VERSION);

const deep = reconcileDeepIntegrity({
  ticker: "BBAS3",
  veredito_final: "MONITORAR",
  score_original: 18,
  score_revisado: 17,
  score_max: 30,
  zona: "R$ 19,00 a R$ 21,00",
  besst: "R$ 24,50 a R$ 26,00",
  desconto: "10%",
  ajustes_score: [
    { dimensao: "Qualidade", antes: 3, depois: 2, motivo: "Evidência nova no Deep." },
    { dimensao: "Governança", antes: 3, depois: 2, motivo: "Evidência nova no Deep." },
    { dimensao: "Catalisadores", antes: 2, depois: 3, motivo: "Evidência nova no Deep." },
    { dimensao: "Qualidade", antes: 2, depois: 0, motivo: "Duplicidade que deve ser ignorada." },
  ],
  passos: ["Acompanhar próximo resultado."],
}, { scan });

assert.equal(deep.score_original, 21);
assert.equal(deep.score_revisado, 20);
assert.equal(deep.score_total, 20);
assert.equal(deep.mudanca_score, "-1");
assert.equal(deep.ajustes_score.length, 3);
assert.equal(deep.integridade_analise.score_source, "server_calculated");
assert.equal(deep.integridade_analise.besst_corrected, true);
assert.equal(deep.besst, "R$ 14,25 a R$ 17,85");

const finalAfterDeep = buildDeterministicFinal({ ticker: "BBAS3", history: { scan, deep } });
assert.equal(finalAfterDeep.classificacao_final, "MONITORAR");
assert.equal(finalAfterDeep.veredito_anterior, "MONITORAR");
assert.equal(finalAfterDeep.veredito_reclassificado, "MONITORAR");
assert.equal(finalAfterDeep.score_original, 20);
assert.equal(finalAfterDeep.score_revisado, 20);
assert.equal(finalAfterDeep.mudanca_veredito, "MANTEVE");
assert.equal(finalAfterDeep.integridade_reclassificacao.baseline_phase, "deep");

const validBesst = reconcileBesst({ zone: "USD 100.00 - USD 110.00", besst: "USD 78.00 - USD 90.00" });
assert.equal(validBesst.status, "valid");
assert.equal(validBesst.corrected, false);

console.log("reclassification integrity: 26/26 checks passed");
