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
    features: ['Debet do 20 zł', 'Zniżka 10% w TFKF Cafe', 'Prezent urodzinowy: 100 💎 + 25 zł', 'Niebieski akcent konta', 'Wsparcie priorytetowe'] },
  pro: { id: 'pro', name: 'TF CARD PRO', tier: 'PRO', price: 39.99, color: 'pro',
    features: ['Debet do 35 zł', 'Zniżka 25% w TFKF Cafe', 'Prezent urodzinowy: 250 💎 + 100 zł', 'Złoty wygląd konta ✨', 'Doradca 24/7'] },
};

/* Perki zależne od planu */
const BDAY = { standard: { teo: 25, cash: 0 }, plus: { teo: 100, cash: 25 }, pro: { teo: 250, cash: 100 } };
const CAFE_FACTOR = { standard: 1, plus: 0.90, pro: 0.75 }; // zniżka w Cafe
function cafeFactor(u) { return CAFE_FACTOR[(u.subs && u.subs.pro) ? 'pro' : (u.subs && u.subs.plus) ? 'plus' : 'standard']; }

/* ---------- stan sesji ---------- */
let session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); // {type:'user',id} | {type:'admin'}
let activeView = 'home';
let pinMode = 'user';   // 'user' | 'admin'
let pinBuf = '';
let myCode = '';        // jednorazowy kod płatności do otrzymania

/* ---------- pomocnicze ---------- */
const fmt = (n) => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(Number(n) || 0);
const num = (n) => Number(n) || 0;
const fmtDate = (ts) => new Date(ts).toLocaleDateString('pl-PL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const dtLocal = (ts) => { const d = new Date(ts), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const txArr = (u) => Object.values(u.transactions || {}).sort((a, b) => b.ts - a.ts);
const initials = (name) => name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
function mkTx(type, title, amount, desc) {
  const t = { type, title, amount: Number(amount), ts: Date.now() };
  if (desc) t.desc = desc;
  return t;
}

function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'toast show ' + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast ' + kind; }, 2600);
}

/* Konfetti — animacja świętowania (czysty canvas, bez bibliotek) */
function celebrate() {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = document.createElement('canvas');
  cv.className = 'confetti-cv';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = cv.width = innerWidth * dpr, H = cv.height = innerHeight * dpr;
  cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
  const colors = ['#6e8bff', '#a06bff', '#2ee6a6', '#f4c45a', '#ff5d7a', '#ffffff'];
  const N = Math.min(140, Math.floor(innerWidth / 3));
  const P = Array.from({ length: N }, () => ({
    x: W / 2 + (Math.random() - .5) * 80 * dpr,
    y: H * 0.32,
    vx: (Math.random() - .5) * 11 * dpr,
    vy: (Math.random() * -10 - 5) * dpr,
    g: (0.28 + Math.random() * 0.18) * dpr,
    s: (4 + Math.random() * 6) * dpr,
    rot: Math.random() * 6.28, vr: (Math.random() - .5) * 0.4,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  (function frame(t) {
    const elapsed = t - t0;
    ctx.clearRect(0, 0, W, H);
    P.forEach(p => {
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - elapsed / 1800);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.5);
      ctx.restore();
    });
    if (elapsed < 1800) requestAnimationFrame(frame);
    else cv.remove();
  })(t0);
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

/* Ile dni do najbliższych urodzin (null gdy brak daty) */
function daysToBirthday(u) {
  if (!u || !u.birthday) return null;
  const [m, d] = u.birthday.split('-').map(Number);
  if (!m || !d) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  let next = new Date(now.getFullYear(), m - 1, d);
  if (next < now) next = new Date(now.getFullYear() + 1, m - 1, d);
  return Math.round((next - now) / 86400000);
}
function bdayLine(u) {
  const d = daysToBirthday(u);
  if (d === null) return '';
  const txt = d === 0 ? 'Dziś Twoje urodziny! 🎉' : `Do urodzin: ${d} ${d === 1 ? 'dzień' : 'dni'}`;
  return `<div class="muted" style="font-size:12px;margin-top:6px">🎂 ${txt}</div>`;
}

/* Dług: 31 dni na spłatę, potem co 31 dni rośnie o 50% */
const DEBT_DAY = 86400000, DEBT_DAYS = 31, DEBT_RATE = 1.5;
function debtDaysLeft(u) {
  if (num(u.debt) <= 0) return null;
  const since = u.debtSince || Date.now();
  return Math.ceil((since + DEBT_DAYS * DEBT_DAY - Date.now()) / DEBT_DAY);
}
async function checkDebt() {
  const u = currentUser(); if (!u) return;
  const debt = num(u.debt); if (debt <= 0) return;
  const since = u.debtSince || 0;
  if (!since) { await Store.updateUser(u.id, { debtSince: Date.now() }); return; }
  if (Date.now() >= since + DEBT_DAYS * DEBT_DAY) {
    const inc = Math.round(debt * DEBT_RATE * 100) / 100;
    await Store.updateUser(u.id, { debt: inc, debtSince: since + DEBT_DAYS * DEBT_DAY });
    await Store.pushTx(u.id, mkTx('out', 'Odsetki od długu (+50%)', Math.round((inc - debt) * 100) / 100));
    toast('Naliczono odsetki od długu (+50%)', 'bad');
  }
}

/* Prezent urodzinowy — TEOpoints + kasa, raz w roku, zależnie od planu */
async function checkBirthday() {
  const u = currentUser(); if (!u || !u.birthday) return;
  const now = new Date();
  const mmdd = String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  if (u.birthday !== mmdd || u.bdayYear === now.getFullYear()) return;
  const b = BDAY[tierOf(u)];
  const patch = Object.assign({ bdayYear: now.getFullYear(), teo: num(u.teo) + b.teo },
    b.cash > 0 ? Store.applyCredit(u, b.cash) : {});
  await Store.updateUser(u.id, patch);
  if (b.teo > 0) await Store.pushTx(u.id, mkTx('teo_in', 'Prezent urodzinowy 🎂', b.teo));
  if (b.cash > 0) await Store.pushTx(u.id, mkTx('in', 'Prezent urodzinowy 🎂', b.cash));
  toast('Wszystkiego najlepszego! 🎂🎉', 'good');
  celebrate();
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
  setupTxModal();
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
  if (session && session.type === 'user') { showApp(); routeRender(); checkBirthday(); checkDebt(); }
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
  const noAdminPin = mode === 'admin' && !(Store.meta && Store.meta().adminPin);
  document.getElementById('lock-sub').textContent = mode === 'admin'
    ? (noAdminPin ? 'Ustaw nowy PIN administratora' : 'PIN administratora')
    : 'Wpisz kod PIN';
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
    const stored = Store.meta().adminPin || '';
    if (!stored) {
      // Pierwsze uruchomienie: PIN admina nie jest w kodzie — ustaw go teraz.
      if (pinBuf.length < PIN_MIN) return false;
      Store.setMeta({ adminPin: pinBuf });
      toast('Ustawiono PIN administratora');
    } else if (pinBuf !== stored) {
      return false;
    }
    session = { type: 'admin' }; saveSession();
    document.getElementById('pin-error').textContent = '';
    setPinMode('user'); ensureAdminAccount(); showAdmin(); renderAdmin();
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

/* Konto admina (żeby admin też miał saldo, TEOpoints i mógł korzystać z kasy/cafe) */
function adminAccount() { return Store.users().find(u => u.isAdminAcct) || null; }
async function ensureAdminAccount() {
  if (adminAccount()) return;
  const pin = Store.meta().adminPin;
  if (!pin) return;
  const free = !Store.users().some(u => u.pin === pin);
  const u = Store.newUser({ name: 'Admin', pin: free ? pin : ('9' + Math.floor(1000 + Math.random() * 8999)) });
  u.isAdminAcct = true;
  u.subs = { plus: true, pro: true };
  await Store.setUser(u.id, u);
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
const NAV_FOR = { home: 'home', pay: 'pay', qr: 'pay', teo: 'teo', more: 'more', subs: 'more', savings: 'more', profile: 'more', stats: 'more', debt: 'more' };

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
  const app = document.getElementById('app-screen');
  app.classList.remove('tier-pro', 'tier-plus');
  const t = tierOf(u);
  if (t === 'pro') app.classList.add('tier-pro'); else if (t === 'plus') app.classList.add('tier-plus');
  const views = {
    home: viewHome, pay: viewPay, subs: viewSubs,
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
    home: wireHome, pay: wirePay, subs: wireSubs,
    teo: wireTeo, more: wireMore, savings: wireSavings,
    profile: wireProfile, debt: wireDebt, qr: wireQr,
  };
  if (wires[activeView]) wires[activeView](u);
  window.scrollTo(0, 0);
}

/* ---------- Pulpit ---------- */
function monthSpend(u) {
  const now = new Date(), m = now.getMonth(), y = now.getFullYear();
  return txArr(u).filter(t => {
    const d = new Date(t.ts);
    return (t.type === 'out') && d.getMonth() === m && d.getFullYear() === y;
  }).reduce((s, t) => s + num(t.amount), 0);
}
function viewHome(u) {
  const all = txArr(u);
  const txs = all.slice(0, 25);
  return `
    <div class="home-head">
      <div class="avatar">${esc(initials(u.name))}</div>
      <div class="home-head-actions">
        <button class="icon-btn key-ghost" id="install-btn" title="Zainstaluj" style="background:var(--card-2);border:none;color:var(--txt);width:40px;height:40px;border-radius:12px;font-size:18px;cursor:pointer">⤓</button>
        <button class="icon-btn" id="logout-btn" title="Wyloguj" style="background:var(--card-2);border:none;color:var(--txt);width:40px;height:40px;border-radius:12px;font-size:18px;cursor:pointer">⎋</button>
      </div>
    </div>
    ${Store.meta().announce ? `<div class="card" style="border-color:var(--accent);margin-bottom:14px">📢 ${esc(Store.meta().announce)}</div>` : ''}
    ${u.message ? `<div class="card" style="border-color:var(--gold);margin-bottom:14px">✉️ ${esc(u.message)} <button class="btn btn-ghost btn-sm mt" id="msg-clear">OK</button></div>` : ''}
    <div class="balance-block">
      <div class="balance-label">Cześć, ${esc(u.name.split(' ')[0])} 👋 • ${new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <div class="balance-amount">${fmt(u.balance)}</div>
      ${(u.frozen) ? '<div class="badge gold" style="margin-top:6px;display:inline-block">❄️ Płatności zablokowane</div>' : ''}
      ${bdayLine(u)}
    </div>
    <div class="actions-row">
      <div class="action" data-go="pay"><div class="circle">💸</div><span>Wyślij</span></div>
      <div class="action" data-go="qr"><div class="circle">📷</div><span>QR</span></div>
      <div class="action" data-go="teo"><div class="circle">💎</div><span>TEOpoints</span></div>
      <div class="action" data-go="more"><div class="circle">⋯</div><span>Więcej</span></div>
    </div>
    <div class="mini-row">
      <div class="mini"><span>📊 Wydatki w tym mies.</span><b>${fmt(monthSpend(u))}</b></div>
      <div class="mini" data-go="teo"><span>💎 TEOpoints</span><b>${num(u.teo)}</b></div>
      <div class="mini" data-go="savings"><span>🏦 Skarbonka</span><b>${fmt(u.savings)}</b></div>
      ${num(u.debt) > 0 ? `<div class="mini debt" data-go="debt"><span>📉 Dług</span><b>${fmt(u.debt)}</b></div>` : ''}
    </div>
    <div class="section-title">Transakcje</div>
    <input type="text" id="tx-search" class="admin-search" placeholder="🔎 Szukaj transakcji…" />
    <div class="card">${txListHTML(txs)}</div>`;
}

const TX_ICON = { in: '⬇️', out: '⬆️', teo_in: '💎', teo_out: '🎁', save: '🏦', unsave: '🏦' };
function txListHTML(txs) {
  if (!txs.length) return `<div class="empty">Brak transakcji</div>`;
  return `<div class="tx-list">` + txs.map(t => {
    const isIn = t.type === 'in' || t.type === 'teo_in' || t.type === 'unsave';
    const isTeo = t.type === 'teo_in' || t.type === 'teo_out';
    const val = isTeo ? `${t.amount} TEOpoints` : fmt(t.amount);
    const amt = `${isIn ? '+' : '−'}${val}`;
    return `<div class="tx" data-txrow data-ico="${TX_ICON[t.type] || '•'}" data-title="${esc(t.title)}" data-desc="${esc(t.desc || '')}" data-amt="${esc(amt)}" data-date="${esc(fmtDate(t.ts))}" data-kind="${isIn ? 'in' : 'out'}">
      <div class="tx-ico">${TX_ICON[t.type] || '•'}</div>
      <div class="tx-main"><div class="tx-title">${esc(t.title)}</div><div class="tx-sub">${t.desc ? esc(t.desc) + ' • ' : ''}${fmtDate(t.ts)}</div></div>
      <div class="tx-amt ${isIn ? 'in' : ''}">${amt}</div>
    </div>`;
  }).join('') + `</div>`;
}

/* Modal szczegółów transakcji (Revolut-style) */
function openTxModal(d) {
  document.getElementById('txm-ico').textContent = d.ico || '•';
  const amtEl = document.getElementById('txm-amt');
  amtEl.textContent = d.amt || '';
  amtEl.className = 'tx-modal-amt ' + (d.kind === 'in' ? 'in' : '');
  document.getElementById('txm-title').textContent = d.title || '';
  document.getElementById('txm-desc').textContent = d.desc || '';
  document.getElementById('txm-date').textContent = d.date || '';
  document.getElementById('tx-modal').classList.remove('hidden');
}
function setupTxModal() {
  document.getElementById('tx-modal').addEventListener('click', (e) => {
    if (e.target.id === 'tx-modal' || e.target.id === 'txm-close') document.getElementById('tx-modal').classList.add('hidden');
  });
  document.getElementById('view-container').addEventListener('click', (e) => {
    const row = e.target.closest('[data-txrow]');
    if (row) openTxModal(row.dataset);
  });
}

function wireHome() {
  document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => navTo(el.dataset.go)));
  document.getElementById('logout-btn').addEventListener('click', doLogout);
  document.getElementById('install-btn').addEventListener('click', showInstall);
  const mc = document.getElementById('msg-clear');
  if (mc) mc.addEventListener('click', async () => { await Store.updateUser(currentUser().id, { message: '' }); render(); });
  const s = document.getElementById('tx-search');
  if (s) s.addEventListener('input', () => {
    const q = s.value.trim().toLowerCase();
    document.querySelectorAll('#view-container .tx').forEach(el => {
      const hit = (el.dataset.title + ' ' + (el.dataset.desc || '')).toLowerCase().includes(q);
      el.style.display = hit ? '' : 'none';
    });
  });
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
    ${frozen ? '<div class="card" style="border-color:var(--gold);margin-bottom:14px">❄️ Płatności zablokowane. Odblokuj w Profilu (Więcej → Profil).</div>' : ''}
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
    if (u.frozen) return toast('Płatności zablokowane', 'bad');
    const toId = document.getElementById('pay-to').value;
    const amount = parseFloat(document.getElementById('pay-amount').value);
    const title = document.getElementById('pay-title').value.trim() || 'Przelew TF PAY';
    if (!toId) return toast('Wybierz odbiorcę', 'bad');
    if (!amount || amount <= 0) return toast('Podaj poprawną kwotę', 'bad');
    const recipient = Store.state().users[toId];
    if (!recipient) return toast('Nie znaleziono odbiorcy', 'bad');
    const charge = Store.applyCharge(u, amount);
    if (!charge) return toast('Niewystarczające środki (limit debetu wykorzystany)', 'bad');

    await Store.updateUser(u.id, charge);
    await Store.pushTx(u.id, mkTx('out', `Przelew do ${recipient.name}: ${title}`, amount));
    await Store.updateUser(recipient.id, Store.applyCredit(recipient, amount));
    await Store.pushTx(recipient.id, mkTx('in', `Przelew od ${u.name}: ${title}`, amount));
    track('transfer', { amount, currency: 'PLN' });
    toast(`Wysłano ${fmt(amount)} do ${recipient.name}`, 'good');
    celebrate();
    render();
  });
}

/* ---------- Płatności kodem QR (jednorazowy 6-cyfrowy) ---------- */

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

/* Skaner QR — kamera + jsQR */
let _scanStream = null, _scanRAF = null;
function startScan(onResult) {
  if (!window.jsQR) return toast('Skaner niedostępny — wpisz kod ręcznie', 'bad');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast('Brak dostępu do kamery', 'bad');
  const overlay = document.getElementById('qr-scanner');
  const video = document.getElementById('qr-video');
  overlay.classList.remove('hidden');
  document.getElementById('qr-scan-close').onclick = stopScan;
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(stream => {
    _scanStream = stream; video.srcObject = stream; video.setAttribute('playsinline', 'true');
    video.play();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = () => {
      if (!_scanStream) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const res = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (res && res.data) { const data = res.data; stopScan(); onResult(data); return; }
      }
      _scanRAF = requestAnimationFrame(tick);
    };
    _scanRAF = requestAnimationFrame(tick);
  }).catch(() => { overlay.classList.add('hidden'); toast('Nie udało się włączyć kamery', 'bad'); });
}
function stopScan() {
  document.getElementById('qr-scanner').classList.add('hidden');
  if (_scanRAF) { cancelAnimationFrame(_scanRAF); _scanRAF = null; }
  if (_scanStream) { _scanStream.getTracks().forEach(t => t.stop()); _scanStream = null; }
  const video = document.getElementById('qr-video'); if (video) video.srcObject = null;
}

function viewQr(u) {
  const frozen = !!u.frozen;
  return `
    <div class="greeting">Płatność QR 📷</div>
    <div class="greeting-sub">Jednorazowy kod 6-cyfrowy</div>
    <div class="section-title">Mój kod do otrzymania wpłaty</div>
    <div class="card">
      ${myCode ? `<div class="qr-box" id="qr-box"></div>
        <div class="qr-code-text">${esc(myCode)}</div>
        <p class="center muted" style="font-size:12px;margin-top:8px">Jednorazowy — znika po opłaceniu. Pokaż go płacącemu.</p>`
        : '<p class="center muted" style="padding:10px">Wygeneruj jednorazowy kod do otrzymania przelewu.</p>'}
      <button class="btn btn-ghost btn-block mt" id="gen-code">${myCode ? 'Nowy kod' : 'Generuj kod'}</button>
    </div>
    <div class="section-title">Zapłać kodem</div>
    <div class="card">
      ${frozen ? '<p class="muted" style="margin-bottom:10px">❄️ Płatności zablokowane (odblokuj w Profilu).</p>' : ''}
      <div class="field"><label>Kod odbiorcy (6 cyfr)</label><input type="text" id="qr-code" inputmode="numeric" maxlength="6" placeholder="np. 123456" ${frozen ? 'disabled' : ''} /></div>
      <button class="btn btn-ghost btn-block" id="qr-scan" ${frozen ? 'disabled' : ''}>📷 Skanuj kod QR</button>
      <div class="field mt"><label>Kwota (PLN)</label><input type="number" id="qr-amount" min="0.01" step="0.01" placeholder="0,00" ${frozen ? 'disabled' : ''} /></div>
      <button class="btn btn-primary btn-block" id="qr-pay" ${frozen ? 'disabled' : ''}>Zapłać</button>
    </div>`;
}

function wireQr(u) {
  if (myCode) renderQR('qr-box', myCode);
  document.getElementById('gen-code').addEventListener('click', async () => {
    myCode = await Store.genCode(u.id);
    toast('Wygenerowano jednorazowy kod', 'good');
    render();
  });
  document.getElementById('qr-scan').addEventListener('click', () => {
    if (u.frozen) return toast('Płatności zablokowane', 'bad');
    startScan((text) => {
      const code = (text || '').replace(/\D/g, '').slice(0, 6);
      if (code.length !== 6) { toast('To nie jest 6-cyfrowy kod', 'bad'); return; }
      document.getElementById('qr-code').value = code;
      toast('Zeskanowano kod ✓', 'good');
    });
  });
  document.getElementById('qr-pay').addEventListener('click', async () => {
    if (u.frozen) return toast('Płatności zablokowane', 'bad');
    const code = document.getElementById('qr-code').value.replace(/\D/g, '');
    const amount = parseFloat(document.getElementById('qr-amount').value);
    if (code.length !== 6) return toast('Podaj 6-cyfrowy kod', 'bad');
    if (!amount || amount <= 0) return toast('Podaj poprawną kwotę', 'bad');
    const toId = Store.resolveCode(code);
    if (!toId) return toast('Kod nieprawidłowy lub już użyty', 'bad');
    if (toId === u.id) return toast('To Twój własny kod', 'bad');
    const recipient = Store.state().users[toId];
    if (!recipient) return toast('Nie znaleziono odbiorcy', 'bad');
    const charge = Store.applyCharge(u, amount);
    if (!charge) return toast('Niewystarczające środki (limit debetu wykorzystany)', 'bad');

    await Store.updateUser(u.id, charge);
    await Store.pushTx(u.id, mkTx('out', `Płatność QR do ${recipient.name}`, amount));
    await Store.updateUser(recipient.id, Store.applyCredit(recipient, amount));
    await Store.pushTx(recipient.id, mkTx('in', `Płatność QR od ${u.name}`, amount));
    await Store.consumeCode(code); // jednorazowy
    track('qr_payment', { amount });
    toast(`Zapłacono ${fmt(amount)} dla ${recipient.name}`, 'good');
    celebrate();
    navTo('pay');
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
      </div>
      <ul class="plan-list">${plan.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
      ${action}
    </div>`;
}

function viewSubs(u) {
  return `
    <div class="greeting">Plany ⭐</div>
    <div class="greeting-sub">Aktywne: <b>${esc(subLabel(u))}</b></div>
    ${subCardHTML(PLANS.plus, u)}
    ${subCardHTML(PLANS.pro, u)}
    <p class="center muted" style="font-size:12px;margin-top:6px">PLUS i PRO są niezależne. Aktywuje je administrator.</p>`;
}

function wireSubs() { /* brak akcji użytkownika — subskrypcje nadaje admin */ }

/* ---------- TEOpoints (punkty przyznaje WYŁĄCZNIE admin) ---------- */
function viewTeo(u) {
  const history = txArr(u).filter(t => t.type === 'teo_in' || t.type === 'teo_out');
  return `
    <div class="greeting">TEOpoints 💎</div>
    <div class="greeting-sub">Program lojalnościowy TF CARD</div>
    <div class="bankcard pro">
      <div class="bankcard-top"><div class="bankcard-tier">TEOPOINTS</div><div class="bankcard-chip"></div></div>
      <div><div class="bankcard-balance-label">Twoje punkty</div><div class="bankcard-balance">${num(u.teo)} 💎</div></div>
      <div class="bankcard-bottom"><span>${esc(u.name.toUpperCase())}</span><span>TF&nbsp;LOYALTY</span></div>
    </div>
    <p class="center muted" style="font-size:12px;margin-top:6px">Punkty TEOpoints przyznaje wyłącznie administrator.</p>
    <div class="section-title">Historia punktów</div>
    <div class="card">${txListHTML(history)}</div>`;
}
function wireTeo() {
  document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => navTo(el.dataset.go)));
}

/* ---------- Skarbonka + TF Goal (cel oszczędnościowy z postępem) ---------- */
function ringHTML(pct) {
  const R = 52, C = 2 * Math.PI * R;
  const off = C * (1 - Math.min(1, pct));
  return `
    <svg class="goal-ring" viewBox="0 0 130 130" width="130" height="130">
      <circle cx="65" cy="65" r="${R}" fill="none" stroke="var(--line)" stroke-width="12"/>
      <circle cx="65" cy="65" r="${R}" fill="none" stroke="url(#gg)" stroke-width="12" stroke-linecap="round"
        stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 65 65)"/>
      <defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/>
      </linearGradient></defs>
      <text x="65" y="60" text-anchor="middle" fill="var(--txt)" font-size="22" font-weight="800">${Math.round(pct * 100)}%</text>
      <text x="65" y="80" text-anchor="middle" fill="var(--muted)" font-size="11">celu</text>
    </svg>`;
}

function viewSavings(u) {
  const txs = txArr(u).filter(t => t.type === 'save' || t.type === 'unsave');
  const target = num(u.goalTarget);
  const pct = target > 0 ? num(u.savings) / target : 0;
  const reached = target > 0 && num(u.savings) >= target;
  const goalCard = target > 0 ? `
    <div class="card goal-card">
      ${ringHTML(pct)}
      <div class="goal-info">
        <div class="goal-name">🎯 ${esc(u.goalName || 'Mój cel')}</div>
        <div class="goal-amounts">${fmt(u.savings)} <span class="muted">/ ${fmt(target)}</span></div>
        ${reached ? '<div class="badge active-badge" style="margin-top:6px;display:inline-block">Cel osiągnięty! 🎉</div>'
          : `<div class="muted" style="font-size:12px;margin-top:4px">Brakuje ${fmt(target - num(u.savings))}</div>`}
      </div>
    </div>` : '';
  return `
    <div class="greeting">Skarbonka 🏦</div>
    <div class="greeting-sub">Odkładaj środki i realizuj cel</div>
    ${goalCard}
    <div class="row-2">
      <div class="stat"><div class="stat-val">${fmt(u.savings)}</div><div class="stat-label">W skarbonce</div></div>
      <div class="stat"><div class="stat-val">${fmt(u.balance)}</div><div class="stat-label">Na koncie</div></div>
    </div>
    <div class="section-title">Przenieś środki</div>
    <div class="card">
      <div class="field"><label>Kwota (PLN)</label><input type="number" id="sav-amount" min="0.01" step="0.01" placeholder="0,00" /></div>
      <div class="row-2">
        <button class="btn btn-primary" id="sav-in">Wpłać</button>
        <button class="btn btn-ghost" id="sav-out">Wypłać</button>
      </div>
    </div>
    <div class="section-title">TF Goal — cel oszczędnościowy</div>
    <div class="card">
      <div class="field"><label>Nazwa celu</label><input type="text" id="goal-name" maxlength="40" value="${esc(u.goalName || '')}" placeholder="np. Wakacje 🏖️" /></div>
      <div class="field"><label>Kwota docelowa (PLN)</label><input type="number" id="goal-target" min="0" step="0.01" value="${target || ''}" placeholder="np. 1000" /></div>
      <div class="row-2">
        <button class="btn btn-primary" id="goal-save">Ustaw cel</button>
        <button class="btn btn-ghost" id="goal-clear">Usuń cel</button>
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
    const before = num(u.savings), after = before + a, target = num(u.goalTarget);
    await Store.updateUser(u.id, { balance: num(u.balance) - a, savings: after });
    await Store.pushTx(u.id, mkTx('save', 'Wpłata do skarbonki', a));
    if (target > 0 && before < target && after >= target) { toast('Cel osiągnięty! 🎉', 'good'); celebrate(); }
    else toast(`Odłożono ${fmt(a)}`, 'good');
    render();
  });
  document.getElementById('sav-out').addEventListener('click', async () => {
    const a = amt(); if (!a || a <= 0) return toast('Podaj kwotę', 'bad');
    if (a > num(u.savings)) return toast('Za mało w skarbonce', 'bad');
    await Store.updateUser(u.id, { balance: num(u.balance) + a, savings: num(u.savings) - a });
    await Store.pushTx(u.id, mkTx('unsave', 'Wypłata ze skarbonki', a));
    toast(`Wypłacono ${fmt(a)}`, 'good'); render();
  });
  document.getElementById('goal-save').addEventListener('click', async () => {
    const name = document.getElementById('goal-name').value.trim();
    const target = parseFloat(document.getElementById('goal-target').value);
    if (!name) return toast('Podaj nazwę celu', 'bad');
    if (!target || target <= 0) return toast('Podaj kwotę docelową', 'bad');
    await Store.updateUser(u.id, { goalName: name, goalTarget: target });
    toast('Cel ustawiony 🎯', 'good'); render();
  });
  document.getElementById('goal-clear').addEventListener('click', async () => {
    await Store.updateUser(u.id, { goalName: '', goalTarget: 0 });
    toast('Cel usunięty'); render();
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
    <div class="card" style="border-color:var(--bad);margin-top:12px">⏳ Spłać w ciągu <b>${debtDaysLeft(u) <= 0 ? '0' : debtDaysLeft(u)} dni</b> — po 31 dniach dług rośnie o <b>50%</b>.</div>
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
    const left = num(u.debt) - real;
    await Store.updateUser(u.id, { balance: num(u.balance) - real, debt: left, debtSince: left === 0 ? 0 : (u.debtSince || Date.now()) });
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
      <div class="tx"><div class="tx-main"><div class="tx-title">Subskrypcje</div></div><div>${esc(subLabel(u))}</div></div>
      <div class="tx"><div class="tx-main"><div class="tx-title">Płatności</div></div><div>${u.frozen ? '❄️ Zablokowane' : '✅ Aktywne'}</div></div>
      ${u.birthday ? `<div class="tx"><div class="tx-main"><div class="tx-title">Do urodzin</div></div><div>${daysToBirthday(u) === 0 ? 'dziś! 🎉' : daysToBirthday(u) + ' dni'}</div></div>` : ''}
      <div class="tx"><div class="tx-main"><div class="tx-title">Klient od</div></div><div>${new Date(u.createdAt).toLocaleDateString('pl-PL')}</div></div>
    </div>
    <div class="section-title">Bezpieczeństwo</div>
    <div class="card">
      <button class="btn ${u.frozen ? 'btn-good' : 'btn-ghost'} btn-block" id="prof-freeze">${u.frozen ? 'Odblokuj płatności' : '❄️ Zablokuj płatności'}</button>
      <div class="field mt"><label>Nowy PIN (4–8 cyfr)</label><input type="text" id="prof-pin" inputmode="numeric" maxlength="8" placeholder="••••" /></div>
      <button class="btn btn-primary btn-block" id="prof-save">Zapisz PIN</button>
    </div>
    <button class="btn btn-ghost btn-block mt" id="prof-export">📋 Kopiuj historię</button>
    <button class="btn btn-danger btn-block mt" id="prof-logout">Wyloguj</button>`;
}
function wireProfile(u) {
  document.getElementById('prof-export').addEventListener('click', async () => {
    const lines = txArr(u).map(t => {
      const v = (t.type === 'teo_in' || t.type === 'teo_out') ? t.amount + ' TEO' : fmt(t.amount);
      const sign = (t.type === 'in' || t.type === 'teo_in' || t.type === 'unsave') ? '+' : '−';
      return `${fmtDate(t.ts)}\t${sign}${v}\t${t.title}${t.desc ? ' — ' + t.desc : ''}`;
    });
    const text = `Historia TF CARD — ${u.name}\n` + lines.join('\n');
    try { await navigator.clipboard.writeText(text); toast('Skopiowano historię', 'good'); }
    catch (e) { prompt('Skopiuj historię:', text); }
  });
  document.getElementById('prof-freeze').addEventListener('click', async () => {
    await Store.updateUser(u.id, { frozen: !u.frozen });
    toast(u.frozen ? 'Płatności odblokowane' : 'Płatności zablokowane ❄️', 'good'); render();
  });
  document.getElementById('prof-save').addEventListener('click', async () => {
    const pin = document.getElementById('prof-pin').value.trim();
    if (!/^\d{4,8}$/.test(pin)) return toast('PIN to 4–8 cyfr', 'bad');
    if (pin === (Store.meta().adminPin)) return toast('Ten PIN jest zajęty', 'bad');
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
      ${item('profile', '👤', 'Profil', u.frozen ? 'płatności zablokowane' : 'dane, PIN, blokada')}
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
            ${u.isAdminAcct ? '<span class="badge gold">TY (ADMIN)</span>' : ''}
            ${hasSub(u, 'plus') ? '<span class="badge cyan">PLUS</span>' : ''}
            ${hasSub(u, 'pro') ? '<span class="badge gold">PRO</span>' : ''}
            ${!hasSub(u, 'plus') && !hasSub(u, 'pro') ? '<span class="badge active-badge">STANDARD</span>' : ''}
          </div>
          <div class="admin-user-meta">PIN: <b>${esc(u.pin)}</b> • Saldo: <b>${fmt(u.balance)}</b> • Transakcje: ${Object.keys(u.transactions || {}).length}</div>
          <div class="admin-user-meta">💎 ${num(u.teo)} TEOpoints • 🏦 ${fmt(u.savings)} • 📉 ${fmt(u.debt)}${u.frozen ? ' • ❄️ płatności zablokowane' : ''}</div>
        </div>
      </div>
      <div class="admin-actions">
        <input type="number" class="adm-amt" placeholder="Kwota zł" style="max-width:95px" />
        <button class="btn btn-good btn-sm" data-adm="credit">Uznaj</button>
        <button class="btn btn-danger btn-sm" data-adm="debit">Obciąż</button>
      </div>
      <div class="admin-actions" style="flex-direction:column;align-items:stretch">
        <div class="muted" style="font-size:12px">Dodaj zakup do historii</div>
        <input type="text" class="adm-bt" placeholder="Tytuł (np. Bilet)" />
        <input type="number" class="adm-bp" min="0" step="0.01" placeholder="Cena zł" />
        <input type="text" class="adm-bd" placeholder="Opis (opcjonalnie)" />
        <button class="btn btn-good btn-sm" data-adm="addbuy">Dodaj zakup</button>
      </div>
      <div class="admin-actions">
        <input type="number" class="adm-teo" placeholder="TEOpoints 💎" style="max-width:120px" />
        <button class="btn btn-good btn-sm" data-adm="teo-add">Dodaj TEOpoints</button>
        <button class="btn btn-danger btn-sm" data-adm="teo-sub">Zabierz</button>
      </div>
      <div class="admin-actions">
        <input type="number" class="adm-debt" placeholder="Dług zł" style="max-width:90px" />
        <button class="btn btn-danger btn-sm" data-adm="debt-add">Nadaj dług</button>
        <button class="btn btn-good btn-sm" data-adm="debt-sub">Umorz dług</button>
      </div>
      <div class="admin-actions">
        ${subBtn(u, 'plus')}
        ${subBtn(u, 'pro')}
        <button class="btn btn-ghost btn-sm" data-adm="freeze">${u.frozen ? 'Odblokuj' : 'Zablokuj'} płatności</button>
      </div>
      <div class="admin-actions">
        <input type="text" class="adm-pin" placeholder="Nowy PIN" maxlength="8" style="max-width:90px" />
        <button class="btn btn-ghost btn-sm" data-adm="setpin">Ustaw PIN</button>
        <input type="text" class="adm-name" placeholder="Zmień imię" style="max-width:120px" />
        <button class="btn btn-ghost btn-sm" data-adm="rename">Zmień imię</button>
      </div>
      <div class="admin-actions">
        <span class="muted" style="font-size:12px">🎂 ${u.birthday ? esc(u.birthday) : 'brak'}</span>
        <input type="date" class="adm-bday" />
        <button class="btn btn-ghost btn-sm" data-adm="bday">Ustaw urodziny</button>
      </div>
      <div class="admin-actions">
        <input type="text" class="adm-msg" placeholder="Wiadomość do usera" style="max-width:170px" value="${esc(u.message || '')}" />
        <button class="btn btn-ghost btn-sm" data-adm="msg">Wyślij</button>
      </div>
      <div class="admin-actions">
        <button class="btn ${u.cafeAccess ? 'btn-good' : 'btn-ghost'} btn-sm" data-adm="cafe">☕ Cafe: ${u.cafeAccess ? 'TAK' : 'NIE'}</button>
        <button class="btn btn-ghost btn-sm" data-adm="view">Podgląd</button>
        <button class="btn btn-danger btn-sm" data-adm="delete">Usuń konto</button>
      </div>
      <details class="adm-history">
        <summary>Historia (${Object.keys(u.transactions || {}).length}) — usuwanie</summary>
        ${Object.entries(u.transactions || {}).sort((a, b) => b[1].ts - a[1].ts).map(([tid, t]) => `
          <div class="adm-tx">
            <div class="adm-tx-main">
              <b>${esc(t.title)}</b>
              <div class="muted" style="font-size:11px">${(t.type === 'teo_in' || t.type === 'teo_out') ? t.amount + ' 💎' : fmt(t.amount)}</div>
              <input type="datetime-local" class="adm-tx-date" value="${dtLocal(t.ts)}" />
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <button class="btn btn-ghost btn-sm" data-edittx="${tid}">Zapisz datę</button>
              <button class="btn btn-danger btn-sm" data-deltx="${tid}">Usuń</button>
            </div>
          </div>`).join('') || '<div class="empty">Brak wpisów</div>'}
      </details>
    </div>`).join('');

  document.getElementById('admin-container').innerHTML = `
    <div class="admin-bar">
      <div class="greeting" style="margin:0">Panel admina 🛡️</div>
      <button class="btn btn-ghost btn-sm" id="admin-logout">Wyloguj</button>
    </div>
    <div class="greeting-sub">Sterujesz wszystkimi kontami TF CARD</div>
    <div class="row-2" style="margin-bottom:14px">
      <a class="btn btn-ghost" href="vending/" style="text-decoration:none">🛍️ Kasa sprzedawcy</a>
      <a class="btn btn-ghost" href="tfkfcafe/" style="text-decoration:none">☕ TFKF Cafe</a>
    </div>
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
      <div class="row-2 mt">
        <div class="field" style="margin:0"><label>Saldo startowe (zł)</label><input type="number" id="new-balance" min="0" step="0.01" placeholder="0,00" /></div>
        <div class="field" style="margin:0"><label>Urodziny</label><input type="date" id="new-bday" /></div>
      </div>
      <div class="admin-actions" style="margin-top:12px">
        <label style="display:flex;align-items:center;gap:6px;font-size:14px"><input type="checkbox" id="new-plus" /> PLUS</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:14px"><input type="checkbox" id="new-pro" /> PRO</label>
      </div>
      <div class="admin-actions mt">
        <input type="text" id="new-pin-rand" readonly placeholder="losowy PIN" style="max-width:120px" />
        <button class="btn btn-ghost btn-sm" id="gen-pin">🎲 Losuj PIN</button>
      </div>
      <button class="btn btn-primary btn-block mt" id="add-user">Utwórz konto</button>
    </div>

    <div class="section-title">Komunikacja i narzędzia 📢</div>
    <div class="card">
      <div class="field" style="margin:0"><label>Ogłoszenie dla wszystkich</label><input type="text" id="announce" value="${esc(Store.meta().announce || '')}" placeholder="np. Promocja w TFKF Cafe!" /></div>
      <div class="row-2 mt">
        <button class="btn btn-primary" id="set-announce">Ustaw ogłoszenie</button>
        <button class="btn btn-ghost" id="clear-announce">Wyczyść</button>
      </div>
      <div class="admin-actions mt">
        <input type="number" id="bonus-all" min="0" step="0.01" placeholder="Bonus zł" style="max-width:110px" />
        <button class="btn btn-good btn-sm" id="give-all">Daj wszystkim</button>
      </div>
    </div>

    <div class="section-title">PIN administratora</div>
    <div class="card">
      <div class="admin-actions" style="margin:0">
        <input type="text" id="admin-pin" inputmode="numeric" maxlength="8" placeholder="Nowy PIN admina (4–8 cyfr)" style="max-width:200px" />
        <button class="btn btn-ghost btn-sm" id="set-admin-pin">Zmień PIN admina</button>
      </div>
    </div>

    <div class="section-title">Produkty do sprzedaży 🛍️</div>
    <div class="card">
      <div class="admin-actions" style="margin:0 0 10px">
        <input type="text" id="vend-emoji" maxlength="2" placeholder="🛍️" style="max-width:60px;text-align:center" />
        <input type="text" id="vend-name" placeholder="Nazwa produktu" style="max-width:160px" />
        <input type="number" id="vend-price" min="0.01" step="0.01" placeholder="Cena zł" style="max-width:90px" />
        <button class="btn btn-good btn-sm" id="vend-add">Dodaj produkt</button>
      </div>
      ${(Store.meta().vending || []).length
        ? `<div class="tx-list">` + (Store.meta().vending || []).map(p => `
            <div class="tx">
              <div class="tx-ico">${esc(p.icon || '🛒')}</div>
              <div class="tx-main"><div class="tx-title">${esc(p.name)}</div><div class="tx-sub">${fmt(p.price)}</div></div>
              <button class="btn btn-danger btn-sm" data-vend-del="${p.id}">Usuń</button>
            </div>`).join('') + `</div>`
        : '<div class="empty">Brak produktów — dodaj powyżej</div>'}
    </div>

    <div class="section-title">Użytkownicy (${users.length})</div>
    ${users.length ? '<input type="text" id="admin-search" class="admin-search" placeholder="🔎 Szukaj po imieniu…" />' : ''}
    <div id="admin-users">${usersHTML || '<div class="empty">Brak kont — utwórz w Kreatorze kont</div>'}</div>`;

  wireAdmin();
}

function wireAdmin() {
  document.getElementById('admin-logout').addEventListener('click', doLogout);

  document.getElementById('gen-pin').addEventListener('click', () => {
    let pin; do { pin = String(Math.floor(1000 + Math.random() * 9000)); }
    while (pin === (Store.meta().adminPin) || Store.users().some(x => x.pin === pin));
    document.getElementById('new-pin-rand').value = pin;
    document.getElementById('new-pin').value = pin;
  });
  document.getElementById('set-announce').addEventListener('click', async () => {
    await Store.setMeta({ announce: document.getElementById('announce').value.trim() });
    toast('Ustawiono ogłoszenie', 'good');
  });
  document.getElementById('clear-announce').addEventListener('click', async () => {
    await Store.setMeta({ announce: '' }); toast('Wyczyszczono ogłoszenie'); renderAdmin();
  });
  document.getElementById('give-all').addEventListener('click', async () => {
    const amt = parseFloat(document.getElementById('bonus-all').value);
    if (!amt || amt <= 0) return toast('Podaj kwotę', 'bad');
    for (const usr of Store.users()) {
      await Store.updateUser(usr.id, Store.applyCredit(usr, amt));
      await Store.pushTx(usr.id, mkTx('in', 'Bonus od TF CARD', amt));
    }
    toast(`Dodano ${fmt(amt)} wszystkim (${Store.users().length})`, 'good'); renderAdmin();
  });

  const search = document.getElementById('admin-search');
  if (search) search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    document.querySelectorAll('#admin-users .admin-user').forEach(el => {
      el.style.display = el.dataset.name.includes(q) ? '' : 'none';
    });
  });

  document.querySelectorAll('[data-deltx]').forEach(b => b.addEventListener('click', async () => {
    const uid = b.closest('.admin-user').dataset.uid;
    if (!confirm('Usunąć ten wpis z historii?')) return;
    await Store.deleteTx(uid, b.dataset.deltx);
    toast('Usunięto wpis z historii', 'good'); renderAdmin();
  }));
  document.querySelectorAll('[data-edittx]').forEach(b => b.addEventListener('click', async () => {
    const wrap = b.closest('.admin-user');
    const val = b.closest('.adm-tx').querySelector('.adm-tx-date').value;
    const ts = new Date(val).getTime();
    if (!val || isNaN(ts)) return toast('Podaj poprawną datę', 'bad');
    await Store.editTx(wrap.dataset.uid, b.dataset.edittx, { ts });
    toast('Zmieniono datę wpisu', 'good'); renderAdmin();
  }));

  // TF Vending — produkty
  document.getElementById('vend-add').addEventListener('click', async () => {
    const name = document.getElementById('vend-name').value.trim();
    const price = parseFloat(document.getElementById('vend-price').value);
    const icon = document.getElementById('vend-emoji').value.trim() || '🛒';
    if (!name) return toast('Podaj nazwę produktu', 'bad');
    if (!price || price <= 0) return toast('Podaj cenę', 'bad');
    const list = (Store.meta().vending || []).slice();
    list.push({ id: 'v-' + Math.random().toString(36).slice(2, 8), name, price, icon });
    await Store.setMeta({ vending: list });
    toast(`Dodano produkt: ${name}`, 'good'); renderAdmin();
  });
  document.querySelectorAll('[data-vend-del]').forEach(b => b.addEventListener('click', async () => {
    const list = (Store.meta().vending || []).filter(p => p.id !== b.dataset.vendDel);
    await Store.setMeta({ vending: list });
    toast('Usunięto produkt'); renderAdmin();
  }));

  document.getElementById('add-user').addEventListener('click', async () => {
    const name = document.getElementById('new-name').value.trim();
    const pin = document.getElementById('new-pin').value.trim();
    const balance = parseFloat(document.getElementById('new-balance').value) || 0;
    const plus = document.getElementById('new-plus').checked;
    const pro = document.getElementById('new-pro').checked;
    const birthday = (document.getElementById('new-bday').value || '').slice(5); // YYYY-MM-DD -> MM-DD
    if (!name) return toast('Podaj imię', 'bad');
    if (!/^\d{4,8}$/.test(pin)) return toast('PIN to 4–8 cyfr', 'bad');
    if (pin === (Store.meta().adminPin)) return toast('Ten PIN jest zajęty (admin)', 'bad');
    if (Store.users().some(u => u.pin === pin)) return toast('Ten PIN jest już zajęty', 'bad');
    const u = Store.newUser({ name, pin, balance, plus, pro, birthday });
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
        await Store.updateUser(u.id, Store.applyCredit(u, amt));
        await Store.pushTx(u.id, mkTx('in', 'Wpłata od TF CARD (admin)', amt));
        toast(`Uznano ${fmt(amt)} dla ${u.name}`, 'good');
      } else {
        await Store.updateUser(u.id, { balance: Math.max(0, (u.balance || 0) - amt) });
        await Store.pushTx(u.id, mkTx('out', 'Obciążenie TF CARD (admin)', amt));
        toast(`Obciążono ${u.name} o ${fmt(amt)}`, 'good');
      }
    } else if (action === 'addbuy') {
      const title = wrap.querySelector('.adm-bt').value.trim();
      const price = parseFloat(wrap.querySelector('.adm-bp').value);
      const desc = wrap.querySelector('.adm-bd').value.trim();
      if (!title) return toast('Podaj tytuł', 'bad');
      if (!price || price < 0) return toast('Podaj cenę', 'bad');
      await Store.updateUser(u.id, { balance: Math.max(0, num(u.balance) - price) });
      await Store.pushTx(u.id, mkTx('out', title, price, desc));
      toast(`Dodano zakup „${title}" dla ${u.name}`, 'good');
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
    } else if (action === 'debt-add' || action === 'debt-sub') {
      const amt = parseFloat(wrap.querySelector('.adm-debt').value);
      if (!amt || amt <= 0) return toast('Podaj kwotę', 'bad');
      if (action === 'debt-add') {
        await Store.updateUser(u.id, { debt: num(u.debt) + amt, debtSince: u.debtSince || Date.now() });
        toast(`Nadano dług ${fmt(amt)}: ${u.name}`, 'good');
      } else {
        const left = Math.max(0, num(u.debt) - amt);
        await Store.updateUser(u.id, { debt: left, debtSince: left === 0 ? 0 : (u.debtSince || Date.now()) });
        toast(`Umorzono ${fmt(amt)} długu: ${u.name}`, 'good');
      }
    } else if (action === 'freeze') {
      await Store.updateUser(u.id, { frozen: !u.frozen });
      toast(u.frozen ? `Odblokowano płatności: ${u.name}` : `Zablokowano płatności: ${u.name}`, 'good');
    } else if (action === 'msg') {
      const m = wrap.querySelector('.adm-msg').value.trim();
      await Store.updateUser(u.id, { message: m });
      toast(m ? `Wysłano wiadomość: ${u.name}` : `Wyczyszczono wiadomość: ${u.name}`, 'good');
    } else if (action === 'cafe') {
      await Store.updateUser(u.id, { cafeAccess: !u.cafeAccess });
      toast(u.cafeAccess ? `Zabrano dostęp Cafe: ${u.name}` : `Nadano dostęp Cafe: ${u.name}`, 'good');
    } else if (action === 'bday') {
      const d = (wrap.querySelector('.adm-bday').value || '').slice(5);
      if (!d) return toast('Wybierz datę', 'bad');
      await Store.updateUser(u.id, { birthday: d, bdayYear: 0 });
      toast(`Ustawiono urodziny: ${u.name} (${d})`, 'good');
    } else if (action === 'give') {
      const key = btn.dataset.key;
      const price = PLANS[key].price;
      const bal = num(u.balance), debt = num(u.debt);
      const patch = { subs: Object.assign({}, u.subs, { [key]: true }) };
      if (price <= bal) patch.balance = bal - price;       // opłata jednorazowa
      else { patch.balance = 0; patch.debt = debt + (price - bal); if (debt === 0) patch.debtSince = Date.now(); } // brak środków → dług
      await Store.updateUser(u.id, patch);
      await Store.pushTx(u.id, mkTx('out', `Opłata za ${PLANS[key].name}`, price));
      track('sub_grant', { plan: key });
      toast(`Nadano ${PLANS[key].name}: ${u.name}`, 'good');
    } else if (action === 'revoke') {
      const key = btn.dataset.key;
      await Store.updateUser(u.id, { subs: Object.assign({}, u.subs, { [key]: false }) });
      toast(`Cofnięto ${PLANS[key].name}: ${u.name}`);
    } else if (action === 'setpin') {
      const pin = wrap.querySelector('.adm-pin').value.trim();
      if (!/^\d{4,8}$/.test(pin)) return toast('PIN to 4–8 cyfr', 'bad');
      if (pin === (Store.meta().adminPin)) return toast('Ten PIN jest zajęty (admin)', 'bad');
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
    // Stabilnie: rejestracja + sprawdzenie aktualizacji w tle.
    // Treść jest świeża dzięki strategii network-first w sw.js,
    // więc nie wymuszamy przeładowania strony (brak „migania").
    navigator.serviceWorker.register('sw.js').then((reg) => { reg.update(); }).catch(() => {});
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
