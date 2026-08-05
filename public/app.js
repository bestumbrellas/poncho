const API = '/api';
// Если задан API_TOKEN на сервере — впишите его сюда для локальной работы дашборда
const AUTH_TOKEN = '';

async function apiGet(path) {
  const res = await fetch(API + path, { headers: AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {} });
  return res.json();
}
async function apiPost(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}) },
    body: JSON.stringify(body),
  });
  return res.json();
}
async function apiPatch(path, body) {
  const res = await fetch(API + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}) },
    body: JSON.stringify(body),
  });
  return res.json();
}

function fmtMoney(v) {
  return new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(v || 0) + ' грн';
}
function fmtDate(v) {
  return new Date(v.replace(' ', 'T') + 'Z').toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ---------- навигация ----------
document.querySelectorAll('.nav-item').forEach((el) => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => (v.style.display = 'none'));
    el.classList.add('active');
    const view = el.dataset.view;
    document.getElementById('view-' + view).style.display = 'block';
    if (view === 'dashboard') loadDashboard();
    if (view === 'leads') loadLeads();
    if (view === 'orders') loadOrders();
    if (view === 'returns') loadReturns();
    if (view === 'finance') loadFinance();
  });
});

// ---------- дашборд / ROAS ----------
async function loadDashboard() {
  const from = document.getElementById('dash-from').value;
  const to = document.getElementById('dash-to').value;
  const q = from || to ? `?from=${from}&to=${to}` : '';

  const [summary, roas] = await Promise.all([
    apiGet('/finance/summary' + q),
    apiGet('/finance/roas' + q),
  ]);

  document.getElementById('kpi-grid').innerHTML = `
    <div class="kpi-card"><div class="kpi-label">Доход</div><div class="kpi-value green">${fmtMoney(summary.income)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Расход</div><div class="kpi-value red">${fmtMoney(summary.expense)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Остаток</div><div class="kpi-value">${fmtMoney(summary.balance)}</div></div>
    <div class="kpi-card"><div class="kpi-label">ROAS (общий)</div><div class="kpi-value">${roas.totals.roas ? roas.totals.roas.toFixed(2) + 'x' : '—'}</div></div>
  `;

  const rows = roas.campaigns.map((c) => `
    <tr>
      <td>${c.campaign_name}</td>
      <td>${c.leads_count}</td>
      <td>${c.orders_count}</td>
      <td>${fmtMoney(c.spend)}</td>
      <td>${fmtMoney(c.revenue)}</td>
      <td class="${c.roas >= 1 ? 'roas-good' : 'roas-bad'}">${c.roas != null ? c.roas.toFixed(2) + 'x' : '—'}</td>
      <td>${c.cpl != null ? fmtMoney(c.cpl) : '—'}</td>
    </tr>
  `).join('');
  document.getElementById('roas-tbody').innerHTML = rows || `<tr><td colspan="7" class="empty">Нет данных по кампаниям</td></tr>`;
}

// ---------- лиды ----------
async function loadLeads() {
  const status = document.getElementById('lead-status-filter').value;
  const leads = await apiGet('/leads' + (status ? `?status=${status}` : ''));
  document.getElementById('leads-tbody').innerHTML = leads.map((l) => `
    <tr>
      <td>${fmtDate(l.created_at)}</td>
      <td>${l.full_name || '—'}</td>
      <td>${l.phone || '—'}</td>
      <td>${l.campaign_name || '—'}</td>
      <td>${l.source}</td>
      <td>${l.manager || '—'}</td>
      <td>
        <select class="status-select" onchange="updateLeadStatus(${l.id}, this.value)">
          ${['new','contacted','qualified','order_created','rejected','spam'].map(s =>
            `<option value="${s}" ${s === l.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="7" class="empty">Лидов пока нет</td></tr>`;
}
async function updateLeadStatus(id, status) {
  await apiPatch(`/leads/${id}`, { status });
}

// ---------- заказы ----------
async function loadOrders() {
  const status = document.getElementById('order-status-filter').value;
  const orders = await apiGet('/orders' + (status ? `?status=${status}` : ''));
  document.getElementById('orders-tbody').innerHTML = orders.map((o) => `
    <tr>
      <td>${fmtDate(o.created_at)}</td>
      <td>${o.order_number || o.id}</td>
      <td>${o.customer_name || '—'}</td>
      <td>${o.phone || '—'}</td>
      <td>${fmtMoney(o.amount)}</td>
      <td>${o.np_ttn || '—'}</td>
      <td>${o.checkbox_status || '—'}</td>
      <td>
        <select class="status-select" onchange="updateOrderStatus(${o.id}, this.value)">
          ${['new','confirmed','shipped','delivered','paid','returned','cancelled'].map(s =>
            `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="8" class="empty">Заказов пока нет</td></tr>`;
}
async function updateOrderStatus(id, status) {
  await apiPatch(`/orders/${id}/status`, { status });
  loadOrders();
}

// ---------- возвраты ----------
async function loadReturns() {
  const returns = await apiGet('/returns');
  document.getElementById('returns-tbody').innerHTML = returns.map((r) => `
    <tr>
      <td>${fmtDate(r.created_at)}</td>
      <td>#${r.order_id}</td>
      <td>${fmtMoney(r.amount)}</td>
      <td>${r.reason || '—'}</td>
      <td><span class="badge ${r.status}">${r.status}</span></td>
    </tr>
  `).join('') || `<tr><td colspan="5" class="empty">Возвратов нет</td></tr>`;
}

// ---------- финансы ----------
async function loadFinance() {
  const from = document.getElementById('fin-from').value;
  const to = document.getElementById('fin-to').value;
  const q = from || to ? `?from=${from}&to=${to}` : '';

  const [summary, tx] = await Promise.all([
    apiGet('/finance/summary' + q),
    apiGet('/finance/transactions' + q),
  ]);

  document.getElementById('fin-kpi-grid').innerHTML = `
    <div class="kpi-card"><div class="kpi-label">Доход</div><div class="kpi-value green">${fmtMoney(summary.income)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Расход</div><div class="kpi-value red">${fmtMoney(summary.expense)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Остаток</div><div class="kpi-value">${fmtMoney(summary.balance)}</div></div>
  `;

  document.getElementById('fin-tbody').innerHTML = tx.map((t) => `
    <tr>
      <td>${fmtDate(t.created_at)}</td>
      <td><span class="badge ${t.type === 'income' ? 'paid' : 'returned'}">${t.type === 'income' ? 'доход' : 'расход'}</span></td>
      <td>${t.category}</td>
      <td>${fmtMoney(t.amount)}</td>
      <td>${t.description || '—'}</td>
    </tr>
  `).join('') || `<tr><td colspan="5" class="empty">Операций нет</td></tr>`;
}
async function addTransaction() {
  const type = document.getElementById('tx-type').value;
  const category = document.getElementById('tx-category').value || 'other';
  const amount = parseFloat(document.getElementById('tx-amount').value);
  const description = document.getElementById('tx-desc').value;
  if (!amount) return alert('Укажите сумму');
  await apiPost('/finance/transactions', { type, category, amount, description });
  document.getElementById('tx-amount').value = '';
  document.getElementById('tx-desc').value = '';
  loadFinance();
}

// стартовая загрузка
loadDashboard();
