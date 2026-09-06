#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const B0_VERSION = "BIB_B0_v1.0";
export const CVM_IPE_BASE = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/IPE/DADOS";

const cli = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=") || true];
}));

function parseCsvLine(line, separator = ";") {
  const fields = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === separator && !quoted) {
      fields.push(value);
      value = "";
    } else value += char;
  }
  fields.push(value);
  return fields;
}

export function parseIpeCsv(content) {
  const lines = String(content || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

export function detectDocumentFormat(buffer) {
  const bytes = Buffer.from(buffer || []);
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2])) return "zip";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return "ole";
  if (bytes.subarray(0, 5).toString("ascii") === "{\\rtf") return "rtf";
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return "gzip";
  const text = bytes.subarray(0, 8192).toString("utf8").replace(/^\uFEFF/, "").trimStart().toLowerCase();
  if (text.startsWith("<!doctype html") || text.startsWith("<html") || /<html[\s>]/.test(text.slice(0, 500))) return "html";
  if (text.startsWith("<?xml") || /^[<][a-z_][\w:.-]*(\s|>)/.test(text)) return "xml";
  if (text.startsWith("{") || text.startsWith("[")) {
    try { JSON.parse(text); return "json"; } catch {}
  }
  if (bytes.length && [...bytes].filter((byte) => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 160).length / bytes.length > 0.9) return "text";
  return bytes.length ? "other" : "empty";
}

function stableHash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function selectStratifiedSample(rows, limit) {
  const eligible = rows.filter((row) => row.Link_Download && row.Protocolo_Entrega);
  const groups = new Map();
  for (const row of eligible) {
    const key = row.Categoria || "SEM_CATEGORIA";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const group of groups.values()) group.sort((a, b) => stableHash(a.Protocolo_Entrega).localeCompare(stableHash(b.Protocolo_Entrega)));
  const categories = [...groups.keys()].sort();
  const selected = [];
  for (let round = 0; selected.length < limit; round += 1) {
    let added = 0;
    for (const category of categories) {
      const row = groups.get(category)[round];
      if (row && selected.length < limit) { selected.push(row); added += 1; }
    }
    if (!added) break;
  }
  return selected;
}

function headerFormat(contentType, disposition) {
  const type = String(contentType || "").toLowerCase();
  const filename = String(disposition || "").match(/filename\*?=(?:UTF-8''|\")?([^";]+)/i)?.[1] || "";
  const extension = filename.split(".").at(-1)?.toLowerCase();
  if (type.includes("pdf") || extension === "pdf") return "pdf";
  if (type.includes("html") || ["html", "htm"].includes(extension)) return "html";
  if (type.includes("xml") || extension === "xml") return "xml";
  if (type.includes("zip") || extension === "zip") return "zip";
  return type || extension || "unknown";
}

async function fetchPrefix(url, { fetchImpl = fetch, timeoutMs = 25_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { Range: "bytes=0-8191", "User-Agent": "NEXO-Biblioteca-B0/1.0" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body?.getReader();
    const first = reader ? await reader.read() : { value: new Uint8Array(await response.arrayBuffer()) };
    if (reader) await reader.cancel().catch(() => {});
    const prefix = Buffer.from(first.value || []).subarray(0, 8192);
    const contentType = response.headers.get("content-type") || "";
    const disposition = response.headers.get("content-disposition") || "";
    return {
      detected_format: detectDocumentFormat(prefix),
      declared_format: headerFormat(contentType, disposition),
      content_type: contentType || null,
      content_disposition: disposition || null,
      bytes_inspected: prefix.length,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPrefixWithRetry(url, options = {}, attempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchPrefix(url, options);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function loadYear(year, fetchImpl = fetch) {
  const url = `${CVM_IPE_BASE}/ipe_cia_aberta_${year}.zip`;
  const response = await fetchImpl(url, { headers: { "User-Agent": "NEXO-Biblioteca-B0/1.0" } });
  if (!response.ok) throw new Error(`CVM IPE ${year}: HTTP ${response.status}`);
  const zip = Buffer.from(await response.arrayBuffer());
  const temp = await mkdtemp(join(tmpdir(), "nexo-b0-"));
  const zipPath = join(temp, `ipe_${year}.zip`);
  try {
    await writeFile(zipPath, zip);
    const csv = execFileSync("unzip", ["-p", zipPath], { maxBuffer: 80 * 1024 * 1024 });
    return { rows: parseIpeCsv(new TextDecoder("windows-1252").decode(csv)), url };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

function counts(items, key) {
  return Object.fromEntries([...items.reduce((map, item) => map.set(item[key], (map.get(item[key]) || 0) + 1), new Map())].sort());
}

function contentTypeFormat(contentType) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("pdf")) return "pdf";
  if (type.includes("html")) return "html";
  if (type.includes("xml")) return "xml";
  if (type.includes("zip")) return "zip";
  return type || "unknown";
}

export function buildB0Report({ years, datasetRows, sample, generatedAt = new Date().toISOString(), sources }) {
  const successful = sample.filter((item) => item.status === "ok");
  const detected = counts(successful, "detected_format");
  const nonPdf = successful.filter((item) => item.detected_format !== "pdf").length;
  const mismatch = successful.filter((item) => item.detected_format !== item.declared_format).length;
  const contentTypeMismatch = successful.filter((item) => item.detected_format !== contentTypeFormat(item.content_type)).length;
  const nonPdfShare = successful.length ? nonPdf / successful.length : null;
  return {
    version: B0_VERSION,
    generated_at: generatedAt,
    source: "CVM_IPE",
    source_urls: sources,
    years,
    methodology: "deterministic_stratified_by_category_magic_bytes",
    dataset_rows: datasetRows,
    sample_requested: sample.length,
    sample_completed: successful.length,
    sample_failed: sample.length - successful.length,
    categories_sampled: new Set(sample.map((item) => item.categoria)).size,
    distribution: {
      detected_format: detected,
      declared_format: counts(successful, "declared_format"),
      content_type: counts(successful, "content_type"),
      non_pdf_share: nonPdfShare === null ? null : Math.round(nonPdfShare * 10_000) / 10_000,
      header_magic_mismatches: mismatch,
      content_type_magic_mismatches: contentTypeMismatch,
    },
    decision_b3: {
      html_xml_branch_required: (detected.html || 0) + (detected.xml || 0) > 0,
      office_branch_required: (detected.ole || 0) + (detected.zip || 0) > 0,
      primary_text_parser: "pdftotext",
      table_parser: "docling",
      note: "A decisão usa o formato detectado, nunca apenas content-type ou extensão.",
    },
    failures: sample.filter((item) => item.status === "failed").map(({ protocolo, categoria, error }) => ({ protocolo, categoria, error })),
    sample,
  };
}

export async function runB0({ years, limit = 60, concurrency = 4, outputPath, fetchImpl = fetch } = {}) {
  const selectedYears = years?.length ? years : [new Date().getUTCFullYear()];
  const datasets = await Promise.all(selectedYears.map((year) => loadYear(year, fetchImpl)));
  const rows = datasets.flatMap((dataset) => dataset.rows);
  const selected = selectStratifiedSample(rows, limit);
  const sample = await mapConcurrent(selected, concurrency, async (row) => {
    const base = {
      protocolo: row.Protocolo_Entrega,
      categoria: row.Categoria || null,
      tipo: row.Tipo || null,
      data_entrega: row.Data_Entrega || null,
      url: row.Link_Download,
    };
    try { return { ...base, status: "ok", ...(await fetchPrefixWithRetry(row.Link_Download, { fetchImpl })) }; }
    catch (error) { return { ...base, status: "failed", error: error?.name === "AbortError" ? "timeout" : error.message }; }
  });
  const report = buildB0Report({
    years: selectedYears,
    datasetRows: rows.length,
    sample,
    sources: datasets.map((dataset) => dataset.url),
  });
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    const temporary = `${outputPath}.tmp-${process.pid}`;
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await rename(temporary, outputPath);
  }
  return report;
}

function selfTest() {
  const csv = 'Categoria;Protocolo_Entrega;Link_Download\n"Fato; Relevante";P1;https://a\nAssembleia;P2;https://b\n';
  const rows = parseIpeCsv(csv);
  if (rows[0].Categoria !== "Fato; Relevante" || rows.length !== 2) throw new Error("CSV parser failed");
  const formats = [
    [Buffer.from("%PDF-1.7"), "pdf"], [Buffer.from("<!doctype html><html>"), "html"],
    [Buffer.from("<?xml version='1.0'?><x/>"), "xml"], [Buffer.from([0x50, 0x4b, 0x03, 0x04]), "zip"],
  ];
  for (const [buffer, expected] of formats) if (detectDocumentFormat(buffer) !== expected) throw new Error(`magic ${expected} failed`);
  const selected = selectStratifiedSample([...rows, { ...rows[0], Protocolo_Entrega: "P3" }], 2);
  if (new Set(selected.map((item) => item.Categoria)).size !== 2) throw new Error("stratification failed");
  const report = buildB0Report({ years: [2026], datasetRows: 2, sources: ["fixture"], sample: [
    { status: "ok", categoria: "A", detected_format: "pdf", declared_format: "html" },
    { status: "ok", categoria: "B", detected_format: "xml", declared_format: "xml" },
  ] });
  if (!report.decision_b3.html_xml_branch_required || report.distribution.header_magic_mismatches !== 1) throw new Error("report decision failed");
  console.log("Biblioteca B0 self-test: OK");
}

if (process.env.NEXO_SELFTEST === "1") selfTest();
else if (import.meta.url === `file://${process.argv[1]}`) {
  const years = String(cli.get("years") || new Date().getUTCFullYear()).split(",").map(Number).filter(Number.isInteger);
  const limit = Number(cli.get("limit") || 60);
  const concurrency = Number(cli.get("concurrency") || 4);
  const output = String(cli.get("output") || join(process.cwd(), "data", "biblioteca", `b0_formatos_${years.join("_")}.json`));
  runB0({ years, limit, concurrency, outputPath: output })
    .then((report) => console.log(`B0: ${report.sample_completed}/${report.sample_requested} documentos · saída ${output}`))
    .catch((error) => { console.error(`B0 falhou: ${error.message}`); process.exitCode = 1; });
}
