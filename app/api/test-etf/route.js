import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.TWELVE_DATA_API_KEY;

  const symbols = [
    "VOO",
    "VTI",
    "VXUS",
    "SGOV",
    "SCHD",
    "JEPI",
    "XLE"
  ];

  const results = [];

  for (const symbol of symbols) {
    try {
      const response = await fetch(
        `https://api.twelvedata.com/etf?symbol=${symbol}&apikey=${apiKey}`
      );

      const data = await response.json();

      results.push({
        symbol,
        success: !data.code,
        keys: Object.keys(data),
        sample: data,
      });
    } catch (error) {
      results.push({
        symbol,
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro desconhecido",
      });
    }
  }

  return NextResponse.json({
    provider: "Twelve Data",
    testedSymbols: symbols,
    results,
  });
}
