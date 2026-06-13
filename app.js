/* =========================================================================
   TF CARD — logika aplikacji (Revolut-style)
   • Logowanie PIN-em (klawiatura numeryczna)
   • Admin: kliknięcie w napis „TF CARD" + PIN administratora
   • Dane przez Store (Firebase / localStorage)
   • PWA: service worker + instrukcja instalacji na iPhone
   ========================================================================= */
'use strict';

const SESSION_KEY = 'tfcard_session_v2';

const PLANS = {
  standard: { id: 'standard', name: 'TF CARD', tier: 'STANDARD', price: 0, color: '',
    features: ['Konto i karta TF CARD', 'Płatności TF PAY', 'Historia transakcji'] },
  plus: { id: 'plus', name: 'TF CARD PLUS', tier: 'PLUS', price: 14.99, color: 'plus',
    features: ['Wszystko ze STANDARD', 'Wyższe limity przelewów', 'Cashback 2%', 'Bez opłat za przewalutowanie', 'Wsparcie priorytetowe'] },
  pro: { id: 'pro', name: 'TF CARD PRO', tier: 'PRO', price: 39.99, color: 'pro',
    features: ['Wszystko z PLUS', 'Karta metalowa PRO', 'Cashback 5%', 'Nielimitowane przelewy', 'Ubezpieczenie podróżne', 'Doradca 24/7'] },
};

/* ---------- stan sesji ---------- */
let session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); // {type:'user',id} | {type:'admin'}
let activeView = 'home';
let pinMode = 'user';   // 'user' | 'admin'
let pinBuf = '';

/* ---------- pomocnicze ---------- */
const fmt = (n) => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(Number(n) || 0);
const fmtDate = (ts) => new Date(ts).toLocaleDateString('pl-PL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const txArr = (u) => Object.values(u.transactions || {}).sort((a, b) => b.ts - a.ts);
const initials = (name) => name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
function mkTx(type, title, amount) { return { type, title, amount: Number(amount), ts: Date.now() }; }

function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'toast show ' + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast ' + kind; }, 2600);
}

function currentUser() {
  if (!session || session.type !== 'user') return null;
  return Store.state().users[session.id] || null;
}

/* =========================================================================
   Start
   ========================================================================= */
async function init() {
  registerSW();
  setupKeypad();
  setupNav();
  await Store.init();
  Store.subscribe(onState);
  showStorageMode();
}

function showStorageMode() {
  const el = document.getElementById('storage-mode');
  el.textContent = Store.backend === 'firebase'
    ? '🔒 Połączono z chmurą — sync na wielu telefonach'
    : '⚠️ Tryb lokalny (ten telefon). Uzupełnij firebase-config.js, by włączyć sync.';
}

/* Reakcja na każdą zmianę danych (również z innego telefonu / od admina) */
function onState() {
  if (session && session.type === 'user' && !currentUser()) { doLogout(); return; }
  if (session && session.type === 'user') { showApp(); routeRender(); }
  else if (session && session.type === 'admin') { showAdmin(); renderAdmin(); }
  else showLock();
}

/* =========================================================================
   Ekran blokady / PIN
   ========================================================================= */
function showLock() {
  document.getElementById('lock-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('admin-screen').classList.add('hidden');
}

function setupKeypad() {
  document.getElementById('keypad').addEventListener('click', (e) => {
    const k = e.target.closest('.key'); if (!k) return;
    const v = k.dataset.k;
    if (v === 'del') { pinBuf = pinBuf.slice(0, -1); updateDots(); return; }
    if (v === 'admin-exit') { if (pinMode === 'admin') setPinMode('user'); return; }
    if (/^\d$/.test(v) && pinBuf.length < 4) { pinBuf += v; updateDots(); if (pinBuf.length === 4) checkPin(); }
  });

  // kliknięcie w napis „TF CARD" → tryb administratora
  document.getElementById('brand-wordmark').addEventListener('click', () => {
    setPinMode(pinMode === 'admin' ? 'user' : 'admin');
  });
}

function setPinMode(mode) {
  pinMode = mode; pinBuf = ''; updateDots();
  document.getElementById('pin-error').textContent = '';
  document.getElementById('lock-screen').classList.toggle('admin', mode === 'admin');
  document.getElementById('lock-sub').textContent = mode === 'admin' ? 'PIN administratora' : 'Wpisz kod PIN';
  document.getElementById('admin-exit').textContent = mode === 'admin' ? '↩' : '';
}

function updateDots() {
  document.querySelectorAll('#pin-dots .dot').forEach((d, i) => d.classList.toggle('filled', i < pinBuf.length));
}

function pinFail(msg) {
  document.getElementById('pin-error').textContent = msg;
  document.getElementById('pin-dots').classList.add('shake');
  setTimeout(() => { document.getElementById('pin-dots').classList.remove('shake'); pinBuf = ''; updateDots(); }, 450);
}

function checkPin() {
  const entered = pinBuf;
  if (pinMode === 'admin') {
    if (entered === (Store.meta().adminPin || '0000')) {
      session = { type: 'admin' }; saveSession(); document.getElementById('pin-error').textContent = '';
      setPinMode('user'); showAdmin(); renderAdmin();
    } else pinFail('Błędny PIN administratora');
    return;
  }
  const user = Store.users().find(u => u.pin === entered);
  if (user) {
    session = { type: 'user', id: user.id }; saveSession();
    document.getElementById('pin-error').textContent = '';
    activeView = 'home'; showApp(); routeRender();
  } else pinFail('Błędny PIN');
}

function saveSession() { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
function doLogout() {
  session = null; localStorage.removeItem(SESSION_KEY);
  pinBuf = ''; updateDots(); setPinMode('user'); showLock();
}

/* =========================================================================
   Powłoka aplikacji użytkownika
   ========================================================================= */
function showApp() {
  document.getElementById('lock-screen').classList.add('hidden');
  document.getElementById('admin-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
}

function setupNav() {
  document.querySelector('.bottom-nav').addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item'); if (!item) return;
    activeView = item.dataset.view;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === activeView));
    routeRender();
  });
}

/* Re-render bez kasowania tekstu, gdy użytkownik coś wpisuje */
function routeRender() {
  const focused = document.activeElement;
  if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'SELECT')) return;
  render();
}

function render() {
  const u = currentUser(); if (!u) return;
  const views = { home: viewHome, pay: viewPay, cards: viewCards, subs: viewSubs };
  const c = document.getElementById('view-container');
  c.innerHTML = `<div class="fade-in">${(views[activeView] || viewHome)(u)}</div>`;
  const wires = { home: wireHome, pay: wirePay, cards: wireCards, subs: wireSubs };
  if (wires[activeView]) wires[activeView](u);
  window.scrollTo(0, 0);
}

/* ---------- Pulpit ---------- */
function bankCardHTML(u) {
  const plan = PLANS[u.plan] || PLANS.standard;
  return `
    <div class="bankcard ${plan.color}">
      <div class="bankcard-top">
        <div class="bankcard-tier">TF CARD ${plan.tier}</div>
        <div class="bankcard-chip"></div>
      </div>
      <div>
        <div class="bankcard-balance-label">Saldo</div>
        <div class="bankcard-balance">${fmt(u.balance)}</div>
      </div>
      <div>
        <div class="bankcard-number">${esc(u.cardNumber)}</div>
        <div class="bankcard-bottom"><span>${esc(u.name.toUpperCase())}</span><span>TF&nbsp;PAY</span></div>
      </div>
    </div>`;
}

function viewHome(u) {
  const txs = txArr(u).slice(0, 6);
  return `
    <div class="home-head">
      <div class="avatar">${esc(initials(u.name))}</div>
      <div class="home-head-actions">
        <button class="icon-btn key-ghost" id="install-btn" title="Zainstaluj" style="background:var(--card-2);border:none;color:var(--txt);width:40px;height:40px;border-radius:12px;font-size:18px;cursor:pointer">⤓</button>
        <button class="icon-btn" id="logout-btn" title="Wyloguj" style="background:var(--card-2);border:none;color:var(--txt);width:40px;height:40px;border-radius:12px;font-size:18px;cursor:pointer">⎋</button>
      </div>
    </div>
    <div class="balance-block">
      <div class="balance-label">Cześć, ${esc(u.name.split(' ')[0])} 👋</div>
      <div class="balance-amount">${fmt(u.balance)}</div>
    </div>
    <div class="actions-row">
      <div class="action" data-go="pay"><div class="circle">💸</div><span>Wyślij</span></div>
      <div class="action" data-go="cards"><div class="circle">💳</div><span>Karty</span></div>
      <div class="action" data-go="subs"><div class="circle">⭐</div><span>Plany</span></div>
    </div>
    <div class="section-title">Ostatnie transakcje</div>
    <div class="card">${txListHTML(txs)}</div>`;
}

function txListHTML(txs) {
  if (!txs.length) return `<div class="empty">Brak transakcji</div>`;
  return `<div class="tx-list">` + txs.map(t => {
    const isIn = t.type === 'in';
    return `<div class="tx">
      <div class="tx-ico">${isIn ? '⬇️' : '⬆️'}</div>
      <div class="tx-main"><div class="tx-title">${esc(t.title)}</div><div class="tx-sub">${fmtDate(t.ts)}</div></div>
      <div class="tx-amt ${isIn ? 'in' : ''}">${isIn ? '+' : '−'}${fmt(t.amount)}</div>
    </div>`;
  }).join('') + `</div>`;
}

function wireHome() {
  document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => {
    activeView = el.dataset.go;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === activeView));
    render();
  }));
  document.getElementById('logout-btn').addEventListener('click', doLogout);
  document.getElementById('install-btn').addEventListener('click', showInstall);
}

/* ---------- TF PAY ---------- */
function viewPay(u) {
  const others = Store.users().filter(x => x.id !== u.id);
  const txs = txArr(u);
  const opts = others.length
    ? others.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')
    : `<option value="">(brak innych kont)</option>`;
  return `
    <div class="greeting">TF PAY ⚡</div>
    <div class="greeting-sub">Saldo: <b>${fmt(u.balance)}</b></div>
    <div class="section-title">Przelew do innego konta TF CARD</div>
    <div class="card">
      <div class="field"><label>Odbiorca</label><select id="pay-to" ${others.length ? '' : 'disabled'}>${opts}</select></div>
      <div class="field"><label>Kwota (PLN)</label><input type="number" id="pay-amount" min="0.01" step="0.01" placeholder="0,00" /></div>
      <div class="field"><label>Tytuł</label><input type="text" id="pay-title" placeholder="Za kawę ☕" /></div>
      <button class="btn btn-primary btn-block" id="pay-send" ${others.length ? '' : 'disabled'}>Wyślij przelew</button>
    </div>
    <div class="section-title">Historia</div>
    <div class="card">${txListHTML(txs)}</div>`;
}

function wirePay(u) {
  document.getElementById('pay-send').addEventListener('click', async () => {
    const toId = document.getElementById('pay-to').value;
    const amount = parseFloat(document.getElementById('pay-amount').value);
    const title = document.getElementById('pay-title').value.trim() || 'Przelew TF PAY';
    if (!toId) return toast('Wybierz odbiorcę', 'bad');
    if (!amount || amount <= 0) return toast('Podaj poprawną kwotę', 'bad');
    if (amount > u.balance) return toast('Niewystarczające środki', 'bad');
    const recipient = Store.state().users[toId];
    if (!recipient) return toast('Nie znaleziono odbiorcy', 'bad');

    await Store.updateUser(u.id, { balance: u.balance - amount });
    await Store.pushTx(u.id, mkTx('out', `Przelew do ${recipient.name}: ${title}`, amount));
    await Store.updateUser(recipient.id, { balance: (recipient.balance || 0) + amount });
    await Store.pushTx(recipient.id, mkTx('in', `Przelew od ${u.name}: ${title}`, amount));
    toast(`Wysłano ${fmt(amount)} do ${recipient.name}`, 'good');
    render();
  });
}

/* ---------- Karty ---------- */
function viewCards(u) {
  const plan = PLANS[u.plan] || PLANS.standard;
  return `
    <div class="greeting">Twoje karty 💳</div>
    <div class="greeting-sub">Plan: ${esc(plan.name)}</div>
    ${bankCardHTML(u)}
    <div class="section-title">Szczegóły</div>
    <div class="card">
      <div class="tx"><div class="tx-main"><div class="tx-title">Numer karty</div></div><div>${esc(u.cardNumber)}</div></div>
      <div class="tx"><div class="tx-main"><div class="tx-title">Posiadacz</div></div><div>${esc(u.name)}</div></div>
      <div class="tx"><div class="tx-main"><div class="tx-title">Ważna do</div></div><div>12/29</div></div>
      <div class="tx"><div class="tx-main"><div class="tx-title">CVV</div></div><div>•••</div></div>
      <div class="tx"><div class="tx-main"><div class="tx-title">Typ</div></div><div>${plan.tier}</div></div>
    </div>
    <div class="mt"><button class="btn btn-ghost btn-block" id="card-regen">Wygeneruj nowy numer karty</button></div>`;
}

function wireCards(u) {
  document.getElementById('card-regen').addEventListener('click', async () => {
    await Store.updateUser(u.id, { cardNumber: Store.newCard() });
    toast('Wygenerowano nowy numer karty', 'good'); render();
  });
}

/* ---------- Plany / subskrypcje ---------- */
function planCardHTML(plan, currentId) {
  const isActive = plan.id === currentId;
  const badge = plan.id === 'pro' ? '<span class="badge gold">NAJLEPSZY</span>'
    : plan.id === 'plus' ? '<span class="badge cyan">POPULARNY</span>' : '';
  let action;
  if (isActive) action = `<button class="btn btn-good btn-block" disabled>Aktywny plan ✓</button>`;
  else if (plan.id === 'standard') action = `<button class="btn btn-ghost btn-block" data-sub="standard">Przejdź na STANDARD</button>`;
  else action = `<button class="btn btn-primary btn-block" data-sub="${plan.id}">Subskrybuj • ${fmt(plan.price)}/mc</button>`;
  return `
    <div class="plan ${plan.color}">
      <div class="plan-head">
        <div class="plan-name">${esc(plan.name)} ${isActive ? '<span class="badge active-badge">AKTYWNY</span>' : badge}</div>
        <div class="plan-price">${plan.price ? fmt(plan.price) : 'Darmowy'}${plan.price ? '<small>/mc</small>' : ''}</div>
      </div>
      <ul class="plan-list">${plan.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
      ${action}
    </div>`;
}

function viewSubs(u) {
  return `
    <div class="greeting">Plany ⭐</div>
    <div class="greeting-sub">Aktualnie: <b>${esc((PLANS[u.plan] || PLANS.standard).name)}</b> • Saldo: ${fmt(u.balance)}</div>
    ${planCardHTML(PLANS.pro, u.plan)}
    ${planCardHTML(PLANS.plus, u.plan)}
    ${planCardHTML(PLANS.standard, u.plan)}
    <p class="center muted" style="font-size:12px;margin-top:6px">Opłata pobierana jednorazowo z salda przy aktywacji (symulacja miesięcznej subskrypcji).</p>`;
}

function wireSubs(u) {
  document.querySelectorAll('[data-sub]').forEach(b => b.addEventListener('click', async () => {
    const plan = PLANS[b.dataset.sub];
    if (!plan || u.plan === plan.id) return;
    if (plan.price > 0) {
      if (u.balance < plan.price) return toast('Za mało środków na opłatę', 'bad');
      await Store.updateUser(u.id, { balance: u.balance - plan.price, plan: plan.id });
      await Store.pushTx(u.id, mkTx('out', `Subskrypcja ${plan.name}`, plan.price));
    } else {
      await Store.updateUser(u.id, { plan: plan.id });
    }
    toast(`Aktywowano ${plan.name} 🎉`, 'good'); render();
  }));
}

/* =========================================================================
   Panel administratora
   ========================================================================= */
function showAdmin() {
  document.getElementById('lock-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('admin-screen').classList.remove('hidden');
}

function renderAdmin() {
  const users = Store.users();
  const total = users.reduce((s, u) => s + (Number(u.balance) || 0), 0);
  const subs = users.filter(u => u.plan && u.plan !== 'standard').length;

  const usersHTML = users.map(u => `
    <div class="admin-user" data-uid="${u.id}">
      <div class="admin-user-top">
        <div>
          <div class="admin-user-name">${esc(u.name)}
            <span class="badge ${u.plan === 'pro' ? 'gold' : u.plan === 'plus' ? 'cyan' : 'active-badge'}">${(PLANS[u.plan] || PLANS.standard).tier}</span>
          </div>
          <div class="admin-user-meta">PIN: <b>${esc(u.pin)}</b> • Saldo: <b>${fmt(u.balance)}</b> • Transakcje: ${Object.keys(u.transactions || {}).length}</div>
          <div class="admin-user-meta">${esc(u.cardNumber)}</div>
        </div>
      </div>
      <div class="admin-actions">
        <input type="number" class="adm-amt" placeholder="Kwota" style="max-width:100px" />
        <button class="btn btn-good btn-sm" data-adm="credit">Uznaj</button>
        <button class="btn btn-danger btn-sm" data-adm="debit">Obciąż</button>
      </div>
      <div class="admin-actions">
        <select class="adm-plan">
          <option value="standard" ${u.plan === 'standard' ? 'selected' : ''}>STANDARD</option>
          <option value="plus" ${u.plan === 'plus' ? 'selected' : ''}>PLUS</option>
          <option value="pro" ${u.plan === 'pro' ? 'selected' : ''}>PRO</option>
        </select>
        <button class="btn btn-ghost btn-sm" data-adm="plan">Plan</button>
        <input type="text" class="adm-pin" placeholder="Nowy PIN" maxlength="4" style="max-width:90px" />
        <button class="btn btn-ghost btn-sm" data-adm="setpin">Ustaw PIN</button>
      </div>
      <div class="admin-actions">
        <input type="text" class="adm-name" placeholder="Zmień imię" style="max-width:130px" />
        <button class="btn btn-ghost btn-sm" data-adm="rename">Zmień imię</button>
        <button class="btn btn-ghost btn-sm" data-adm="view">Podgląd</button>
        <button class="btn btn-danger btn-sm" data-adm="delete">Usuń</button>
      </div>
    </div>`).join('');

  document.getElementById('admin-container').innerHTML = `
    <div class="admin-bar">
      <div class="greeting" style="margin:0">Panel admina 🛡️</div>
      <button class="btn btn-ghost btn-sm" id="admin-logout">Wyloguj</button>
    </div>
    <div class="greeting-sub">Sterujesz wszystkimi kontami TF CARD</div>
    <div class="stat-row">
      <div class="stat"><div class="stat-val">${users.length}</div><div class="stat-label">Konta</div></div>
      <div class="stat"><div class="stat-val">${subs}</div><div class="stat-label">Subskrypcje</div></div>
      <div class="stat"><div class="stat-val">${fmt(total)}</div><div class="stat-label">Suma sald</div></div>
    </div>

    <div class="section-title">Dodaj użytkownika</div>
    <div class="card">
      <div class="row-2">
        <div class="field" style="margin:0"><label>Imię</label><input type="text" id="new-name" placeholder="np. Anna" /></div>
        <div class="field" style="margin:0"><label>PIN (4 cyfry)</label><input type="text" id="new-pin" maxlength="4" placeholder="np. 4321" /></div>
      </div>
      <button class="btn btn-primary btn-block mt" id="add-user">Utwórz konto</button>
    </div>

    <div class="section-title">PIN administratora</div>
    <div class="card">
      <div class="admin-actions" style="margin:0">
        <input type="text" id="admin-pin" maxlength="4" placeholder="Nowy PIN admina" style="max-width:140px" />
        <button class="btn btn-ghost btn-sm" id="set-admin-pin">Zmień PIN admina</button>
      </div>
    </div>

    <div class="section-title">Użytkownicy</div>
    ${usersHTML || '<div class="empty">Brak kont</div>'}`;

  wireAdmin();
}

function wireAdmin() {
  document.getElementById('admin-logout').addEventListener('click', doLogout);

  document.getElementById('add-user').addEventListener('click', async () => {
    const name = document.getElementById('new-name').value.trim();
    const pin = document.getElementById('new-pin').value.trim();
    if (!name) return toast('Podaj imię', 'bad');
    if (!/^\d{4}$/.test(pin)) return toast('PIN to 4 cyfry', 'bad');
    if (Store.users().some(u => u.pin === pin)) return toast('Ten PIN jest już zajęty', 'bad');
    const u = Store.newUser({ name, pin });
    await Store.setUser(u.id, u);
    toast(`Utworzono konto: ${name}`, 'good'); renderAdmin();
  });

  document.getElementById('set-admin-pin').addEventListener('click', async () => {
    const pin = document.getElementById('admin-pin').value.trim();
    if (!/^\d{4}$/.test(pin)) return toast('PIN to 4 cyfry', 'bad');
    await Store.setMeta({ adminPin: pin });
    toast('Zmieniono PIN administratora', 'good');
  });

  document.querySelectorAll('[data-adm]').forEach(btn => btn.addEventListener('click', async () => {
    const wrap = btn.closest('.admin-user');
    const u = Store.state().users[wrap.dataset.uid];
    if (!u) return;
    const action = btn.dataset.adm;

    if (action === 'credit' || action === 'debit') {
      const amt = parseFloat(wrap.querySelector('.adm-amt').value);
      if (!amt || amt <= 0) return toast('Podaj kwotę', 'bad');
      if (action === 'credit') {
        await Store.updateUser(u.id, { balance: (u.balance || 0) + amt });
        await Store.pushTx(u.id, mkTx('in', 'Wpłata od TF CARD (admin)', amt));
        toast(`Uznano ${fmt(amt)} dla ${u.name}`, 'good');
      } else {
        await Store.updateUser(u.id, { balance: Math.max(0, (u.balance || 0) - amt) });
        await Store.pushTx(u.id, mkTx('out', 'Obciążenie TF CARD (admin)', amt));
        toast(`Obciążono ${u.name} o ${fmt(amt)}`, 'good');
      }
    } else if (action === 'plan') {
      await Store.updateUser(u.id, { plan: wrap.querySelector('.adm-plan').value });
      toast(`Zmieniono plan: ${u.name}`, 'good');
    } else if (action === 'setpin') {
      const pin = wrap.querySelector('.adm-pin').value.trim();
      if (!/^\d{4}$/.test(pin)) return toast('PIN to 4 cyfry', 'bad');
      if (Store.users().some(x => x.id !== u.id && x.pin === pin)) return toast('Ten PIN jest zajęty', 'bad');
      await Store.updateUser(u.id, { pin });
      toast(`Zmieniono PIN: ${u.name}`, 'good');
    } else if (action === 'rename') {
      const name = wrap.querySelector('.adm-name').value.trim();
      if (!name) return toast('Podaj imię', 'bad');
      await Store.updateUser(u.id, { name });
      toast('Zmieniono imię', 'good');
    } else if (action === 'view') {
      session = { type: 'user', id: u.id }; saveSession();
      activeView = 'home'; showApp(); render();
      toast(`Podgląd konta: ${u.name}`);
    } else if (action === 'delete') {
      if (!confirm(`Usunąć konto ${u.name}?`)) return;
      await Store.deleteUser(u.id);
      toast('Konto usunięte', 'good');
    }
    renderAdmin();
  }));
}

/* =========================================================================
   PWA — service worker + instalacja na iPhone
   ========================================================================= */
function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }

function showInstall() {
  document.getElementById('ios-install').classList.remove('hidden');
}
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'ios-close') document.getElementById('ios-install').classList.add('hidden');
  if (e.target && e.target.id === 'ios-install') document.getElementById('ios-install').classList.add('hidden');
});

// Podpowiedź instalacji na iPhone przy pierwszym wejściu (gdy nie zainstalowano)
window.addEventListener('load', () => {
  if (isIOS() && !isStandalone() && !localStorage.getItem('tfcard_install_hint')) {
    setTimeout(() => { showInstall(); localStorage.setItem('tfcard_install_hint', '1'); }, 1500);
  }
});

document.addEventListener('DOMContentLoaded', init);
