const db = require('../db');

/**
 * ROAS = доход от заказов, пришедших с кампании / расход на рекламу этой кампании.
 * Считаем за период from..to (YYYY-MM-DD). Если период не указан — за всё время.
 */
function getRoasByCampaign({ from, to } = {}) {
  const dateFilter = (col) => {
    const parts = [];
    if (from) parts.push(`date(${col}) >= date('${from}')`);
    if (to) parts.push(`date(${col}) <= date('${to}')`);
    return parts.length ? 'AND ' + parts.join(' AND ') : '';
  };

  const campaigns = db.prepare('SELECT * FROM campaigns').all();

  const rows = campaigns.map((c) => {
    const spend = db.prepare(`
      SELECT COALESCE(SUM(spend),0) AS total
      FROM campaign_spend
      WHERE campaign_id = ? ${dateFilter('date')}
    `).get(c.id).total;

    const revenue = db.prepare(`
      SELECT COALESCE(SUM(o.amount),0) AS total, COUNT(*) AS orders_count
      FROM orders o
      JOIN leads l ON l.id = o.lead_id
      WHERE l.campaign_id = ?
        AND o.status IN ('paid','delivered','shipped','confirmed')
        ${dateFilter('o.created_at')}
    `).get(c.id);

    const leadsCount = db.prepare(`
      SELECT COUNT(*) AS cnt FROM leads WHERE campaign_id = ? ${dateFilter('created_at')}
    `).get(c.id).cnt;

    const roas = spend > 0 ? revenue.total / spend : null;
    const cpl = leadsCount > 0 ? spend / leadsCount : null; // цена лида

    return {
      campaign_id: c.id,
      campaign_name: c.name,
      spend,
      revenue: revenue.total,
      orders_count: revenue.orders_count,
      leads_count: leadsCount,
      roas,          // например 3.5 = каждая 1 грн рекламы дала 3.5 грн выручки
      cpl,
    };
  });

  const totals = rows.reduce((acc, r) => {
    acc.spend += r.spend;
    acc.revenue += r.revenue;
    return acc;
  }, { spend: 0, revenue: 0 });
  totals.roas = totals.spend > 0 ? totals.revenue / totals.spend : null;

  return { campaigns: rows, totals };
}

module.exports = { getRoasByCampaign };
