import { neon } from "@neondatabase/serverless";

export const BIBLIOTECA_DB_VERSION = "BIB_DB_v1.0";
export const BIBLIOTECA_SCHEMA_VERSION = "001_biblioteca_b1";

export function databaseConfiguration(env = process.env) {
  const connectionString = String(env.DATABASE_URL || "").trim();
  return {
    provider: "neon_postgres",
    configured: connectionString.startsWith("postgres://") || connectionString.startsWith("postgresql://"),
    connectionString,
  };
}

export function createDatabaseClient({ connectionString = databaseConfiguration().connectionString } = {}) {
  if (!connectionString || !/^postgres(ql)?:\/\//.test(connectionString)) {
    throw new Error("biblioteca_database_not_configured");
  }
  const sql = neon(connectionString);
  return { query: (text, params = []) => sql.query(text, params) };
}

export async function bibliotecaDatabaseHealth({ client, env = process.env } = {}) {
  const configuration = databaseConfiguration(env);
  if (!configuration.configured && !client) {
    return {
      available: false,
      configured: false,
      provider: configuration.provider,
      version: BIBLIOTECA_DB_VERSION,
      schemaVersion: null,
      status: "not_configured",
    };
  }
  try {
    const database = client || createDatabaseClient({ connectionString: configuration.connectionString });
    const rows = await database.query(
      "SELECT version FROM biblioteca.schema_migrations WHERE version = $1 LIMIT 1",
      [BIBLIOTECA_SCHEMA_VERSION]
    );
    const schemaVersion = rows?.[0]?.version || null;
    return {
      available: schemaVersion === BIBLIOTECA_SCHEMA_VERSION,
      configured: true,
      provider: configuration.provider,
      version: BIBLIOTECA_DB_VERSION,
      schemaVersion,
      status: schemaVersion ? "ready" : "migration_required",
    };
  } catch {
    return {
      available: false,
      configured: true,
      provider: configuration.provider,
      version: BIBLIOTECA_DB_VERSION,
      schemaVersion: null,
      status: "unavailable",
      error: "biblioteca_database_unavailable",
    };
  }
}
