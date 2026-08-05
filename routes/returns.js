const express = require('express');
const db = require('../db');
const finance = require('../services/finance');
const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM returns ORDER BY created_at DESC LIMIT 500').all());
});

router.post('/', (req, res) => {
  const { order_id, amount, reason } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });

  const info = db.prepare(`
    INSERT INTO returns (order_id, amount, reason, status)
    VALUES (@order_id, @amount, @reason, 'requested')
  `).run({ order_id, amount: amount ?? order.amount, reason: reason || null });

  db.prepare("UPDATE orders SET status = 'returned', updated_at = datetime('now') WHERE id = ?").run(order_id);

  res.status(201).json(db.prepare('SELECT * FROM returns WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/:id/status', (req, res) => {
  const ret = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!ret) return res.status(404).json({ error: 'Возврат не найден' });
  const { status } = req.body;

  db.prepare("UPDATE returns SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, ret.id);

  // как только деньги реально вернули клиенту — фиксируем расход
  if (status === 'refunded' && ret.status !== 'refunded') {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(ret.order_id);
    finance.onReturnRefunded(ret, order);
  }

  res.json(db.prepare('SELECT * FROM returns WHERE id = ?').get(ret.id));
});

module.exports = router;
