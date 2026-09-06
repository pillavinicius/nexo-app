#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { createDatabaseClient } from "../../lib/nexo/biblioteca/database.mjs";

const migrationDirectory = join(process.cwd(), "db", "migrations");
const migrations = (await readdir(migrationDirectory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
const client = createDatabaseClient();

let statementCount = 0;
for (const migration of migrations) {
  const source = await readFile(join(migrationDirectory, migration), "utf8");
  const statements = source.split(/^-- statement-breakpoint\s*$/m).map((statement) => statement.trim()).filter(Boolean);
  for (const statement of statements) await client.query(statement);
  statementCount += statements.length;
}
console.log(`Biblioteca: ${statementCount} comandos aplicados · ${migrations.join(", ")}`);
