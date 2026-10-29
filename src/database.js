import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, runMigrations } from "./migrations.js";

export function openDatabase(databasePath) {
  const database = new DatabaseSync(databasePath);
  runMigrations(database, MIGRATIONS);
  return database;
}
