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
  preco: [
    { c: "C1", vj: "R$ 19,00", met: "Valor unitário", prem: "Direto.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 19, multiplo: 1 } },
    { c: "C2", vj: "R$ 21,00", met: "Valor unitário", prem: "Direto.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 21, multiplo: 1 } },
  ],
  zona: "R$ 19,00 a R$ 21,00",
  zona_calc: { camadas_incluidas: ["C1", "C2"], justificativa_exclusoes: "" },
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
assert.equal(deep.besst, "R$ 14,25 a R$ 16,15");

const finalAfterDeep = buildDeterministicFinal({ ticker: "BBAS3", history: { scan, deep } });
assert.equal(finalAfterDeep.classificacao_final, "MONITORAR");
assert.equal(finalAfterDeep.veredito_anterior, "MONITORAR");
assert.equal(finalAfterDeep.veredito_reclassificado, "MONITORAR");
assert.equal(finalAfterDeep.score_original, 20);
assert.equal(finalAfterDeep.score_revisado, 20);
assert.equal(finalAfterDeep.mudanca_veredito, "MANTEVE");
assert.equal(finalAfterDeep.integridade_reclassificacao.baseline_phase, "deep");

const validBesst = reconcileBesst({ zone: "USD 100.00 - USD 110.00", besst: "USD 75.00 - USD 85.00" });
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
  preco: [
    { c: "C1", vj: "R$ 24,00", met: "Valor unitário", prem: "Direto.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 24, multiplo: 1 } },
    { c: "C2", vj: "R$ 27,00", met: "Valor unitário", prem: "Direto.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 27, multiplo: 1 } },
  ],
  zona: "R$ 24,00 – R$ 27,00",
  zona_calc: { camadas_incluidas: ["C1", "C2"], justificativa_exclusoes: "" },
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
assert.equal(reportEightDeep.integridade_analise.valuation_zone_suppressed, false);
assert.equal(reportEightDeep.zona, "R$ 32,21 a R$ 62,72");
assert.equal(reportEightDeep.besst, "R$ 24,16 a R$ 27,38");
assert.match(reportEightDeep.desconto, /abaixo do piso/);
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

const bbasYieldNarrative = reconcileValuationLayers([{
  c: "C2",
  vj: "R$ 22,84",
  met: "Renda por yield com yield-alvo de 6,0%.",
  prem: "Renda anual de R$ 0,628 e yield-alvo de 2,75%.",
  calc: { formula: "RENDA_POR_YIELD", renda_por_unidade: 0.628, yield_pct: 2.75 },
}]);
assert.equal(bbasYieldNarrative.layers[0].vj, "R$ 22,84");
assert.match(bbasYieldNarrative.layers[0].met, /yield-alvo de 2,75%/i, "o método deve usar o mesmo yield da memória estruturada");
assert.doesNotMatch(bbasYieldNarrative.layers[0].met, /6,0%/, "o servidor deve remover a taxa textual contraditória");
assert.deepEqual(bbasYieldNarrative.layers[0].calculo_integridade.narrative_input_corrections.map((item) => item.field), ["yield_pct"]);

const valeStaleExclusion = reconcileDeepIntegrity({
  ticker: "VALE3",
  veredito_final: "MONITORAR",
  preco: [
    { c: "C1", vj: "R$ 87,00", met: "Base direta", prem: "Valor verificável.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 87, multiplo: 1 } },
    { c: "C2", vj: "R$ 82,00", met: "Base direta", prem: "Valor verificável.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 82, multiplo: 1 } },
    { c: "C3", vj: "R$ 92,00", met: "Múltiplo", prem: "Valor estruturado.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 45.35, multiplo: 2 } },
  ],
  zona: "R$ 82,00 a R$ 87,00",
  zona_calc: { camadas_incluidas: ["C1", "C2"], justificativa_exclusoes: "C3 (R$ 92,00) excluída por representar cenário otimista." },
  besst: "R$ 61,50 a R$ 69,70",
  ajustes_score: [],
}, { scan: { ...scan, ticker: "VALE3" } }, { referencePrice: 62 });
assert.equal(valeStaleExclusion.preco[2].vj, "R$ 90,70");
assert.match(valeStaleExclusion.zona_calc.justificativa_exclusoes, /C3 \(R\$ 90,70\)/);
assert.doesNotMatch(valeStaleExclusion.zona_calc.justificativa_exclusoes, /92,00/);

const validStructuredLayers = reconcileDeepIntegrity({
  ticker: "ITUB4",
  veredito_final: "MONITORAR",
  preco: [
    {
      c: "C1",
      vj: "R$ 90,00",
      met: "Múltiplo sobre resultado por ação",
      prem: "Entradas estruturadas.",
      calc: { formula: "TOTAL_POR_UNIDADE_X_MULTIPLO", multiplo: 9, valor_total: 40e9, quantidade_unidades: 4e9 },
    },
    {
      c: "C2",
      vj: "R$ 80,00",
      met: "Valor unitário",
      prem: "Entrada direta.",
      calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", multiplo: 1, valor_por_unidade: 80 },
    },
  ],
  zona: "R$ 80,00 a R$ 90,00",
  zona_calc: { camadas_incluidas: ["C1", "C2"], justificativa_exclusoes: "" },
  besst: "R$ 60,00 a R$ 76,50",
  desconto: "Narrativa provisória.",
  ajustes_score: [],
}, { scan: { ...scan, ticker: "ITUB4" } }, { referencePrice: 75 });
assert.equal(validStructuredLayers.integridade_analise.valuation_status, "verified");
assert.equal(validStructuredLayers.integridade_analise.valuation_zone_suppressed, false);
assert.equal(validStructuredLayers.zona, "R$ 80,00 a R$ 90,00");
assert.match(validStructuredLayers.desconto, /6,25% abaixo do piso/);

const reportNineRejected = reconcileDeepIntegrity({
  ticker: "BANK3",
  veredito_final: "MONITORAR",
  preco: [
    { c: "C1", vj: "R$ 25,41", met: "P/VPA", prem: "VPA direto.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 31.76, multiplo: 0.8 } },
    { c: "C2", vj: "R$ 23,52", met: "P/L", prem: "Média conservadora entre R$ 2,18 e R$ 2,47.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 2.24, multiplo: 10.5 } },
    { c: "C3", vj: "R$ 27,00", met: "P/VPA", prem: "Cenário otimista.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 31.76, multiplo: 0.85 } },
  ],
  zona: "R$ 23,52 a R$ 25,41",
  zona_calc: { camadas_incluidas: ["C1", "C2"], justificativa_exclusoes: "C3 representa cenário otimista, não a convergência central." },
  besst: "R$ 19,92 a R$ 19,91",
  ajustes_score: [],
}, { scan: { ...scan, ticker: "BANK3" } }, { referencePrice: 22.45 });
assert.deepEqual(reportNineRejected.integridade_analise.valuation_invalid_layers, ["C2"]);
assert.equal(reportNineRejected.preco[1].calculo_integridade.reason, "derivacao_composta_nao_declarada");
assert.equal(reportNineRejected.integridade_analise.valuation_zone_suppressed, false);
assert.equal(reportNineRejected.zona, "R$ 25,41 a R$ 27,00");
assert.equal(reportNineRejected.besst, "R$ 19,06 a R$ 21,60");
assert.deepEqual(reportNineRejected.integridade_analise.convergence_excluded_layers, ["C2"]);

const reportThreeC2Regression = reconcileDeepIntegrity({
  ticker: "BBAS3",
  veredito_final: "MONITORAR",
  preco: [
    { c: "C1", vj: "R$ 31,76", met: "Valor Patrimonial por Ação (VPA) — múltiplo de P/VP histórico médio", prem: "VPA de R$ 31,76 com P/VP alvo de 1,0x.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 31.76, multiplo: 1 } },
    { c: "C2", vj: "R$ 28,56", met: "LPA anualizado com P/L alvo setorial", prem: "LPA 2T26 de R$ 0,56 anualizado (R$ 2,24/ano) com P/L alvo de 12,75x (média setor 10–15x).", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 2.24, multiplo: 12.75 } },
    { c: "C3", vj: "", met: "Dividend Yield normalizado", prem: "Sem convergência confiável.", calc: { formula: "NAO_VERIFICAVEL" } },
  ],
  zona: "R$ 28,56 a R$ 31,76",
  zona_calc: { camadas_incluidas: ["C1", "C2"], justificativa_exclusoes: "C3 não possui valor confiável por renda." },
  besst: "Não calculado",
  ajustes_score: [],
}, { scan: { ticker: "BBAS3", score_total: 18, score_max: 30 } }, { referencePrice: 22.45 });
assert.notEqual(reportThreeC2Regression.preco[1].calculo_integridade?.status, "invalid_formula", "média do múltiplo setorial não é média oculta do LPA");
assert.deepEqual(reportThreeC2Regression.integridade_analise.valuation_invalid_layers, []);
assert.equal(reportThreeC2Regression.integridade_analise.valuation_zone_suppressed, false);
assert.equal(reportThreeC2Regression.zona, "R$ 28,56 a R$ 31,76");
assert.equal(reportThreeC2Regression.besst, "R$ 21,42 a R$ 24,28");
assert.match(reportThreeC2Regression.desconto, /dentro da faixa BESST/);

const reportTenProvisional = reconcileDeepIntegrity({
  ticker: "BANK3",
  veredito_final: "MONITORAR",
  preco: [
    { c: "C1", vj: "R$ 26,50", met: "P/L normalizado", prem: "Referência declarada.", calc: { formula: "NAO_VERIFICAVEL" } },
    { c: "C2", vj: "R$ 22,45", met: "P/VP histórico", prem: "Referência declarada.", calc: { formula: "NAO_VERIFICAVEL" } },
    { c: "C3", vj: "R$ 24,50", met: "Dividend yield reverso", prem: "Referência declarada.", calc: { formula: "NAO_VERIFICAVEL" } },
  ],
  zona: "R$ 22,45 a R$ 26,50",
  zona_calc: { camadas_incluidas: ["C1", "C2", "C3"], justificativa_exclusoes: "" },
  besst: "N/D",
  ajustes_score: [],
}, { scan: { ...scan, ticker: "BANK3" } }, { referencePrice: 22.45 });
assert.equal(reportTenProvisional.integridade_analise.valuation_zone_suppressed, false);
assert.equal(reportTenProvisional.integridade_analise.convergence_status, "provisional_from_declared_layers");
assert.deepEqual(reportTenProvisional.integridade_analise.convergence_provisional_layers, ["C1", "C2", "C3"]);
assert.equal(reportTenProvisional.zona, "R$ 22,45 a R$ 26,50");
assert.equal(reportTenProvisional.besst, "R$ 16,84 a R$ 19,08");
assert.doesNotMatch(`${reportTenProvisional.zona} ${reportTenProvisional.besst} ${reportTenProvisional.desconto}`, /suprimid/i);

const roundingConsistent = reconcileDeepIntegrity({
  ticker: "BANK3",
  veredito_final: "MONITORAR",
  preco: [
    { c: "C1", vj: "R$ 24,50", met: "P/VP", prem: "Referência declarada.", calc: { formula: "NAO_VERIFICAVEL" } },
    { c: "C2", vj: "R$ 21,40", met: "Yield", prem: "Referência declarada.", calc: { formula: "NAO_VERIFICAVEL" } },
    { c: "C3", vj: "R$ 20,40", met: "P/L", prem: "2,14 x 9,5.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 2.14, multiplo: 9.5 } },
  ],
  zona: "R$ 20,40 a R$ 24,50",
  zona_calc: { camadas_incluidas: ["C1", "C2", "C3"], justificativa_exclusoes: "" },
  besst: "R$ 15,30 a R$ 17,34",
  ajustes_score: [],
}, { scan: { ...scan, ticker: "BANK3" } }, { referencePrice: 22.45 });
assert.equal(roundingConsistent.preco[2].vj, "R$ 20,33", "valor exibido deve coincidir com a aritmética usada na convergência");
assert.equal(roundingConsistent.zona, "R$ 20,33 a R$ 24,50");
assert.equal(roundingConsistent.besst, "R$ 15,25 a R$ 17,28");
assert.deepEqual(roundingConsistent.integridade_analise.valuation_corrected_layers, ["C3"]);
assert.equal(roundingConsistent.integridade_analise.besst_corrected, true);

const reportNineCorrected = reconcileDeepIntegrity({
  ticker: "BANK3",
  veredito_final: "MONITORAR",
  tese_final: "Banco negocia com P/B 0,67x e P/L 10,49x após atualização documental.",
  preco: [
    { c: "C1", vj: "R$ 25,41", met: "P/VPA", prem: "VPA direto.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 31.76, multiplo: 0.8 } },
    { c: "C2", vj: "R$ 24,41", met: "P/L", prem: "Média ponderada explicitada.", calc: { formula: "MEDIA_PONDERADA_X_MULTIPLO", multiplo: 10.5, componentes: [{ rotulo: "LPA contábil", valor: 2.18, peso_pct: 50 }, { rotulo: "LPA ajustado", valor: 2.47, peso_pct: 50 }] } },
    { c: "C3", vj: "R$ 27,00", met: "P/VPA", prem: "Cenário otimista.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 31.76, multiplo: 0.85 } },
  ],
  zona: "R$ 24,41 a R$ 25,41",
  zona_calc: { camadas_incluidas: ["C1", "C2"], justificativa_exclusoes: "C3 representa cenário otimista, não a convergência central." },
  besst: "R$ 19,92 a R$ 19,91",
  ajustes_score: [],
}, { scan: { ...scan, ticker: "BANK3" } }, { referencePrice: 22.45 });
assert.equal(reportNineCorrected.integridade_analise.valuation_zone_suppressed, false);
assert.equal(reportNineCorrected.preco[1].vj, "R$ 24,41");
assert.equal(reportNineCorrected.zona, "R$ 24,41 a R$ 25,41");
assert.equal(reportNineCorrected.besst, "R$ 18,31 a R$ 20,75");
assert.equal(reportNineCorrected.integridade_analise.besst_corrected, true);
assert.deepEqual(reportNineCorrected.integridade_analise.convergence_excluded_layers, ["C3"]);
const reportNineFinal = buildDeterministicFinal({ ticker: "BANK3", history: { scan: { ...scan, ticker: "BANK3" }, deep: reportNineCorrected } });
assert.match(reportNineFinal.tese_final, /P\/B 0,71x/);
assert.match(reportNineFinal.tese_final, /P\/L 9,66x/);
assert.doesNotMatch(reportNineFinal.tese_final, /0,67x|10,49x/);

const reportEightConvergence = reconcileDeepIntegrity({
  ticker: "BBAS3",
  veredito_final: "MONITORAR",
  preco: [
    { c: "C1", vj: "R$ 23,50", met: "P/VPA", prem: "Valor governado.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 23.83, multiplo: 1 } },
    { c: "C2", vj: "R$ 25,16", met: "P/L", prem: "Valor governado.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 25.16, multiplo: 1 } },
    { c: "C3", vj: "R$ 22,39", met: "Yield", prem: "Valor governado.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 22.39, multiplo: 1 } },
  ],
  zona: "R$ 22,39 a R$ 25,16",
  zona_calc: { camadas_incluidas: ["C3", "C2"], justificativa_exclusoes: "C1 de R$ 23,50 está dentro do intervalo central." },
  besst: "R$ 16,79 a R$ 19,03",
  ajustes_score: [],
}, { scan: { ticker: "BBAS3", score_total: 18, score_max: 30 } }, { referencePrice: 22.45 });
assert.equal(reportEightConvergence.preco[0].vj, "R$ 23,83");
assert.deepEqual(reportEightConvergence.integridade_analise.convergence_included_layers, ["C3", "C2", "C1"], "camada válida dentro do intervalo deve integrar a convergência");
assert.deepEqual(reportEightConvergence.integridade_analise.convergence_excluded_layers, []);
assert.equal(reportEightConvergence.zona_calc.justificativa_exclusoes, "");
assert.equal(reportEightConvergence.zona, "R$ 22,39 a R$ 25,16");
assert.equal(reportEightConvergence.besst, "R$ 16,79 a R$ 19,03");
assert.match(reportEightConvergence.desconto, /15,00% e 25,00% abaixo do piso/);
const reportEightFinal = buildDeterministicFinal({ ticker: "BBAS3", history: { scan: { ticker: "BBAS3", score_total: 18, score_max: 30 }, deep: reportEightConvergence } });
assert.doesNotMatch(reportEightFinal.preco_final.observacao, /23,50|fora da faixa|\.\.$/);

console.log("reclassification integrity: score, valuation layers, BESST and price narrative checks passed");
