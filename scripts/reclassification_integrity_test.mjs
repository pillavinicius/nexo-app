import assert from "node:assert/strict";
import {
  buildDeterministicFinal,
  extractReferencePrice,
  reconcileBesst,
  reconcileDeepIntegrity,
  reconcilePriceNarrative,
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

const referencePrice = extractReferencePrice("- Moeda selecionada: BRL\n- Valor atual/cota atual: 22,45\n");
assert.equal(referencePrice, 22.45);
const priceNarrative = reconcilePriceNarrative({
  zone: "R$ 24,00 – R$ 27,00",
  besst: "R$ 19,50",
  referencePrice,
  previousNarrative: "Preço dentro da zona; desconto de 20,4%.",
});
assert.equal(priceNarrative.status, "server_calculated");
assert.equal(priceNarrative.current_position, "below_zone");
assert.match(priceNarrative.value, /6,46% abaixo do piso/);
assert.match(priceNarrative.value, /16,85% abaixo do teto/);
assert.match(priceNarrative.value, /18,75% abaixo do piso/);
assert.doesNotMatch(priceNarrative.value, /20,4%|dentro da zona de convergência/);

const reportSevenDeep = reconcileDeepIntegrity({
  ticker: "BBAS3",
  veredito_final: "MONITORAR",
  zona: "R$ 24,00 – R$ 27,00",
  besst: "R$ 19,50",
  desconto: "Preço atual R$ 22,45 está dentro da zona de convergência.",
  ajustes_score: [],
}, { scan }, { referencePrice });
assert.match(reportSevenDeep.desconto, /acima do BESST e abaixo da zona de convergência/);
assert.equal(reportSevenDeep.integridade_analise.price_narrative_status, "server_calculated");
assert.equal(reportSevenDeep.integridade_analise.reference_price, 22.45);

console.log("reclassification integrity: deterministic score, BESST and price narrative checks passed");
