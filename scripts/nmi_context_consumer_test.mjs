#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  buildNmiPromptContext,
  getLatestContext,
} from "../lib/nmi/get_latest_context.mjs";

let assertions = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  assertions += 1;
};

const canonicalPath = resolve(process.cwd(), "data/context/latest.json");
const canonical = JSON.parse(readFileSync(canonicalPath, "utf8"));
const result = getLatestContext();

const loadFrom = (filePath) =>
  getLatestContext({ readContextFile: () => readFileSync(filePath, "utf8") });

check(result.ok, "carrega pacote canônico válido");
check(result.status === "available", "pacote real não é seed");
check(result.meta.compatibility === "exact", "contrato 1.2 é compatível");
check(result.meta.contextId === canonical.context_id, "preserva context_id");

const prompt = buildNmiPromptContext(result);
check(prompt.includes(canonical.context_id), "prompt registra context_id");
check(prompt.includes("BCB_SGS/432"), "prompt registra proveniência da Selic");
check(prompt.includes("14.00% a.a."), "prompt preserva valor e unidade da Selic");
check(prompt.includes("null significa indisponível, nunca zero"), "prompt proíbe default zero");
check(prompt.includes("priorize o NMI validado"), "prompt resolve conflito com snapshot automático");
check(prompt.includes("Fontes indisponíveis:"), "prompt sinaliza cobertura parcial");

const tempDir = mkdtempSync(join(tmpdir(), "nexo-context-consumer-"));

try {
  const invalidJsonPath = join(tempDir, "invalid.json");
  writeFileSync(invalidJsonPath, "{", "utf8");
  const invalidJson = loadFrom(invalidJsonPath);
  check(!invalidJson.ok && invalidJson.reason === "invalid_json", "JSON inválido falha graciosamente");

  const missing = loadFrom(join(tempDir, "missing.json"));
  check(!missing.ok && missing.reason === "missing_or_unreadable", "arquivo ausente falha graciosamente");

  const invalidContractPath = join(tempDir, "invalid-contract.json");
  writeFileSync(
    invalidContractPath,
    JSON.stringify({ ...canonical, context_id: "" }),
    "utf8"
  );
  const invalidContract = loadFrom(invalidContractPath);
  check(!invalidContract.ok && invalidContract.reason === "contract_invalid", "pacote inválido é recusado");

  const incompatiblePath = join(tempDir, "incompatible.json");
  writeFileSync(
    incompatiblePath,
    JSON.stringify({ ...canonical, contextSchemaVersion: "2.0" }),
    "utf8"
  );
  const incompatible = loadFrom(incompatiblePath);
  check(!incompatible.ok && incompatible.reason === "incompatible_contract", "MAJOR incompatível é recusado");

  const unavailablePrompt = buildNmiPromptContext(incompatible);
  check(unavailablePrompt.includes("CONTEXTO NMI: INDISPONÍVEL"), "indisponibilidade fica explícita no prompt");
  check(unavailablePrompt.includes("Não invente"), "fallback proíbe síntese de macro");

  const seedPath = join(tempDir, "seed.json");
  const seed = structuredClone(canonical);
  seed.context_id = "ctx_test_seed";
  seed.is_seed_mode = true;
  seed.quality.seed_penalty = 0.7;
  seed.quality.overall_confidence = 0.3;
  for (const watermark of Object.values(seed.source_watermarks)) {
    watermark.status = "seed";
  }
  writeFileSync(seedPath, JSON.stringify(seed), "utf8");
  const seedResult = loadFrom(seedPath);
  check(seedResult.ok && seedResult.status === "seed", "seed válido permanece identificado");
  check(buildNmiPromptContext(seedResult).includes("não alimente score, veto ou veredito"), "seed não alimenta decisão");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

const originalFetch = globalThis.fetch;
const capturedRequests = [];

try {
  globalThis.fetch = async (_url, options) => {
    capturedRequests.push(JSON.parse(options.body));
    return new Response(
      JSON.stringify({ content: [{ text: '{"ticker":"TEST"}' }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const { POST } = await import("../app/api/analyze/route.js");

  for (const phase of ["scan", "deep", "final"]) {
    const request = new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phase,
        assetType: "acao-br",
        ticker: "TEST3",
        scanSummary: "scan de teste",
        extraCtx: "contexto de teste",
      }),
    });

    const response = await POST(request);
    check(response.status === 200, `${phase} responde com contexto NMI`);
  }

  check(capturedRequests.length === 3, "Scan, Deep e Final chamam a Estação 3");
  for (const [index, phase] of ["scan", "deep", "final"].entries()) {
    const userMessage = capturedRequests[index].messages[0].content;
    check(userMessage.includes("CONTEXTO NMI VALIDADO"), `${phase} recebe bloco NMI validado`);
    check(userMessage.includes(canonical.context_id), `${phase} recebe o Context ID canônico`);
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`NMI context consumer: ${assertions} assertions OK`);
