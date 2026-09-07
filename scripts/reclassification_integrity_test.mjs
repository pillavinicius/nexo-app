import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildDeterministicFinal,
  extractReferencePrice,
  reconcileBesst,
  reconcileDeepIntegrity,
  reconcilePriceNarrative,
  RECLASSIFICATION_INTEGRITY_VERSION,
} from "../lib/nexo/analysis/reclassification_integrity.mjs";
import { reconcileValuationLayers } from "../lib/nexo/analysis/valuation_integrity.mjs";

const scan = {
  ticker: "BBAS3",
  veredito: "APROVADO",
  score_total: 21,
  score_max: 30,
  tese: "Tese registrada no Scan.",
  lacunas_deep: ["Validar inadimplência."],
};

for (const productionModule of [
  "../lib/nexo/analysis/valuation_integrity.mjs",
  "../lib/nexo/analysis/reclassification_integrity.mjs",
]) {
  const source = readFileSync(new URL(productionModule, import.meta.url), "utf8");
  assert.doesNotMatch(source, /BBAS3|ITUB4|BBDC4/, "a regra de produção não pode conter exceção por ticker");
}

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

const reportEightPriceLayers = [
  {
    c: "C1",
    vj: "R$ 25,50",
    met: "P/L normalizado 12x sobre lucro ajustado anualizado ~R$15 bi / ~2,87 bi ações",
    prem: "ROE retorna a 11–12% em 12 meses.",
  },
  {
    c: "C2",
    vj: "R$ 23,00",
    met: "P/VP 0,75x sobre patrimônio líquido estimado (~R$145 bi / 2,87 bi ações = ~R$50,5 BV)",
    prem: "Cenário-base.",
  },
  {
    c: "C3",
    vj: "R$ 19,50",
    met: "Desconto adicional de 15% sobre C2 por risco político",
    prem: "Cenário de estresse.",
  },
];
const reportEightDeep = reconcileDeepIntegrity({
  ticker: "BBAS3",
  veredito_final: "MONITORAR",
  preco: reportEightPriceLayers,
  zona: "R$ 22,00 – R$ 25,50",
  besst: "R$ 18,70",
  desconto: "Preço atual R$ 22,45 está dentro da zona.",
  ajustes_score: [],
}, { scan }, { referencePrice });
assert.equal(reportEightDeep.preco[0].vj, "R$ 62,72");
assert.equal(reportEightDeep.preco[1].vj, "R$ 37,89");
assert.equal(reportEightDeep.preco[2].vj, "R$ 32,21");
assert.deepEqual(reportEightDeep.integridade_analise.valuation_corrected_layers, ["C1", "C2", "C3"]);
assert.equal(reportEightDeep.integridade_analise.valuation_zone_suppressed, true);
assert.match(reportEightDeep.zona, /^N\/D/);
assert.match(reportEightDeep.besst, /^N\/D/);
assert.match(reportEightDeep.desconto, /não foi inferida automaticamente/);
assert.doesNotMatch(reportEightDeep.desconto, /dentro da zona/);

for (const bankCase of [
  { ticker: "ITUB4", total: 40e9, units: 4e9, multiple: 9, expected: "R$ 90,00" },
  { ticker: "BBDC4", total: 30e9, units: 5e9, multiple: 8, expected: "R$ 48,00" },
]) {
  const result = reconcileValuationLayers([{
    c: "C1",
    vj: "R$ 1,00",
    met: "Múltiplo sobre resultado por ação",
    prem: "Entradas estruturadas.",
    calc: {
      formula: "TOTAL_POR_UNIDADE_X_MULTIPLO",
      multiplo: bankCase.multiple,
      valor_total: bankCase.total,
      quantidade_unidades: bankCase.units,
    },
  }]);
  assert.equal(result.layers[0].vj, bankCase.expected, `${bankCase.ticker} deve obedecer à mesma regra, sem exceção por ticker`);
  assert.equal(result.corrected_layers[0], "C1");
}

const fiiYield = reconcileValuationLayers([{
  c: "C2",
  vj: "R$ 10,00",
  met: "Renda anual por cota dividida pelo yield requerido",
  prem: "Perfil de FII de renda.",
  calc: { formula: "RENDA_POR_YIELD", renda_por_unidade: 1.2, yield_pct: 10 },
}]);
assert.equal(fiiYield.layers[0].vj, "R$ 12,00", "a integridade aritmética também deve funcionar para outra natureza de ativo");

const validStructuredLayers = reconcileDeepIntegrity({
  ticker: "ITUB4",
  veredito_final: "MONITORAR",
  preco: [{
    c: "C1",
    vj: "R$ 90,00",
    met: "Múltiplo sobre resultado por ação",
    prem: "Entradas estruturadas.",
    calc: { formula: "TOTAL_POR_UNIDADE_X_MULTIPLO", multiplo: 9, valor_total: 40e9, quantidade_unidades: 4e9 },
  }],
  zona: "R$ 80,00 a R$ 90,00",
  besst: "R$ 60,00 a R$ 76,50",
  desconto: "Narrativa provisória.",
  ajustes_score: [],
}, { scan: { ...scan, ticker: "ITUB4" } }, { referencePrice: 75 });
assert.equal(validStructuredLayers.integridade_analise.valuation_status, "verified");
assert.equal(validStructuredLayers.integridade_analise.valuation_zone_suppressed, false);
assert.equal(validStructuredLayers.zona, "R$ 80,00 a R$ 90,00");
assert.match(validStructuredLayers.desconto, /6,25% abaixo do piso/);

console.log("reclassification integrity: score, valuation layers, BESST and price narrative checks passed");
