export const dynamic = "force-dynamic";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadHdlCurve } from "../../../lib/nexo/hdl/hdl_repository.mjs";
import { computeNFI } from "../../../lib/nexo/nfi/nfi_engine.mjs";
import { loadNfiFlow } from "../../../lib/nexo/nfi/nfi_repository.mjs";

function readMacroStatus() {
  try {
    const content = readFileSync(
      join(process.cwd(), "data", "nexo_macro.csv"),
      "utf8"
    );
    const rows = content.trim() ? content.trim().split("\n").length - 1 : 0;
    return {
      available: rows > 0,
      rows,
    };
  } catch {
    return {
      available: false,
      rows: 0,
    };
  }
}

function readContext() {
  try {
    return JSON.parse(
      readFileSync(
        join(process.cwd(), "data", "context", "latest.json"),
        "utf8"
      )
    );
  } catch {
    return null;
  }
}

export async function GET() {
  const macro = readMacroStatus();
  const context = readContext();
  const hdl = loadHdlCurve();
  const nfiRepository = loadNfiFlow();
  const nfi = computeNFI({ fluxo: nfiRepository.rows });

  const contextReadable =
    typeof context?.contextSchemaVersion === "string" &&
    typeof context?.context_id === "string";

  const ready = macro.available && contextReadable && hdl.ok && nfiRepository.ok;
  const commit = process.env.VERCEL_GIT_COMMIT_SHA || "local";

  return Response.json(
    {
      status: ready ? "ok" : "degraded",
      service: "nexo-app",
      checkedAt: new Date().toISOString(),
      build: {
        commit: commit === "local" ? commit : commit.slice(0, 12),
        environment: process.env.VERCEL_ENV || "local",
      },
      data: {
        macro,
        context: {
          available: contextReadable,
          schemaVersion: context?.contextSchemaVersion || null,
          contextId: context?.context_id || null,
          asOf: context?.as_of || null,
          isSeedMode: context?.is_seed_mode ?? null,
          overallConfidence: context?.quality?.overall_confidence ?? null,
        },
        hdl: {
          available: hdl.ok,
          version: "HDL_v1.0",
          asOf: hdl.asOf,
          rows: hdl.rows,
          vertices: hdl.vertices,
          maxVertexYears: hdl.maxVertexYears,
          source: hdl.source,
          sourceStatus: hdl.status,
          error: hdl.error || null,
        },
        nfi: {
          available: nfiRepository.ok,
          version: nfi.version,
          status: nfi.status,
          asOf: nfi.source_as_of,
          windowReferenceDate: nfi.window_reference_date,
          historyMonths: nfi.history_months,
          historyComplete: nfi.history_complete,
          source: nfi.source,
          sourceStatus: nfi.status_fonte,
          error: nfiRepository.error || null,
        },
      },
    },
    {
      status: ready ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
