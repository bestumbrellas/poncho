const TelegramBot = require('node-telegram-bot-api');
const db = require('../db');

/**
 * Meta Lead Ads (через нативную интеграцию Facebook -> Telegram, или через
 * Zapier/Make) обычно присылает сообщение вида:
 *
 *   Новая заявка с рекламы "Название кампании"
 *   Имя: Иван Иванов
 *   Телефон: +380671234567
 *   Email: ivan@example.com
 *
 * Формат может отличаться — правьте regex под свой шаблон сообщений.
 */
function parseLeadMessage(text) {
  const phoneMatch = text.match(/(\+?3?8?0\d{9}|\+?\d{10,13})/);
  const nameMatch = text.match(/(?:имя|name|ім'я)\s*[:\-]\s*(.+)/i);
  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[a-zA-Z.]{2,}/);
  const campaignMatch = text.match(/(?:кампани[яи]|campaign|реклам[аы])\s*[:\-]?\s*"?([^"\n]+)"?/i);

  return {
    full_name: nameMatch ? nameMatch[1].trim() : null,
    phone: phoneMatch ? phoneMatch[0].replace(/\s+/g, '') : null,
    email: emailMatch ? emailMatch[0] : null,
    campaign_name: campaignMatch ? campaignMatch[1].trim() : null,
  };
}

function findOrCreateCampaign(name) {
  if (!name) return null;
  let campaign = db.prepare('SELECT * FROM campaigns WHERE name = ?').get(name);
  if (!campaign) {
    const info = db.prepare('INSERT INTO campaigns (name) VALUES (?)').run(name);
    campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(info.lastInsertRowid);
  }
  return campaign;
}

function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN не задан — бот не запущен');
    return null;
  }

  const bot = new TelegramBot(token, { polling: true });
  const leadsChatId = process.env.TELEGRAM_LEADS_CHAT_ID;

  bot.on('message', (msg) => {
    // Если указан конкретный чат с лидами — обрабатываем только его
    if (leadsChatId && String(msg.chat.id) !== String(leadsChatId)) return;
    if (!msg.text) return;

    const parsed = parseLeadMessage(msg.text);
    if (!parsed.phone && !parsed.full_name) return; // не похоже на лид, игнорируем

    const campaign = findOrCreateCampaign(parsed.campaign_name);

    db.prepare(`
      INSERT INTO leads (source, full_name, phone, email, campaign_id, raw_text, telegram_message_id)
      VALUES ('telegram', @full_name, @phone, @email, @campaign_id, @raw_text, @telegram_message_id)
    `).run({
      full_name: parsed.full_name,
      phone: parsed.phone,
      email: parsed.email,
      campaign_id: campaign ? campaign.id : null,
      raw_text: msg.text,
      telegram_message_id: msg.message_id,
    });

    console.log(`[telegram] Новый лид: ${parsed.full_name || '(без имени)'} ${parsed.phone || ''}`);
  });

  // Простая команда, чтобы узнать chat_id (пригодится для .env)
  bot.onText(/\/getchatid/, (msg) => {
    bot.sendMessage(msg.chat.id, `Chat ID: ${msg.chat.id}`);
  });

  console.log('[telegram] Бот запущен, слушаю лиды...');
  return bot;
}

module.exports = { startTelegramBot, parseLeadMessage };
