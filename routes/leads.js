const express = require('express');
const db = require('../db');
const router = express.Router();

// Список лидов с фильтрами
router.get('/', (req, res) => {
  const { status, from, to } = req.query;
  let sql = 'SELECT l.*, c.name AS campaign_name FROM leads l LEFT JOIN campaigns c ON c.id = l.campaign_id WHERE 1=1';
  const params = {};
  if (status) { sql += ' AND l.status = @status'; params.status = status; }
  if (from) { sql += " AND date(l.created_at) >= date(@from)"; params.from = from; }
  if (to) { sql += " AND date(l.created_at) <= date(@to)"; params.to = to; }
  sql += ' ORDER BY l.created_at DESC LIMIT 500';
  res.json(db.prepare(sql).all(params));
});

// Создать лид вручную
router.post('/', (req, res) => {
  const { full_name, phone, email, campaign_id, ad_name, source = 'manual', raw_text } = req.body;
  const info = db.prepare(`
    INSERT INTO leads (full_name, phone, email, campaign_id, ad_name, source, raw_text)
    VALUES (@full_name, @phone, @email, @campaign_id, @ad_name, @source, @raw_text)
  `).run({ full_name, phone, email: email || null, campaign_id: campaign_id || null, ad_name: ad_name || null, source, raw_text: raw_text || null });
  res.status(201).json(db.prepare('SELECT * FROM leads WHERE id = ?').get(info.lastInsertRowid));
});

// Обновить статус/менеджера лида
router.patch('/:id', (req, res) => {
  const { status, manager } = req.body;
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Лид не найден' });

  db.prepare(`
    UPDATE leads SET
      status = COALESCE(@status, status),
      manager = COALESCE(@manager, manager),
      updated_at = datetime('now')
    WHERE id = @id
  `).run({ status: status || null, manager: manager || null, id: req.params.id });

  res.json(db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
