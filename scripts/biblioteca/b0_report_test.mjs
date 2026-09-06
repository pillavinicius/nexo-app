#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";

const path = join(process.cwd(), "data", "biblioteca", "b0_formatos_2025_2026.json");
const report = JSON.parse(readFileSync(path, "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(report.version === "BIB_B0_v1.0", "versão B0 inválida");
assert(report.source === "CVM_IPE", "fonte B0 inválida");
assert(report.sample_completed > 0, "amostra B0 vazia");
assert(report.sample_completed + report.sample_failed === report.sample_requested, "contagem da amostra inconsistente");

const detectedTotal = Object.values(report.distribution.detected_format).reduce((sum, value) => sum + value, 0);
assert(detectedTotal === report.sample_completed, "distribuição detectada inconsistente");
assert(report.sample.every((item) => item.url?.startsWith("https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?")), "URL fora do RAD/CVM");
assert(report.sample.every((item) => !Object.hasOwn(item, "body") && !Object.hasOwn(item, "content") && !Object.hasOwn(item, "document")), "conteúdo integral persistido indevidamente");
assert(report.sample.filter((item) => item.status === "ok").every((item) => item.bytes_inspected > 0 && item.bytes_inspected <= 8192), "janela de bytes inválida");

const formats = report.distribution.detected_format;
assert(report.decision_b3.html_xml_branch_required === ((formats.html || 0) + (formats.xml || 0) > 0), "decisão HTML/XML inconsistente");
assert(report.decision_b3.office_branch_required === ((formats.ole || 0) + (formats.zip || 0) > 0), "decisão Office inconsistente");

console.log(`Biblioteca B0 report: OK (${report.sample_completed} documentos)`);
