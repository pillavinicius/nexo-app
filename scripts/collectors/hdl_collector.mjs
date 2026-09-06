#!/usr/bin/env node

// NEXO Goldberg F1a — coletor offline da curva ETTJ IPCA/ANBIMA.
// A Vercel apenas lê data/goldberg/hdl_curva.csv; nunca executa este arquivo.
//
// Uso:
//   node scripts/collectors/hdl_collector.mjs
//   node scripts/collectors/hdl_collector.mjs --refresh
//   NEXO_SELFTEST=1 node scripts/collectors/hdl_collector.mjs

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseHdlCurveCsv } from "../../lib/nexo/hdl/hdl_repository.mjs";

export const HDL_COLLECTOR_VERSION = "HDL_COLLECTOR_v1.0";
export const ANBIMA_CURVE_URL = "https://www.anbima.com.br/informacoes/est-termo/CZ-down.asp";

const SELFTEST = process.env.NEXO_SELFTEST === "1";
const REFRESH = process.argv.includes("--refresh");
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(SCRIPT_DIR, "..", "..", "data", "goldberg", "hdl_curva.csv");

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function brNumber(value) {
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  if (!raw || raw === "-") return null;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function brInteger(value) {
  const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(/[.,]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function dateBr(iso) {
  const [year, month, day] = String(iso).split("-");
  return `${day}/${month}/${year}`;
}

function referenceDateFromLines(lines, fallback) {
  const referenceLine = lines.find((line) => {
    const normalized = line
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return normalized.includes("data") && normalized.includes("referencia");
  });
  const match = String(referenceLine || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : fallback;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function previousUtcDay(date) {
  return new Date(date.getTime() - 86_400_000);
}

export function parseAnbimaCurveCsv(text, dataRef) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim());
  const headerIndex = lines.findIndex((line) => {
    const normalized = line
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return normalized.includes("vertices") && normalized.includes("ettj ipca");
  });
  if (headerIndex < 0) return [];
  const effectiveDataRef = referenceDateFromLines(lines, dataRef);

  const rows = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line) {
      if (rows.length) break;
      continue;
    }
    const columns = line.split(";").map((column) => column.trim().replace(/^"|"$/g, ""));
    const businessDays = brInteger(columns[0]);
    const ipcaRate = brNumber(columns[1]);
    if (businessDays === null || ipcaRate === null) {
      if (rows.length) break;
      continue;
    }
    rows.push({
      data_ref: effectiveDataRef,
      vertice_anos: round(businessDays / 252),
      taxa_real_pct: round(ipcaRate, 4),
      fonte: "anbima_ettj",
      status: "official",
    });
  }
  return rows;
}

export function mergeCurveHistory(existing = [], incoming = []) {
  const merged = new Map();
  for (const row of [...existing, ...incoming]) {
    if (!row?.data_ref || !Number.isFinite(Number(row?.vertice_anos))) continue;
    merged.set(`${row.data_ref}|${Number(row.vertice_anos)}`, {
      data_ref: row.data_ref,
      vertice_anos: Number(row.vertice_anos),
      taxa_real_pct: Number(row.taxa_real_pct),
      fonte: row.fonte || "anbima_ettj",
      status: row.status || "official",
    });
  }
  return [...merged.values()].sort(
    (a, b) => a.data_ref.localeCompare(b.data_ref) || a.vertice_anos - b.vertice_anos
  );
}

export function serializeCurve(rows) {
  const header = "data_ref,vertice_anos,taxa_real_pct,fonte,status";
  const body = rows.map((row) =>
    [row.data_ref, row.vertice_anos, row.taxa_real_pct, row.fonte, row.status].join(",")
  );
  return `${[header, ...body].join("\n")}\n`;
}

async function fetchCurveForDate(dataRef) {
  const body = new URLSearchParams({
    escolha: "2",
    Idioma: "PT",
    saida: "csv",
    Dt_Ref: dateBr(dataRef),
  });
  const response = await fetch(ANBIMA_CURVE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "NEXO-HDL-Collector/1.0",
    },
    body,
  });
  if (!response.ok) throw new Error(`ANBIMA HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const text = new TextDecoder("iso-8859-1").decode(bytes);
  return parseAnbimaCurveCsv(text, dataRef);
}

async function collectLatestDates({ targetDates = 1, lookbackDays = 20 } = {}) {
  const dates = new Map();
  let cursor = new Date();
  for (let attempt = 0; attempt < lookbackDays && dates.size < targetDates; attempt += 1) {
    const dataRef = toIsoDate(cursor);
    process.stdout.write(`HDL · ANBIMA ${dataRef} ... `);
    try {
      const rows = await fetchCurveForDate(dataRef);
      if (rows.length) {
        const officialDate = rows[0].data_ref;
        if (!dates.has(officialDate)) {
          dates.set(officialDate, rows);
          console.log(`${rows.length} vértices · ref. ${officialDate}`);
        } else {
          console.log(`curva repetida · ref. ${officialDate}`);
        }
      } else {
        console.log("sem curva");
      }
    } catch (error) {
      console.log(`indisponível (${error.message})`);
    }
    cursor = previousUtcDay(cursor);
  }
  return [...dates.values()].flat();
}

function readExisting() {
  try {
    return parseHdlCurveCsv(readFileSync(OUTPUT_PATH, "utf8"));
  } catch {
    return [];
  }
}

function atomicWrite(content) {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const temporaryPath = `${OUTPUT_PATH}.tmp`;
  writeFileSync(temporaryPath, content, "utf8");
  renameSync(temporaryPath, OUTPUT_PATH);
}

export function selfTest() {
  const fixture = [
    "Arquivo ANBIMA",
    "Data de Referência;04/09/2026",
    "Vertices;ETTJ IPCA;ETTJ PREF;Inflação Implícita",
    "252;6,9576;10,00;3,00",
    "1.260;7,9001;11,00;3,10",
    "2.520;7,5846;11,20;3,20",
    "",
  ].join("\r\n");
  const parsed = parseAnbimaCurveCsv(fixture, "2026-09-06");
  if (parsed.length !== 3 || parsed[1].vertice_anos !== 5 || parsed[1].taxa_real_pct !== 7.9001) {
    throw new Error("hdl_collector_parse_failed");
  }
  const merged = mergeCurveHistory(
    [{ ...parsed[0], taxa_real_pct: 1 }],
    parsed
  );
  if (merged.length !== 3 || merged[0].taxa_real_pct !== 6.9576) {
    throw new Error("hdl_collector_dedup_failed");
  }
  const reparsed = parseHdlCurveCsv(serializeCurve(merged));
  if (reparsed.length !== 3) throw new Error("hdl_collector_roundtrip_failed");
  return true;
}

async function main() {
  const targetDates = REFRESH ? 1 : 5;
  const incoming = await collectLatestDates({ targetDates });
  if (!incoming.length) {
    throw new Error("Nenhuma curva oficial encontrada na janela consultada; arquivo atual preservado.");
  }
  const existing = readExisting();
  const merged = mergeCurveHistory(existing, incoming);
  atomicWrite(serializeCurve(merged));
  const latestDate = merged.at(-1)?.data_ref;
  console.log(
    `HDL ${HDL_COLLECTOR_VERSION} · ${merged.length} linhas gravadas · curva mais recente ${latestDate}`
  );
}

if (SELFTEST) {
  selfTest();
  console.log("HDL collector self-test: OK");
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`HDL collector: ${error.message}`);
    process.exitCode = 1;
  });
}
