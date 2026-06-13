/* =========================================================================
   TF CARD — aplikacja bankowa (vanilla JS, dane w localStorage)
   Moduły: Auth, TF PAY (przelewy/doładowania), Karty, Subskrypcje (PRO/PLUS),
           Panel administratora.
   ========================================================================= */

'use strict';

const DB_KEY = 'tfcard_db_v1';
const SESSION_KEY = 'tfcard_session_v1';

/* ---------- Definicje planów subskrypcji ---------- */
const PLANS = {
  standard: {
    id: 'standard', name: 'TF CARD', tier: 'STANDARD', price: 0,
    color: '', features: ['Konto i karta TF CARD', 'Płatności TF PAY', 'Historia transakcji'],
  },
  plus: {
    id: 'plus', name: 'TF CARD PLUS', tier: 'PLUS', price: 14.99,
    color: 'plus',
    features: ['Wszystko ze STANDARD', 'Limit przelewów 50 000 zł', '2% zwrotu (cashback)', 'Brak opłat za przewalutowanie', 'Wsparcie priorytetowe'],
  },
  pro: {
    id: 'pro', name: 'TF CARD PRO', tier: 'PRO', price: 39.99,
    color: 'pro',
    features: ['Wszystko z PLUS', 'Karta metalowa PRO', '5% zwrotu (cashback)', 'Nielimitowane przelewy', 'Ubezpieczenie podróżne', 'Doradca 24/7'],
  },
};

/* =========================================================================
   Warstwa danych
   ========================================================================= */
function loadDB() {
  const raw = localStorage.getItem(DB_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch (e) { /* reset poniżej */ }
  }
  const db = seedDB();
  saveDB(db);
  return db;
}
function saveDB(db) { localStorage.setItem(DB_KEY, JSON.stringify(db)); }

function seedDB() {
  return {
    users: [
      {
        id: 'u-admin', fullname: 'Administrator TF', username: 'admin',
        email: 'admin@tfcard.app', password: 'admin123', role: 'admin',
        balance: 100000, plan: 'pro', cardNumber: genCard(), createdAt: Date.now(),
        transactions: [],
      },
      {
        id: 'u-demo', fullname: 'Jan Kowalski', username: 'jan.kowalski',
        email: 'jan@example.com', password: 'demo', role: 'user',
        balance: 2450.75, plan: 'plus', cardNumber: genCard(), createdAt: Date.now(),
        transactions: [
          tx('in', 'Wpływ wynagrodzenia', 4200, Date.now() - 86400000 * 3),
          tx('out', 'Biedronka', 87.43, Date.now() - 86400000 * 2),
          tx('out', 'Subskrypcja TF CARD PLUS', 14.99, Date.now() - 86400000),
        ],
      },
    ],
  };
}

function genCard() {
  const part = () => Math.floor(1000 + Math.random() * 9000);
  return `4921 ${part()} ${part()} ${part()}`;
}

function tx(type, title, amount, ts = Date.now()) {
  return { id: 'tx-' + Math.random().toString(36).slice(2, 10), type, title, amount, ts };
}

/* =========================================================================
   Stan / sesja
   ========================================================================= */
let DB = loadDB();
let currentUserId = localStorage.getItem(SESSION_KEY) || null;
let activeView = 'home';

function currentUser() { return DB.users.find(u => u.id === currentUserId) || null; }
function persist() { saveDB(DB); }

/* =========================================================================
   Pomocnicze formatowanie
   ========================================================================= */
const fmt = (n) => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(n);
const fmtDate = (ts) => new Date(ts).toLocaleDateString('pl-PL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast ' + kind; }, 2600);
}

/* =========================================================================
   Auth
   ========================================================================= */
function setupAuth() {
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const isLogin = tab.dataset.tab === 'login';
      document.getElementById('login-form').classList.toggle('hidden', !isLogin);
      document.getElementById('register-form').classList.toggle('hidden', isLogin);
      document.getElementById('auth-error').textContent = '';
    });
  });

  document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('login-username').value.trim().toLowerCase();
    const pw = document.getElementById('login-password').value;
    const user = DB.users.find(u => u.username.toLowerCase() === id || u.email.toLowerCase() === id);
    if (!user || user.password !== pw) {
      document.getElementById('auth-error').textContent = 'Nieprawidłowy login lub hasło.';
      return;
    }
    startSession(user.id);
  });

  document.getElementById('register-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fullname = document.getElementById('reg-fullname').value.trim();
    const username = document.getElementById('reg-username').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const err = document.getElementById('auth-error');

    if (password.length < 4) { err.textContent = 'Hasło musi mieć min. 4 znaki.'; return; }
    if (DB.users.some(u => u.username.toLowerCase() === username.toLowerCase())) { err.textContent = 'Ten login jest już zajęty.'; return; }
    if (DB.users.some(u => u.email.toLowerCase() === email.toLowerCase())) { err.textContent = 'Ten e-mail jest już zarejestrowany.'; return; }

    const user = {
      id: 'u-' + Math.random().toString(36).slice(2, 10),
      fullname, username, email, password, role: 'user',
      balance: 50, plan: 'standard', cardNumber: genCard(), createdAt: Date.now(),
      transactions: [tx('in', 'Bonus powitalny TF CARD', 50)],
    };
    DB.users.push(user);
    persist();
    startSession(user.id);
  });
}

function startSession(userId) {
  currentUserId = userId;
  localStorage.setItem(SESSION_KEY, userId);
  document.getElementById('login-form').reset();
  document.getElementById('register-form').reset();
  document.getElementById('auth-error').textContent = '';
  showApp();
}

function logout() {
  currentUserId = null;
  localStorage.removeItem(SESSION_KEY);
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
}

/* =========================================================================
   Powłoka aplikacji
   ========================================================================= */
function showApp() {
  const u = currentUser();
  if (!u) { logout(); return; }
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  document.getElementById('user-badge').textContent = u.fullname;
  document.getElementById('nav-admin').style.display = u.role === 'admin' ? '' : 'none';
  activeView = 'home';
  render();
}

function setupNav() {
  document.getElementById('logout-btn').addEventListener('click', logout);
  document.getElementById('bottom-nav').addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item');
    if (!item) return;
    navigate(item.dataset.view);
  });
}

function navigate(view) {
  activeView = view;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  render();
}

function render() {
  const c = document.getElementById('view-container');
  const views = { home: viewHome, pay: viewPay, cards: viewCards, subs: viewSubs, admin: viewAdmin };
  const fn = views[activeView] || viewHome;
  c.innerHTML = `<div class="fade-in">${fn()}</div>`;
  // podpięcie zdarzeń dla danego widoku
  const wires = { pay: wirePay, subs: wireSubs, admin: wireAdmin, cards: wireCards, home: wireHome };
  if (wires[activeView]) wires[activeView]();
  window.scrollTo(0, 0);
}

/* =========================================================================
   Widok: Pulpit
   ========================================================================= */
function bankCardHTML(u, big = true) {
  const plan = PLANS[u.plan];
  return `
    <div class="bankcard ${plan.color}">
      <div class="bankcard-top">
        <div>
          <div class="bankcard-tier">TF CARD ${plan.tier}</div>
          ${big ? `<div class="bankcard-balance-label">Dostępne środki</div>
                   <div class="bankcard-balance">${fmt(u.balance)}</div>` : ''}
        </div>
        <div class="bankcard-chip"></div>
      </div>
      <div>
        <div class="bankcard-number">${esc(u.cardNumber)}</div>
        <div class="bankcard-bottom">
          <span>${esc(u.fullname.toUpperCase())}</span>
          <span>TF&nbsp;PAY</span>
        </div>
      </div>
    </div>`;
}

function viewHome() {
  const u = currentUser();
  const txs = [...u.transactions].sort((a, b) => b.ts - a.ts).slice(0, 5);
  return `
    <div class="greeting">Cześć, ${esc(u.fullname.split(' ')[0])} 👋</div>
    <div class="greeting-sub">Witaj w TF CARD ${PLANS[u.plan].tier}</div>
    ${bankCardHTML(u)}
    <div class="tile-row">
      <div class="tile" data-go="pay"><div class="tile-ico">⚡</div><div class="tile-label">TF PAY</div></div>
      <div class="tile" data-act="topup"><div class="tile-ico">➕</div><div class="tile-label">Doładuj</div></div>
      <div class="tile" data-go="cards"><div class="tile-ico">💳</div><div class="tile-label">Karty</div></div>
      <div class="tile" data-go="subs"><div class="tile-ico">⭐</div><div class="tile-label">Plany</div></div>
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
      <div class="tx-main">
        <div class="tx-title">${esc(t.title)}</div>
        <div class="tx-sub">${fmtDate(t.ts)}</div>
      </div>
      <div class="tx-amt ${isIn ? 'in' : 'out'}">${isIn ? '+' : '−'}${fmt(t.amount)}</div>
    </div>`;
  }).join('') + `</div>`;
}

function wireHome() {
  document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.go)));
  document.querySelectorAll('[data-act="topup"]').forEach(el => el.addEventListener('click', () => navigate('pay')));
}

/* =========================================================================
   Widok: TF PAY (przelewy + doładowania)
   ========================================================================= */
function viewPay() {
  const u = currentUser();
  const txs = [...u.transactions].sort((a, b) => b.ts - a.ts);
  return `
    <div class="greeting">TF PAY ⚡</div>
    <div class="greeting-sub">Saldo: <b>${fmt(u.balance)}</b></div>

    <div class="section-title">Przelew na konto TF CARD</div>
    <div class="card">
      <div class="field">
        <label>Odbiorca (login lub e-mail)</label>
        <input type="text" id="pay-to" placeholder="np. jan.kowalski" />
      </div>
      <div class="field">
        <label>Kwota (PLN)</label>
        <input type="number" id="pay-amount" min="0.01" step="0.01" placeholder="0,00" />
      </div>
      <div class="field">
        <label>Tytuł</label>
        <input type="text" id="pay-title" placeholder="Za kawę ☕" />
      </div>
      <button class="btn btn-primary btn-block" id="pay-send">Wyślij przelew</button>
    </div>

    <div class="section-title">Doładuj konto (symulacja)</div>
    <div class="card">
      <div class="row-2">
        <button class="btn btn-ghost" data-topup="50">+50 zł</button>
        <button class="btn btn-ghost" data-topup="100">+100 zł</button>
        <button class="btn btn-ghost" data-topup="200">+200 zł</button>
        <button class="btn btn-ghost" data-topup="500">+500 zł</button>
      </div>
    </div>

    <div class="section-title">Historia</div>
    <div class="card">${txListHTML(txs)}</div>`;
}

function wirePay() {
  document.getElementById('pay-send').addEventListener('click', doTransfer);
  document.querySelectorAll('[data-topup]').forEach(b =>
    b.addEventListener('click', () => doTopup(parseFloat(b.dataset.topup))));
}

function doTopup(amount) {
  const u = currentUser();
  u.balance += amount;
  u.transactions.push(tx('in', 'Doładowanie konta', amount));
  persist();
  toast(`Doładowano ${fmt(amount)}`, 'good');
  render();
}

function doTransfer() {
  const u = currentUser();
  const to = document.getElementById('pay-to').value.trim().toLowerCase();
  const amount = parseFloat(document.getElementById('pay-amount').value);
  const title = document.getElementById('pay-title').value.trim() || 'Przelew TF PAY';

  if (!to) return toast('Podaj odbiorcę', 'bad');
  if (!amount || amount <= 0) return toast('Podaj poprawną kwotę', 'bad');
  if (amount > u.balance) return toast('Niewystarczające środki', 'bad');

  const recipient = DB.users.find(r => r.username.toLowerCase() === to || r.email.toLowerCase() === to);
  if (!recipient) return toast('Nie znaleziono odbiorcy', 'bad');
  if (recipient.id === u.id) return toast('Nie możesz przelać do siebie', 'bad');

  u.balance -= amount;
  u.transactions.push(tx('out', `Przelew do ${recipient.fullname}: ${title}`, amount));
  recipient.balance += amount;
  recipient.transactions.push(tx('in', `Przelew od ${u.fullname}: ${title}`, amount));
  persist();
  toast(`Wysłano ${fmt(amount)} do ${recipient.fullname}`, 'good');
  render();
}

/* =========================================================================
   Widok: Karty
   ========================================================================= */
function viewCards() {
  const u = currentUser();
  return `
    <div class="greeting">Twoje karty 💳</div>
    <div class="greeting-sub">Plan: ${PLANS[u.plan].name}</div>
    ${bankCardHTML(u)}
    <div class="section-title">Szczegóły karty</div>
    <div class="card">
      <div class="tx"><div class="tx-main"><div class="tx-title">Numer karty</div></div><div>${esc(u.cardNumber)}</div></div>
      <div class="tx"><div class="tx-main"><div class="tx-title">Posiadacz</div></div><div>${esc(u.fullname)}</div></div>
      <div class="tx"><div class="tx-main"><div class="tx-title">Ważna do</div></div><div>12/29</div></div>
      <div class="tx"><div class="tx-main"><div class="tx-title">CVV</div></div><div>•••</div></div>
      <div class="tx"><div class="tx-main"><div class="tx-title">Typ</div></div><div>${PLANS[u.plan].tier}</div></div>
    </div>
    <div class="mt">
      <button class="btn btn-ghost btn-block" id="card-regen">Wygeneruj nowy numer karty</button>
    </div>`;
}

function wireCards() {
  document.getElementById('card-regen').addEventListener('click', () => {
    const u = currentUser();
    u.cardNumber = genCard();
    persist();
    toast('Wygenerowano nowy numer karty', 'good');
    render();
  });
}

/* =========================================================================
   Widok: Subskrypcje (PRO / PLUS)
   ========================================================================= */
function planCardHTML(plan, currentPlanId) {
  const isActive = plan.id === currentPlanId;
  const badge = plan.id === 'pro' ? '<span class="badge gold">NAJLEPSZY</span>'
    : plan.id === 'plus' ? '<span class="badge cyan">POPULARNY</span>' : '';
  let action;
  if (isActive) {
    action = `<button class="btn btn-good btn-block" disabled>Aktywny plan ✓</button>`;
  } else if (plan.id === 'standard') {
    action = `<button class="btn btn-ghost btn-block" data-sub="standard">Przejdź na STANDARD</button>`;
  } else {
    action = `<button class="btn btn-primary btn-block" data-sub="${plan.id}">Subskrybuj • ${fmt(plan.price)}/mc</button>`;
  }
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

function viewSubs() {
  const u = currentUser();
  return `
    <div class="greeting">Subskrypcje ⭐</div>
    <div class="greeting-sub">Aktualny plan: <b>${PLANS[u.plan].name}</b> • Saldo: ${fmt(u.balance)}</div>
    ${planCardHTML(PLANS.pro, u.plan)}
    ${planCardHTML(PLANS.plus, u.plan)}
    ${planCardHTML(PLANS.standard, u.plan)}
    <p class="center" style="color:var(--muted);font-size:12px;margin-top:6px">
      Opłata pobierana jest jednorazowo z salda przy aktywacji (symulacja miesięcznej subskrypcji).
    </p>`;
}

function wireSubs() {
  document.querySelectorAll('[data-sub]').forEach(b =>
    b.addEventListener('click', () => subscribe(b.dataset.sub)));
}

function subscribe(planId) {
  const u = currentUser();
  const plan = PLANS[planId];
  if (!plan || u.plan === planId) return;

  if (plan.price > 0) {
    if (u.balance < plan.price) return toast('Za mało środków na opłatę', 'bad');
    u.balance -= plan.price;
    u.transactions.push(tx('out', `Subskrypcja ${plan.name}`, plan.price));
  }
  u.plan = planId;
  persist();
  toast(`Aktywowano ${plan.name} 🎉`, 'good');
  render();
}

/* =========================================================================
   Widok: Panel administratora
   ========================================================================= */
function viewAdmin() {
  const u = currentUser();
  if (u.role !== 'admin') return `<div class="empty">Brak dostępu.</div>`;

  const total = DB.users.reduce((s, x) => s + x.balance, 0);
  const subs = DB.users.filter(x => x.plan !== 'standard').length;

  const usersHTML = DB.users.map(usr => `
    <div class="admin-user" data-uid="${usr.id}">
      <div class="admin-user-top">
        <div>
          <div class="admin-user-name">${esc(usr.fullname)}
            ${usr.role === 'admin' ? '<span class="badge gold">ADMIN</span>' : ''}
            <span class="badge ${usr.plan === 'pro' ? 'gold' : usr.plan === 'plus' ? 'cyan' : 'active-badge'}">${PLANS[usr.plan].tier}</span>
          </div>
          <div class="admin-user-meta">@${esc(usr.username)} • ${esc(usr.email)}</div>
          <div class="admin-user-meta">Saldo: <b>${fmt(usr.balance)}</b> • Transakcje: ${usr.transactions.length}</div>
        </div>
      </div>
      <div class="admin-actions">
        <input type="number" class="adm-amt" placeholder="Kwota" style="max-width:110px" />
        <button class="btn btn-good btn-sm" data-adm="credit">Uznaj</button>
        <button class="btn btn-danger btn-sm" data-adm="debit">Obciąż</button>
        <select class="adm-plan">
          <option value="standard" ${usr.plan === 'standard' ? 'selected' : ''}>STANDARD</option>
          <option value="plus" ${usr.plan === 'plus' ? 'selected' : ''}>PLUS</option>
          <option value="pro" ${usr.plan === 'pro' ? 'selected' : ''}>PRO</option>
        </select>
        <button class="btn btn-ghost btn-sm" data-adm="plan">Zmień plan</button>
        ${usr.role !== 'admin' ? `<button class="btn btn-danger btn-sm" data-adm="delete">Usuń</button>` : ''}
      </div>
    </div>`).join('');

  return `
    <div class="greeting">Panel administratora 🛡️</div>
    <div class="greeting-sub">Zarządzanie użytkownikami TF CARD</div>
    <div class="stat-row">
      <div class="stat"><div class="stat-val">${DB.users.length}</div><div class="stat-label">Użytkownicy</div></div>
      <div class="stat"><div class="stat-val">${subs}</div><div class="stat-label">Subskrypcje</div></div>
      <div class="stat"><div class="stat-val">${fmt(total)}</div><div class="stat-label">Suma sald</div></div>
    </div>
    <div class="section-title">Użytkownicy</div>
    ${usersHTML}`;
}

function wireAdmin() {
  document.querySelectorAll('[data-adm]').forEach(btn => {
    btn.addEventListener('click', () => {
      const wrap = btn.closest('.admin-user');
      const uid = wrap.dataset.uid;
      const usr = DB.users.find(x => x.id === uid);
      if (!usr) return;
      const action = btn.dataset.adm;

      if (action === 'credit' || action === 'debit') {
        const amt = parseFloat(wrap.querySelector('.adm-amt').value);
        if (!amt || amt <= 0) return toast('Podaj kwotę', 'bad');
        if (action === 'credit') {
          usr.balance += amt;
          usr.transactions.push(tx('in', 'Korekta admina (uznanie)', amt));
          toast(`Uznano ${fmt(amt)} dla ${usr.fullname}`, 'good');
        } else {
          usr.balance = Math.max(0, usr.balance - amt);
          usr.transactions.push(tx('out', 'Korekta admina (obciążenie)', amt));
          toast(`Obciążono ${usr.fullname} o ${fmt(amt)}`, 'good');
        }
      } else if (action === 'plan') {
        usr.plan = wrap.querySelector('.adm-plan').value;
        toast(`Zmieniono plan: ${usr.fullname} → ${PLANS[usr.plan].tier}`, 'good');
      } else if (action === 'delete') {
        if (!confirm(`Usunąć użytkownika ${usr.fullname}?`)) return;
        DB.users = DB.users.filter(x => x.id !== uid);
        toast('Użytkownik usunięty', 'good');
      }
      persist();
      render();
    });
  });
}

/* =========================================================================
   Start
   ========================================================================= */
function init() {
  setupAuth();
  setupNav();
  if (currentUser()) showApp();
  else { document.getElementById('app-screen').classList.add('hidden'); }
}

document.addEventListener('DOMContentLoaded', init);
