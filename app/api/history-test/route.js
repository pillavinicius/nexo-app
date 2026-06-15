import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    HG_BRASIL_KEY: !!process.env.HG_BRASIL_KEY,
    TWELVEDATA_API_KEY: !!process.env.TWELVEDATA_API_KEY,
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY
  });
}
