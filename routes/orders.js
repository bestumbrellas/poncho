const express = require('express');
const db = require('../db');
const finance = require('../services/finance');
const checkbox = require('../integrations/checkbox');
const novaposhta = require('../integrations/novaposhta');
const router = express.Router();

router.get('/', (req, res) => {
  const { status, from, to } = req.query;
  let sql = 'SELECT * FROM orders WHERE 1=1';
  const params = {};
  if (status) { sql += ' AND status = @status'; params.status = status; }
  if (from) { sql += " AND date(created_at) >= date(@from)"; params.from = from; }
  if (to) { sql += " AND date(created_at) <= date(@to)"; params.to = to; }
  sql += ' ORDER BY created_at DESC LIMIT 500';
  res.json(db.prepare(sql).all(params));
});

router.post('/', (req, res) => {
  const b = req.body;
  const info = db.prepare(`
    INSERT INTO orders (lead_id, order_number, source, customer_name, phone, amount, cost_price, payment_method, status, raw_email_id)
    VALUES (@lead_id, @order_number, @source, @customer_name, @phone, @amount, @cost_price, @payment_method, @status, @raw_email_id)
  `).run({
    lead_id: b.lead_id || null,
    order_number: b.order_number || null,
    source: b.source || 'manual',
    customer_name: b.customer_name || null,
    phone: b.phone || null,
    amount: b.amount || 0,
    cost_price: b.cost_price || 0,
    payment_method: b.payment_method || null,
    status: b.status || 'new',
    raw_email_id: b.raw_email_id || null,
  });
  if (b.lead_id) {
    db.prepare("UPDATE leads SET status = 'order_created', updated_at = datetime('now') WHERE id = ?").run(b.lead_id);
  }
  res.status(201).json(db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid));
});

// Смена статуса заказа: тут же триггерятся финансы, ТТН, авточек
router.patch('/:id/status', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });

  const prevStatus = order.status;
  const newStatus = req.body.status;

  db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(newStatus, order.id);
  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);

  // 1) финансовый учёт
  finance.onOrderStatusChange(updated, prevStatus, newStatus);

  // 2) авточек в Checkbox при оплате/доставке (наложка тоже считается оплатой на руки)
  if (['paid', 'delivered'].includes(newStatus) && !['paid', 'delivered'].includes(prevStatus)) {
    try {
      const receipt = await checkbox.sendAutoReceipt(updated);
      db.prepare("UPDATE orders SET checkbox_receipt_id = ?, checkbox_status = ? WHERE id = ?")
        .run(receipt.id || null, receipt.status || 'sent', order.id);
    } catch (err) {
      console.error('Checkbox ошибка авточека:', err.message);
      db.prepare("UPDATE orders SET checkbox_status = ? WHERE id = ?").run('error: ' + err.message, order.id);
    }
  }

  res.json(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id));
});

// Создать накладную Новой Почты по заказу
router.post('/:id/nova-poshta/ttn', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  try {
    const ttn = await novaposhta.createWaybill({ order, recipient: req.body });
    db.prepare("UPDATE orders SET np_ttn = ?, status = 'shipped', updated_at = datetime('now') WHERE id = ?")
      .run(ttn.IntDocNumber, order.id);
    res.json({ ttn: ttn.IntDocNumber, raw: ttn });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Обновить статус доставки из Новой Почты (можно дергать по крону или вручную)
router.get('/:id/nova-poshta/status', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order || !order.np_ttn) return res.status(404).json({ error: 'ТТН не найдена' });
  const status = await novaposhta.trackWaybill(order.np_ttn);
  db.prepare("UPDATE orders SET np_status = ? WHERE id = ?").run(status.Status, order.id);
  res.json(status);
});

module.exports = router;
