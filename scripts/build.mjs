import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const SOURCE_DIRECTORIES = ["src", "test", "bin"];
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", ".acceptance"]);

function listJavaScriptFiles(directory) {
  let entries;
  try { entries = readdirSync(directory); } catch { return []; }
  return entries.flatMap((entry) => {
    if (SKIPPED_DIRECTORIES.has(entry)) return [];
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return listJavaScriptFiles(path);
    return /\.(c|m)?js$/.test(entry) ? [path] : [];
  });
}

const files = SOURCE_DIRECTORIES.flatMap(listJavaScriptFiles);
for (const file of files) execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
console.log(`build: syntax-checked ${files.length} file(s)`);
