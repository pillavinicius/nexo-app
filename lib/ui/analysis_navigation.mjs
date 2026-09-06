export const ANALYSIS_VIEW = Object.freeze({
  SETUP: "setup",
  SCAN: "scan",
  DEEP_MAIN: "deep-0",
  FINAL: "final",
});

export function deepViewId(index = 0) {
  const normalized = Number.isInteger(index) && index >= 0 ? index : 0;
  return `deep-${normalized}`;
}

export function latestDeepViewId(deepAddsCount = 0) {
  const count = Number.isInteger(deepAddsCount) && deepAddsCount > 0 ? deepAddsCount : 0;
  return deepViewId(count);
}

export function buildAnalysisTabs({
  hasScan = false,
  hasDeep = false,
  deepAddsCount = 0,
  hasFinal = false,
  loadingKind = "",
} = {}) {
  const count = Number.isInteger(deepAddsCount) && deepAddsCount > 0 ? deepAddsCount : 0;
  const tabs = [
    { id: ANALYSIS_VIEW.SETUP, label: "Preparação", shortLabel: "Dados", enabled: true },
    { id: ANALYSIS_VIEW.SCAN, label: "Scan", shortLabel: "Scan", enabled: hasScan || loadingKind === "scan" },
    { id: ANALYSIS_VIEW.DEEP_MAIN, label: "Deep 1", shortLabel: "Deep 1", enabled: hasDeep || loadingKind === "deep" },
  ];

  for (let index = 1; index <= count; index += 1) {
    tabs.push({
      id: deepViewId(index),
      label: `Deep ${index + 1}`,
      shortLabel: `Deep ${index + 1}`,
      enabled: true,
    });
  }

  tabs.push({
    id: ANALYSIS_VIEW.FINAL,
    label: "Reclassificação",
    shortLabel: "Final",
    enabled: hasFinal || loadingKind === "final",
  });

  return tabs;
}

export function analysisViewLabel(view, deepAddsCount = 0) {
  if (view === ANALYSIS_VIEW.SETUP) return "Preparação da análise";
  if (view === ANALYSIS_VIEW.SCAN) return "Resultado Scan";
  if (view === ANALYSIS_VIEW.FINAL) return "Reclassificação Final";

  const match = /^deep-(\d+)$/.exec(String(view || ""));
  if (match) return Number(match[1]) === 0 ? "Deep Principal" : `Deep Aprofundado ${match[1]}`;
  return deepAddsCount > 0 ? "Deep NEXO" : "Análise NEXO";
}
