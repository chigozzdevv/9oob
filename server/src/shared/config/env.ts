import type { DatabaseConfig } from "../database/database.types.js";

export type ServerConfig = { openAiApiKey: string; openAiModel: string; database: DatabaseConfig };

export class ConfigurationError extends Error {}

export function readDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const mode = env.DB_MODE?.trim();
  const uri = env.DB_URI?.trim();
  if (mode !== "mongodb" && mode !== "postgres") throw new ConfigurationError("DB_MODE must be mongodb or postgres");
  if (!uri) throw new ConfigurationError("DB_URI is required by the 9oob server");
  if (mode === "mongodb" ? !/^mongodb(?:\+srv)?:\/\//.test(uri) : !/^postgres(?:ql)?:\/\//.test(uri))
    throw new ConfigurationError("DB_URI does not match DB_MODE");
  return { mode, uri };
}

export function readServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const openAiApiKey = env.OPENAI_API_KEY?.trim();
  if (!openAiApiKey) throw new ConfigurationError("OPENAI_API_KEY is required by the 9oob server");
  return { openAiApiKey, openAiModel: env.OPENAI_MODEL?.trim() || "gpt-6-luna", database: readDatabaseConfig(env) };
}
