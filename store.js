/* =========================================================================
   TF CARD — warstwa danych
   Dwa backendy z identycznym API:
     • firebase  — Cloud Firestore, synchronizacja na wielu telefonach
     • local     — localStorage, awaryjnie zanim Firebase zacznie działać
   Cały stan trzymany jest w jednym dokumencie:  kolekcja "tfcard" / "state"
     { users: { <id>: { id,name,pin,balance,
                        subs:{plus,pro}, req:{plus,pro},
                        cardNumber,createdAt, transactions:{<txid>:{...}} } },
       meta:  { adminPin } }
   ========================================================================= */
'use strict';

const LOCAL_KEY = 'tfcard_state_v4';

function uid(p) { return p + '-' + Math.random().toString(36).slice(2, 10); }
function genCard() {
  const part = () => Math.floor(1000 + Math.random() * 9000);
  return `4921 ${part()} ${part()} ${part()}`;
}

function blankUser(name, pin, opts = {}) {
  return {
    id: uid('u'), name, pin, balance: Number(opts.balance) || 0,
    savings: 0, teo: Number(opts.teo) || 0, debt: 0, debtSince: 0, frozen: false,
    goalName: '', goalTarget: 0, cafeAccess: false, locked: false,
    birthday: opts.birthday || '', bdayYear: 0, message: '', splitReqs: [],
    monthlyFee: 0, feePaidAt: 0,
    subs: { plus: !!opts.plus, pro: !!opts.pro },
    cardNumber: genCard(), createdAt: Date.now(), transactions: {},
  };
}

/* Dane startowe: brak kont użytkowników (admin zakłada je kreatorem) + PIN admina. */
function seedState() {
  // PIN administratora NIE jest zapisany w kodzie — ustawia się go przy
  // pierwszym wejściu w tryb admina (i można zmienić w panelu).
  return { users: {}, meta: { adminPin: '', vending: [], cafe: [], shop: [], announce: '' } };
}

function configReady(cfg) {
  return cfg && typeof cfg.apiKey === 'string' && !cfg.apiKey.includes('PASTE_');
}

const Store = {
  backend: 'local',
  _db: null,
  _docRef: null,
  _state: { users: {}, meta: {} },
  _subs: [],
  errCode: '',

  async init() {
    const cfg = window.FIREBASE_CONFIG;
    if (!configReady(cfg) || !window.firebase || !firebase.firestore) {
      this.errCode = '167'; // brak/niepełny config lub SDK
    } else {
      let authFailed = false;
      try {
        if (!firebase.apps.length) firebase.initializeApp(cfg);
        // Timeout, żeby UI nie wisiało gdy Firebase nie odpowiada (8 s)
        const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
        this._db = firebase.firestore();
        this._docRef = this._db.collection('tfcard').doc('state');
        // Samonaprawiający się nasłuch: gdy sieć w końcu odpowie, przełącza na chmurę
        this._docRef.onSnapshot((s) => {
          if (s && s.exists && s.data() && s.data().users) {
            this._state = s.data(); this.backend = 'firebase'; this.errCode = ''; this._emit();
          }
        }, (err) => { console.warn('Nasłuch Firestore błąd:', err); });
        // Logowanie anonimowe — reguły Firestore wymagają auth (nie blokuje na stałe)
        if (firebase.auth) {
          try { await withTimeout(firebase.auth().signInAnonymously(), 8000); }
          catch (e) { authFailed = true; console.warn('Logowanie nieudane:', e); }
        }
        const snap = await withTimeout(this._docRef.get(), 8000);
        if (!snap.exists || !snap.data().users) await this._docRef.set(seedState());
        this.backend = 'firebase';
        this.errCode = '';
        return;
      } catch (e) {
        // Kody błędów synchronizacji (zapamiętane):
        //  106  logowanie nieudane (np. Anonymous wyłączone)
        //  109  brak odpowiedzi / timeout (sieć)
        //  151  odmowa dostępu (reguły Firestore / brak auth)
        //  167  config/SDK lub inny błąd inicjalizacji
        //  172  usługa chmury niedostępna (unavailable)
        //  188  przekroczony limit (resource-exhausted / quota)
        //  193  brak sieci / offline
        //  199  nieznany błąd
        const msg = (e && (e.code || e.message || '')) + '';
        if (e && e.message === 'timeout') this.errCode = '109';
        else if (/permission-denied|insufficient|PERMISSION/i.test(msg)) this.errCode = authFailed ? '106' : '151';
        else if (/unavailable/i.test(msg)) this.errCode = '172';
        else if (/resource-exhausted|quota/i.test(msg)) this.errCode = '188';
        else if (/network|offline|failed to fetch/i.test(msg) || (typeof navigator !== 'undefined' && navigator.onLine === false)) this.errCode = '193';
        else if (authFailed) this.errCode = '106';
        else this.errCode = '199';
        console.warn('Firebase init nieudany (' + this.errCode + '), localStorage:', e);
      }
    }
    // ---- fallback: localStorage ----
    this.backend = 'local';
    const raw = localStorage.getItem(LOCAL_KEY);
    this._state = raw ? JSON.parse(raw) : seedState();
    this._commitLocal();
    window.addEventListener('storage', (e) => {
      if (e.key === LOCAL_KEY && e.newValue) { this._state = JSON.parse(e.newValue); this._emit(); }
    });
    setTimeout(() => this._emit(), 0);
  },

  subscribe(cb) { this._subs.push(cb); },
  _emit() { this._subs.forEach((cb) => cb(this._state)); },

  state() { return this._state; },
  users() { return Object.values(this._state.users || {}); },
  meta() { return this._state.meta || {}; },

  _commitLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(this._state)); } catch (e) { console.warn('Zapis lokalny nieudany:', e); }
    this._emit();
  },
  _commit() {
    if (this.backend === 'firebase') {
      // Stabilność: błąd zapisu nie wywala aplikacji; snapshot skoryguje stan
      return this._docRef.set(this._state).catch((e) => { console.warn('Zapis do chmury nieudany:', e); });
    }
    this._commitLocal();
    return Promise.resolve();
  },

  /* ---- zapisy (mutują stan w pamięci, potem zapis) ---- */
  setUser(id, data) { this._state.users[id] = data; return this._commit(); },
  updateUser(id, patch) { Object.assign(this._state.users[id], patch); return this._commit(); },
  deleteUser(id) { delete this._state.users[id]; return this._commit(); },
  setMeta(patch) { this._state.meta = Object.assign({}, this._state.meta, patch); return this._commit(); },
  pushTx(id, tx) {
    const u = this._state.users[id];
    u.transactions = u.transactions || {};
    u.transactions[uid('t')] = tx;
    return this._commit();
  },
  deleteTx(id, txId) {
    const u = this._state.users[id];
    if (u && u.transactions) delete u.transactions[txId];
    return this._commit();
  },
  editTx(id, txId, patch) {
    const u = this._state.users[id];
    if (u && u.transactions && u.transactions[txId]) Object.assign(u.transactions[txId], patch);
    return this._commit();
  },
  /* Prośby Split Bill (do akceptacji przez odbiorcę) */
  pushReq(id, req) {
    const u = this._state.users[id]; if (!u) return Promise.resolve();
    u.splitReqs = (u.splitReqs || []).concat(req);
    return this._commit();
  },
  pullReq(id, reqId) {
    const u = this._state.users[id]; if (!u) return Promise.resolve();
    u.splitReqs = (u.splitReqs || []).filter(r => r.id !== reqId);
    return this._commit();
  },

  newUser(opts) { return blankUser(opts.name, opts.pin, opts); },
  newCard: genCard,

  /* Debet (overdraft) zależny od planu: PLUS 20 zł, PRO 35 zł */
  overdraftLimit(u) {
    if (!u || !u.subs) return 0;
    if (u.subs.pro) return 35;
    if (u.subs.plus) return 20;
    return 0;
  },
  /* Zwraca patch {balance[,debt]} po obciążeniu kwotą (z uwzgl. debetu) lub null gdy za mało */
  applyCharge(u, amount) {
    const bal = Number(u.balance) || 0, debt = Number(u.debt) || 0;
    if (debt > 0) return null;                       // masz dług — nie możesz płacić aż spłacisz
    if (amount <= bal) return { balance: bal - amount };
    const short = amount - bal;                      // brak środków → dług z różnicy
    if (short > this.overdraftLimit(u)) return null; // ponad limit debetu planu
    return { balance: 0, debt: short, debtSince: Date.now() };
  },
  /* Wpływ środków: najpierw spłaca dług, reszta na saldo (łączy dług z zapłatą) */
  applyCredit(u, amount) {
    const bal = Number(u.balance) || 0, debt = Number(u.debt) || 0;
    if (debt <= 0) return { balance: bal + amount };
    const pay = Math.min(debt, amount);
    const patch = { balance: bal + (amount - pay), debt: debt - pay };
    if (debt - pay === 0) patch.debtSince = 0; // dług spłacony
    return patch;
  },

  /* Jednorazowe 6-cyfrowe kody płatności (mapowane na konto w meta.codes) */
  async genCode(uid) {
    const codes = Object.assign({}, this.meta().codes || {});
    for (const k in codes) { if (codes[k].uid === uid) delete codes[k]; } // jeden aktywny kod na konto
    let code;
    do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (codes[code]);
    codes[code] = { uid, ts: Date.now() };
    await this.setMeta({ codes });
    return code;
  },
  resolveCode(code) { const c = (this.meta().codes || {})[code]; return c ? c.uid : null; },
  async consumeCode(code) {
    const codes = Object.assign({}, this.meta().codes || {});
    if (codes[code]) { delete codes[code]; await this.setMeta({ codes }); }
  },
};

window.Store = Store;
