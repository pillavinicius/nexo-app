import { renderNexoReportPdf } from "../../../../lib/reporting/nexo_pdf_report.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 800_000;

function safeFilenamePart(value) {
  return String(value || "ATIVO")
    .toUpperCase()
    .replace(/[^A-Z0-9._-]/g, "_")
    .slice(0, 32);
}

function jsonError(message, status) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function POST(request) {
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
      return jsonError("Relatório excede o tamanho máximo permitido.", 413);
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return jsonError("Conteúdo inválido para exportação.", 400);
    }

    if (!payload?.ticker || !payload?.scan || !payload?.final) {
      return jsonError("Conclua a análise antes de exportar o PDF.", 400);
    }

    const pdf = await renderNexoReportPdf(payload);
    const date = new Date().toISOString().slice(0, 10);
    const filename = `NEXO_${safeFilenamePart(payload.ticker)}_${date}.pdf`;

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[NEXO PDF]", error);
    return jsonError("Não foi possível gerar o PDF. Tente novamente.", 500);
  }
}
