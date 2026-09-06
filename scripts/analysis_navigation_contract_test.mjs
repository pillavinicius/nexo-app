#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ANALYSIS_VIEW,
  analysisViewLabel,
  buildAnalysisTabs,
  deepViewId,
  latestDeepViewId,
} from "../lib/ui/analysis_navigation.mjs";

assert.equal(deepViewId(0), "deep-0");
assert.equal(deepViewId(2), "deep-2");
assert.equal(latestDeepViewId(0), "deep-0");
assert.equal(latestDeepViewId(3), "deep-3");

const initial = buildAnalysisTabs();
assert.deepEqual(initial.map((tab) => [tab.id, tab.enabled]), [
  ["setup", true],
  ["scan", false],
  ["deep-0", false],
  ["final", false],
]);

const completed = buildAnalysisTabs({ hasScan: true, hasDeep: true, deepAddsCount: 2, hasFinal: true });
assert.deepEqual(completed.map((tab) => tab.id), ["setup", "scan", "deep-0", "deep-1", "deep-2", "final"]);
assert.ok(completed.every((tab) => tab.enabled));
assert.equal(analysisViewLabel(ANALYSIS_VIEW.SCAN), "Resultado Scan");
assert.equal(analysisViewLabel("deep-2"), "Deep Aprofundado 2");

const page = await readFile(join(process.cwd(), "app", "page.jsx"), "utf8");
for (const token of [
  "analysis-nav",
  "Preencher HDL",
  "Voltar para executar o Deep",
  "openHdlFromDeep",
  "returnToDeepAction",
  "activeView === ANALYSIS_VIEW.SCAN",
  "activeView === ANALYSIS_VIEW.FINAL",
]) assert.ok(page.includes(token), `contrato visual ausente: ${token}`);

assert.ok(page.includes("activeDeepResult"), "cada página Deep deve renderizar somente seu próprio resultado");
assert.match(
  page,
  /const nextDeepView = `deep-\$\{deepAdds\.length \+ 1\}`;[\s\S]*?setActiveView\(nextDeepView\);[\s\S]*?pageTopRef\.current\?\.scrollIntoView/,
  "ao concluir um aprofundamento, a nova página Deep deve abrir no topo",
);
assert.ok(page.includes("min-height:100dvh"), "a página deve ocupar o viewport sem deixar cauda vazia após o rodapé");
assert.ok(page.includes("margin-top:auto"), "o rodapé deve encostar no fim do viewport em páginas curtas");
console.log("B3.1 navegação Scan/Deep/Reclassificação e desvio HDL: OK");
