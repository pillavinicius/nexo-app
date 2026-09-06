import { readFileSync } from "node:fs";
import { join } from "node:path";

export const NFI_FLOW_PATH = join(process.cwd(), "data", "goldberg", "nfi_fluxo.csv");

export function parseNfiCsv(content) {
  const lines = String(content || "").trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const columns = line.split(",");
    const row = Object.fromEntries(header.map((name, index) => [name, columns[index]]));
    return { ...row, fluxo_liquido_brl: Number(row.fluxo_liquido_brl) };
  }).filter((row) => Number.isFinite(row.fluxo_liquido_brl));
}

export function loadNfiFlow(path = NFI_FLOW_PATH) {
  try {
    const rows = parseNfiCsv(readFileSync(path, "utf8"));
    return { ok: rows.length > 0, rows, path };
  } catch (error) {
    return { ok: false, rows: [], path, error: error.message };
  }
}

if (process.env.NEXO_SELFTEST === "1") {
  const loaded = loadNfiFlow();
  if (!loaded.ok || loaded.rows.length < 1) throw new Error("NFI repository failed");
  console.log("NFI repository self-test: OK");
}
