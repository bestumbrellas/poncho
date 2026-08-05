const db = require('../db');

/**
 * Записать финансовую операцию (доход или расход).
 */
function addTransaction({ type, category, amount, description, order_id = null, campaign_id = null }) {
  if (!['income', 'expense'].includes(type)) {
    throw new Error('type должен быть income или expense');
  }
  const stmt = db.prepare(`
    INSERT INTO finance_transactions (type, category, amount, description, order_id, campaign_id)
    VALUES (@type, @category, @amount, @description, @order_id, @campaign_id)
  `);
  const info = stmt.run({ type, category, amount, description, order_id, campaign_id });
  return info.lastInsertRowid;
}

/**
 * Сводка доход/расход/остаток за период (по умолчанию — за всё время).
 * from/to в формате YYYY-MM-DD (необязательно).
 */
function getSummary({ from, to } = {}) {
  const where = [];
  const params = {};
  if (from) { where.push('date(created_at) >= date(@from)'); params.from = from; }
  if (to) { where.push('date(created_at) <= date(@to)'); params.to = to; }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const income = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM finance_transactions
    ${whereSql ? whereSql + " AND type = 'income'" : "WHERE type = 'income'"}
  `).get(params).total;

  const expense = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM finance_transactions
    ${whereSql ? whereSql + " AND type = 'expense'" : "WHERE type = 'expense'"}
  `).get(params).total;

  const byCategory = db.prepare(`
    SELECT type, category, COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt
    FROM finance_transactions
    ${whereSql}
    GROUP BY type, category
    ORDER BY type, total DESC
  `).all(params);

  return {
    income,
    expense,
    balance: income - expense,
    by_category: byCategory,
  };
}

/**
 * Автоматически создаёт транзакции при смене статуса заказа.
 * Вызывать из routes/orders.js при апдейте статуса.
 */
function onOrderStatusChange(order, prevStatus, newStatus) {
  // Заказ оплачен / доставлен и оплачен -> фиксируем доход и себестоимость (расход)
  if ((newStatus === 'paid' || newStatus === 'delivered') && !['paid', 'delivered'].includes(prevStatus)) {
    addTransaction({
      type: 'income',
      category: 'order_payment',
      amount: order.amount,
      description: `Оплата заказа #${order.id} (${order.order_number || ''})`,
      order_id: order.id,
    });
    if (order.cost_price > 0) {
      addTransaction({
        type: 'expense',
        category: 'cogs',
        amount: order.cost_price,
        description: `Себестоимость заказа #${order.id}`,
        order_id: order.id,
      });
    }
  }
}

/**
 * Фиксирует возврат: минусуем доход, что уже был зачислен.
 */
function onReturnRefunded(ret, order) {
  addTransaction({
    type: 'expense',
    category: 'refund',
    amount: ret.amount,
    description: `Возврат по заказу #${order.id}`,
    order_id: order.id,
  });
}

module.exports = { addTransaction, getSummary, onOrderStatusChange, onReturnRefunded };
