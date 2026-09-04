#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  assetPrefill,
  compactAssetContext,
  displayNumber,
  monthYear,
} from "../lib/ui/asset_market_adapter.mjs";

const sample = {
  ok: true,
  requestedTicker: "BBSE3",
  route: "B3_HG_BRASIL",
  updatedAt: "2026-09-04T16:30:00Z",
  asset: {
    dataProvider: "HG Brasil",
    ticker: "BBSE3",
    name: "BB Seguridade",
    assetType: "stock",
    currency: "BRL",
    price: 42.12,
    changePercent: 1.03,
    market: { open: 41.74, high: 42.16, low: 41.38, volume: 2153800 },
  },
  keyIndicators: { pe: 8.87, pb: 7.48, dividendYieldPercent: 10.84 },
  derived: {
    currentPrice: 42.12,
    minPrice: 31.53,
    minDate: "2025-08-21",
    maxPrice: 42.99,
    maxDate: "2026-09-03",
  },
  derivedAdvanced: { sharpeRatio: -0.58 },
  nexoMetrics: { liquidityHint: "alta" },
};

assert.equal(displayNumber(42.12), "42,12");
assert.equal(displayNumber(null), "");
assert.equal(monthYear("2025-08-21"), "08/25");
assert.deepEqual(assetPrefill(sample), {
  currentPrice: "42,12",
  currency: "BRL",
  histMin: "31,53",
  histMinDate: "08/25",
  histMax: "42,99",
  histMaxDate: "09/26",
});

const compact = compactAssetContext(sample);
assert.equal(compact.ticker, "BBSE3");
assert.equal(compact.provider, "HG Brasil");
assert.equal(compact.price, 42.12);
assert.equal(compact.indicators.pe, 8.87);
assert.equal(compact.risk.sharpeRatio, -0.58);
assert.equal(compactAssetContext({ ok: false }), null);

console.log("PASS asset market adapter: 11 assercoes");
