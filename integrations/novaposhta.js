const axios = require('axios');

const API_URL = 'https://api.novaposhta.ua/v2.0/json/';

async function call(model, calledMethod, methodProperties) {
  const { data } = await axios.post(API_URL, {
    apiKey: process.env.NOVAPOSHTA_API_KEY,
    modelName: model,
    calledMethod,
    methodProperties,
  });
  if (!data.success) {
    throw new Error('NovaPoshta: ' + (data.errors?.join(', ') || 'неизвестная ошибка'));
  }
  return data.data;
}

/**
 * Создать накладную (ТТН) по заказу.
 * recipient: { fullName, phone, cityRef, warehouseRef } — данные получателя,
 * их нужно заранее получить через методы Address/searchSettlements и Address/getWarehouses
 * (см. документацию Новой Почты), либо собрать в форме на фронте при оформлении отправки.
 */
async function createWaybill({ order, recipient }) {
  const result = await call('InternetDocument', 'save', {
    SenderWarehouseIndex: undefined,
    Sender: process.env.NOVAPOSHTA_SENDER_REF,
    SenderAddress: process.env.NOVAPOSHTA_SENDER_ADDRESS_REF,
    ContactSender: process.env.NOVAPOSHTA_SENDER_CONTACT_REF,
    SendersPhone: undefined,
    Recipient: recipient.recipientRef, // если получатель уже есть как контрагент
    RecipientAddress: recipient.warehouseRef,
    ContactRecipient: recipient.contactRef,
    RecipientsPhone: recipient.phone || order.phone,
    RecipientName: recipient.fullName || order.customer_name,
    PayerType: recipient.payerType || 'Recipient',
    PaymentMethod: recipient.paymentMethod || 'Cash',
    CargoType: 'Parcel',
    Weight: recipient.weight || '1',
    ServiceType: recipient.serviceType || 'WarehouseWarehouse',
    Description: `Заказ #${order.id}`,
    Cost: order.amount,
    SeatsAmount: '1',
    // Наложенный платёж, если оплата при получении
    BackwardDeliveryData: recipient.cod ? [{
      PayerType: 'Recipient',
      CargoType: 'Money',
      RedeliveryString: String(order.amount),
    }] : undefined,
  });
  return result[0];
}

/** Трекинг посылки по номеру ТТН (публичный метод, без ключа отправителя) */
async function trackWaybill(ttn) {
  const result = await call('TrackingDocument', 'getStatusDocuments', {
    Documents: [{ DocumentNumber: ttn, Phone: '' }],
  });
  return result[0];
}

module.exports = { createWaybill, trackWaybill };
