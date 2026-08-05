require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');

const db = require('./db'); // инициализирует схему при импорте

const leadsRoutes = require('./routes/leads');
const ordersRoutes = require('./routes/orders');
const returnsRoutes = require('./routes/returns');
const financeRoutes = require('./routes/finance');
const metaWebhook = require('./integrations/metaWebhook');
const { startTelegramBot } = require('./integrations/telegramBot');
const { fetchNewOrdersFromEmail } = require('./integrations/emailParser');

const app = express();

// нужен raw body для проверки подписи Meta webhook
app.use('/integrations/meta', express.json({
  verify: (req, res, buf) => { req.rawBody = buf.toString(); },
}), metaWebhook);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// простая защита API токеном (кроме статики и meta webhook, который уже подключен выше)
app.use('/api', (req, res, next) => {
  const token = process.env.API_TOKEN;
  if (!token) return next(); // если токен не задан — доступ открыт (для локальной разработки)
  const header = req.headers.authorization || '';
  if (header === `Bearer ${token}`) return next();
  res.status(401).json({ error: 'Не авторизовано' });
});

app.use('/api/leads', leadsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/returns', returnsRoutes);
app.use('/api/finance', financeRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ручной запуск проверки почты (удобно для теста)
app.post('/api/email/check-now', async (req, res) => {
  try {
    const result = await fetchNewOrdersFromEmail();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CRM запущена: http://localhost:${PORT}`);

  // запускаем Telegram-бота для приёма лидов
  startTelegramBot();

  // периодическая проверка почты на новые заказы
  const cronExpr = process.env.MAIL_POLL_CRON || '*/5 * * * *';
  if (process.env.MAIL_HOST) {
    cron.schedule(cronExpr, () => {
      fetchNewOrdersFromEmail().catch((err) => console.error('[email cron] ошибка:', err.message));
    });
    console.log(`[email] Проверка почты по расписанию: ${cronExpr}`);
  }
});
