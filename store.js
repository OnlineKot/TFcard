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
    savings: 0, teo: Number(opts.teo) || 0, debt: 0, frozen: false,
    goalName: '', goalTarget: 0,
    subs: { plus: !!opts.plus, pro: !!opts.pro },
    cardNumber: genCard(), createdAt: Date.now(), transactions: {},
  };
}

/* Dane startowe: brak kont użytkowników (admin zakłada je kreatorem) + PIN admina. */
function seedState() {
  return { users: {}, meta: { adminPin: '951852' } };
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

  async init() {
    const cfg = window.FIREBASE_CONFIG;
    if (configReady(cfg) && window.firebase && firebase.firestore) {
      try {
        if (!firebase.apps.length) firebase.initializeApp(cfg);
        // Bezpieczeństwo: logowanie anonimowe — reguły Firestore wymagają auth
        if (firebase.auth) {
          try { await firebase.auth().signInAnonymously(); }
          catch (e) { console.warn('Anonimowe logowanie nieudane (włącz Anonymous w konsoli):', e); }
        }
        this._db = firebase.firestore();
        this._docRef = this._db.collection('tfcard').doc('state');
        const snap = await this._docRef.get();
        if (!snap.exists || !snap.data().users) await this._docRef.set(seedState());
        this.backend = 'firebase';
        this._docRef.onSnapshot((s) => {
          this._state = s.data() || { users: {}, meta: {} };
          this._emit();
        });
        return;
      } catch (e) {
        console.warn('Firebase init nieudany, używam localStorage:', e);
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

  newUser(opts) { return blankUser(opts.name, opts.pin, opts); },
  newCard: genCard,
};

window.Store = Store;
