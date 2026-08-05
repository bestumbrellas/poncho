-- ============================================================
-- Схема CRM для продаж
-- ============================================================

-- Рекламные кампании Meta (для расчёта ROAS)
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meta_campaign_id TEXT UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Расход по кампании за день (заполняется синхронизацией с Meta Ads Insights)
CREATE TABLE IF NOT EXISTS campaign_spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  date TEXT NOT NULL,           -- YYYY-MM-DD
  spend REAL NOT NULL DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  leads_reported INTEGER DEFAULT 0,
  UNIQUE(campaign_id, date)
);

-- Лиды (из Telegram-пересылки Meta или прямого webhook)
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'telegram',   -- telegram | meta_webhook | manual
  meta_lead_id TEXT,
  campaign_id INTEGER REFERENCES campaigns(id),
  ad_name TEXT,
  full_name TEXT,
  phone TEXT,
  email TEXT,
  raw_text TEXT,               -- исходное сообщение из Telegram, на всякий случай
  telegram_message_id INTEGER,
  status TEXT NOT NULL DEFAULT 'new',  -- new | contacted | qualified | order_created | rejected | spam
  manager TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Заказы
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER REFERENCES leads(id),
  order_number TEXT,              -- номер из письма/магазина, если есть
  source TEXT NOT NULL DEFAULT 'email',   -- email | manual | telegram
  customer_name TEXT,
  phone TEXT,
  amount REAL NOT NULL DEFAULT 0,     -- сумма заказа (доход)
  cost_price REAL NOT NULL DEFAULT 0, -- себестоимость (расход)
  payment_method TEXT,             -- cod (наложка) | prepaid | card
  status TEXT NOT NULL DEFAULT 'new', -- new | confirmed | shipped | delivered | paid | returned | cancelled
  np_ttn TEXT,                     -- номер накладной Новой Почты
  np_status TEXT,
  raw_email_id TEXT,               -- id письма, чтобы не импортировать дважды
  checkbox_receipt_id TEXT,
  checkbox_status TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Возвраты
CREATE TABLE IF NOT EXISTS returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  amount REAL NOT NULL DEFAULT 0,
  reason TEXT,
  np_return_ttn TEXT,
  status TEXT NOT NULL DEFAULT 'requested', -- requested | in_transit | received | refunded
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Финансовые операции (для расчёта доход/расход/остаток)
CREATE TABLE IF NOT EXISTS finance_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,              -- income | expense
  category TEXT NOT NULL,          -- order_payment | ad_spend | cogs | refund | np_delivery | other
  amount REAL NOT NULL,
  description TEXT,
  order_id INTEGER REFERENCES orders(id),
  campaign_id INTEGER REFERENCES campaigns(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_finance_type ON finance_transactions(type);
CREATE INDEX IF NOT EXISTS idx_finance_date ON finance_transactions(created_at);
