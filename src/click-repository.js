const INSERT_CLICK_SQL =
  "INSERT INTO clicks (code, clicked_at_ms, referer) VALUES (?, ?, ?)";

const SELECT_CLICK_TOTALS_SQL = `
  SELECT COUNT(*) AS total_clicks, MAX(clicked_at_ms) AS last_clicked_at_ms
  FROM clicks
  WHERE code = ?
`;

const SELECT_CLICKS_BY_DAY_SQL = `
  SELECT strftime('%Y-%m-%d', clicked_at_ms / 1000, 'unixepoch') AS click_day,
         COUNT(*) AS click_count
  FROM clicks
  WHERE code = ?
  GROUP BY click_day
  ORDER BY click_day
`;

function toClicksByDay(rows) {
  const clicksByDay = {};
  for (const row of rows) {
    clicksByDay[row.click_day] = row.click_count;
  }
  return clicksByDay;
}

function toIsoStringOrNull(epochMilliseconds) {
  return epochMilliseconds === null ? null : new Date(epochMilliseconds).toISOString();
}

export function createClickRepository(database) {
  const insertClick = database.prepare(INSERT_CLICK_SQL);
  const selectClickTotals = database.prepare(SELECT_CLICK_TOTALS_SQL);
  const selectClicksByDay = database.prepare(SELECT_CLICKS_BY_DAY_SQL);

  return {
    record({ code, clickedAtMs, referer }) {
      insertClick.run(code, clickedAtMs, referer);
    },
    summarize(code) {
      const totals = selectClickTotals.get(code);
      return {
        totalClicks: totals.total_clicks,
        lastClickedAt: toIsoStringOrNull(totals.last_clicked_at_ms),
        clicksByDay: toClicksByDay(selectClicksByDay.all(code)),
      };
    },
  };
}
