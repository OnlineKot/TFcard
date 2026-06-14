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
const num = (n) => Number(n) || 0;
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

/* ---------- subskrypcje: PLUS i PRO są niezależne, nadaje je tylko admin ---------- */
function hasSub(u, key) { return !!(u.subs && u.subs[key]); }
function tierOf(u) { return hasSub(u, 'pro') ? 'pro' : hasSub(u, 'plus') ? 'plus' : 'standard'; }
function subLabel(u) {
  const a = [];
  if (hasSub(u, 'plus')) a.push('PLUS');
  if (hasSub(u, 'pro')) a.push('PRO');
  return a.length ? a.join(' + ') : 'STANDARD';
}

/* =========================================================================
   Start
   ========================================================================= */
let analytics = null;
function initAnalytics() {
  try {
    if (window.firebase && firebase.apps && firebase.apps.length && firebase.analytics) {
      analytics = firebase.analytics();
    }
  } catch (e) { /* analytics opcjonalne */ }
}
/* Śledzenie zdarzeń Firebase (jeśli dostępne) */
function track(event, params) {
  try { if (analytics) analytics.logEvent(event, params || {}); } catch (e) { /* ignore */ }
}

async function init() {
  registerSW();
  setupKeypad();
  setupNav();
  setupLanding();
  await Store.init();
  initAnalytics();
  Store.subscribe(onState);
  showStorageMode();
  track('app_open', { backend: Store.backend });
}

const LANDING_KEY = 'tfcard_seen_landing';
function setupLanding() {
  document.getElementById('landing-start').addEventListener('click', () => {
    localStorage.setItem(LANDING_KEY, '1');
    showLock();
  });
}
function showLanding() {
  document.getElementById('landing-screen').classList.remove('hidden');
  document.getElementById('lock-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('admin-screen').classList.add('hidden');
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
  else if (!localStorage.getItem(LANDING_KEY)) showLanding();
  else showLock();
}

/* =========================================================================
   Ekran blokady / PIN
   ========================================================================= */
function showLock() {
  document.getElementById('landing-screen').classList.add('hidden');
  document.getElementById('lock-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('admin-screen').classList.add('hidden');
}

const PIN_MIN = 4;
const PIN_MAX = 8;

function setupKeypad() {
  document.getElementById('keypad').addEventListener('click', (e) => {
    const k = e.target.closest('.key'); if (!k) return;
    const v = k.dataset.k;
    if (v === 'del') { pinBuf = pinBuf.slice(0, -1); updateDots(); return; }
    if (v === 'admin-exit') { if (pinMode === 'admin') setPinMode('user'); return; }
    if (/^\d$/.test(v) && pinBuf.length < PIN_MAX) {
      pinBuf += v; updateDots();
      // PIN-y mają różną długość — próbujemy dopasować po każdej cyfrze
      if (pinBuf.length >= PIN_MIN && tryMatch()) return;
      if (pinBuf.length === PIN_MAX) pinFail(pinMode === 'admin' ? 'Błędny PIN administratora' : 'Błędny PIN');
    }
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
  const n = Math.max(pinBuf.length, 4);
  let html = '';
  for (let i = 0; i < n; i++) html += `<span class="dot${i < pinBuf.length ? ' filled' : ''}"></span>`;
  document.getElementById('pin-dots').innerHTML = html;
}

function pinFail(msg) {
  document.getElementById('pin-error').textContent = msg;
  document.getElementById('pin-dots').classList.add('shake');
  setTimeout(() => { document.getElementById('pin-dots').classList.remove('shake'); pinBuf = ''; updateDots(); }, 450);
}

/* Zwraca true, gdy aktualny pinBuf pasuje do PIN-u (admina lub użytkownika). */
function tryMatch() {
  if (pinMode === 'admin') {
    if (pinBuf !== (Store.meta().adminPin || '951852')) return false;
    session = { type: 'admin' }; saveSession();
    document.getElementById('pin-error').textContent = '';
    setPinMode('user'); showAdmin(); renderAdmin();
    track('login', { role: 'admin' });
    return true;
  }
  const user = Store.users().find(u => u.pin === pinBuf);
  if (!user) return false;
  session = { type: 'user', id: user.id }; saveSession();
  document.getElementById('pin-error').textContent = '';
  activeView = 'home'; showApp(); routeRender();
  track('login', { role: 'user' });
  return true;
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
  document.getElementById('landing-screen').classList.add('hidden');
  document.getElementById('lock-screen').classList.add('hidden');
  document.getElementById('admin-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
}

/* Podświetlenie w dolnej nawigacji dla widoków podrzędnych (np. „Więcej") */
const NAV_FOR = { home: 'home', pay: 'pay', qr: 'pay', teo: 'teo', cards: 'cards', more: 'more', subs: 'more', savings: 'more', profile: 'more', stats: 'more', debt: 'more' };

function navTo(view) {
  activeView = view;
  const navKey = NAV_FOR[view] || 'more';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === navKey));
  render();
}

function setupNav() {
  document.querySelector('.bottom-nav').addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item'); if (!item) return;
    navTo(item.dataset.view);
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
  const views = {
    home: viewHome, pay: viewPay, cards: viewCards, subs: viewSubs,
    teo: viewTeo, more: viewMore, savings: viewSavings,
    profile: viewProfile, stats: viewStats, debt: viewDebt, qr: viewQr,
  };
  const c = document.getElementById('view-container');
  try {
    c.innerHTML = `<div class="fade-in">${(views[activeView] || viewHome)(u)}</div>`;
  } catch (e) {
    console.error(e);
    c.innerHTML = `<div class="empty">Błąd widoku. Spróbuj ponownie.</div>`;
    return;
  }
  const wires = {
    home: wireHome, pay: wirePay, cards: wireCards, subs: wireSubs,
    teo: wireTeo, more: wireMore, savings: wireSavings,
    profile: wireProfile, debt: wireDebt, qr: wireQr,
  };
  if (wires[activeView]) wires[activeView](u);
  window.scrollTo(0, 0);
}

/* ---------- Pulpit ---------- */
function bankCardHTML(u) {
  const tier = tierOf(u);
  const color = tier === 'pro' ? 'pro' : tier === 'plus' ? 'plus' : '';
  return `
    <div class="bankcard ${color}">
      <div class="bankcard-top">
        <div class="bankcard-tier">TF CARD ${subLabel(u)}</div>
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
      <div class="balance-label">Cześć, ${esc(u.name.split(' ')[0])} 👋 • ${new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <div class="balance-amount">${fmt(u.balance)}</div>
      ${(u.frozen) ? '<div class="badge gold" style="margin-top:6px;display:inline-block">❄️ Karta zamrożona</div>' : ''}
    </div>
    <div class="actions-row">
      <div class="action" data-go="pay"><div class="circle">💸</div><span>Wyślij</span></div>
      <div class="action" data-go="qr"><div class="circle">📷</div><span>QR</span></div>
      <div class="action" data-go="teo"><div class="circle">💎</div><span>TEOpoints</span></div>
      <div class="action" data-go="more"><div class="circle">⋯</div><span>Więcej</span></div>
    </div>
    ${bankCardHTML(u)}
    <div class="mini-row">
      <div class="mini" data-go="teo"><span>💎 TEOpoints</span><b>${num(u.teo)}</b></div>
      <div class="mini" data-go="savings"><span>🏦 Skarbonka</span><b>${fmt(u.savings)}</b></div>
      ${num(u.debt) > 0 ? `<div class="mini debt" data-go="debt"><span>📉 Dług</span><b>${fmt(u.debt)}</b></div>` : ''}
    </div>
    <div class="section-title">Ostatnie transakcje</div>
    <div class="card">${txListHTML(txs)}</div>`;
}

const TX_ICON = { in: '⬇️', out: '⬆️', teo_in: '💎', teo_out: '🎁', save: '🏦', unsave: '🏦' };
function txListHTML(txs) {
  if (!txs.length) return `<div class="empty">Brak transakcji</div>`;
  return `<div class="tx-list">` + txs.map(t => {
    const isIn = t.type === 'in' || t.type === 'teo_in' || t.type === 'unsave';
    const isTeo = t.type === 'teo_in' || t.type === 'teo_out';
    const val = isTeo ? `${t.amount} TEOpoints` : fmt(t.amount);
    return `<div class="tx">
      <div class="tx-ico">${TX_ICON[t.type] || '•'}</div>
      <div class="tx-main"><div class="tx-title">${esc(t.title)}</div><div class="tx-sub">${fmtDate(t.ts)}</div></div>
      <div class="tx-amt ${isIn ? 'in' : ''}">${isIn ? '+' : '−'}${val}</div>
    </div>`;
  }).join('') + `</div>`;
}

function wireHome() {
  document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => navTo(el.dataset.go)));
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
  const frozen = !!u.frozen;
  return `
    <div class="greeting">TF PAY ⚡</div>
    <div class="greeting-sub">Saldo: <b>${fmt(u.balance)}</b></div>
    ${frozen ? '<div class="card" style="border-color:var(--gold);margin-bottom:14px">❄️ Karta jest zamrożona — przelewy zablokowane. Odmroź ją w zakładce Karty.</div>' : ''}
    <div class="section-title">Przelew do innego konta TF CARD</div>
    <div class="card">
      <div class="field"><label>Odbiorca</label><select id="pay-to" ${others.length && !frozen ? '' : 'disabled'}>${opts}</select></div>
      <div class="field"><label>Kwota (PLN)</label><input type="number" id="pay-amount" min="0.01" step="0.01" placeholder="0,00" ${frozen ? 'disabled' : ''} /></div>
      <div class="field"><label>Tytuł</label><input type="text" id="pay-title" placeholder="Za kawę ☕" ${frozen ? 'disabled' : ''} /></div>
      <button class="btn btn-primary btn-block" id="pay-send" ${others.length && !frozen ? '' : 'disabled'}>Wyślij przelew</button>
    </div>
    <button class="btn btn-ghost btn-block mt" data-go="qr">📷 Zapłać / odbierz kodem QR</button>
    <div class="section-title">Historia</div>
    <div class="card">${txListHTML(txs)}</div>`;
}

function wirePay(u) {
  document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => navTo(el.dataset.go)));
  document.getElementById('pay-send').addEventListener('click', async () => {
    if (u.frozen) return toast('Karta zamrożona', 'bad');
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
    track('transfer', { amount, currency: 'PLN' });
    toast(`Wysłano ${fmt(amount)} do ${recipient.name}`, 'good');
    render();
  });
}

/* ---------- Płatności kodem QR ---------- */
function payCode(u) { return 'TFPAY:' + u.id; }

function renderQR(elId, text) {
  const el = document.getElementById(elId); if (!el) return;
  el.innerHTML = '';
  if (window.QRCode) {
    try { new QRCode(el, { text, width: 190, height: 190, colorDark: '#0b0f1a', colorLight: '#ffffff' }); return; }
    catch (e) { /* fallback poniżej */ }
  }
  // awaryjnie: obrazek z zewnętrznego generatora
  const img = new Image();
  img.width = 190; img.height = 190;
  img.alt = 'Kod QR';
  img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=190x190&data=' + encodeURIComponent(text);
  el.appendChild(img);
}

function viewQr(u) {
  const frozen = !!u.frozen;
  return `
    <div class="greeting">Płatność QR 📷</div>
    <div class="greeting-sub">Pokaż kod, by otrzymać przelew</div>
    <div class="section-title">Mój kod do płatności</div>
    <div class="card">
      <div class="qr-box" id="qr-box"></div>
      <div class="qr-code-text">${esc(payCode(u))}</div>
      <p class="center muted" style="font-size:12px;margin-top:8px">Inny użytkownik TF CARD skanuje/wpisuje ten kod, aby Ci zapłacić.</p>
    </div>
    <div class="section-title">Zapłać kodem</div>
    <div class="card">
      ${frozen ? '<p class="muted" style="margin-bottom:10px">❄️ Karta zamrożona — płatności zablokowane.</p>' : ''}
      <div class="field"><label>Kod odbiorcy (TFPAY:...)</label><input type="text" id="qr-code" placeholder="TFPAY:u-xxxxxxxx" ${frozen ? 'disabled' : ''} /></div>
      <div class="field"><label>Kwota (PLN)</label><input type="number" id="qr-amount" min="0.01" step="0.01" placeholder="0,00" ${frozen ? 'disabled' : ''} /></div>
      <button class="btn btn-primary btn-block" id="qr-pay" ${frozen ? 'disabled' : ''}>Zapłać</button>
    </div>`;
}

function wireQr(u) {
  renderQR('qr-box', payCode(u));
  document.getElementById('qr-pay').addEventListener('click', async () => {
    if (u.frozen) return toast('Karta zamrożona', 'bad');
    const raw = document.getElementById('qr-code').value.trim();
    const amount = parseFloat(document.getElementById('qr-amount').value);
    const toId = raw.replace(/^TFPAY:/i, '');
    if (!toId) return toast('Wpisz kod odbiorcy', 'bad');
    if (!amount || amount <= 0) return toast('Podaj poprawną kwotę', 'bad');
    if (toId === u.id) return toast('To Twój własny kod', 'bad');
    const recipient = Store.state().users[toId];
    if (!recipient) return toast('Nie znaleziono odbiorcy', 'bad');
    if (amount > num(u.balance)) return toast('Niewystarczające środki', 'bad');

    await Store.updateUser(u.id, { balance: num(u.balance) - amount });
    await Store.pushTx(u.id, mkTx('out', `Płatność QR do ${recipient.name}`, amount));
    await Store.updateUser(recipient.id, { balance: num(recipient.balance) + amount });
    await Store.pushTx(recipient.id, mkTx('in', `Płatność QR od ${u.name}`, amount));
    track('qr_payment', { amount });
    toast(`Zapłacono ${fmt(amount)} dla ${recipient.name}`, 'good');
    navTo('pay');
  });
}

/* ---------- Karty ---------- */
function viewCards(u) {
  return `
    <div class="greeting">Twoje karty 💳</div>
    <div class="greeting-sub">Subskrypcje: ${esc(subLabel(u))}</div>
    ${bankCardHTML(u)}
    <div class="section-title">Szczegóły</div>
    <div class="card">
      <div class="tx"><div class="tx-main"><div class="tx-title">Numer karty</div></div><div>${esc(u.cardNumber)}</div></div>
      <div class="tx"><div class="tx-main"><div class="tx-title">Posiadacz</div></div><div>${esc(u.name)}</div></div>
      <div class="tx"><div class="tx-main"><div class="tx-title">Ważna do</div></div><div>12/29</div></div>
      <div class="tx"><div class="tx-main"><div class="tx-title">CVV</div></div><div>•••</div></div>
      <div class="tx"><div class="tx-main"><div class="tx-title">Subskrypcje</div></div><div>${esc(subLabel(u))}</div></div>
      <div class="tx"><div class="tx-main"><div class="tx-title">Status</div></div><div>${u.frozen ? '❄️ Zamrożona' : '✅ Aktywna'}</div></div>
    </div>
    <div class="row-2 mt">
      <button class="btn ${u.frozen ? 'btn-good' : 'btn-ghost'}" id="card-freeze">${u.frozen ? 'Odmroź kartę' : '❄️ Zamroź kartę'}</button>
      <button class="btn btn-ghost" id="card-regen">Nowy numer</button>
    </div>`;
}

function wireCards(u) {
  document.getElementById('card-regen').addEventListener('click', async () => {
    await Store.updateUser(u.id, { cardNumber: Store.newCard() });
    toast('Wygenerowano nowy numer karty', 'good'); render();
  });
  document.getElementById('card-freeze').addEventListener('click', async () => {
    await Store.updateUser(u.id, { frozen: !u.frozen });
    toast(u.frozen ? 'Karta odmrożona' : 'Karta zamrożona ❄️', 'good'); render();
  });
}

/* ---------- Subskrypcje: PLUS i PRO osobno, nadaje WYŁĄCZNIE admin ---------- */
function subCardHTML(plan, u) {
  const key = plan.id; // 'plus' | 'pro'
  const active = hasSub(u, key);
  const badge = key === 'pro' ? '<span class="badge gold">NAJLEPSZY</span>' : '<span class="badge cyan">POPULARNY</span>';
  const action = active
    ? `<button class="btn btn-good btn-block" disabled>Aktywna ✓</button>`
    : `<button class="btn btn-ghost btn-block" disabled>Aktywuje administrator</button>`;
  return `
    <div class="plan ${plan.color}">
      <div class="plan-head">
        <div class="plan-name">${esc(plan.name)} ${active ? '<span class="badge active-badge">AKTYWNA</span>' : badge}</div>
        <div class="plan-price">${fmt(plan.price)}<small>/mc</small></div>
      </div>
      <div class="muted" style="font-size:13px;margin-top:4px">Cena: <b>${fmt(plan.price)}</b> miesięcznie</div>
      <ul class="plan-list">${plan.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
      ${action}
    </div>`;
}

function viewSubs(u) {
  return `
    <div class="greeting">Subskrypcje ⭐</div>
    <div class="greeting-sub">Aktywne: <b>${esc(subLabel(u))}</b></div>
    ${subCardHTML(PLANS.plus, u)}
    ${subCardHTML(PLANS.pro, u)}
    <p class="center muted" style="font-size:12px;margin-top:6px">PLUS i PRO są niezależne. Subskrypcje nadaje wyłącznie administrator.</p>`;
}

function wireSubs() { /* brak akcji użytkownika — subskrypcje nadaje admin */ }

/* ---------- TEOpoints (punkty i zakupy przyznaje WYŁĄCZNIE admin) ---------- */
const REWARDS = [
  { id: 'r1', name: 'Kawa na koszt TF', cost: 50, icon: '☕' },
  { id: 'r2', name: 'Zwrot 10 zł na konto', cost: 200, icon: '💵', cash: 10 },
  { id: 'r3', name: 'Naklejki TF CARD', cost: 80, icon: '🏷️' },
  { id: 'r4', name: 'Bilet do kina', cost: 500, icon: '🎬' },
  { id: 'r5', name: 'Zwrot 50 zł na konto', cost: 900, icon: '💰', cash: 50 },
];

function viewTeo(u) {
  const history = txArr(u).filter(t => t.type === 'teo_in' || t.type === 'teo_out');
  const purchases = txArr(u).filter(t => t.type === 'teo_out');
  const purchasesHTML = purchases.length
    ? `<div class="tx-list">` + purchases.map(t => `
        <div class="tx">
          <div class="tx-ico">🎁</div>
          <div class="tx-main"><div class="tx-title">${esc(t.title)}</div><div class="tx-sub">${fmtDate(t.ts)}</div></div>
          <div class="tx-amt">${t.amount} 💎</div>
        </div>`).join('') + `</div>`
    : `<div class="empty">Nic jeszcze nie kupiono</div>`;
  return `
    <div class="greeting">TEOpoints 💎</div>
    <div class="greeting-sub">Program lojalnościowy TF CARD</div>
    <div class="bankcard pro">
      <div class="bankcard-top"><div class="bankcard-tier">TEOPOINTS</div><div class="bankcard-chip"></div></div>
      <div><div class="bankcard-balance-label">Twoje punkty</div><div class="bankcard-balance">${num(u.teo)} 💎</div></div>
      <div class="bankcard-bottom"><span>${esc(u.name.toUpperCase())}</span><span>TF&nbsp;LOYALTY</span></div>
    </div>
    <p class="center muted" style="font-size:12px;margin-top:6px">Punkty i zakupy przyznaje wyłącznie administrator.</p>
    <div class="section-title">Twoje zakupy</div>
    <div class="card">${purchasesHTML}</div>
    <div class="section-title">Historia punktów</div>
    <div class="card">${txListHTML(history)}</div>`;
}
function wireTeo() {
  document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => navTo(el.dataset.go)));
}

/* ---------- Skarbonka (oszczędności) ---------- */
function viewSavings(u) {
  const txs = txArr(u).filter(t => t.type === 'save' || t.type === 'unsave');
  return `
    <div class="greeting">Skarbonka 🏦</div>
    <div class="greeting-sub">Odkładaj środki na bok</div>
    <div class="row-2">
      <div class="stat"><div class="stat-val">${fmt(u.savings)}</div><div class="stat-label">W skarbonce</div></div>
      <div class="stat"><div class="stat-val">${fmt(u.balance)}</div><div class="stat-label">Na koncie</div></div>
    </div>
    <div class="section-title">Przenieś środki</div>
    <div class="card">
      <div class="field"><label>Kwota (PLN)</label><input type="number" id="sav-amount" min="0.01" step="0.01" placeholder="0,00" /></div>
      <div class="row-2">
        <button class="btn btn-primary" id="sav-in">Wpłać do skarbonki</button>
        <button class="btn btn-ghost" id="sav-out">Wypłać na konto</button>
      </div>
    </div>
    <div class="section-title">Historia</div>
    <div class="card">${txListHTML(txs)}</div>`;
}
function wireSavings(u) {
  const amt = () => parseFloat(document.getElementById('sav-amount').value);
  document.getElementById('sav-in').addEventListener('click', async () => {
    const a = amt(); if (!a || a <= 0) return toast('Podaj kwotę', 'bad');
    if (a > num(u.balance)) return toast('Za mało na koncie', 'bad');
    await Store.updateUser(u.id, { balance: num(u.balance) - a, savings: num(u.savings) + a });
    await Store.pushTx(u.id, mkTx('save', 'Wpłata do skarbonki', a));
    toast(`Odłożono ${fmt(a)}`, 'good'); render();
  });
  document.getElementById('sav-out').addEventListener('click', async () => {
    const a = amt(); if (!a || a <= 0) return toast('Podaj kwotę', 'bad');
    if (a > num(u.savings)) return toast('Za mało w skarbonce', 'bad');
    await Store.updateUser(u.id, { balance: num(u.balance) + a, savings: num(u.savings) - a });
    await Store.pushTx(u.id, mkTx('unsave', 'Wypłata ze skarbonki', a));
    toast(`Wypłacono ${fmt(a)}`, 'good'); render();
  });
}

/* ---------- Dług (nadaje admin, użytkownik spłaca) ---------- */
function viewDebt(u) {
  const debt = num(u.debt);
  return `
    <div class="greeting">Dług 📉</div>
    <div class="greeting-sub">${debt > 0 ? 'Masz zadłużenie do spłaty' : 'Brak zadłużenia 🎉'}</div>
    <div class="bankcard" style="background:linear-gradient(135deg,#5c1f2b,#7a1f3a)">
      <div class="bankcard-top"><div class="bankcard-tier">DŁUG</div><div class="bankcard-chip"></div></div>
      <div><div class="bankcard-balance-label">Do spłaty</div><div class="bankcard-balance">${fmt(debt)}</div></div>
      <div class="bankcard-bottom"><span>${esc(u.name.toUpperCase())}</span><span>TF&nbsp;CREDIT</span></div>
    </div>
    ${debt > 0 ? `
    <div class="section-title">Spłać dług z konta</div>
    <div class="card">
      <div class="field"><label>Kwota spłaty (PLN)</label><input type="number" id="debt-amount" min="0.01" step="0.01" placeholder="0,00" /></div>
      <div class="row-2">
        <button class="btn btn-good" id="debt-pay">Spłać</button>
        <button class="btn btn-ghost" id="debt-payall">Spłać całość</button>
      </div>
    </div>` : ''}
    <p class="center muted" style="font-size:12px;margin-top:10px">Dług nadaje wyłącznie administrator.</p>`;
}
function wireDebt(u) {
  const pay = async (a) => {
    if (!a || a <= 0) return toast('Podaj kwotę', 'bad');
    if (a > num(u.balance)) return toast('Za mało środków na koncie', 'bad');
    const real = Math.min(a, num(u.debt));
    await Store.updateUser(u.id, { balance: num(u.balance) - real, debt: num(u.debt) - real });
    await Store.pushTx(u.id, mkTx('out', 'Spłata długu', real));
    toast(`Spłacono ${fmt(real)}`, 'good'); render();
  };
  const payBtn = document.getElementById('debt-pay');
  if (payBtn) payBtn.addEventListener('click', () => pay(parseFloat(document.getElementById('debt-amount').value)));
  const allBtn = document.getElementById('debt-payall');
  if (allBtn) allBtn.addEventListener('click', () => pay(num(u.debt)));
}

/* ---------- Profil ---------- */
function viewProfile(u) {
  return `
    <div class="greeting">Profil 👤</div>
    <div class="greeting-sub">${esc(u.name)}</div>
    <div class="card">
      <div class="tx"><div class="tx-main"><div class="tx-title">Imię</div></div><div>${esc(u.name)}</div></div>
      <div class="tx"><div class="tx-main"><div class="tx-title">Karta</div></div><div>${esc(u.cardNumber)}</div></div>
      <div class="tx"><div class="tx-main"><div class="tx-title">Subskrypcje</div></div><div>${esc(subLabel(u))}</div></div>
      <div class="tx"><div class="tx-main"><div class="tx-title">Klient od</div></div><div>${new Date(u.createdAt).toLocaleDateString('pl-PL')}</div></div>
    </div>
    <div class="section-title">Zmień swój PIN</div>
    <div class="card">
      <div class="field"><label>Nowy PIN (4–8 cyfr)</label><input type="text" id="prof-pin" inputmode="numeric" maxlength="8" placeholder="••••" /></div>
      <button class="btn btn-primary btn-block" id="prof-save">Zapisz PIN</button>
    </div>
    <button class="btn btn-danger btn-block mt" id="prof-logout">Wyloguj</button>`;
}
function wireProfile(u) {
  document.getElementById('prof-save').addEventListener('click', async () => {
    const pin = document.getElementById('prof-pin').value.trim();
    if (!/^\d{4,8}$/.test(pin)) return toast('PIN to 4–8 cyfr', 'bad');
    if (pin === (Store.meta().adminPin || '951852')) return toast('Ten PIN jest zajęty', 'bad');
    if (Store.users().some(x => x.id !== u.id && x.pin === pin)) return toast('Ten PIN jest zajęty', 'bad');
    await Store.updateUser(u.id, { pin });
    toast('Zmieniono PIN', 'good');
  });
  document.getElementById('prof-logout').addEventListener('click', doLogout);
}

/* ---------- Statystyki ---------- */
function viewStats(u) {
  const txs = txArr(u);
  const sum = (pred) => txs.filter(pred).reduce((s, t) => s + num(t.amount), 0);
  const inMoney = sum(t => t.type === 'in' || t.type === 'unsave');
  const outMoney = sum(t => t.type === 'out' || t.type === 'save');
  const teoIn = sum(t => t.type === 'teo_in');
  const teoOut = sum(t => t.type === 'teo_out');
  return `
    <div class="greeting">Statystyki 📊</div>
    <div class="greeting-sub">Podsumowanie Twojego konta</div>
    <div class="stat-row">
      <div class="stat"><div class="stat-val">${txs.length}</div><div class="stat-label">Transakcje</div></div>
      <div class="stat"><div class="stat-val">${fmt(u.balance)}</div><div class="stat-label">Saldo</div></div>
      <div class="stat"><div class="stat-val">${num(u.teo)}💎</div><div class="stat-label">TEOpoints</div></div>
    </div>
    <div class="section-title">Przepływy</div>
    <div class="card">
      <div class="tx"><div class="tx-ico">⬇️</div><div class="tx-main"><div class="tx-title">Wpływy</div></div><div class="tx-amt in">+${fmt(inMoney)}</div></div>
      <div class="tx"><div class="tx-ico">⬆️</div><div class="tx-main"><div class="tx-title">Wydatki</div></div><div class="tx-amt">−${fmt(outMoney)}</div></div>
      <div class="tx"><div class="tx-ico">💎</div><div class="tx-main"><div class="tx-title">Zdobyte TEOpoints</div></div><div class="tx-amt in">+${teoIn}</div></div>
      <div class="tx"><div class="tx-ico">🎁</div><div class="tx-main"><div class="tx-title">Wydane TEOpoints</div></div><div class="tx-amt">−${teoOut}</div></div>
    </div>`;
}

/* ---------- Więcej (menu funkcji) ---------- */
function viewMore(u) {
  const item = (view, ico, label, sub) => `
    <div class="more-item" data-go="${view}">
      <div class="more-ico">${ico}</div>
      <div class="more-main"><div class="more-label">${label}</div><div class="more-sub">${sub}</div></div>
      <div class="more-arrow">›</div>
    </div>`;
  return `
    <div class="greeting">Więcej ⋯</div>
    <div class="greeting-sub">Wszystkie funkcje TF CARD</div>
    <div class="card" style="padding:6px 12px">
      ${item('qr', '📷', 'Płatność QR', 'zapłać/odbierz kodem')}
      ${item('subs', '⭐', 'Subskrypcje', 'PLUS i PRO')}
      ${item('savings', '🏦', 'Skarbonka', `${fmt(u.savings)} odłożone`)}
      ${item('teo', '💎', 'TEOpoints', `${num(u.teo)} punktów`)}
      ${item('debt', '📉', 'Dług', num(u.debt) > 0 ? fmt(u.debt) + ' do spłaty' : 'brak')}
      ${item('stats', '📊', 'Statystyki', 'podsumowanie konta')}
      ${item('cards', '💳', 'Karty', u.frozen ? 'zamrożona' : 'aktywna')}
      ${item('profile', '👤', 'Profil', 'dane i PIN')}
    </div>
    <button class="btn btn-danger btn-block mt" id="more-logout">Wyloguj</button>`;
}
function wireMore() {
  document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => navTo(el.dataset.go)));
  document.getElementById('more-logout').addEventListener('click', doLogout);
}

/* =========================================================================
   Panel administratora
   ========================================================================= */
function showAdmin() {
  document.getElementById('landing-screen').classList.add('hidden');
  document.getElementById('lock-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('admin-screen').classList.remove('hidden');
}

function renderAdmin() {
  const users = Store.users();
  const total = users.reduce((s, u) => s + (Number(u.balance) || 0), 0);
  const subs = users.reduce((s, u) => s + (hasSub(u, 'plus') ? 1 : 0) + (hasSub(u, 'pro') ? 1 : 0), 0);

  const subBtn = (u, key) => hasSub(u, key)
    ? `<button class="btn btn-danger btn-sm" data-adm="revoke" data-key="${key}">Cofnij ${PLANS[key].tier}</button>`
    : `<button class="btn btn-good btn-sm" data-adm="give" data-key="${key}">Nadaj ${PLANS[key].tier} • ${fmt(PLANS[key].price)}/mc</button>`;

  const usersHTML = users.map(u => `
    <div class="admin-user" data-uid="${u.id}" data-name="${esc(u.name.toLowerCase())}">
      <div class="admin-user-top">
        <div>
          <div class="admin-user-name">${esc(u.name)}
            ${hasSub(u, 'plus') ? '<span class="badge cyan">PLUS</span>' : ''}
            ${hasSub(u, 'pro') ? '<span class="badge gold">PRO</span>' : ''}
            ${!hasSub(u, 'plus') && !hasSub(u, 'pro') ? '<span class="badge active-badge">STANDARD</span>' : ''}
          </div>
          <div class="admin-user-meta">PIN: <b>${esc(u.pin)}</b> • Saldo: <b>${fmt(u.balance)}</b> • Transakcje: ${Object.keys(u.transactions || {}).length}</div>
          <div class="admin-user-meta">💎 ${num(u.teo)} TEOpoints • 🏦 ${fmt(u.savings)} • 📉 ${fmt(u.debt)}${u.frozen ? ' • ❄️ zamrożona' : ''}</div>
          <div class="admin-user-meta">${esc(u.cardNumber)}</div>
        </div>
      </div>
      <div class="admin-actions">
        <input type="number" class="adm-amt" placeholder="Kwota zł" style="max-width:95px" />
        <button class="btn btn-good btn-sm" data-adm="credit">Uznaj</button>
        <button class="btn btn-danger btn-sm" data-adm="debit">Obciąż</button>
      </div>
      <div class="admin-actions">
        <input type="number" class="adm-teo" placeholder="TEOpoints 💎" style="max-width:120px" />
        <button class="btn btn-good btn-sm" data-adm="teo-add">Dodaj TEOpoints</button>
        <button class="btn btn-danger btn-sm" data-adm="teo-sub">Zabierz</button>
      </div>
      <div class="admin-actions">
        <select class="adm-buy">${REWARDS.map(r => `<option value="${r.id}">${r.icon} ${r.name} • ${r.cost}💎${r.cash ? ` (+${fmt(r.cash)})` : ''}</option>`).join('')}</select>
        <button class="btn btn-good btn-sm" data-adm="buy">Przyznaj zakup</button>
      </div>
      <div class="admin-actions">
        <input type="number" class="adm-debt" placeholder="Dług zł" style="max-width:90px" />
        <button class="btn btn-danger btn-sm" data-adm="debt-add">Nadaj dług</button>
        <button class="btn btn-good btn-sm" data-adm="debt-sub">Umorz dług</button>
      </div>
      <div class="admin-actions">
        ${subBtn(u, 'plus')}
        ${subBtn(u, 'pro')}
        <button class="btn btn-ghost btn-sm" data-adm="freeze">${u.frozen ? 'Odmroź' : 'Zamroź'} kartę</button>
      </div>
      <div class="admin-actions">
        <input type="text" class="adm-pin" placeholder="Nowy PIN" maxlength="8" style="max-width:90px" />
        <button class="btn btn-ghost btn-sm" data-adm="setpin">Ustaw PIN</button>
        <input type="text" class="adm-name" placeholder="Zmień imię" style="max-width:120px" />
        <button class="btn btn-ghost btn-sm" data-adm="rename">Zmień imię</button>
      </div>
      <div class="admin-actions">
        <button class="btn btn-ghost btn-sm" data-adm="view">Podgląd</button>
        <button class="btn btn-danger btn-sm" data-adm="delete">Usuń konto</button>
      </div>
    </div>`).join('');

  document.getElementById('admin-container').innerHTML = `
    <div class="admin-bar">
      <div class="greeting" style="margin:0">Panel admina 🛡️</div>
      <button class="btn btn-ghost btn-sm" id="admin-logout">Wyloguj</button>
    </div>
    <div class="greeting-sub">Sterujesz wszystkimi kontami TF CARD</div>
    ${Store.backend !== 'firebase' ? `
    <div class="card" style="border-color:var(--gold);margin-bottom:14px">
      <b>⚠️ Dokończ konfigurację Firebase</b>
      <div class="muted" style="font-size:13px;margin-top:6px">Teraz dane są tylko na tym telefonie. Aby działały na wielu:</div>
      <ol style="margin:8px 0 0 18px;font-size:13px;line-height:1.6">
        <li>Firebase → <b>Databases &amp; Storage</b> → Firestore → <b>Create database</b> (region eur3, tryb testowy)</li>
        <li>Firebase → <b>Security</b> → Authentication → <b>Anonymous</b> → Enable</li>
      </ol>
    </div>` : `
    <div class="card" style="border-color:var(--good);margin-bottom:14px">🔒 Firebase połączony — sync na wielu telefonach działa.</div>`}
    <div class="stat-row">
      <div class="stat"><div class="stat-val">${users.length}</div><div class="stat-label">Konta</div></div>
      <div class="stat"><div class="stat-val">${subs}</div><div class="stat-label">Subskrypcje</div></div>
      <div class="stat"><div class="stat-val">${fmt(total)}</div><div class="stat-label">Suma sald</div></div>
    </div>

    <div class="section-title">Kreator kont 🧩</div>
    <div class="card">
      <div class="row-2">
        <div class="field" style="margin:0"><label>Imię</label><input type="text" id="new-name" placeholder="np. Anna" /></div>
        <div class="field" style="margin:0"><label>PIN (4–8 cyfr)</label><input type="text" id="new-pin" inputmode="numeric" maxlength="8" placeholder="np. 4321" /></div>
      </div>
      <div class="field mt" style="margin-bottom:0"><label>Saldo startowe (zł)</label><input type="number" id="new-balance" min="0" step="0.01" placeholder="0,00" /></div>
      <div class="admin-actions" style="margin-top:12px">
        <label style="display:flex;align-items:center;gap:6px;font-size:14px"><input type="checkbox" id="new-plus" /> PLUS</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:14px"><input type="checkbox" id="new-pro" /> PRO</label>
      </div>
      <button class="btn btn-primary btn-block mt" id="add-user">Utwórz konto</button>
    </div>

    <div class="section-title">PIN administratora</div>
    <div class="card">
      <div class="admin-actions" style="margin:0">
        <input type="text" id="admin-pin" inputmode="numeric" maxlength="8" placeholder="Nowy PIN admina (4–8 cyfr)" style="max-width:200px" />
        <button class="btn btn-ghost btn-sm" id="set-admin-pin">Zmień PIN admina</button>
      </div>
    </div>

    <div class="section-title">Użytkownicy (${users.length})</div>
    ${users.length ? '<input type="text" id="admin-search" class="admin-search" placeholder="🔎 Szukaj po imieniu…" />' : ''}
    <div id="admin-users">${usersHTML || '<div class="empty">Brak kont — utwórz w Kreatorze kont</div>'}</div>`;

  wireAdmin();
}

function wireAdmin() {
  document.getElementById('admin-logout').addEventListener('click', doLogout);

  const search = document.getElementById('admin-search');
  if (search) search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    document.querySelectorAll('#admin-users .admin-user').forEach(el => {
      el.style.display = el.dataset.name.includes(q) ? '' : 'none';
    });
  });

  document.getElementById('add-user').addEventListener('click', async () => {
    const name = document.getElementById('new-name').value.trim();
    const pin = document.getElementById('new-pin').value.trim();
    const balance = parseFloat(document.getElementById('new-balance').value) || 0;
    const plus = document.getElementById('new-plus').checked;
    const pro = document.getElementById('new-pro').checked;
    if (!name) return toast('Podaj imię', 'bad');
    if (!/^\d{4,8}$/.test(pin)) return toast('PIN to 4–8 cyfr', 'bad');
    if (pin === (Store.meta().adminPin || '951852')) return toast('Ten PIN jest zajęty (admin)', 'bad');
    if (Store.users().some(u => u.pin === pin)) return toast('Ten PIN jest już zajęty', 'bad');
    const u = Store.newUser({ name, pin, balance, plus, pro });
    await Store.setUser(u.id, u);
    track('account_create', { plus, pro });
    toast(`Utworzono konto: ${name}`, 'good'); renderAdmin();
  });

  document.getElementById('set-admin-pin').addEventListener('click', async () => {
    const pin = document.getElementById('admin-pin').value.trim();
    if (!/^\d{4,8}$/.test(pin)) return toast('PIN to 4–8 cyfr', 'bad');
    if (Store.users().some(u => u.pin === pin)) return toast('Ten PIN jest zajęty przez użytkownika', 'bad');
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
    } else if (action === 'teo-add' || action === 'teo-sub') {
      const amt = parseInt(wrap.querySelector('.adm-teo').value, 10);
      if (!amt || amt <= 0) return toast('Podaj liczbę punktów', 'bad');
      if (action === 'teo-add') {
        await Store.updateUser(u.id, { teo: num(u.teo) + amt });
        await Store.pushTx(u.id, mkTx('teo_in', 'TEOpoints od admina', amt));
        track('teo_grant', { amount: amt });
        toast(`Dodano ${amt} 💎 dla ${u.name}`, 'good');
      } else {
        await Store.updateUser(u.id, { teo: Math.max(0, num(u.teo) - amt) });
        await Store.pushTx(u.id, mkTx('teo_out', 'Korekta TEOpoints (admin)', amt));
        toast(`Zabrano ${amt} 💎 od ${u.name}`, 'good');
      }
    } else if (action === 'buy') {
      const r = REWARDS.find(x => x.id === wrap.querySelector('.adm-buy').value);
      if (!r) return;
      if (num(u.teo) < r.cost) return toast(`${u.name} ma za mało punktów (${num(u.teo)}/${r.cost})`, 'bad');
      const patch = { teo: num(u.teo) - r.cost };
      if (r.cash) patch.balance = num(u.balance) + r.cash;
      await Store.updateUser(u.id, patch);
      await Store.pushTx(u.id, mkTx('teo_out', `Zakup: ${r.name}`, r.cost));
      if (r.cash) await Store.pushTx(u.id, mkTx('in', `Zwrot za zakup: ${r.name}`, r.cash));
      track('purchase_grant', { reward: r.id });
      toast(`Przyznano zakup „${r.name}" dla ${u.name}`, 'good');
    } else if (action === 'debt-add' || action === 'debt-sub') {
      const amt = parseFloat(wrap.querySelector('.adm-debt').value);
      if (!amt || amt <= 0) return toast('Podaj kwotę', 'bad');
      if (action === 'debt-add') {
        await Store.updateUser(u.id, { debt: num(u.debt) + amt });
        toast(`Nadano dług ${fmt(amt)}: ${u.name}`, 'good');
      } else {
        await Store.updateUser(u.id, { debt: Math.max(0, num(u.debt) - amt) });
        toast(`Umorzono ${fmt(amt)} długu: ${u.name}`, 'good');
      }
    } else if (action === 'freeze') {
      await Store.updateUser(u.id, { frozen: !u.frozen });
      toast(u.frozen ? `Odmrożono kartę: ${u.name}` : `Zamrożono kartę: ${u.name}`, 'good');
    } else if (action === 'give') {
      const key = btn.dataset.key;
      await Store.updateUser(u.id, { subs: Object.assign({}, u.subs, { [key]: true }) });
      track('sub_grant', { plan: key });
      toast(`Nadano ${PLANS[key].name}: ${u.name}`, 'good');
    } else if (action === 'revoke') {
      const key = btn.dataset.key;
      await Store.updateUser(u.id, { subs: Object.assign({}, u.subs, { [key]: false }) });
      toast(`Cofnięto ${PLANS[key].name}: ${u.name}`);
    } else if (action === 'setpin') {
      const pin = wrap.querySelector('.adm-pin').value.trim();
      if (!/^\d{4,8}$/.test(pin)) return toast('PIN to 4–8 cyfr', 'bad');
      if (pin === (Store.meta().adminPin || '951852')) return toast('Ten PIN jest zajęty (admin)', 'bad');
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
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // Sprawdzaj aktualizacje przy każdym wejściu — aplikacja jest „ulepszalna"
      reg.update();
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            sw.postMessage('skip-waiting');
            toast('Dostępna nowa wersja — aktualizuję…');
          }
        });
      });
    }).catch(() => {});
    let refreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshed) return; refreshed = true; window.location.reload();
    });
  });
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
