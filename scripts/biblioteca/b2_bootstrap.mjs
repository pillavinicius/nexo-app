#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createDatabaseClient } from "../../lib/nexo/biblioteca/database.mjs";
import { proveIpeDeduplication } from "../../lib/nexo/biblioteca/ipe_ingestion.mjs";

const universe = JSON.parse(await readFile(join(process.cwd(), "data", "biblioteca", "universo.json"), "utf8"));
const result = await proveIpeDeduplication({ client: createDatabaseClient(), universe });
console.log(`Biblioteca B2: dedup=${result.dedupProvada} · baixados=${result.baixados} · inseridos=${result.inseridos} · existentes=${result.jaExistentes}`);
