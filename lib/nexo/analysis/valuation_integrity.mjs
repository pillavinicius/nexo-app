export const VALUATION_INTEGRITY_VERSION = "VALUATION_v1.3";

const FORMULAS = Object.freeze({
  TOTAL_PER_UNIT_MULTIPLE: "TOTAL_POR_UNIDADE_X_MULTIPLO",
  PER_UNIT_MULTIPLE: "VALOR_POR_UNIDADE_X_MULTIPLO",
  WEIGHTED_AVERAGE_MULTIPLE: "MEDIA_PONDERADA_X_MULTIPLO",
  INCOME_YIELD: "RENDA_POR_YIELD",
  LAYER_ADJUSTMENT: "AJUSTE_PERCENTUAL_CAMADA",
  UNVERIFIABLE: "NAO_VERIFICAVEL",
});

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function finitePositive(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseLocalizedNumber(token) {
  let value = String(token || "").replace(/\s/g, "");
  const comma = value.lastIndexOf(",");
  const dot = value.lastIndexOf(".");
  if (comma > dot) value = value.replace(/\./g, "").replace(",", ".");
  else if (dot > comma) value = value.replace(/,/g, "");
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstNumber(value) {
  const token = String(value || "").match(/-?\d[\d.,]*/)?.[0];
  return token ? parseLocalizedNumber(token) : null;
}

function scaleOf(unit) {
  const normalized = normalize(unit);
  if (["BI", "BN", "BILHAO", "BILHOES", "BILLION", "BILLIONS"].includes(normalized)) return 1e9;
  if (["MI", "MN", "MILHAO", "MILHOES", "MILLION", "MILLIONS"].includes(normalized)) return 1e6;
  if (["MIL", "THOUSAND", "THOUSANDS"].includes(normalized)) return 1e3;
  return 1;
}

function layerCode(layer, index) {
  const label = String(layer?.c ?? layer?.camada ?? layer?.nome ?? "");
  return label.match(/\bC\s*([123])\b/i)?.[0]?.replace(/\s/g, "").toUpperCase() || `L${index + 1}`;
}

function priceValue(layer) {
  return String(layer?.vj ?? layer?.valor_justo ?? layer?.preco_justo ?? layer?.valor ?? "");
}

function pricePrefix(...values) {
  const text = values.join(" ");
  if (/USD|US\$/i.test(text)) return "USD ";
  if (/EUR|€/i.test(text)) return "EUR ";
  if (/R\$/i.test(text)) return "R$ ";
  return "";
}

function formatPrice(value, prefix) {
  return `${prefix}${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizedFormula(value) {
  const formula = normalize(value);
  const aliases = {
    MULTIPLO_TOTAL_POR_UNIDADE: FORMULAS.TOTAL_PER_UNIT_MULTIPLE,
    TOTAL_PER_UNIT_MULTIPLE: FORMULAS.TOTAL_PER_UNIT_MULTIPLE,
    MULTIPLO_VALOR_POR_UNIDADE: FORMULAS.PER_UNIT_MULTIPLE,
    PER_UNIT_MULTIPLE: FORMULAS.PER_UNIT_MULTIPLE,
    WEIGHTED_AVERAGE_MULTIPLE: FORMULAS.WEIGHTED_AVERAGE_MULTIPLE,
    MEDIA_PONDERADA: FORMULAS.WEIGHTED_AVERAGE_MULTIPLE,
    INCOME_YIELD: FORMULAS.INCOME_YIELD,
    YIELD: FORMULAS.INCOME_YIELD,
    AJUSTE_SOBRE_CAMADA: FORMULAS.LAYER_ADJUSTMENT,
    LAYER_ADJUSTMENT: FORMULAS.LAYER_ADJUSTMENT,
    UNVERIFIABLE: FORMULAS.UNVERIFIABLE,
  };
  return aliases[formula] || formula;
}

function structuredCalculation(layer) {
  const calc = layer?.calc ?? layer?.calculo;
  if (!calc || typeof calc !== "object" || Array.isArray(calc)) return null;
  const formula = normalizedFormula(calc.formula ?? calc.operacao ?? calc.tipo);
  const multiple = finitePositive(calc.multiplo ?? calc.multiplicador);

  if (formula === FORMULAS.TOTAL_PER_UNIT_MULTIPLE) {
    const total = finitePositive(calc.valor_total);
    const units = finitePositive(calc.quantidade_unidades ?? calc.quantidade_acoes ?? calc.quantidade_cotas);
    if (!multiple || !total || !units) return { formula, invalid: true, source: "structured" };
    return {
      formula,
      expected: (total / units) * multiple,
      inputs: { multiplo: multiple, valor_total: total, quantidade_unidades: units, valor_base_unitario: total / units },
      source: "structured",
    };
  }

  if (formula === FORMULAS.PER_UNIT_MULTIPLE) {
    const perUnit = finitePositive(calc.valor_por_unidade);
    if (!multiple || !perUnit) return { formula, invalid: true, source: "structured" };
    const narrative = normalize(`${layer?.met ?? layer?.metodologia ?? ""} ${layer?.prem ?? layer?.premissas ?? ""}`);
    if (/(?:^|_)(?:MEDIA|MEDIA_SIMPLES|MEDIA_PONDERADA|PONDERAD[AO]?|COMBINACAO|BLEND)(?:_|$)/.test(narrative)) {
      return {
        formula,
        invalid: true,
        invalid_reason: "derivacao_composta_nao_declarada",
        source: "structured",
      };
    }
    return {
      formula,
      expected: perUnit * multiple,
      inputs: { multiplo: multiple, valor_por_unidade: perUnit, valor_base_unitario: perUnit },
      source: "structured",
    };
  }

  if (formula === FORMULAS.WEIGHTED_AVERAGE_MULTIPLE) {
    const components = Array.isArray(calc.componentes) ? calc.componentes : [];
    const normalizedComponents = components.map((component) => ({
      valor: finitePositive(component?.valor ?? component?.valor_por_unidade),
      peso_pct: finiteNonNegative(component?.peso_pct ?? component?.peso),
      rotulo: String(component?.rotulo || "").trim(),
    }));
    const weightTotal = normalizedComponents.reduce((total, component) => total + (component.peso_pct ?? 0), 0);
    if (!multiple || normalizedComponents.length < 2 || normalizedComponents.some((component) => !component.valor || component.peso_pct === null) || Math.abs(weightTotal - 100) > 0.1) {
      return {
        formula,
        invalid: true,
        invalid_reason: "componentes_ou_pesos_invalidos",
        source: "structured",
      };
    }
    const weightedBase = normalizedComponents.reduce(
      (total, component) => total + component.valor * (component.peso_pct / 100),
      0
    );
    return {
      formula,
      expected: weightedBase * multiple,
      inputs: {
        multiplo: multiple,
        componentes: normalizedComponents,
        peso_total_pct: round2(weightTotal),
        valor_base_unitario: weightedBase,
      },
      source: "structured",
    };
  }

  if (formula === FORMULAS.INCOME_YIELD) {
    const income = finitePositive(calc.renda_por_unidade ?? calc.dividendo_por_unidade);
    const yieldPct = finitePositive(calc.yield_pct ?? calc.taxa_pct);
    if (!income || !yieldPct) return { formula, invalid: true, source: "structured" };
    return {
      formula,
      expected: income / (yieldPct / 100),
      inputs: { renda_por_unidade: income, yield_pct: yieldPct },
      source: "structured",
    };
  }

  if (formula === FORMULAS.LAYER_ADJUSTMENT) {
    const adjustment = finitePositive(calc.ajuste_pct ?? calc.desconto_pct ?? calc.premio_pct);
    const base = normalize(calc.camada_base).replace(/_/g, "");
    const direction = normalize(calc.direcao || (calc.premio_pct ? "PREMIO" : "DESCONTO"));
    if (!adjustment || !/^C[123]$/.test(base)) return { formula, invalid: true, source: "structured" };
    return {
      formula,
      dependency: base,
      adjustment,
      direction: direction.includes("PREMIO") || direction.includes("ACRESCIMO") ? "premium" : "discount",
      inputs: { ajuste_pct: adjustment, camada_base: base },
      source: "structured",
    };
  }

  return formula === FORMULAS.UNVERIFIABLE ? null : { formula: formula || "DESCONHECIDA", invalid: true, source: "structured" };
}

function legacyCalculation(layer) {
  const text = `${layer?.met ?? layer?.metodologia ?? ""} ${layer?.prem ?? layer?.premissas ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const multiple = text.match(/(?:^|[^\d])([0-9]+(?:[.,][0-9]+)?)\s*x\b/i)?.[1];
  const totalPerUnits = text.match(/(?:R\$|US\$|USD|EUR|€)?\s*~?\s*([0-9]+(?:[.,][0-9]+)?)\s*(bi|bn|bilhao|bilhoes|billion|billions|mi|mn|milhao|milhoes|million|millions)\b[^/\n]{0,90}\/\s*~?\s*([0-9]+(?:[.,][0-9]+)?)\s*(bi|bn|bilhao|bilhoes|billion|billions|mi|mn|milhao|milhoes|million|millions)\s*(?:acoes?|shares?|cotas?|units?|unidades?)/i);
  if (multiple && totalPerUnits) {
    const factor = parseLocalizedNumber(multiple);
    const total = parseLocalizedNumber(totalPerUnits[1]) * scaleOf(totalPerUnits[2]);
    const units = parseLocalizedNumber(totalPerUnits[3]) * scaleOf(totalPerUnits[4]);
    if (factor > 0 && total > 0 && units > 0) {
      return {
        formula: FORMULAS.TOTAL_PER_UNIT_MULTIPLE,
        expected: (total / units) * factor,
        inputs: { multiplo: factor, valor_total: total, quantidade_unidades: units, valor_base_unitario: total / units },
        source: "legacy_text",
      };
    }
  }

  const adjustment = text.match(/\b(desconto|reducao|premio|acrescimo)(?:\s+adicional)?(?:\s+de)?\s*([0-9]+(?:[.,][0-9]+)?)\s*%[^.\n]{0,60}\b(?:sobre|em relacao a)\s*(C\s*[123])\b/i);
  if (adjustment) {
    return {
      formula: FORMULAS.LAYER_ADJUSTMENT,
      dependency: adjustment[3].replace(/\s/g, "").toUpperCase(),
      adjustment: parseLocalizedNumber(adjustment[2]),
      direction: /premio|acrescimo/i.test(adjustment[1]) ? "premium" : "discount",
      inputs: { ajuste_pct: parseLocalizedNumber(adjustment[2]), camada_base: adjustment[3].replace(/\s/g, "").toUpperCase() },
      source: "legacy_text",
    };
  }

  return null;
}

function calculationFor(layer) {
  return structuredCalculation(layer) || legacyCalculation(layer);
}

function isMismatch(declared, expected) {
  if (!Number.isFinite(declared)) return true;
  return round2(declared) !== round2(expected);
}

function reconcileLayer(layer, code, calculation, expected) {
  const declaredText = priceValue(layer);
  const declared = firstNumber(declaredText);
  const prefix = pricePrefix(declaredText, layer?.met, layer?.metodologia);
  const mismatch = isMismatch(declared, expected);
  const calculated = round2(expected);
  const declaredRounded = Number.isFinite(declared) ? round2(declared) : null;
  const status = mismatch ? (declaredRounded === null ? "calculated" : "corrected") : "verified";
  const correctionNote = mismatch
    ? `Integridade aritmética: ${declaredRounded === null ? "valor calculado" : `valor informado ${formatPrice(declaredRounded, prefix)} corrigido`} para ${formatPrice(calculated, prefix)} pelo servidor.`
    : "";
  const premise = String(layer?.prem ?? layer?.premissas ?? "").trim();

  return {
    layer: {
      ...layer,
      vj: mismatch ? formatPrice(calculated, prefix) : declaredText,
      prem: [premise, correctionNote].filter(Boolean).join(" · "),
      calculo_integridade: {
        version: VALUATION_INTEGRITY_VERSION,
        status,
        formula: calculation.formula,
        source: calculation.source,
        declared_value: declaredRounded,
        calculated_value: calculated,
        difference_pct: declaredRounded && calculated
          ? round2(((declaredRounded - calculated) / calculated) * 100)
          : null,
        inputs: calculation.inputs,
      },
    },
    code,
    value: calculated,
    changed: mismatch,
    status,
  };
}

export function reconcileValuationLayers(layers = []) {
  const sourceLayers = Array.isArray(layers) ? layers : [];
  const prepared = sourceLayers.map((layer, index) => ({
    layer,
    code: layerCode(layer, index),
    calculation: calculationFor(layer),
  }));
  const values = new Map();
  const results = new Map();

  for (const item of prepared.filter((entry) => entry.calculation?.expected !== undefined)) {
    const result = reconcileLayer(item.layer, item.code, item.calculation, item.calculation.expected);
    values.set(item.code, result.value);
    results.set(item.code, result);
  }

  for (const item of prepared.filter((entry) => entry.calculation?.dependency)) {
    const base = values.get(item.calculation.dependency) ?? firstNumber(priceValue(prepared.find((entry) => entry.code === item.calculation.dependency)?.layer));
    if (!Number.isFinite(base) || !Number.isFinite(item.calculation.adjustment)) continue;
    const factor = item.calculation.direction === "premium"
      ? 1 + item.calculation.adjustment / 100
      : 1 - item.calculation.adjustment / 100;
    const calculation = {
      ...item.calculation,
      expected: base * factor,
      inputs: { ...item.calculation.inputs, valor_base: round2(base) },
    };
    const result = reconcileLayer(item.layer, item.code, calculation, calculation.expected);
    values.set(item.code, result.value);
    results.set(item.code, result);
  }

  const governed = prepared.map((item) => {
    if (results.has(item.code)) return results.get(item.code);
    const invalid = Boolean(item.calculation?.invalid || item.calculation?.dependency);
    return {
      code: item.code,
      value: firstNumber(priceValue(item.layer)),
      changed: false,
      status: invalid ? "invalid_formula" : "unverifiable",
      layer: invalid
        ? {
            ...item.layer,
            calculo_integridade: {
              version: VALUATION_INTEGRITY_VERSION,
              status: "invalid_formula",
              formula: item.calculation.formula,
              source: item.calculation.source,
              reason: item.calculation.invalid_reason || null,
            },
          }
        : item.layer,
    };
  });
  const changed = governed.filter((item) => item.changed);
  const invalid = governed.filter((item) => item.status === "invalid_formula");
  const usable = governed.filter((item) => item.status !== "invalid_formula" && Number.isFinite(item.value) && item.value > 0);

  return {
    layers: governed.map((item) => item.layer),
    status: changed.length ? "corrected" : invalid.length ? "invalid_formula" : governed.some((item) => item.status === "verified") ? "verified" : "unverifiable",
    corrected_layers: changed.map((item) => item.code),
    verified_layers: governed.filter((item) => item.status === "verified").map((item) => item.code),
    invalid_layers: invalid.map((item) => item.code),
    layer_values: governed.map((item) => ({
      code: item.code,
      value: Number.isFinite(item.value) ? round2(item.value) : null,
      status: item.status,
      formula: item.layer?.calculo_integridade?.formula || normalizedFormula(item.layer?.calc?.formula),
      unit_base: finitePositive(item.layer?.calculo_integridade?.inputs?.valor_base_unitario),
      methodology: String(item.layer?.met ?? item.layer?.metodologia ?? ""),
    })),
    zone_must_be_suppressed: usable.length < 2,
  };
}

export { FORMULAS as VALUATION_FORMULAS };
