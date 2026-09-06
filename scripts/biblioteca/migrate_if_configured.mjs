#!/usr/bin/env node

import { databaseConfiguration } from "../../lib/nexo/biblioteca/database.mjs";

const configuration = databaseConfiguration();

if (!configuration.configured) {
  if (process.env.VERCEL) {
    throw new Error("Biblioteca B1: DATABASE_URL obrigatória no deploy Vercel");
  }
  console.log("Biblioteca B1: migração ignorada fora da Vercel sem DATABASE_URL");
} else {
  await import("./migrate.mjs");
  await import("./b2_bootstrap.mjs");
  await import("./b3_bootstrap.mjs");
  await import("../tdn_bootstrap.mjs");
}
