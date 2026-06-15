import { NextResponse } from "next/server";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const ticker =
      (searchParams.get("ticker") || "BBSE3")
        .toUpperCase()
        .trim();

    const hgKey = process.env.HG_BRASIL_KEY;

    const url = new URL(
      "https://api.hgbrasil.com/v2/finance/history"
    );

    url.searchParams.set("tickers", `B3:${ticker}`);
    url.searchParams.set("key", hgKey);

    const response = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store"
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      ticker,
      requestUrl: url
        .toString()
        .replace(hgKey, "***"),
      raw: data
    });

  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error.message
    });
  }
}
