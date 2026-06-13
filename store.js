/* =========================================================================
   TF CARD — warstwa danych
   Dwa backendy z identycznym API:
     • firebase  — Realtime Database, synchronizacja na wielu telefonach
     • local     — localStorage, awaryjnie zanim wkleisz config Firebase
   Kształt stanu:
     { users: { <id>: { id,name,pin,balance,plan,cardNumber,createdAt,
                        transactions:{<txid>:{type,title,amount,ts}} } },
       meta:  { adminPin } }
   ========================================================================= */
'use strict';

const LOCAL_KEY = 'tfcard_state_v2';

function uid(p) { return p + '-' + Math.random().toString(36).slice(2, 10); }
function genCard() {
  const part = () => Math.floor(1000 + Math.random() * 9000);
  return `4921 ${part()} ${part()} ${part()}`;
}

/* Dane startowe: użytkownik Karol (BEZ startowej kasy) + PIN admina. */
function seedState() {
  const id = uid('u');
  return {
    users: {
      [id]: {
        id, name: 'Karol', pin: '1234', balance: 0, plan: 'standard', requestedPlan: '',
        cardNumber: genCard(), createdAt: Date.now(), transactions: {},
      },
    },
    meta: { adminPin: '0000' },
  };
}

function configReady(cfg) {
  return cfg && typeof cfg.databaseURL === 'string' && !cfg.databaseURL.includes('PASTE_');
}

const Store = {
  backend: 'local',
  _db: null,
  _state: { users: {}, meta: {} },
  _subs: [],

  async init() {
    const cfg = window.FIREBASE_CONFIG;
    if (configReady(cfg) && window.firebase) {
      try {
        firebase.initializeApp(cfg);
        this._db = firebase.database();
        this.backend = 'firebase';
        await this._ensureSeed();
        this._db.ref('tfcard').on('value', (snap) => {
          this._state = snap.val() || { users: {}, meta: {} };
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
    this._saveLocal();
    window.addEventListener('storage', (e) => {
      if (e.key === LOCAL_KEY && e.newValue) { this._state = JSON.parse(e.newValue); this._emit(); }
    });
    // pierwszy render
    setTimeout(() => this._emit(), 0);
  },

  async _ensureSeed() {
    const snap = await this._db.ref('tfcard').once('value');
    if (!snap.exists() || !snap.val().users) {
      await this._db.ref('tfcard').set(seedState());
    }
  },

  subscribe(cb) { this._subs.push(cb); },
  _emit() { this._subs.forEach((cb) => cb(this._state)); },

  state() { return this._state; },
  users() { return Object.values(this._state.users || {}); },
  meta() { return this._state.meta || {}; },

  _saveLocal() {
    if (this.backend === 'local') localStorage.setItem(LOCAL_KEY, JSON.stringify(this._state));
  },

  /* ---- zapisy ---- */
  async setUser(id, data) {
    if (this.backend === 'firebase') return this._db.ref('tfcard/users/' + id).set(data);
    this._state.users[id] = data; this._saveLocal(); this._emit();
  },

  async updateUser(id, patch) {
    if (this.backend === 'firebase') return this._db.ref('tfcard/users/' + id).update(patch);
    Object.assign(this._state.users[id], patch); this._saveLocal(); this._emit();
  },

  async deleteUser(id) {
    if (this.backend === 'firebase') return this._db.ref('tfcard/users/' + id).remove();
    delete this._state.users[id]; this._saveLocal(); this._emit();
  },

  async pushTx(id, tx) {
    const txId = uid('t');
    if (this.backend === 'firebase') return this._db.ref(`tfcard/users/${id}/transactions/${txId}`).set(tx);
    const u = this._state.users[id];
    u.transactions = u.transactions || {};
    u.transactions[txId] = tx;
    this._saveLocal(); this._emit();
  },

  async setMeta(patch) {
    if (this.backend === 'firebase') return this._db.ref('tfcard/meta').update(patch);
    Object.assign(this._state.meta, patch); this._saveLocal(); this._emit();
  },

  newUser({ name, pin }) {
    const id = uid('u');
    return {
      id, name, pin, balance: 0, plan: 'standard', requestedPlan: '',
      cardNumber: genCard(), createdAt: Date.now(), transactions: {},
    };
  },

  newCard: genCard,
};

window.Store = Store;
