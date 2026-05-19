/* GrillSync Cloud — vanilla SPA */
(function () {
  'use strict';

  // -------------- State / API --------------
  const API = (window.BACKEND_URL || '').replace(/\/+$/, '');
  const state = {
    token: localStorage.getItem('gs_token') || null,
    user: null,
    page: location.hash.replace('#', '') || 'dashboard',
    restaurants: [],
    selectedBranchId: null,
    range: 7,
    sse: null,
    notifications: [],
    unreadCount: 0,
  };

  function setToken(t) { state.token = t; t ? localStorage.setItem('gs_token', t) : localStorage.removeItem('gs_token'); }

  async function api(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    const res = await fetch(API + path, Object.assign({}, opts, { headers, body: opts.body ? JSON.stringify(opts.body) : undefined }));
    const text = await res.text();
    const data = text ? safeJSON(text) : null;
    if (!res.ok) {
      const msg = (data && data.error) || res.statusText || 'Request failed';
      const err = new Error(msg); err.status = res.status; err.data = data; throw err;
    }
    return data;
  }
  function safeJSON(s) { try { return JSON.parse(s); } catch { return s; } }

  // -------------- Toasts --------------
  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    document.getElementById('toast-root').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .2s'; setTimeout(() => el.remove(), 220); }, 3200);
  }

  // -------------- Modal --------------
  function openModal(html, opts = {}) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-back"><div class="modal ${opts.large ? 'modal-lg' : ''}">${html}</div></div>`;
    root.querySelector('.modal-back').addEventListener('click', e => {
      if (e.target.classList.contains('modal-back')) closeModal();
    });
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModal));
    return root;
  }
  function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

  // -------------- Format --------------
  const peso = n => '₱' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtNum = n => Number(n || 0).toLocaleString();
  const fmtDate = d => d ? new Date(d).toLocaleString() : '—';
  const fmtDateShort = d => d ? new Date(d).toLocaleDateString() : '—';

  // -------------- Login --------------
  function renderLogin() {
    document.getElementById('app').innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <div class="login-brand"><i class="fa-solid fa-fire"></i> GrillSync Cloud</div>
          <div class="login-sub">Sign in to your dashboard</div>
          <form id="login-form">
            <div class="field"><label>Email</label><input class="input" type="email" name="email" required value="admin@grillsync.app" /></div>
            <div class="field"><label>Password</label><input class="input" type="password" name="password" required value="Admin@1234" /></div>
            <button class="btn btn-primary btn-block" type="submit"><i class="fa-solid fa-arrow-right-to-bracket"></i> Sign in</button>
            <div class="field mt-2"><label>Backend URL</label><input class="input" id="backend-url" value="${API}" /></div>
          </form>
          <div class="hint">Default seed: admin@grillsync.app / Admin@1234</div>
        </div>
      </div>`;
    document.getElementById('login-form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      const backend = document.getElementById('backend-url').value.trim();
      if (backend && backend !== API) { localStorage.setItem('gs_backend_url', backend); location.reload(); return; }
      try {
        const data = await api('/api/auth/login', { method: 'POST', body: { email: f.email.value, password: f.password.value } });
        setToken(data.token); state.user = data.user;
        toast('Welcome back, ' + data.user.name, 'success');
        boot();
      } catch (err) { toast(err.message || 'Login failed', 'error'); }
    });
  }

  // -------------- Layout --------------
  const NAV = [
    { id: 'dashboard',   label: 'Dashboard',          icon: 'fa-gauge-high' },
    { id: 'live',        label: 'Live Orders',        icon: 'fa-bolt' },
    { id: 'analytics',   label: 'Sales Analytics',    icon: 'fa-chart-line' },
    { id: 'pnl',         label: 'Profit & Loss',      icon: 'fa-scale-balanced' },
    { id: 'branches',    label: 'Branch Performance', icon: 'fa-store' },
    { id: 'orders',      label: 'Order History',      icon: 'fa-receipt' },
    { id: 'expenses',    label: 'Expenses',           icon: 'fa-money-bill-wave' },
    { id: 'notifications', label: 'Notifications',    icon: 'fa-bell' },
    { id: 'settings',    label: 'Settings',           icon: 'fa-gear' },
  ];

  function renderShell() {
    const u = state.user;
    document.getElementById('app').innerHTML = `
      <div class="layout">
        <aside class="sidebar">
          <div class="sidebar-brand"><i class="fa-solid fa-fire"></i> GrillSync Cloud</div>
          <nav class="sidebar-nav">
            ${NAV.map(n => `
              <div class="nav-item ${state.page === n.id ? 'active' : ''}" data-nav="${n.id}">
                <i class="fa-solid ${n.icon}"></i> <span>${n.label}</span>
                ${n.id === 'notifications' && state.unreadCount ? `<span class="badge badge-primary" style="margin-left:auto">${state.unreadCount}</span>` : ''}
              </div>`).join('')}
          </nav>
          <div class="sidebar-foot">
            <div>${API}</div>
            <div style="margin-top:6px;">v1.0 · ${u.role}</div>
          </div>
        </aside>
        <main class="main">
          <header class="topbar">
            <div class="topbar-title" id="page-title">${NAV.find(n => n.id === state.page)?.label || ''}</div>
            <div class="topbar-actions">
              <button class="btn btn-ghost btn-icon" id="theme-toggle" title="Toggle theme"><i class="fa-solid fa-circle-half-stroke"></i></button>
              <div class="user-chip"><span class="role">${u.role}</span><span>${u.name}</span></div>
              <button class="btn btn-ghost btn-sm" id="logout-btn"><i class="fa-solid fa-arrow-right-from-bracket"></i></button>
            </div>
          </header>
          <div class="content" id="page-content"><div class="empty"><span class="spinner"></span></div></div>
        </main>
      </div>`;

    document.querySelectorAll('[data-nav]').forEach(el => el.addEventListener('click', () => go(el.dataset.nav)));
    document.getElementById('logout-btn').addEventListener('click', logout);
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    renderPage();
  }

  function go(p) { state.page = p; location.hash = p; renderShell(); }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('gs_theme', next);
  }
  function logout() { setToken(null); state.user = null; closeSSE(); renderLogin(); }

  // -------------- Pages --------------
  async function renderPage() {
    const c = document.getElementById('page-content');
    try {
      switch (state.page) {
        case 'dashboard':     return await pageDashboard(c);
        case 'live':          return await pageLive(c);
        case 'analytics':     return await pageAnalytics(c);
        case 'pnl':           return await pagePnL(c);
        case 'branches':      return await pageBranches(c);
        case 'orders':        return await pageOrders(c);
        case 'expenses':      return await pageExpenses(c);
        case 'notifications': return await pageNotifications(c);
        case 'settings':      return await pageSettings(c);
        default: c.innerHTML = `<div class="empty">Unknown page</div>`;
      }
    } catch (e) {
      c.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><div>${e.message}</div></div>`;
    }
  }

  // ----- Dashboard -----
  async function pageDashboard(c) {
    const [summary, daily, hourly, best, cats] = await Promise.all([
      api(`/api/analytics/summary?range=${state.range}`),
      api(`/api/analytics/daily?range=${state.range}`),
      api(`/api/analytics/hourly?range=${state.range}`),
      api(`/api/analytics/bestsellers?range=${state.range}&limit=8`),
      api(`/api/analytics/categories?range=${state.range}`),
    ]);
    c.innerHTML = `
      <div class="kpi-grid">
        ${kpiCard('fa-coins', "Today's Revenue", peso(summary.todayRevenue), summary.todayCount + ' orders today')}
        ${kpiCard('fa-chart-line', `${state.range}-day Revenue`, peso(summary.periodRevenue), summary.periodCount + ' orders')}
        ${kpiCard('fa-money-bill-trend-up', 'Expenses', peso(summary.periodExpense), `${state.range}-day total`)}
        ${kpiCard('fa-percent', 'Profit Margin', summary.margin.toFixed(1) + '%', 'Profit ' + peso(summary.profit))}
      </div>
      <div class="dash-grid">
        <div class="card">
          <div class="card-header"><div class="card-title">Revenue trend</div>
            <select class="input" id="range-select" style="width:auto">
              <option value="7" ${state.range==7?'selected':''}>7 days</option>
              <option value="14" ${state.range==14?'selected':''}>14 days</option>
              <option value="30" ${state.range==30?'selected':''}>30 days</option>
            </select>
          </div>
          <div class="chart-wrap"><canvas class="chart" id="chart-daily"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Hourly revenue</div></div>
          <div class="chart-wrap"><canvas class="chart" id="chart-hourly"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Bestsellers</div></div>
          ${best.bestsellers.length ? `
            <div class="table-wrap"><table class="tbl"><thead><tr><th>Item</th><th class="text-right">Qty</th><th class="text-right">Revenue</th></tr></thead><tbody>
            ${best.bestsellers.map(b => `<tr><td>${b.name||'—'}</td><td class="text-right">${fmtNum(b.quantity)}</td><td class="text-right">${peso(b.revenue)}</td></tr>`).join('')}
            </tbody></table></div>` : `<div class="empty">No sales yet</div>`}
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">By category</div></div>
          ${cats.categories.length ? `
            <div class="table-wrap"><table class="tbl"><thead><tr><th>Category</th><th class="text-right">Qty</th><th class="text-right">Revenue</th></tr></thead><tbody>
            ${cats.categories.map(c => `<tr><td>${c.category}</td><td class="text-right">${fmtNum(c.quantity)}</td><td class="text-right">${peso(c.revenue)}</td></tr>`).join('')}
            </tbody></table></div>` : `<div class="empty">No data</div>`}
        </div>
      </div>`;
    document.getElementById('range-select').addEventListener('change', e => { state.range = Number(e.target.value); renderPage(); });
    drawLine(document.getElementById('chart-daily'), daily.daily.map(d => ({ label: d.date.slice(5), value: d.revenue })));
    drawBars(document.getElementById('chart-hourly'), hourly.hourly.map(h => ({ label: String(h.hour).padStart(2,'0'), value: h.revenue })));
  }
  function kpiCard(icon, label, value, sub) {
    return `<div class="kpi"><div class="kpi-icon"><i class="fa-solid ${icon}"></i></div>
      <div class="kpi-body"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub||''}</div></div></div>`;
  }

  // ----- Live Orders (SSE) -----
  async function pageLive(c) {
    c.innerHTML = `
      <div class="card mb-3 flex-between">
        <div><div class="card-title">Live order feed</div><div class="card-sub" id="sse-status">Connecting…</div></div>
        <button class="btn btn-sm" id="reload-live"><i class="fa-solid fa-rotate"></i> Refresh</button>
      </div>
      <div class="orders-list" id="live-orders"></div>`;
    document.getElementById('reload-live').addEventListener('click', loadLive);
    await loadLive();
    openSSE(evt => {
      if (evt.type === 'sync:batchReceived') {
        toast(`Branch ${evt.data.branchId} synced ${evt.data.acceptedCount} record(s)`, 'success');
        loadLive();
      }
    });
    async function loadLive() {
      const list = document.getElementById('live-orders');
      list.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
      const r = await api('/api/orders?page=1&limit=20');
      if (!r.orders.length) { list.innerHTML = `<div class="empty"><i class="fa-solid fa-inbox"></i><div>No orders yet — waiting for POS sync</div></div>`; return; }
      list.innerHTML = r.orders.map(o => `
        <div class="order-card">
          <div class="head">
            <div><span class="oid">#${o.orderId}</span> <span class="text-muted">· customer ${o.customerNo||'-'}</span></div>
            <div>${statusBadge(o.status)}</div>
          </div>
          <div class="items">${(o.items||[]).map(it => `${it.quantity}× ${it.name}`).join(', ') || '—'}</div>
          <div class="flex-between"><span class="text-dim">${fmtDate(o.placedAt)}</span><span class="total">${peso(o.totalPrice)}</span></div>
        </div>`).join('');
    }
  }
  function statusBadge(s) {
    const map = { paid:'badge-success', completed:'badge-success', ready:'badge-info', preparing:'badge-warning', pending:'badge-warning', cancelled:'badge-danger' };
    return `<span class="badge ${map[s]||''}">${s||'—'}</span>`;
  }

  // ----- Analytics -----
  async function pageAnalytics(c) {
    const r = await api(`/api/analytics/daily?range=${state.range}`);
    c.innerHTML = `
      <div class="card mb-3 flex-between">
        <div class="card-title">Daily sales</div>
        <select class="input" id="range-select" style="width:auto">
          <option value="7" ${state.range==7?'selected':''}>7 days</option>
          <option value="14" ${state.range==14?'selected':''}>14 days</option>
          <option value="30" ${state.range==30?'selected':''}>30 days</option>
          <option value="60" ${state.range==60?'selected':''}>60 days</option>
        </select>
      </div>
      <div class="card mb-3"><div class="chart-wrap" style="height:320px"><canvas class="chart" id="chart"></canvas></div></div>
      <div class="card">
        <div class="card-title mb-3">Breakdown</div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th class="text-right">Orders</th><th class="text-right">Revenue</th><th class="text-right">Expenses</th></tr></thead><tbody>
        ${r.daily.slice().reverse().map(d => `<tr><td>${d.date}</td><td class="text-right">${fmtNum(d.orders)}</td><td class="text-right">${peso(d.revenue)}</td><td class="text-right">${peso(d.expense)}</td></tr>`).join('')}
        </tbody></table></div>
      </div>`;
    document.getElementById('range-select').addEventListener('change', e => { state.range = Number(e.target.value); renderPage(); });
    drawLine(document.getElementById('chart'), r.daily.map(d => ({ label: d.date.slice(5), value: d.revenue })));
  }

  // ----- Profit & Loss -----
  async function pagePnL(c) {
    const r = await api(`/api/analytics/daily?range=${state.range}`);
    const totRev = r.daily.reduce((s,d)=>s+d.revenue,0);
    const totExp = r.daily.reduce((s,d)=>s+d.expense,0);
    const profit = totRev - totExp;
    const margin = totRev ? (profit/totRev)*100 : 0;
    c.innerHTML = `
      <div class="kpi-grid">
        ${kpiCard('fa-arrow-trend-up','Revenue', peso(totRev), `${state.range} days`)}
        ${kpiCard('fa-arrow-trend-down','Expenses', peso(totExp), `${state.range} days`)}
        ${kpiCard('fa-coins','Profit', peso(profit), margin.toFixed(1) + '% margin')}
      </div>
      <div class="card"><div class="chart-wrap" style="height:320px"><canvas class="chart" id="chart"></canvas></div></div>`;
    drawDualBars(document.getElementById('chart'), r.daily.map(d => ({ label: d.date.slice(5), a: d.revenue, b: d.expense })));
  }

  // ----- Branch Performance -----
  async function pageBranches(c) {
    const r = await api('/api/restaurants');
    const rows = [];
    for (const rest of r.restaurants) for (const b of (rest.branches||[])) rows.push({ rest, b });
    c.innerHTML = `<div class="card">
      <div class="card-header"><div class="card-title">Branch sync status</div></div>
      ${rows.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Restaurant</th><th>Branch</th><th>Status</th><th>Last sync</th><th>Branch ID</th></tr></thead><tbody>
      ${rows.map(({rest,b}) => `<tr>
        <td>${rest.name}</td><td>${b.name}</td>
        <td>${b.syncStatus==='online'?'<span class="badge badge-success">online</span>':b.syncStatus==='offline'?'<span class="badge badge-warning">offline</span>':'<span class="badge">never</span>'}</td>
        <td>${b.lastSyncAt?fmtDate(b.lastSyncAt):'Never'}</td>
        <td class="text-mono">${b.branchId}</td>
      </tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">No branches</div>`}
    </div>`;
  }

  // ----- Order History -----
  async function pageOrders(c, page = 1) {
    c.innerHTML = `
      <div class="card mb-3 flex gap-2 flex-between">
        <div class="card-title">Order history</div>
        <div class="flex gap-2"><input class="input" type="date" id="date-filter" /><button class="btn btn-sm" id="apply-filter">Filter</button><button class="btn btn-sm btn-ghost" id="clear-filter">Clear</button></div>
      </div>
      <div id="orders-table"></div>`;
    const dateFilter = sessionStorage.getItem('gs_orders_date') || '';
    if (dateFilter) document.getElementById('date-filter').value = dateFilter;
    document.getElementById('apply-filter').addEventListener('click', () => { sessionStorage.setItem('gs_orders_date', document.getElementById('date-filter').value); pageOrders(c,1); });
    document.getElementById('clear-filter').addEventListener('click', () => { sessionStorage.removeItem('gs_orders_date'); pageOrders(c,1); });
    const q = new URLSearchParams({ page: String(page), limit: '30' });
    if (dateFilter) q.set('date', dateFilter);
    const r = await api('/api/orders?' + q.toString());
    document.getElementById('orders-table').innerHTML = r.orders.length ? `
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Order</th><th>Branch</th><th>Items</th><th>Total</th><th>Status</th><th>Placed</th></tr></thead><tbody>
      ${r.orders.map(o => `<tr>
        <td class="text-mono">#${o.orderId}</td>
        <td class="text-mono">${o.branchId}</td>
        <td>${(o.items||[]).length} item(s)</td>
        <td>${peso(o.totalPrice)}</td>
        <td>${statusBadge(o.status)}</td>
        <td>${fmtDate(o.placedAt)}</td>
      </tr>`).join('')}
      </tbody></table></div>
      <div class="flex-between mt-3">
        <div class="text-muted">${r.total} total · page ${r.page}/${r.pages}</div>
        <div class="flex gap-2">
          <button class="btn btn-sm" ${r.page<=1?'disabled':''} id="prev-pg">Prev</button>
          <button class="btn btn-sm" ${r.page>=r.pages?'disabled':''} id="next-pg">Next</button>
        </div>
      </div>` : `<div class="empty"><i class="fa-solid fa-inbox"></i><div>No orders</div></div>`;
    document.getElementById('prev-pg')?.addEventListener('click', () => pageOrders(c, page-1));
    document.getElementById('next-pg')?.addEventListener('click', () => pageOrders(c, page+1));
  }

  // ----- Expenses -----
  async function pageExpenses(c) {
    const r = await api('/api/expenses');
    c.innerHTML = `
      <div class="card mb-3 flex-between">
        <div class="card-title">Expenses</div>
        <button class="btn btn-primary btn-sm" id="add-exp"><i class="fa-solid fa-plus"></i> New expense</button>
      </div>
      ${r.expenses.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="text-right">Amount</th><th></th></tr></thead><tbody>
      ${r.expenses.map(e => `<tr>
        <td>${fmtDateShort(e.expenseDate)}</td><td>${escapeHtml(e.description)}</td><td>${e.category}</td>
        <td class="text-right">${peso(e.amount)}</td>
        <td class="text-right"><button class="btn btn-sm btn-ghost" data-del="${e._id}"><i class="fa-solid fa-trash"></i></button></td>
      </tr>`).join('')}</tbody></table></div>` : `<div class="empty"><i class="fa-solid fa-money-bill"></i><div>No expenses logged</div></div>`}`;
    document.getElementById('add-exp').addEventListener('click', () => {
      openModal(`
        <div class="modal-header"><div class="modal-title">New expense</div><button class="btn btn-ghost btn-sm" data-close>✕</button></div>
        <form class="modal-body" id="exp-form">
          <div class="field"><label>Description</label><input class="input" name="description" required /></div>
          <div class="field"><label>Amount</label><input class="input" name="amount" type="number" step="0.01" required /></div>
          <div class="field"><label>Category</label><input class="input" name="category" value="general" /></div>
          <div class="field"><label>Date</label><input class="input" name="expenseDate" type="date" value="${new Date().toISOString().slice(0,10)}" /></div>
        </form>
        <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="exp-save">Save</button></div>`);
      document.getElementById('exp-save').addEventListener('click', async () => {
        const fd = new FormData(document.getElementById('exp-form'));
        try { await api('/api/expenses', { method:'POST', body: Object.fromEntries(fd) }); closeModal(); toast('Expense added','success'); pageExpenses(c); }
        catch(e){ toast(e.message,'error'); }
      });
    });
    c.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this expense?')) return;
      try { await api('/api/expenses/'+b.dataset.del,{method:'DELETE'}); toast('Deleted','success'); pageExpenses(c); }
      catch(e){ toast(e.message,'error'); }
    }));
  }

  // ----- Notifications -----
  async function pageNotifications(c) {
    const r = await api('/api/notifications');
    state.notifications = r.notifications; state.unreadCount = r.unreadCount;
    c.innerHTML = `
      <div class="card mb-3 flex-between">
        <div class="card-title">Notifications</div>
        <button class="btn btn-sm" id="mark-all"><i class="fa-solid fa-check-double"></i> Mark all read</button>
      </div>
      ${r.notifications.length ? r.notifications.map(n => `
        <div class="card mb-2" style="padding:12px 16px; ${!n.isRead?'border-left:3px solid var(--primary)':''}">
          <div class="flex-between"><div><strong>${escapeHtml(n.title)}</strong> ${n.isRead?'':'<span class="badge badge-primary">new</span>'}</div><div class="text-dim">${fmtDate(n.createdAt)}</div></div>
          <div class="text-muted mt-2">${escapeHtml(n.message||'')}</div>
        </div>`).join('') : `<div class="empty"><i class="fa-solid fa-bell-slash"></i><div>No notifications</div></div>`}`;
    document.getElementById('mark-all').addEventListener('click', async () => {
      await api('/api/notifications/read-all',{method:'POST'}); pageNotifications(c);
    });
  }

  // ----- Settings -----
  async function pageSettings(c) {
    const r = await api('/api/restaurants');
    state.restaurants = r.restaurants;
    c.innerHTML = `
      <div class="card mb-3 flex-between">
        <div><div class="card-title">Restaurants & Branches</div><div class="card-sub">Manage cloud-synced locations</div></div>
        ${state.user.role==='superadmin' || state.user.role==='owner' ? `<button class="btn btn-primary btn-sm" id="add-rest"><i class="fa-solid fa-plus"></i> Add restaurant</button>`:''}
      </div>
      ${r.restaurants.length ? r.restaurants.map(rest => `
        <div class="card mb-3">
          <div class="flex-between mb-3">
            <div><strong>${escapeHtml(rest.name)}</strong> <span class="text-muted text-mono">· ${rest.restaurantId}</span> <span class="badge badge-info">${rest.plan}</span></div>
            ${state.user.role==='superadmin'||state.user.role==='owner'?`<button class="btn btn-sm" data-add-branch="${rest.restaurantId}"><i class="fa-solid fa-plus"></i> Add branch</button>`:''}
          </div>
          <div class="table-wrap"><table class="tbl"><thead><tr><th>Branch</th><th>Branch ID</th><th>API Key</th><th>Last sync</th><th>Status</th><th></th></tr></thead><tbody>
          ${(rest.branches||[]).map(b => `<tr>
            <td>${escapeHtml(b.name)}</td>
            <td class="text-mono">${b.branchId}</td>
            <td class="text-mono">${b.apiKey.slice(0,14)}…</td>
            <td>${b.lastSyncAt?fmtDate(b.lastSyncAt):'Never'}</td>
            <td>${b.syncStatus==='online'?'<span class="badge badge-success">online</span>':'<span class="badge">'+b.syncStatus+'</span>'}</td>
            <td class="text-right">
              <a class="btn btn-sm btn-ghost" href="${API}/api/restaurants/${rest.restaurantId}/branches/${b.branchId}/sync-script.js" target="_blank"><i class="fa-solid fa-download"></i> Script</a>
              ${state.user.role==='superadmin'||state.user.role==='owner'?`<button class="btn btn-sm btn-ghost" data-rotate="${rest.restaurantId}|${b.branchId}"><i class="fa-solid fa-rotate"></i> Rotate keys</button>`:''}
            </td>
          </tr>`).join('')}
          </tbody></table></div>
        </div>`).join('') : `<div class="empty">No restaurants yet</div>`}`;

    document.getElementById('add-rest')?.addEventListener('click', () => openCreateRestaurant());
    c.querySelectorAll('[data-add-branch]').forEach(b => b.addEventListener('click', () => openAddBranch(b.dataset.addBranch)));
    c.querySelectorAll('[data-rotate]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Rotate API keys? Old credentials stop working immediately.')) return;
      const [rid,bid] = b.dataset.rotate.split('|');
      try { const r = await api(`/api/restaurants/${rid}/branches/${bid}/rotate-keys`,{method:'POST'}); showCredentials('Keys rotated', r); pageSettings(c); }
      catch(e){ toast(e.message,'error'); }
    }));
  }

  function openCreateRestaurant() {
    openModal(`
      <div class="modal-header"><div class="modal-title">Add restaurant</div><button class="btn btn-ghost btn-sm" data-close>✕</button></div>
      <form class="modal-body" id="r-form">
        <div class="field"><label>Restaurant name</label><input class="input" name="name" required /></div>
        <div class="field"><label>First branch name</label><input class="input" name="branchName" required value="Main Branch" /></div>
        <div class="field"><label>Branch address</label><input class="input" name="branchAddress" /></div>
        <div class="field"><label>City</label><input class="input" name="branchCity" /></div>
        <div class="field"><label>Plan</label>
          <select class="input" name="plan"><option>trial</option><option>basic</option><option>pro</option><option>enterprise</option></select>
        </div>
        ${state.user.role==='superadmin'?`
          <div class="field"><label>Owner email (optional)</label><input class="input" name="ownerEmail" type="email" /></div>
          <div class="field"><label>Owner password</label><input class="input" name="ownerPassword" type="password" /></div>
          <div class="field"><label>Owner name</label><input class="input" name="ownerName" /></div>`:''}
      </form>
      <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="r-save">Create</button></div>`, {large:true});
    document.getElementById('r-save').addEventListener('click', async () => {
      const fd = new FormData(document.getElementById('r-form'));
      try { const r = await api('/api/restaurants',{method:'POST', body: Object.fromEntries(fd)}); showCredentials('Restaurant created', r); pageSettings(document.getElementById('page-content')); }
      catch(e){ toast(e.message,'error'); }
    });
  }

  function openAddBranch(restaurantId) {
    openModal(`
      <div class="modal-header"><div class="modal-title">Add branch</div><button class="btn btn-ghost btn-sm" data-close>✕</button></div>
      <form class="modal-body" id="b-form">
        <div class="field"><label>Branch name</label><input class="input" name="name" required /></div>
        <div class="field"><label>Address</label><input class="input" name="address" /></div>
        <div class="field"><label>City</label><input class="input" name="city" /></div>
        <div class="field"><label>Phone</label><input class="input" name="phone" /></div>
      </form>
      <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="b-save">Create</button></div>`);
    document.getElementById('b-save').addEventListener('click', async () => {
      const fd = new FormData(document.getElementById('b-form'));
      try { const r = await api(`/api/restaurants/${restaurantId}/branches`,{method:'POST', body:Object.fromEntries(fd)}); showCredentials('Branch added', r); pageSettings(document.getElementById('page-content')); }
      catch(e){ toast(e.message,'error'); }
    });
  }

  function showCredentials(title, r) {
    const c = r.branchCredentials || {};
    const script = r.syncScript || '';
    openModal(`
      <div class="modal-header"><div class="modal-title">${title}</div><button class="btn btn-ghost btn-sm" data-close>✕</button></div>
      <div class="modal-body">
        <div class="text-muted">Save these credentials now — the API secret will not be shown again.</div>
        <div class="creds">
          ${credRow('Restaurant ID', c.restaurantId)}
          ${credRow('Branch ID', c.branchId)}
          ${credRow('API Key', c.apiKey)}
          ${credRow('API Secret', c.apiSecret)}
          ${credRow('Sync Endpoint', c.syncEndpoint)}
        </div>
        <div class="btn-row">
          <button class="btn btn-primary btn-sm" id="dl-script"><i class="fa-solid fa-download"></i> Download sync script</button>
          <button class="btn btn-sm" id="copy-script"><i class="fa-solid fa-copy"></i> Copy script</button>
        </div>
        <div class="creds"><details><summary>Preview sync script</summary><pre>${escapeHtml(script)}</pre></details></div>
      </div>
      <div class="modal-foot"><button class="btn btn-primary" data-close>Done</button></div>`, {large:true});

    document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
      navigator.clipboard.writeText(b.dataset.copy); toast('Copied','success');
    }));
    document.getElementById('dl-script').addEventListener('click', () => {
      const blob = new Blob([script], { type: 'application/javascript' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `grillsync-sync-${c.branchId}.js`;
      a.click(); URL.revokeObjectURL(a.href);
    });
    document.getElementById('copy-script').addEventListener('click', () => {
      navigator.clipboard.writeText(script); toast('Script copied','success');
    });
  }
  function credRow(key, val) {
    return `<div class="row"><div class="key">${key}</div><code>${escapeHtml(val||'')}</code><button class="btn btn-sm btn-ghost" data-copy="${escapeAttr(val||'')}"><i class="fa-solid fa-copy"></i></button></div>`;
  }
  function escapeHtml(s) { return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escapeAttr(s) { return escapeHtml(s); }

  // -------------- Charts (tiny canvas) --------------
  function chartCtx(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w*dpr; canvas.height = h*dpr;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr,dpr);
    return { ctx, w, h };
  }
  function axisColor() { return getComputedStyle(document.documentElement).getPropertyValue('--border-strong').trim() || '#333'; }
  function textColor() { return getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#888'; }
  function primary()   { return getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#ff6a3d'; }

  function drawLine(canvas, data) {
    const { ctx, w, h } = chartCtx(canvas);
    const pad = { l:46, r:12, t:12, b:24 };
    const max = Math.max(1, ...data.map(d => d.value));
    ctx.strokeStyle = axisColor(); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, h-pad.b); ctx.lineTo(w-pad.r, h-pad.b); ctx.stroke();
    ctx.fillStyle = textColor(); ctx.font = '10px sans-serif'; ctx.textAlign='right'; ctx.textBaseline='middle';
    for (let i=0;i<=4;i++) {
      const y = pad.t + (h-pad.t-pad.b)*i/4;
      const v = max - (max*i/4);
      ctx.fillText(Math.round(v).toLocaleString(), pad.l-6, y);
      ctx.strokeStyle = axisColor()+'55'; ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(w-pad.r,y); ctx.stroke();
    }
    if (!data.length) return;
    const stepX = (w-pad.l-pad.r) / Math.max(1, data.length-1);
    const yFor = v => h-pad.b - (v/max)*(h-pad.t-pad.b);
    // line
    ctx.strokeStyle = primary(); ctx.lineWidth = 2; ctx.beginPath();
    data.forEach((d,i) => { const x=pad.l+stepX*i, y=yFor(d.value); i?ctx.lineTo(x,y):ctx.moveTo(x,y); }); ctx.stroke();
    // fill
    ctx.lineTo(pad.l+stepX*(data.length-1), h-pad.b); ctx.lineTo(pad.l, h-pad.b); ctx.closePath();
    ctx.fillStyle = primary()+'22'; ctx.fill();
    // labels (every Nth)
    ctx.fillStyle = textColor(); ctx.textAlign='center'; ctx.textBaseline='top';
    const lblStep = Math.max(1, Math.ceil(data.length/8));
    data.forEach((d,i) => { if (i%lblStep===0) ctx.fillText(d.label, pad.l+stepX*i, h-pad.b+6); });
  }
  function drawBars(canvas, data) {
    const { ctx, w, h } = chartCtx(canvas);
    const pad = { l:36, r:8, t:10, b:24 };
    const max = Math.max(1, ...data.map(d => d.value));
    ctx.strokeStyle = axisColor(); ctx.beginPath(); ctx.moveTo(pad.l,h-pad.b); ctx.lineTo(w-pad.r,h-pad.b); ctx.stroke();
    const bw = (w-pad.l-pad.r)/data.length - 2;
    ctx.fillStyle = primary();
    data.forEach((d,i)=>{
      const x = pad.l + i*(bw+2);
      const bh = (d.value/max)*(h-pad.t-pad.b);
      ctx.fillRect(x, h-pad.b-bh, bw, bh);
    });
    ctx.fillStyle = textColor(); ctx.font='10px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
    data.forEach((d,i)=>{ if (i%3===0) ctx.fillText(d.label, pad.l+i*(bw+2)+bw/2, h-pad.b+6); });
  }
  function drawDualBars(canvas, data) {
    const { ctx, w, h } = chartCtx(canvas);
    const pad = { l:46, r:8, t:10, b:24 };
    const max = Math.max(1, ...data.flatMap(d=>[d.a,d.b]));
    ctx.strokeStyle = axisColor(); ctx.beginPath(); ctx.moveTo(pad.l,h-pad.b); ctx.lineTo(w-pad.r,h-pad.b); ctx.stroke();
    const slot = (w-pad.l-pad.r)/data.length;
    const bw = Math.max(2, slot/2 - 2);
    data.forEach((d,i)=>{
      const x = pad.l + i*slot;
      const yA = (d.a/max)*(h-pad.t-pad.b); const yB = (d.b/max)*(h-pad.t-pad.b);
      ctx.fillStyle = primary();      ctx.fillRect(x, h-pad.b-yA, bw, yA);
      ctx.fillStyle = '#ef4444';      ctx.fillRect(x+bw+2, h-pad.b-yB, bw, yB);
    });
    ctx.fillStyle = textColor(); ctx.font='10px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
    const lblStep = Math.max(1, Math.ceil(data.length/8));
    data.forEach((d,i)=>{ if (i%lblStep===0) ctx.fillText(d.label, pad.l+i*slot+slot/2, h-pad.b+6); });
  }

  // -------------- SSE --------------
  let sseHandler = null;
  function openSSE(handler) {
    closeSSE();
    sseHandler = handler;
    if (!state.token) return;
    const url = API + '/api/stream?token=' + encodeURIComponent(state.token);
    const es = new EventSource(url);
    es.addEventListener('sync:batchReceived', e => { try { handler({ type:'sync:batchReceived', data: JSON.parse(e.data) }); } catch {} });
    es.addEventListener('ready', () => { const s = document.getElementById('sse-status'); if (s) s.textContent='Connected · waiting for events'; });
    es.onerror = () => { const s = document.getElementById('sse-status'); if (s) s.textContent='Reconnecting…'; };
    state.sse = es;
  }
  function closeSSE() { if (state.sse) { try { state.sse.close(); } catch{} state.sse = null; } }

  // -------------- Boot --------------
  async function boot() {
    // theme
    const stored = localStorage.getItem('gs_theme');
    if (stored) document.documentElement.setAttribute('data-theme', stored);
    if (!state.token) return renderLogin();
    try {
      const me = await api('/api/auth/me'); state.user = me.user;
    } catch (e) { setToken(null); return renderLogin(); }
    // refresh notifications count
    try { const n = await api('/api/notifications'); state.unreadCount = n.unreadCount; } catch {}
    renderShell();
  }

  window.addEventListener('hashchange', () => {
    const p = location.hash.replace('#','') || 'dashboard';
    if (p !== state.page) { state.page = p; if (state.user) renderShell(); }
  });

  boot();
})();
