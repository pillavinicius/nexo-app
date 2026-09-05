#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  buildGuidedEdgeEvidence,
  buildGuidedExpiryCondition,
  EDGE_DEADLINE_OBJECTS,
  EDGE_EXPIRY_EVENTS,
  EDGE_EXPIRY_METRICS,
  EDGE_INSUMO_METADATA,
  evidenceOptionsForType,
} from "../lib/ui/edg_form_adapter.mjs";
import {
  computeEDG,
  isObservableExpiryCondition,
} from "../lib/nexo/edg/edg_engine.mjs";

let assertions = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  assertions += 1;
};
const equal = (actual, expected, message) => {
  assert.equal(actual, expected, message);
  assertions += 1;
};

const evidence = buildGuidedEdgeEvidence({
  edgeType: "analitico",
  edgeInsumo: "IQD",
  templateId: "benchmark_divergence",
  basisId: "validated_series",
  windowId: "twelve_months",
});

check(evidence.includes("módulo IQD"), "evidência identifica o insumo");
check(evidence.includes("série histórica validada"), "evidência identifica a base");
check(evidence.includes("últimos doze meses"), "evidência identifica a janela");
equal(
  buildGuidedEdgeEvidence({ edgeType: "analitico", edgeInsumo: "IQD" }),
  "",
  "evidência incompleta não produz frase genérica"
);

for (const edgeType of ["informacional", "analitico", "estrutural", "temporal"]) {
  for (const template of evidenceOptionsForType(edgeType).filter((item) => item.id !== "custom")) {
    const guided = buildGuidedEdgeEvidence({
      edgeType,
      edgeInsumo: "IQD",
      templateId: template.id,
      basisId: "module_output",
      windowId: "latest_result",
    });
    check(guided.length >= 12, `evidência ${edgeType}/${template.id} produz registro verificável`);
  }
}

const metricExpiry = buildGuidedExpiryCondition({
  templateId: "metric_below",
  metricId: "gross_margin",
  threshold: "17",
  unitId: "percent",
  persistence: "2",
  periodId: "quarter",
});

equal(
  metricExpiry,
  "Quando Margem bruta cruzar 17% para baixo por 2 trimestres consecutivos.",
  "builder produz condição métrica canônica"
);
check(isObservableExpiryCondition(metricExpiry), "condição métrica é observável");
check(
  buildGuidedExpiryCondition({
    templateId: "metric_above",
    metricId: "roic",
    threshold: "12,5",
    unitId: "percent",
    persistence: "1",
    periodId: "year",
  }).includes("12,5%"),
  "limite decimal aceita a notação brasileira"
);
equal(
  buildGuidedExpiryCondition({
    templateId: "metric_above",
    metricId: "roic",
    threshold: "",
    unitId: "percent",
    persistence: "2",
    periodId: "quarter",
  }),
  "",
  "limite vazio não produz condição"
);
equal(
  buildGuidedExpiryCondition({
    templateId: "metric_above",
    metricId: "roic",
    threshold: "doze",
    unitId: "percent",
    persistence: "2",
    periodId: "quarter",
  }),
  "",
  "limite textual é rejeitado"
);

for (const metric of EDGE_EXPIRY_METRICS) {
  const condition = buildGuidedExpiryCondition({
    templateId: "metric_below",
    metricId: metric.id,
    threshold: "10",
    unitId: "percent",
    persistence: "2",
    periodId: "quarter",
  });
  check(isObservableExpiryCondition(condition), `métrica ${metric.id} passa na régua observável`);
}

for (const event of EDGE_EXPIRY_EVENTS) {
  const condition = buildGuidedExpiryCondition({
    templateId: "objective_event",
    eventId: event.id,
  });
  check(condition.length >= 20, `evento ${event.id} produz condição`);
  check(isObservableExpiryCondition(condition), `evento ${event.id} passa na régua observável`);
}

for (const object of EDGE_DEADLINE_OBJECTS) {
  const condition = buildGuidedExpiryCondition({
    templateId: "deadline_unconfirmed",
    deadlineObjectId: object.id,
    deadlineDate: "2026-12-31",
  });
  check(isObservableExpiryCondition(condition), `prazo ${object.id} passa na régua observável`);
}

const edg = computeEDG({
  edge_type: "analitico",
  edge_evidence: evidence,
  edge_insumo: "IQD",
  edge_expiry_condition: metricExpiry,
  edge_declared_at: "2026-09-05",
  edge_status: "ativo",
});
equal(edg.validation.valid, true, "registro guiado completo passa no contrato EDG");
equal(edg.ledger_completeness, 1, "registro guiado atinge completude integral");

check(
  evidenceOptionsForType("estrutural").some((item) => item.id === "forced_seller"),
  "catálogo estrutural oferece vendedor forçado"
);
check(
  !evidenceOptionsForType("temporal").some((item) => item.id === "forced_seller"),
  "opções de evidência respeitam o tipo selecionado"
);
equal(EDGE_INSUMO_METADATA.IQD.available, true, "IQD está habilitado");
equal(EDGE_INSUMO_METADATA.HDL.available, false, "HDL futuro não pode lastrear edge agora");

console.log(`EDG form adapter: ${assertions} assertions OK`);
