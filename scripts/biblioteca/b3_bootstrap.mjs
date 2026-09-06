#!/usr/bin/env node

import { createDatabaseClient } from "../../lib/nexo/biblioteca/database.mjs";
import { parsePendingDocuments } from "../../lib/nexo/biblioteca/document_parser.mjs";
import { createBibliotecaRepository } from "../../lib/nexo/biblioteca/repository.mjs";

const repository = createBibliotecaRepository(createDatabaseClient());
const result = await parsePendingDocuments({ repository, limit: 20 });
if (result.failed > 0) throw new Error(`Biblioteca B3: ${result.failed} documento(s) falharam no parse`);
console.log(`Biblioteca B3: pendentes=${result.discovered} · processados=${result.parsed} · não suportados=${result.unsupported}`);
