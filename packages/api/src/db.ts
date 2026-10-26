import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "./migrations";

/** Open the local SQLite database and bring its schema up to date. */
export function openDatabase(filename: string): DatabaseSync {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  return db;
}
