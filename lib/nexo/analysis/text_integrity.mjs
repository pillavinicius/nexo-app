export const TEXT_INTEGRITY_VERSION = "TEXT_v1.0";

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value || {})
    : JSON.parse(JSON.stringify(value || {}));
}

export function reconcileListingSegmentClaims(result) {
  const governed = clone(result);
  const reconciledPaths = [];
  const contradictionPatterns = [
    /Novo\s+Mercado\s+(?:adaptado\s*)?\(\s*N[ií]vel\s*[12](?:\s+B3)?\s*\)/gi,
    /N[ií]vel\s*[12]\s+(?:adaptado\s+(?:ao|do)\s+)?Novo\s+Mercado/gi,
  ];

  function visit(value, path = "$") {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      const itemPath = `${path}.${key}`;
      if (typeof item === "string") {
        let corrected = item;
        for (const pattern of contradictionPatterns) {
          corrected = corrected.replace(pattern, "segmento especial de governança da B3 (classificação específica não confirmada)");
        }
        if (corrected !== item) {
          value[key] = corrected;
          reconciledPaths.push(itemPath);
        }
      } else {
        visit(item, itemPath);
      }
    }
  }

  visit(governed);
  if (reconciledPaths.length) {
    governed.integridade_analise = {
      ...(governed.integridade_analise || {}),
      text_integrity_version: TEXT_INTEGRITY_VERSION,
      listing_segment_conflicts_reconciled: reconciledPaths,
    };
  }
  return governed;
}
