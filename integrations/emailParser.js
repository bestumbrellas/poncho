const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const db = require('../db');

/**
 * Парсинг тела письма с заказом. Формат писем отличается от магазина к магазину
 * (Prom.ua, Rozetka, своя форма на сайте и т.д.) — под конкретный шаблон
 * нужно доработать регулярки ниже.
 */
function parseOrderEmail(subject, text) {
  const orderNumberMatch = text.match(/(?:заказ|замовлення|order)\s*#?\s*(\d{3,})/i);
  const amountMatch = text.match(/(?:сумма|сума|итого|разом|total)\D{0,10}(\d[\d\s]*[.,]?\d*)\s*(?:грн|uah|₴)/i);
  const nameMatch = text.match(/(?:получатель|отримувач|клиент|ім'я)\s*[:\-]\s*(.+)/i);
  const phoneMatch = text.match(/(\+?3?8?0\d{9}|\+?\d{10,13})/);

  return {
    order_number: orderNumberMatch ? orderNumberMatch[1] : null,
    amount: amountMatch ? parseFloat(amountMatch[1].replace(/\s/g, '').replace(',', '.')) : null,
    customer_name: nameMatch ? nameMatch[1].trim() : null,
    phone: phoneMatch ? phoneMatch[0].replace(/\s+/g, '') : null,
  };
}

async function fetchNewOrdersFromEmail() {
  const host = process.env.MAIL_HOST;
  if (!host) {
    console.warn('[email] MAIL_HOST не задан — пропускаю проверку почты');
    return { imported: 0 };
  }

  const client = new ImapFlow({
    host,
    port: Number(process.env.MAIL_PORT || 993),
    secure: true,
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    logger: false,
  });

  let imported = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock(process.env.MAIL_FOLDER || 'INBOX');
    try {
      // берём непрочитанные — считаем их ещё не импортированными
      for await (const msg of client.fetch({ seen: false }, { source: true, uid: true })) {
        const parsed = await simpleParser(msg.source);
        const emailId = parsed.messageId || String(msg.uid);

        const already = db.prepare('SELECT id FROM orders WHERE raw_email_id = ?').get(emailId);
        if (already) continue;

        const order = parseOrderEmail(parsed.subject || '', parsed.text || '');
        if (!order.amount) continue; // не похоже на письмо с заказом

        // пробуем сматчить с существующим лидом по телефону
        let leadId = null;
        if (order.phone) {
          const lead = db.prepare('SELECT id FROM leads WHERE phone = ? ORDER BY created_at DESC LIMIT 1').get(order.phone);
          if (lead) leadId = lead.id;
        }

        db.prepare(`
          INSERT INTO orders (lead_id, order_number, source, customer_name, phone, amount, status, raw_email_id)
          VALUES (@lead_id, @order_number, 'email', @customer_name, @phone, @amount, 'new', @raw_email_id)
        `).run({
          lead_id: leadId,
          order_number: order.order_number,
          customer_name: order.customer_name,
          phone: order.phone,
          amount: order.amount,
          raw_email_id: emailId,
        });

        imported += 1;
        await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  if (imported > 0) console.log(`[email] Импортировано заказов: ${imported}`);
  return { imported };
}

module.exports = { fetchNewOrdersFromEmail, parseOrderEmail };
