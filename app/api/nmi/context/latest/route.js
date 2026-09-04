export const dynamic = "force-dynamic";

import { readFileSync } from "node:fs";
import { join } from "node:path";

export async function GET() {
  try {
    const content = readFileSync(
      join(process.cwd(), "data", "context", "latest.json"),
      "utf8"
    );
    JSON.parse(content);
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
      },
    });
  } catch {
    return Response.json(
      { status: "unavailable", error: "context_package_unavailable" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}
