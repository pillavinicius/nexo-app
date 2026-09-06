#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createDatabaseClient } from "../../lib/nexo/biblioteca/database.mjs";

const migrationPath = join(process.cwd(), "db", "migrations", "001_biblioteca_b1.sql");
const source = await readFile(migrationPath, "utf8");
const statements = source.split(/^-- statement-breakpoint\s*$/m).map((statement) => statement.trim()).filter(Boolean);
const client = createDatabaseClient();

for (const statement of statements) await client.query(statement);
console.log(`Biblioteca B1: ${statements.length} comandos aplicados · 001_biblioteca_b1`);
