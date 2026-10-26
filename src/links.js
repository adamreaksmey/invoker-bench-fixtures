import { randomBytes } from "node:crypto";

const CODE_LENGTH = 6;
const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const MAX_CODE_GENERATION_ATTEMPTS = 16;
const UTC_DATE_LENGTH = 10;

export function generateCode() {
  const bytes = randomBytes(CODE_LENGTH);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

export function createLinksRepository(database) {
  const insertLink = database.prepare(
    "INSERT INTO links (code, url, created_at) VALUES (?, ?, ?)",
  );
  const selectLink = database.prepare(
    "SELECT code, url, created_at AS createdAt FROM links WHERE code = ?",
  );
  const insertClick = database.prepare(
    "INSERT INTO clicks (code, clicked_at, referer) VALUES (?, ?, ?)",
  );
  const selectClicks = database.prepare(
    "SELECT clicked_at AS clickedAt FROM clicks WHERE code = ? ORDER BY clicked_at ASC",
  );

  function findByCode(code) {
    return selectLink.get(code) ?? null;
  }

  function codeExists(code) {
    return findByCode(code) !== null;
  }

  function allocateCode() {
    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt += 1) {
      const code = generateCode();
      if (!codeExists(code)) return code;
    }
    throw new Error("failed to allocate a unique short code");
  }

  function createLink({ url, code, createdAt }) {
    insertLink.run(code, url, createdAt);
    return { code, url, createdAt };
  }

  function recordClick({ code, clickedAt, referer }) {
    insertClick.run(code, clickedAt, referer);
  }

  function getStats(code) {
    const link = findByCode(code);
    if (!link) return null;

    const clicks = selectClicks.all(code);
    const clicksByDay = {};
    for (const click of clicks) {
      const dayKey = click.clickedAt.slice(0, UTC_DATE_LENGTH);
      clicksByDay[dayKey] = (clicksByDay[dayKey] ?? 0) + 1;
    }

    const lastClick = clicks.length === 0 ? null : clicks[clicks.length - 1];
    return {
      code: link.code,
      url: link.url,
      totalClicks: clicks.length,
      lastClickedAt: lastClick?.clickedAt ?? null,
      clicksByDay,
    };
  }

  return { findByCode, codeExists, allocateCode, createLink, recordClick, getStats };
}
