import { DatabaseSync } from "node:sqlite";
import { listSlugs, readPage } from "./pages.js";

const migrations = [
  `CREATE TABLE pages (slug TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL);
   CREATE TABLE tags (slug TEXT NOT NULL REFERENCES pages(slug) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY (slug, tag));
   CREATE VIRTUAL TABLE pages_fts USING fts5(slug UNINDEXED, title, body);`,
];

export class WikiIndex {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON; CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);");
    if (this.db.prepare("SELECT COUNT(*) AS count FROM schema_version").get().count === 0) this.db.exec("INSERT INTO schema_version (version) VALUES (0)");
    let version = this.db.prepare("SELECT version FROM schema_version").get().version;
    while (version < migrations.length) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(migrations[version]);
        version += 1;
        this.db.prepare("UPDATE schema_version SET version = ?").run(version);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  sync(pagesDir) {
    const slugs = listSlugs(pagesDir);
    this.db.exec("BEGIN");
    try {
      const seen = new Set(slugs);
      for (const row of this.db.prepare("SELECT slug FROM pages").all()) if (!seen.has(row.slug)) this.remove(row.slug);
      for (const slug of slugs) this.upsert(readPage(pagesDir, slug));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  upsert(page) {
    this.db.prepare("INSERT INTO pages (slug, title, body) VALUES (?, ?, ?) ON CONFLICT(slug) DO UPDATE SET title=excluded.title, body=excluded.body").run(page.slug, page.title, page.body);
    this.db.prepare("DELETE FROM tags WHERE slug = ?").run(page.slug);
    const tag = this.db.prepare("INSERT INTO tags (slug, tag) VALUES (?, ?)");
    for (const value of page.tags) tag.run(page.slug, value);
    this.db.prepare("DELETE FROM pages_fts WHERE slug = ?").run(page.slug);
    this.db.prepare("INSERT INTO pages_fts (slug, title, body) VALUES (?, ?, ?)").run(page.slug, page.title, page.body);
  }

  remove(slug) {
    this.db.prepare("DELETE FROM pages WHERE slug = ?").run(slug);
    this.db.prepare("DELETE FROM pages_fts WHERE slug = ?").run(slug);
  }

  search(query) {
    const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (!terms.length) return [];
    const match = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" AND ");
    return this.db.prepare(`SELECT p.slug, p.title, p.body, -bm25(pages_fts, 10.0, 1.0) AS score
      FROM pages_fts JOIN pages p ON p.slug = pages_fts.slug WHERE pages_fts MATCH ?
      ORDER BY score DESC, p.slug ASC LIMIT 20`).all(match);
  }

  allTags() {
    return this.db.prepare("SELECT tag, COUNT(*) AS count FROM tags GROUP BY tag ORDER BY count DESC, tag ASC").all();
  }

  pagesWithTag(tag) {
    return this.db.prepare("SELECT p.slug, p.title FROM tags t JOIN pages p ON p.slug = t.slug WHERE t.tag = ? COLLATE NOCASE ORDER BY p.slug ASC").all(tag.toLowerCase());
  }

  close() { this.db.close(); }
}
