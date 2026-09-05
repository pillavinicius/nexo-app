import assert from "node:assert/strict";
import { splitPriceModels } from "../lib/ui/valuation_adapter.mjs";

const result = {
  preco: [
    { c: "C1 · Conservador", vj: "R$ 38,20", met: "Fluxo normalizado", prem: "Cenário defensivo" },
    { c: "C2 · Base", vj: "R$ 42,70", met: "Múltiplos", prem: "Premissas centrais" },
    { c: "Graham", vj: "R$ 39,90", met: "Fórmula de Graham", prem: "Referência auxiliar" },
  ],
  valuations_classicos: {
    "Peter Lynch": { valor_justo: "R$ 44,10", metodologia: "PEG normalizado", premissas: "Referência auxiliar" },
    Bazin: { preco_justo: "R$ 36,00", descricao: "Renda esperada", observacao: "Referência auxiliar" },
  },
};

const hidden = splitPriceModels(result, { includeClassic: false });
assert.equal(hidden.layers.length, 2);
assert.equal(hidden.classics.length, 0);

const shown = splitPriceModels(result, { includeClassic: true });
assert.equal(shown.layers.length, 2);
assert.deepEqual(shown.classics.map((item) => item.label), ["Graham", "Peter Lynch", "Bazin"]);
for (const item of [...shown.layers, ...shown.classics]) {
  assert.deepEqual(Object.keys(item), ["label", "value", "methodology", "premises"]);
}

const arrayVariant = splitPriceModels({
  modelo_preco: [{ camada: "C3", valor_justo: "USD 50.00", metodologia: "DCF", premissas: "Base" }],
  classic_valuations: [{ modelo: "Buffett moderno", resultado: "USD 47.00", calculo: "Owner earnings" }],
}, { includeClassic: true });
assert.equal(arrayVariant.layers[0].label, "C3");
assert.equal(arrayVariant.classics[0].methodology, "Owner earnings");

console.log("valuation adapter: 10/10 checks passed");
