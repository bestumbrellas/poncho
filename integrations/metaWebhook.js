const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const db = require('../db');

const router = express.Router();

// 1) Верификация webhook при подключении в Meta App Dashboard
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// 2) Проверка подписи запроса (безопасность)
function verifySignature(req) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !process.env.META_APP_SECRET) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.META_APP_SECRET)
    .update(req.rawBody || '')
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// 3) Получаем событие leadgen и подтягиваем детали лида через Graph API
router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // отвечаем сразу, обработку делаем асинхронно

  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        if (change.field !== 'leadgen') continue;
        const { leadgen_id, form_id, ad_id, campaign_id } = change.value;
        await importLeadFromGraphApi(leadgen_id, campaign_id);
      }
    }
  } catch (err) {
    console.error('[meta webhook] ошибка обработки:', err.message);
  }
});

async function importLeadFromGraphApi(leadgenId, metaCampaignId) {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) {
    console.warn('[meta webhook] META_PAGE_ACCESS_TOKEN не задан, пропускаю leadgen_id=', leadgenId);
    return;
  }

  const { data } = await axios.get(`https://graph.facebook.com/v19.0/${leadgenId}`, {
    params: { access_token: token },
  });

  const fields = {};
  for (const f of data.field_data || []) {
    fields[f.name] = f.values ? f.values[0] : null;
  }

  let campaign = null;
  if (metaCampaignId) {
    campaign = db.prepare('SELECT * FROM campaigns WHERE meta_campaign_id = ?').get(metaCampaignId);
    if (!campaign) {
      const info = db.prepare('INSERT INTO campaigns (meta_campaign_id, name) VALUES (?, ?)')
        .run(metaCampaignId, `Кампания ${metaCampaignId}`);
      campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(info.lastInsertRowid);
    }
  }

  db.prepare(`
    INSERT INTO leads (source, meta_lead_id, campaign_id, full_name, phone, email, raw_text)
    VALUES ('meta_webhook', @meta_lead_id, @campaign_id, @full_name, @phone, @email, @raw_text)
  `).run({
    meta_lead_id: leadgenId,
    campaign_id: campaign ? campaign.id : null,
    full_name: fields.full_name || fields.name || null,
    phone: fields.phone_number || fields.phone || null,
    email: fields.email || null,
    raw_text: JSON.stringify(data),
  });

  console.log(`[meta webhook] Импортирован лид ${leadgenId}`);
}

module.exports = router;
