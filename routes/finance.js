const express = require('express');
const db = require('../db');
const financeService = require('../services/finance');
const roasService = require('../services/roas');
const router = express.Router();

router.get('/summary', (req, res) => {
  res.json(financeService.getSummary({ from: req.query.from, to: req.query.to }));
});

router.get('/transactions', (req, res) => {
  const { from, to, type } = req.query;
  let sql = 'SELECT * FROM finance_transactions WHERE 1=1';
  const params = {};
  if (type) { sql += ' AND type = @type'; params.type = type; }
  if (from) { sql += " AND date(created_at) >= date(@from)"; params.from = from; }
  if (to) { sql += " AND date(created_at) <= date(@to)"; params.to = to; }
  sql += ' ORDER BY created_at DESC LIMIT 1000';
  res.json(db.prepare(sql).all(params));
});

// Ручное добавление операции (например, аренда, ЗП, ручной расход на рекламу)
router.post('/transactions', (req, res) => {
  const { type, category, amount, description, order_id, campaign_id } = req.body;
  const id = financeService.addTransaction({ type, category, amount, description, order_id, campaign_id });
  res.status(201).json(db.prepare('SELECT * FROM finance_transactions WHERE id = ?').get(id));
});

router.get('/roas', (req, res) => {
  res.json(roasService.getRoasByCampaign({ from: req.query.from, to: req.query.to }));
});

module.exports = router;
