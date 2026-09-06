export const dynamic = "force-dynamic";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadHdlCurve } from "../../../lib/nexo/hdl/hdl_repository.mjs";

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

  const contextReadable =
    typeof context?.contextSchemaVersion === "string" &&
    typeof context?.context_id === "string";

  const ready = macro.available && contextReadable && hdl.ok;
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
