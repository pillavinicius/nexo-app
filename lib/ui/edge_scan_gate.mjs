import { validateEdgeRecord } from "../nexo/edg/edg_engine.mjs";

export function resolveEdgeScanGate({ record, availableModules, errorLabels = {} }) {
  const validation = validateEdgeRecord(record, { availableModules });
  const firstError = validation.errors[0] || "";

  return {
    ready: validation.valid,
    validation,
    reason: validation.valid
      ? ""
      : errorLabels[firstError] || "Preencha corretamente todos os campos obrigatórios do EDG.",
  };
}
