const axios = require('axios');

const BASE_URL = process.env.CHECKBOX_BASE_URL || 'https://api.checkbox.in.ua/api/v1';

let cachedToken = null;
let cachedShiftId = null;

function client(token) {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      'X-License-Key': process.env.CHECKBOX_LICENSE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(process.env.CHECKBOX_CASH_REGISTER_ID
        ? { 'X-Cash-Register-Id': process.env.CHECKBOX_CASH_REGISTER_ID }
        : {}),
    },
  });
}

/** Авторизация кассира (по PIN-коду смены или логин/пароль) */
async function getToken() {
  if (cachedToken) return cachedToken;

  if (process.env.CHECKBOX_CASHIER_PIN) {
    const { data } = await client().post('/cashier/signinPinCode', {
      pin_code: process.env.CHECKBOX_CASHIER_PIN,
    });
    cachedToken = data.access_token;
  } else {
    const { data } = await client().post('/cashier/signin', {
      login: process.env.CHECKBOX_LOGIN,
      password: process.env.CHECKBOX_PASSWORD,
    });
    cachedToken = data.access_token;
  }
  return cachedToken;
}

/** Открыть смену, если ещё не открыта */
async function ensureShiftOpen() {
  const token = await getToken();
  const api = client(token);

  const { data: current } = await api.get('/cashier/shift');
  if (current && current.status === 'OPENED') {
    cachedShiftId = current.id;
    return current;
  }

  const { data: shift } = await api.post('/shifts');
  // Checkbox открывает смену асинхронно — можно опросить /shifts/{id}, здесь упрощённо ждём
  cachedShiftId = shift.id;
  return shift;
}

/**
 * Автоматически создать и отправить фискальный чек по заказу.
 * Чек отправляется покупателю на email/телефон, если они указаны в заказе.
 */
async function sendAutoReceipt(order) {
  const token = await getToken();
  await ensureShiftOpen();
  const api = client(token);

  const receiptPayload = {
    good: undefined, // ниже формируем goods массивом
    goods: [
      {
        good: {
          name: order.order_number ? `Товар по заказу #${order.order_number}` : `Заказ #${order.id}`,
          price: Math.round(order.amount * 100), // Checkbox принимает копейки
        },
        quantity: 1000, // 1.000 шт (тоже в тысячных)
      },
    ],
    payments: [
      {
        type: 'CASH', // при наложенном платеже логично CASH; для карты — CARD
        value: Math.round(order.amount * 100),
      },
    ],
    delivery: order.phone || order.customer_email
      ? { email: order.customer_email || undefined, phone: order.phone || undefined }
      : undefined,
  };

  const { data: receipt } = await api.post('/receipts/sell', receiptPayload);
  return { id: receipt.id, status: receipt.status || 'created' };
}

module.exports = { getToken, ensureShiftOpen, sendAutoReceipt };
