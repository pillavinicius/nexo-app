export const dynamic = "force-dynamic";

import { getLatestContext } from "../../../../../lib/nmi/get_latest_context.mjs";

export async function GET() {
  const result = getLatestContext();

  if (result.ok) {
    return Response.json(result.contextPackage, {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
        "X-NEXO-Context-Id": result.meta.contextId,
        "X-NEXO-Context-Status": result.status,
      },
    });
  }

  return Response.json(
    {
      status: "unavailable",
      error: "context_package_unavailable",
      reason: result.reason,
    },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
