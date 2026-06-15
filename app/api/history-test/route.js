import { NextResponse } from "next/server";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const ticker =
      (searchParams.get("ticker") || "BBSE3")
        .toUpperCase()
        .trim();

    const hgKey =
      process.env.HG_API_KEY ||
      process.env.HGBRASIL_API_KEY ||
      process.env.HG_BRASIL_API_KEY;

    if (!hgKey) {
      return NextResponse.json({
        ok: false,
        error: "HG_API_KEY não encontrada"
      });
    }

    const url =
      `https://api.hgbrasil.com/v2/finance/history` +
      `?tickers=B3:${ticker}` +
      `&key=${hgKey}`;

    const response = await fetch(url, {
      cache: "no-store"
    });

    const data = await response.json();

    return NextResponse.json({
      ok: true,
      ticker,
      request: url.replace(hgKey, "***"),
      raw: data
    });

  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error.message
    });
  }
}
