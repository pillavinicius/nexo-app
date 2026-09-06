import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { parseNfiCsv } from "../../lib/nexo/nfi/nfi_repository.mjs";

export const NFI_SOURCE_URL = "https://sistemaswebb3-listados.b3.com.br/marketDataProxy/MarketDataCall/GetDownloadMarketData/RELATORIO_DADOS_DE_MERCADO.csv";
export const NFI_OUTPUT_PATH = join(process.cwd(), "data", "goldberg", "nfi_fluxo.csv");

const MONTHS = Object.freeze({ Jan: 1, Fev: 2, Mar: 3, Abr: 4, Mai: 5, Jun: 6, Jul: 7, Ago: 8, Set: 9, Out: 10, Nov: 11, Dez: 12 });

function monthEnd(year, month) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function brNumber(value) {
  const number = Number(String(value).trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

export function parseB3ForeignFlowReport(text) {
  const source = String(text || "").replace(/\r/g, "");
  const start = source.indexOf("Movimentação dos Investidores Estrangeiros Mensal");
  if (start < 0) throw new Error("Seção mensal de investidores estrangeiros não encontrada");
  const section = source.slice(start);
  const cutoffMatch = section.match(/\(\*\) Até dia\s+(\d{1,2})\s+([A-Z][a-z]{2})/);
  const cutoffDay = cutoffMatch ? Number(cutoffMatch[1]) : null;
  const cutoffMonth = cutoffMatch ? MONTHS[cutoffMatch[2]] : null;
  const rows = [];

  for (const line of section.split("\n")) {
    const match = line.match(/^([A-Z][a-z]{2})\/[A-Z][a-z]{2}\/(\d{4});[^;]*;[^;]*;[^;]*;([^;\n]+)$/);
    if (!match) continue;
    const month = MONTHS[match[1]];
    const year = Number(match[2]);
    const balanceMillions = brNumber(match[3]);
    if (!month || !year || balanceMillions === null) continue;
    const currentPartial = month === cutoffMonth && cutoffDay !== null && rows.every((row) => row.data_ref.slice(0, 7) !== `${year}-${String(month).padStart(2, "0")}`);
    rows.push({
      data_ref: currentPartial
        ? `${year}-${String(month).padStart(2, "0")}-${String(cutoffDay).padStart(2, "0")}`
        : monthEnd(year, month),
      segmento: "acoes",
      fluxo_liquido_brl: Math.round(balanceMillions * 1_000_000),
      tipo_investidor: "estrangeiro",
      status: "t2_official",
    });
  }
  if (!rows.length) throw new Error("Nenhuma observação mensal válida encontrada");
  return rows.sort((a, b) => a.data_ref.localeCompare(b.data_ref));
}

function mergeByMonth(existing, incoming) {
  const merged = new Map();
  for (const row of [...existing, ...incoming]) {
    const key = `${row.data_ref.slice(0, 7)}|${row.segmento}|${row.tipo_investidor}`;
    const previous = merged.get(key);
    if (!previous || row.data_ref >= previous.data_ref) merged.set(key, row);
  }
  return [...merged.values()].sort((a, b) => a.data_ref.localeCompare(b.data_ref));
}

function serialize(rows) {
  return [
    "data_ref,segmento,fluxo_liquido_brl,tipo_investidor,status",
    ...rows.map((row) => [row.data_ref, row.segmento, row.fluxo_liquido_brl, row.tipo_investidor, row.status].join(",")),
    "",
  ].join("\n");
}

export async function collectNfi({ fetchImpl = fetch, outputPath = NFI_OUTPUT_PATH, dryRun = false } = {}) {
  const response = await fetchImpl(NFI_SOURCE_URL, { headers: { "User-Agent": "NEXO-NFI-Collector/1.0" } });
  if (!response.ok) throw new Error(`B3 HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const text = new TextDecoder("iso-8859-1").decode(bytes);
  const incoming = parseB3ForeignFlowReport(text);
  let existing = [];
  try { existing = parseNfiCsv(await readFile(outputPath, "utf8")); } catch {}
  const merged = mergeByMonth(existing, incoming);
  if (!dryRun) {
    await mkdir(dirname(outputPath), { recursive: true });
    const tempPath = `${outputPath}.tmp`;
    await writeFile(tempPath, serialize(merged), "utf8");
    await rename(tempPath, outputPath);
  }
  return { rows: merged, latest: merged.at(-1), source: NFI_SOURCE_URL };
}

function selfTest() {
  const fixture = [
    "Movimentação dos Investidores Estrangeiros Mensal (R$ Milhões)",
    "Mês / Month;Compras;Vendas;IPO;Saldo",
    "Ago/Aug/2026;1,0;2,0;0,0;-1,0",
    "Set/Sep/2026;5,0;2,0;0,0;3,0",
    "2026(*);0;0;0;0",
    "(*) Até dia 2 Set - Until Sep 2",
  ].join("\n");
  const rows = parseB3ForeignFlowReport(fixture);
  if (rows.length !== 2 || rows[0].fluxo_liquido_brl !== -1_000_000 || rows[1].data_ref !== "2026-09-02") {
    throw new Error("NFI B3 parser self-test failed");
  }
  console.log("NFI collector self-test: OK");
}

if (process.env.NEXO_SELFTEST === "1") selfTest();
else if (import.meta.url === `file://${process.argv[1]}`) {
  collectNfi({ dryRun: process.argv.includes("--dry-run") })
    .then((result) => console.log(`NFI: ${result.rows.length} observações · última ${result.latest.data_ref}`))
    .catch((error) => { console.error(`NFI collector: ${error.message}`); process.exitCode = 1; });
}
