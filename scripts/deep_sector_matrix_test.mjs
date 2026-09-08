#!/usr/bin/env node

import assert from "node:assert/strict";

import { reconcileDeepIntegrity } from "../lib/nexo/analysis/reclassification_integrity.mjs";
import { reconcileScanGaps } from "../lib/nexo/analysis/gap_integrity.mjs";
import { reconcileListingSegmentClaims } from "../lib/nexo/analysis/text_integrity.mjs";

function brlNumber(value) {
  const parsed = Number(String(value || "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  assert.ok(Number.isFinite(parsed), `valor monetário inválido: ${value}`);
  return parsed;
}

const cases = [
  {
    ticker: "BBAS3",
    sector: "bancos",
    referencePrice: 22.45,
    segmento: "Novo Mercado adaptado (Nível 1 B3)",
    scan: { lacunas_deep: ["Validar inadimplência.", "Confirmar capital regulatório."] },
    layers: [
      { c: "C1", vj: "R$ 1,00", met: "Resultado por ação", prem: "Total por ações.", calc: { formula: "TOTAL_POR_UNIDADE_X_MULTIPLO", valor_total: 14.298e9, quantidade_unidades: 6e9, multiplo: 10 } },
      { c: "C2", vj: "R$ 1,00", met: "Valor unitário", prem: "Base direta.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 3.145, multiplo: 8 } },
      { c: "C3", vj: "R$ 1,00", met: "Média ponderada", prem: "Componentes declarados.", calc: { formula: "MEDIA_PONDERADA_X_MULTIPLO", multiplo: 10, componentes: [{ rotulo: "Base A", valor: 2.1, peso_pct: 60 }, { rotulo: "Base B", valor: 2.4475, peso_pct: 40 }] } },
    ],
  },
  {
    ticker: "ROMI3",
    sector: "indústria de máquinas",
    referencePrice: 13.2,
    segmento: "Novo Mercado",
    scan: { lacunas_deep: [], kpis: [{ nome: "Carteira de pedidos atualizada", valor: "N/D" }, { nome: "Conversão de caixa normalizada", valor: "Não informado" }] },
    layers: [
      { c: "C1", vj: "R$ 1,00", met: "Resultado por ação", prem: "Total por ações.", calc: { formula: "TOTAL_POR_UNIDADE_X_MULTIPLO", valor_total: 180e6, quantidade_unidades: 90e6, multiplo: 7.5 } },
      { c: "C2", vj: "R$ 1,00", met: "Valor unitário", prem: "Base direta.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 12, multiplo: 1.4 } },
      { c: "C3", vj: "R$ 1,00", met: "Média ponderada", prem: "Componentes declarados.", calc: { formula: "MEDIA_PONDERADA_X_MULTIPLO", multiplo: 1.2, componentes: [{ rotulo: "Ciclo baixo", valor: 12, peso_pct: 40 }, { rotulo: "Ciclo normal", valor: 14, peso_pct: 60 }] } },
    ],
  },
  {
    ticker: "VALE3",
    sector: "mineração e commodities",
    referencePrice: 62,
    segmento: "Novo Mercado",
    scan: { lacunas_deep: [], riscos: [{ descricao: "volatilidade do minério sem evidência primária atualizada", severidade: "ALTO" }, { descricao: "execução de projetos de crescimento sem cronograma confirmado", severidade: "MEDIO" }] },
    layers: [
      { c: "C1", vj: "R$ 1,00", met: "Resultado por ação", prem: "Total por ações.", calc: { formula: "TOTAL_POR_UNIDADE_X_MULTIPLO", valor_total: 36e9, quantidade_unidades: 4.5e9, multiplo: 8 } },
      { c: "C2", vj: "R$ 1,00", met: "Renda por yield", prem: "Renda anual declarada.", calc: { formula: "RENDA_POR_YIELD", renda_por_unidade: 5.4, yield_pct: 8 } },
      { c: "C3", vj: "R$ 1,00", met: "Valor unitário", prem: "Base direta.", calc: { formula: "VALOR_POR_UNIDADE_X_MULTIPLO", valor_por_unidade: 55, multiplo: 1.1 } },
    ],
  },
];

assert.equal(new Set(cases.map((item) => item.ticker)).size, 3);
assert.equal(new Set(cases.map((item) => item.sector)).size, 3);

for (const fixture of cases) {
  const scanChecked = reconcileScanGaps({ ticker: fixture.ticker, ...fixture.scan });
  assert.equal(scanChecked.lacunas_deep.length, 2, `${fixture.ticker}: duas lacunas concretas no Scan`);
  assert.ok(scanChecked.lacunas_deep.every((gap) => String(gap).trim().length > 10), `${fixture.ticker}: lacunas úteis e não vazias`);

  const textChecked = reconcileListingSegmentClaims({
    ticker: fixture.ticker,
    segmento: fixture.segmento,
    veredito_final: "MONITORAR",
    score_original: 18,
    score_revisado: 99,
    score_max: 30,
    ajustes_score: [],
    preco: fixture.layers,
    zona: "R$ 1,00 a R$ 2,00",
    zona_calc: { camadas_incluidas: ["C1", "C2", "C3"], justificativa_exclusoes: "" },
    besst: "R$ 999,00",
    desconto: "Narrativa incorreta para ser recalculada.",
  });
  const governed = reconcileDeepIntegrity(textChecked, {
    scan: { ticker: fixture.ticker, score_total: 18, score_max: 30 },
  }, { referencePrice: fixture.referencePrice });

  assert.equal(governed.score_original, 18, `${fixture.ticker}: score original`);
  assert.equal(governed.score_revisado, 18, `${fixture.ticker}: score governado`);
  assert.equal(governed.integridade_analise.valuation_status, "corrected", `${fixture.ticker}: aritmética corrigida e verificável`);
  assert.deepEqual(governed.integridade_analise.valuation_corrected_layers, ["C1", "C2", "C3"], `${fixture.ticker}: três valores exibidos reconciliados`);
  assert.deepEqual(governed.integridade_analise.convergence_included_layers, ["C1", "C2", "C3"], `${fixture.ticker}: três camadas na convergência`);
  assert.equal(governed.integridade_analise.valuation_zone_suppressed, false, `${fixture.ticker}: zona preservada`);
  assert.doesNotMatch(JSON.stringify(governed), /suprimid[oa]/i, `${fixture.ticker}: sem campos suprimidos`);

  const values = governed.preco.map((layer) => {
    assert.equal(brlNumber(layer.vj), Number(layer.calculo_integridade.calculated_value.toFixed(2)), `${fixture.ticker}/${layer.c}: valor exibido igual ao calculado`);
    return brlNumber(layer.vj);
  });
  const floor = Math.min(...values);
  const ceiling = Math.max(...values);
  assert.equal(governed.zona, `R$ ${floor.toFixed(2).replace(".", ",")} a R$ ${ceiling.toFixed(2).replace(".", ",")}`, `${fixture.ticker}: zona determinística`);
  const besstValues = governed.besst.split(/\s+a\s+/).map(brlNumber);
  assert.ok(Math.abs(besstValues[0] - floor * 0.75) <= 0.011, `${fixture.ticker}: BESST de 25%`);
  assert.ok(Math.abs(besstValues[1] - floor * 0.85) <= 0.011, `${fixture.ticker}: BESST de 15%`);
}

assert.doesNotMatch(reconcileListingSegmentClaims({ segmento: cases[0].segmento }).segmento, /Novo Mercado.*Nível 1/i, "segmentos B3 mutuamente exclusivos devem ser reconciliados");
const grammarChecked = reconcileListingSegmentClaims({ tese: "Basileia acima dos referência regulatória citada, com adicionaiss." });
assert.equal(grammarChecked.tese, "Basileia acima das referências regulatórias citadas, com adicionais.");

console.log("matriz Deep virtual: 3/3 tickers e 3/3 setores aprovados (BBAS3, ROMI3, VALE3), sem chamadas externas");
