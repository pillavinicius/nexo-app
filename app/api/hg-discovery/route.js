import { NextResponse } from "next/server";

export async function GET() {
  const HG_API_KEY = process.env.HG_BRASIL_KEY;

  const endpoints = [
    "balance-sheets",
    "income-statements",
    "income-statement",
    "cash-flows",
    "cash-flow",
    "financial-statements",
    "fundamentals",
    "reports"
  ];

  const results = [];

  for (const endpoint of endpoints) {
    try {
      const url =
        `https://api.hgbrasil.com/v2/finance/${endpoint}` +
        `?tickers=B3:BBSE3&key=${HG_API_KEY}`;

      const response = await fetch(url);

      const text = await response.text();

      results.push({
        endpoint,
        status: response.status,
        preview: text.substring(0, 300)
      });
    } catch (error) {
      results.push({
        endpoint,
        error: error.message
      });
    }
  }

  return NextResponse.json(results);
}
