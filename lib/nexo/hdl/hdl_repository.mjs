import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const HDL_CURVE_PATH = join(process.cwd(), "data", "goldberg", "hdl_curva.csv");

function csvNumber(value) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function parseHdlCurveCsv(content) {
  const lines = String(content || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const header = lines[0].split(",").map((field) => field.trim());
  const expected = ["data_ref", "vertice_anos", "taxa_real_pct", "fonte", "status"];
  if (expected.some((field, index) => header[index] !== field)) {
    throw new Error("hdl_curve_invalid_header");
  }

  return lines.slice(1).map((line, index) => {
    const columns = line.split(",").map((field) => field.trim());
    const row = {
      data_ref: columns[0],
      vertice_anos: csvNumber(columns[1]),
      taxa_real_pct: csvNumber(columns[2]),
      fonte: columns[3],
      status: columns[4],
    };
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(row.data_ref) ||
      row.vertice_anos === null ||
      row.taxa_real_pct === null ||
      !row.fonte ||
      !row.status
    ) {
      throw new Error(`hdl_curve_invalid_row_${index + 2}`);
    }
    return row;
  });
}

export function loadHdlCurve(path = HDL_CURVE_PATH) {
  try {
    const curve = parseHdlCurveCsv(readFileSync(path, "utf8"));
    if (!curve.length) throw new Error("hdl_curve_empty");
    const latestDate = curve.reduce(
      (latest, row) => (row.data_ref > latest ? row.data_ref : latest),
      curve[0].data_ref
    );
    const latest = curve.filter((row) => row.data_ref === latestDate);
    return {
      ok: true,
      curve,
      latest,
      asOf: latestDate,
      rows: curve.length,
      vertices: latest.length,
      maxVertexYears: Math.max(...latest.map((row) => row.vertice_anos)),
      source: latest[0]?.fonte || null,
      status: latest.every((row) => row.status === "official") ? "official" : "mixed",
    };
  } catch (error) {
    return {
      ok: false,
      curve: [],
      latest: [],
      asOf: null,
      rows: 0,
      vertices: 0,
      maxVertexYears: null,
      source: null,
      status: "unavailable",
      error: error?.message || "hdl_curve_unavailable",
    };
  }
}

export function selfTest() {
  const fixture = [
    "data_ref,vertice_anos,taxa_real_pct,fonte,status",
    "2026-09-03,5,7.5,anbima_ettj,official",
    "2026-09-04,5,7.4,anbima_ettj,official",
    "2026-09-04,10,7.2,anbima_ettj,official",
  ].join("\n");
  const rows = parseHdlCurveCsv(fixture);
  if (rows.length !== 3 || rows[2].vertice_anos !== 10 || rows[2].taxa_real_pct !== 7.2) {
    throw new Error("hdl_repository_parse_failed");
  }
  let rejected = false;
  try {
    parseHdlCurveCsv("vertice,taxa\n5,7.2");
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("hdl_repository_header_guard_failed");
  return true;
}

if (
  process.env.NEXO_SELFTEST === "1" &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1]
) {
  selfTest();
  console.log("HDL repository self-test: OK");
}
