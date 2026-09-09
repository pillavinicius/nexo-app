export const VALUATION_INTEGRITY_VERSION = "VALUATION_v1.8";

const MAX_ROUNDING_ABSOLUTE = 0.05;
const MAX_ROUNDING_RELATIVE_PCT = 0.5;

const FORMULAS = Object.freeze({
  TOTAL_PER_UNIT_MULTIPLE: "TOTAL_POR_UNIDADE_X_MULTIPLO",
  PER_UNIT_MULTIPLE: "VALOR_POR_UNIDADE_X_MULTIPLO",
  WEIGHTED_AVERAGE_MULTIPLE: "MEDIA_PONDERADA_X_MULTIPLO",
  INCOME_YIELD: "RENDA_POR_YIELD",
  ENTERPRISE_TO_EQUITY_PER_UNIT: "EV_POR_UNIDADE_MENOS_DIVIDA_LIQUIDA",
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

function formatInput(value) {
  return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function reconcileTargetClaims(text, calculation) {
  let governed = String(text || "");
  const corrections = [];
  const claims = [];
  if (Number.isFinite(calculation?.inputs?.yield_pct)) {
    claims.push({
      field: "yield_pct",
      expected: calculation.inputs.yield_pct,
      suffix: "%",
      pattern: /(\b(?:yield|taxa)\s*(?:-|\s)*(?:alvo|required[oa]|sustent[aá]vel)\s*(?:de|:|=)?\s*)(\d+(?:[.,]\d+)?)(\s*%)/gi,
    });
  }
  if (Number.isFinite(calculation?.inputs?.multiplo)) {
    claims.push({
      field: "multiplo",
      expected: calculation.inputs.multiplo,
      suffix: "x",
      pattern: /(\b(?:P\s*\/\s*(?:L|E|VP|VPA|B)|EV\s*\/\s*EBITDA|m[uú]ltiplo)\s*(?:-|\s)*(?:alvo|required[oa]|de\s+converg[eê]ncia)?\s*(?:de|:|=)?\s*)(\d+(?:[.,]\d+)?)(\s*x)/gi,
    });
  }
  for (const claim of claims) {
    governed = governed.replace(claim.pattern, (match, prefix, token, suffix) => {
      const declared = parseLocalizedNumber(token);
      if (declared === null || Math.abs(declared - claim.expected) <= 0.0001) return match;
      corrections.push({ field: claim.field, declared, governed: claim.expected });
      return `${prefix}${formatInput(claim.expected)}${suffix}`;
    });
  }
  return { text: governed, corrections };
}

function hasComparativePercentageConflict(layer, calculation) {
  const target = finitePositive(calculation?.inputs?.yield_pct);
  if (!target) return false;
  const narrative = String(`${layer?.met ?? layer?.metodologia ?? ""} ${layer?.prem ?? layer?.premissas ?? ""}`);
  const comparisons = [...narrative.matchAll(/\b(acima|superior|abaixo|inferior)\b[^%\n]{0,80}?(\d+(?:[.,]\d+)?)\s*%/gi)];
  return comparisons.some((match) => {
    const reference = parseLocalizedNumber(match[2]);
    if (!Number.isFinite(reference)) return false;
    return /acima|superior/i.test(match[1]) ? target <= reference : target >= reference;
  });
}

function hasNarrativeTargetConflict(layer, calculation) {
  const narrative = String(`${layer?.met ?? layer?.metodologia ?? ""} ${layer?.prem ?? layer?.premissas ?? ""}`);
  const claims = [];
  if (Number.isFinite(calculation?.inputs?.yield_pct)) {
    claims.push({
      expected: calculation.inputs.yield_pct,
      patterns: [
        /\b(?:DY|dividend\s+yield|yield|taxa)\s*(?:-|\s)*(?:alvo|required[oa]|sustent[aá]vel)\s*(?:de|:|=)?\s*(\d+(?:[.,]\d+)?)\s*%/gi,
      ],
    });
  }
  if (Number.isFinite(calculation?.inputs?.multiplo)) {
    claims.push({
      expected: calculation.inputs.multiplo,
      patterns: [
        /\b(?:P\s*\/\s*(?:L|E|VP|VPA|B)|EV\s*\/\s*EBITDA|m[uú]ltiplo)\s*(?:-|\s)*(?:alvo|required[oa]|de\s+converg[eê]ncia)\s*(?:de|:|=)?\s*(\d+(?:[.,]\d+)?)\s*x/gi,
      ],
    });
  }
  return claims.some((claim) => claim.patterns.some((pattern) =>
    [...narrative.matchAll(pattern)].some((match) => {
      const declared = parseLocalizedNumber(match[1]);
      return Number.isFinite(declared) && Math.abs(declared - claim.expected) > 0.0001;
    })
  ));
}

function hasUnstructuredNetDebtAdjustment(layer, formula) {
  if (formula === FORMULAS.ENTERPRISE_TO_EQUITY_PER_UNIT) return false;
  const narrative = String(`${layer?.met ?? layer?.metodologia ?? ""} ${layer?.prem ?? layer?.premissas ?? ""}`);
  return /(?:descont(?:ando|ar)|subtra(?:indo|ir)|menos)\s+(?:a\s+)?d[ií]vida\s+l[ií]quida(?:\s*\/\s*(?:a[cç][aã]o|cota|unidade)|\s+por\s+(?:a[cç][aã]o|cota|unidade))?/i.test(narrative);
}

function usesEnterpriseValueMultiple(layer) {
  const narrative = String(`${layer?.met ?? layer?.metodologia ?? ""} ${layer?.prem ?? layer?.premissas ?? ""}`);
  return /\bEV\s*\/\s*EBITDA\b/i.test(narrative);
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
    ENTERPRISE_TO_EQUITY_PER_UNIT: FORMULAS.ENTERPRISE_TO_EQUITY_PER_UNIT,
    EV_PER_UNIT_MINUS_NET_DEBT: FORMULAS.ENTERPRISE_TO_EQUITY_PER_UNIT,
    AJUSTE_SOBRE_CAMADA: FORMULAS.LAYER_ADJUSTMENT,
    LAYER_ADJUSTMENT: FORMULAS.LAYER_ADJUSTMENT,
    UNVERIFIABLE: FORMULAS.UNVERIFIABLE,
  };
  return aliases[formula] || formula;
}

function hasUndeclaredCompositeUnitBase(layer) {
  const narrative = normalize(`${layer?.met ?? layer?.metodologia ?? ""} ${layer?.prem ?? layer?.premissas ?? ""}`);
  const explicitCompositeRange = /(?:^|_)(?:MEDIA(?:_SIMPLES|_PONDERADA)?|BLEND|COMBINACAO|PONDERAD[AO]?)(?:_[A-Z0-9]+){0,6}_ENTRE_(?:R_)?\d/.test(narrative);
  const averagedUnitMetric = /(?:^|_)(?:LPA|VPA|FFO|LUCRO_POR_ACAO|RESULTADO_POR_ACAO|RENDA_POR_UNIDADE|VALOR_POR_UNIDADE|VALOR_BASE)(?:_[A-Z0-9]+){0,2}_(?:MEDI[AO]|MEDIA|PONDERAD[AO]?|BLEND)(?:_|$)/.test(narrative) ||
    /(?:^|_)(?:MEDIA(?:_SIMPLES|_PONDERADA)?|PONDERAD[AO]?|BLEND|COMBINACAO)(?:_[A-Z0-9]+){0,3}_(?:LPA|VPA|FFO|LUCRO_POR_ACAO|RESULTADO_POR_ACAO|RENDA_POR_UNIDADE|VALOR_POR_UNIDADE|VALOR_BASE)(?:_|$)/.test(narrative);
  return explicitCompositeRange || averagedUnitMetric;
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
    if (hasUndeclaredCompositeUnitBase(layer)) {
      return {
        formula,
        invalid: true,
        invalid_reason: "derivacao_composta_nao_declarada",
        source: "structured",
      };
    }
    if (hasUnstructuredNetDebtAdjustment(layer, formula)) {
      return {
        formula,
        invalid: true,
        invalid_reason: "ajuste_divida_liquida_nao_estruturado",
        source: "structured",
      };
    }
    if (usesEnterpriseValueMultiple(layer)) {
      return {
        formula,
        invalid: true,
        invalid_reason: "ev_sem_conversao_para_equity",
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
    const candidate = { inputs: { renda_por_unidade: income, yield_pct: yieldPct } };
    if (hasNarrativeTargetConflict(layer, candidate)) {
      return { formula, invalid: true, invalid_reason: "premissa_percentual_conflitante", source: "structured" };
    }
    if (hasComparativePercentageConflict(layer, candidate)) {
      return { formula, invalid: true, invalid_reason: "comparacao_percentual_contraditoria", source: "structured" };
    }
    return {
      formula,
      expected: income / (yieldPct / 100),
      inputs: { renda_por_unidade: income, yield_pct: yieldPct },
      source: "structured",
    };
  }

  if (formula === FORMULAS.ENTERPRISE_TO_EQUITY_PER_UNIT) {
    const ebitdaPerUnit = finitePositive(calc.ebitda_por_unidade);
    const netDebtPerUnit = finiteNonNegative(calc.divida_liquida_por_unidade);
    if (!multiple || !ebitdaPerUnit || netDebtPerUnit === null) {
      return { formula, invalid: true, invalid_reason: "componentes_ev_equity_invalidos", source: "structured" };
    }
    const expected = ebitdaPerUnit * multiple - netDebtPerUnit;
    if (!(expected > 0)) return { formula, invalid: true, invalid_reason: "equity_por_unidade_nao_positivo", source: "structured" };
    return {
      formula,
      expected,
      inputs: {
        multiplo: multiple,
        ebitda_por_unidade: ebitdaPerUnit,
        divida_liquida_por_unidade: netDebtPerUnit,
        ev_por_unidade: ebitdaPerUnit * multiple,
      },
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

function invalidLayerPresentation(layer, integrity) {
  const premise = String(layer?.prem ?? layer?.premissas ?? "").trim();
  const note = "Camada não utilizada na convergência: memória de cálculo não verificável.";
  return {
    ...layer,
    vj: "N/D",
    prem: premise.includes(note) ? premise : [premise, note].filter(Boolean).join(" · "),
    calculo_integridade: integrity,
  };
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


  const vpaImplied = text.match(/\bVPA\s+implicito\b[^\n]{0,160}=\s*R\$\s*([0-9]+(?:[.,][0-9]+)?)/i);
  const pbTarget = text.match(/\bP\s*\/\s*(?:VP|VPA|B)\s+alvo\s+(?:de\s+)?([0-9]+(?:[.,][0-9]+)?)\s*x/i);
  if (vpaImplied && pbTarget) {
    const perUnit = parseLocalizedNumber(vpaImplied[1]);
    const factor = parseLocalizedNumber(pbTarget[1]);
    if (perUnit > 0 && factor > 0) {
      return {
        formula: FORMULAS.PER_UNIT_MULTIPLE,
        expected: perUnit * factor,
        inputs: { multiplo: factor, valor_por_unidade: perUnit, valor_base_unitario: perUnit },
        source: "legacy_text",
      };
    }
  }

  return null;
}

function calculationFor(layer) {
  const structured = structuredCalculation(layer);
  if (structured && !structured.invalid) return structured;
  return legacyCalculation(layer) || structured;
}

function isMismatch(declared, expected) {
  if (!Number.isFinite(declared)) return true;
  return round2(declared) !== round2(expected);
}

function isAcceptableRounding(declared, expected) {
  if (!Number.isFinite(declared) || !Number.isFinite(expected)) return false;
  const difference = Math.abs(declared - expected);
  const relativePct = expected ? (difference / Math.abs(expected)) * 100 : Infinity;
  return difference <= MAX_ROUNDING_ABSOLUTE || relativePct <= MAX_ROUNDING_RELATIVE_PCT;
}

function reconcileLayer(layer, code, calculation, expected) {
  const declaredText = priceValue(layer);
  const declared = firstNumber(declaredText);
  const prefix = pricePrefix(declaredText, layer?.met, layer?.metodologia);
  const mismatch = isMismatch(declared, expected);
  const calculated = round2(expected);
  const declaredRounded = Number.isFinite(declared) ? round2(declared) : null;
  const acceptableRounding = mismatch && declaredRounded !== null && isAcceptableRounding(declaredRounded, calculated);
  const materialMismatch = mismatch && declaredRounded !== null && !acceptableRounding;
  const status = materialMismatch
    ? "invalid_formula"
    : mismatch
    ? (declaredRounded === null ? "calculated" : "normalized_rounding")
    : "verified";
  const correctionNote = mismatch
    ? materialMismatch
      ? `Camada não utilizada na convergência: o valor informado ${formatPrice(declaredRounded, prefix)} diverge materialmente do resultado ${formatPrice(calculated, prefix)} reproduzido pela memória de cálculo.`
      : `Integridade aritmética: ${declaredRounded === null ? "valor calculado" : `arredondamento informado ${formatPrice(declaredRounded, prefix)} normalizado`} para ${formatPrice(calculated, prefix)} pelo servidor.`
    : "";
  const methodology = reconcileTargetClaims(layer?.met ?? layer?.metodologia, calculation);
  const premise = reconcileTargetClaims(layer?.prem ?? layer?.premissas, calculation);
  const narrativeCorrections = [...methodology.corrections, ...premise.corrections];
  const narrativeNote = narrativeCorrections.length
    ? `Integridade semântica: ${[...new Set(narrativeCorrections.map((item) => item.field))].join(" e ")} textual alinhado à memória estruturada pelo servidor.`
    : "";

  const reconciledPremise = mismatch && declaredRounded !== null
    ? premise.text.replace(
        new RegExp(`((?:R\\$|US\\$|USD|EUR|€)\\s*)${String(declaredRounded).replace(".", "[.,]")}(?!\\d)`, "gi"),
        (_, currency) => `${currency}${calculated.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      )
    : premise.text;

  const reconciled = {
      ...layer,
      met: methodology.text,
      vj: materialMismatch ? "N/D" : mismatch ? formatPrice(calculated, prefix) : declaredText,
      prem: [reconciledPremise, correctionNote, narrativeNote].filter(Boolean).join(" · "),
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
        narrative_input_corrections: narrativeCorrections,
        reason: materialMismatch ? "resultado_declarado_incompativel_com_memoria" : null,
      },
    };
  return {
    layer: reconciled,
    code,
    value: materialMismatch ? null : calculated,
    changed: mismatch && !materialMismatch,
    status,
  };
}

export function reconcileValuationLayers(layers = [], { documentIds = [] } = {}) {
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
    if (Number.isFinite(result.value)) values.set(item.code, result.value);
    results.set(item.code, result);
  }

  for (const item of prepared.filter((entry) => entry.calculation?.dependency)) {
    const dependencyWasGoverned = results.has(item.calculation.dependency);
    const base = values.get(item.calculation.dependency) ?? (dependencyWasGoverned
      ? null
      : firstNumber(priceValue(prepared.find((entry) => entry.code === item.calculation.dependency)?.layer)));
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
    if (Number.isFinite(result.value)) values.set(item.code, result.value);
    results.set(item.code, result);
  }

  const allowedDocuments = new Set(documentIds);
  const governed = prepared.map((item) => {
    if (results.has(item.code)) return results.get(item.code);
    const invalid = Boolean(item.calculation?.invalid || item.calculation?.dependency);
    return {
      code: item.code,
      value: firstNumber(priceValue(item.layer)),
      changed: false,
      status: invalid ? "invalid_formula" : "unverifiable",
      layer: invalid
        ? invalidLayerPresentation(item.layer, {
              version: VALUATION_INTEGRITY_VERSION,
              status: "invalid_formula",
              formula: item.calculation.formula,
              source: item.calculation.source,
              reason: item.calculation.invalid_reason || null,
              declared_value: firstNumber(priceValue(item.layer)),
            })
        : item.layer,
    };
  });
  for (const item of governed) {
    const calc = item.layer?.calc ?? item.layer?.calculo ?? {};
    const provenance = normalize(calc?.origem_base);
    const cited = Array.isArray(calc?.evidencia_documental) ? calc.evidencia_documental.filter((id) => allowedDocuments.has(id)) : [];
    if (provenance === "HIPOTESE" || (provenance === "BIBLIOTECA" && !cited.length)) {
      item.status = "invalid_formula";
      item.value = null;
      item.layer = invalidLayerPresentation(item.layer, {
          ...(item.layer?.calculo_integridade || {}),
          version: VALUATION_INTEGRITY_VERSION,
          status: "invalid_formula",
          reason: provenance === "HIPOTESE" ? "premissa_hipotetica" : "evidencia_documental_ausente",
          declared_value: firstNumber(priceValue(item.layer)),
        });
    }
  }
  const changed = governed.filter((item) => item.changed && item.status !== "invalid_formula");
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
