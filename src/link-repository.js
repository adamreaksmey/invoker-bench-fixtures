const SELECT_LINK_SQL = "SELECT code, url, created_at_ms FROM links WHERE code = ?";
const SELECT_LINK_EXISTS_SQL = "SELECT 1 AS link_exists FROM links WHERE code = ?";
const INSERT_LINK_SQL = "INSERT INTO links (code, url, created_at_ms) VALUES (?, ?, ?)";

function toLink(row) {
  return { code: row.code, url: row.url, createdAt: new Date(row.created_at_ms).toISOString() };
}

export function createLinkRepository(database) {
  const selectLink = database.prepare(SELECT_LINK_SQL);
  const selectLinkExists = database.prepare(SELECT_LINK_EXISTS_SQL);
  const insertLink = database.prepare(INSERT_LINK_SQL);

  return {
    findByCode(code) {
      const row = selectLink.get(code);
      return row ? toLink(row) : null;
    },
    hasCode(code) {
      return selectLinkExists.get(code) !== undefined;
    },
    create({ code, url, createdAtMs }) {
      insertLink.run(code, url, createdAtMs);
      return { code, url, createdAt: new Date(createdAtMs).toISOString() };
    },
  };
}
