import assert from "node:assert/strict";
import {
  applyEdgGuardrails,
  buildEdgAnalysisContext,
  computeEDG,
} from "../lib/nexo/edg/edg_engine.mjs";
import { resolveEdgeScanGate } from "../lib/ui/edge_scan_gate.mjs";

const availableModules = ["IQD", "PIJR", "RES"];
const activeRecord = {
  edge_type: "analitico",
  edge_evidence: "O módulo PIJR diverge do benchmark setorial nos últimos doze meses.",
  edge_insumo: "PIJR",
  edge_expiry_condition: "Quando a inadimplência ficar acima de 5% por dois trimestres consecutivos.",
  edge_declared_at: "2026-09-05",
  edge_status: "ativo",
};

const noEdge = resolveEdgeScanGate({
  record: { edge_type: "nenhum", edge_status: "nao_declarado" },
  availableModules,
});
assert.equal(noEdge.ready, true);

const incomplete = resolveEdgeScanGate({
  record: { edge_type: "analitico", edge_status: "ativo" },
  availableModules,
});
assert.equal(incomplete.ready, false);
assert.ok(incomplete.validation.errors.includes("edge_evidence_not_verifiable"));
assert.ok(incomplete.validation.errors.includes("edge_expiry_condition_required"));

const coherent = resolveEdgeScanGate({ record: activeRecord, availableModules });
assert.equal(coherent.ready, true);
assert.equal(coherent.validation.errors.length, 0);

const incoherent = resolveEdgeScanGate({
  record: { ...activeRecord, edge_expiry_condition: "Quando piorar." },
  availableModules,
});
assert.equal(incoherent.ready, false);
assert.ok(incoherent.validation.errors.includes("edge_expiry_condition_not_observable"));

const unavailable = resolveEdgeScanGate({
  record: { ...activeRecord, edge_insumo: "TDN" },
  availableModules,
});
assert.equal(unavailable.ready, false);
assert.ok(unavailable.validation.errors.includes("edge_insumo_unknown"));

const d2 = applyEdgGuardrails({
  phase: "scan",
  result: { veredito: "APROVADO" },
  edg: computeEDG({ edge_type: "nenhum", edge_status: "nao_declarado" }),
});
assert.equal(d2.veredito, "WATCHLIST");
assert.equal(d2.edg_governance.comparison.without_edg, "APROVADO");
assert.equal(d2.edg_governance.comparison.with_edg, "WATCHLIST");

const active = applyEdgGuardrails({
  phase: "scan",
  result: { veredito: "APROVADO" },
  edg: computeEDG(activeRecord),
});
assert.equal(active.veredito, "APROVADO");
assert.equal(active.edg_governance.comparison.without_edg, "APROVADO");
assert.equal(active.edg_governance.comparison.with_edg, "APROVADO");

const d3 = applyEdgGuardrails({
  phase: "deep",
  result: { veredito_final: "MONITORAR" },
  edg: computeEDG({ ...activeRecord, edge_status: "expirado" }),
});
assert.equal(d3.veredito_final, "EVITAR");
assert.equal(d3.edg_governance.rule, "D3");
assert.equal(d3.edg_governance.comparison.without_edg, "MONITORAR");
assert.equal(d3.edg_governance.comparison.with_edg, "EVITAR");

const promptContext = buildEdgAnalysisContext(computeEDG(activeRecord), activeRecord);
assert.match(promptContext, /veredito analítico bruto/);
assert.doesNotMatch(promptContext, /REGRA D2 RATIFICADA|REGRA D3 RATIFICADA/);

console.log("edge UI contract: 20/20 checks passed");
