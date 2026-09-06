export const dynamic = "force-dynamic";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadHdlCurve } from "../../../lib/nexo/hdl/hdl_repository.mjs";
import { computeNFI } from "../../../lib/nexo/nfi/nfi_engine.mjs";
import { loadNfiFlow } from "../../../lib/nexo/nfi/nfi_repository.mjs";
import { bibliotecaDatabaseHealth } from "../../../lib/nexo/biblioteca/database.mjs";
import { createDatabaseClient } from "../../../lib/nexo/biblioteca/database.mjs";
import { createBibliotecaRepository } from "../../../lib/nexo/biblioteca/repository.mjs";

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

function readBibliotecaB0() {
  try {
    const report = JSON.parse(
      readFileSync(
        join(process.cwd(), "data", "biblioteca", "b0_formatos_2025_2026.json"),
        "utf8"
      )
    );
    return {
      available: report?.version === "BIB_B0_v1.0" && report?.sample_completed > 0,
      version: report?.version || null,
      generatedAt: report?.generated_at || null,
      years: report?.years || [],
      datasetRows: report?.dataset_rows || 0,
      sampleCompleted: report?.sample_completed || 0,
      sampleFailed: report?.sample_failed || 0,
      categoriesSampled: report?.categories_sampled || 0,
      detectedFormats: report?.distribution?.detected_format || {},
      contentTypeMagicMismatches: report?.distribution?.content_type_magic_mismatches || 0,
      decisionB3: report?.decision_b3 || null,
    };
  } catch {
    return {
      available: false,
      version: null,
      generatedAt: null,
      years: [],
      datasetRows: 0,
      sampleCompleted: 0,
      sampleFailed: 0,
      categoriesSampled: 0,
      detectedFormats: {},
      contentTypeMagicMismatches: 0,
      decisionB3: null,
    };
  }
}

async function readBibliotecaB2(b1) {
  if (!b1.available) return { available: false, version: "BIB_B2_v1.0", status: "database_unavailable" };
  try {
    const repository = createBibliotecaRepository(createDatabaseClient());
    const [latestRun, documents] = await Promise.all([
      repository.latestIngestionRun(),
      repository.countDocuments({ fonte: "cvm_ipe" }),
    ]);
    return {
      available: latestRun?.status === "ok" && latestRun?.dedup_provada === true,
      version: "BIB_B2_v1.0",
      status: latestRun?.status || "not_run",
      source: "cvm_ipe",
      documents,
      latestRun: latestRun ? {
        runId: latestRun.run_id,
        completedAt: latestRun.concluido_em,
        discovered: latestRun.descobertos,
        alreadyExisting: latestRun.ja_existentes,
        downloaded: latestRun.baixados,
        inserted: latestRun.inseridos,
        failures: latestRun.falhas,
        bytesDownloaded: Number(latestRun.bytes_baixados || 0),
        dedupProven: latestRun.dedup_provada,
      } : null,
    };
  } catch {
    return { available: false, version: "BIB_B2_v1.0", status: "unavailable" };
  }
}

export async function GET() {
  const macro = readMacroStatus();
  const context = readContext();
  const hdl = loadHdlCurve();
  const nfiRepository = loadNfiFlow();
  const nfi = computeNFI({ fluxo: nfiRepository.rows });
  const bibliotecaB0 = readBibliotecaB0();
  const bibliotecaB1 = await bibliotecaDatabaseHealth();
  const bibliotecaB2 = await readBibliotecaB2(bibliotecaB1);

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
        bibliotecaB0,
        bibliotecaB1,
        bibliotecaB2,
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
