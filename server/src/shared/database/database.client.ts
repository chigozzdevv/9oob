import type { Database, DatabaseConfig } from "./database.types.js";
import { MongoDatabase } from "./mongodb.client.js";
import { PostgresDatabase } from "./postgres.client.js";

export function openDatabase(config: DatabaseConfig): Database {
  return config.mode === "mongodb" ? MongoDatabase.connect(config.uri) : PostgresDatabase.connect(config.uri);
}
