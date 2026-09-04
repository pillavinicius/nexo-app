#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  assetPrefill,
  displayInputNumber,
  displayMoney,
  compactAssetContext,
  displayNumber,
  monthYear,
} from "../lib/ui/asset_market_adapter.mjs";
import {
  mergeMacroData,
  nmiContextToMacroData,
} from "../lib/ui/nmi_macro_adapter.mjs";

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
assert.equal(displayNumber(42.129), "42,13");
assert.equal(displayNumber(null), "");
assert.equal(displayInputNumber(42.129, "USD"), "42.13");
assert.equal(displayMoney(42.129, "BRL"), "R$ 42,13");
assert.equal(displayMoney(42.129, "USD"), "USD 42.13");
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

const nmiMacro = nmiContextToMacroData({
  contextSchemaVersion: "1.2",
  context_id: "ctx_test",
  as_of: "2026-09-04T18:00:00Z",
  market_close_date: "2026-09-04",
  is_seed_mode: false,
  source_observations: {
    selic_target: { provider: "BCB_SGS", series_code: 432, status: "official", observed_at: "2026-09-04", value: 14, unit: "percent_per_year" },
    ipca_12m: { provider: "BCB_SGS", series_code: 13522, status: "official", observed_at: "2026-07-01", value: 4.44, unit: "percent_12m" },
    credit_gdp: { provider: "BCB_SGS", series_code: 20622, status: "official", observed_at: "2026-07-01", value: 0.5557, unit: "fraction_of_gdp" },
  },
  quality: { overall_confidence: 0.41 },
});

assert.equal(nmiMacro.nmi.contextId, "ctx_test");
assert.equal(nmiMacro.automatic.selic_meta.value, 14);
assert.equal(nmiMacro.automatic.ipca_12m.value, 4.44);
assert.equal(nmiMacro.automatic.credit_gdp.value, 55.57);

const mergedMacro = mergeMacroData(nmiMacro, {
  ok: true,
  automatic: {
    selic_meta: { ok: true, value: 14.25, source: "snapshot antigo" },
    usd_ptax: { ok: true, value: 5.12, source: "BCB PTAX" },
  },
});
assert.equal(mergedMacro.automatic.selic_meta.value, 14);
assert.equal(mergedMacro.automatic.usd_ptax.value, 5.12);

const seedMacro = nmiContextToMacroData({
  ...{
    context_id: "ctx_seed",
    is_seed_mode: true,
    source_observations: {
      selic_target: { provider: "seed", series_code: 432, status: "official", observed_at: "2026-09-04", value: 14 },
    },
  },
});
assert.equal(seedMacro.nmi.status, "seed");
assert.equal(seedMacro.automatic.selic_meta.ok, false);

console.log("PASS asset + NMI macro adapters: 23 assercoes");
