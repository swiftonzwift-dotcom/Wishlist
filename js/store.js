// Data storage. Two interchangeable back ends with the same methods:
//  - cloud: Firebase Firestore (shared by the whole family, updates live)
//  - local: this browser only (demo mode, used until Firebase is set up)
//
// Data model
//  people/{id}   { name, families: ["smith", ...], order, createdAt, removed?, removedAt? }
//  items/{id}    { personId, year, title, url, image, siteName, price, notes,
//                  priority (1-3), isSecret, addedBy, createdAt, copiedFrom?,
//                  purchased, purchasedBy, purchasedByName, purchasedAt }
//  meta/settings { currentYear, archivedYear?, rolledOverAt? }
//
// "Archiving" a year never moves data: each item remembers its year, and the
// site simply shows items whose year matches settings.currentYear.

import { FIREBASE_CONFIG, FAMILIES } from "./config.js";

const FIREBASE_VERSION = "10.12.2";

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function clean(o) {
  const r = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = v;
  return r;
}

function seedPeople() {
  const now = Date.now();
  const byName = new Map();
  for (const fam of FAMILIES) {
    for (const name of fam.members) {
      const key = name.trim().toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, {
          id: key.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "p" + byName.size,
          name: name.trim(),
          families: [],
          order: byName.size,
          createdAt: now,
        });
      }
      const p = byName.get(key);
      if (!p.families.includes(fam.id)) p.families.push(fam.id);
    }
  }
  return [...byName.values()];
}

function alreadyBought() {
  const e = new Error("Someone already marked this as bought.");
  e.code = "already-bought";
  return e;
}

export function isCloudConfigured() {
  const k = FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey;
  return !!(k && !/^PASTE/i.test(k) && FIREBASE_CONFIG.projectId);
}

export async function createStore() {
  return isCloudConfigured() ? cloudStore(FIREBASE_CONFIG) : localStore();
}

/* ------------------------------------------------------------------ local */

function localStore() {
  const KEY = "family-wishlist-data-v2";
  const listeners = new Set();
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY));
    } catch {
      return null;
    }
  };
  const write = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* private mode / storage full: keep working in memory */
    }
  };
  let data = read();
  if (!data || !Array.isArray(data.people)) {
    data = { people: seedPeople(), items: [], settings: { currentYear: new Date().getFullYear() } };
    write();
  }
  const snapshot = () => ({
    people: data.people.map((p) => ({ ...p })),
    items: data.items.map((i) => ({ ...i })),
    settings: { ...data.settings },
  });
  const emit = () => listeners.forEach((fn) => fn(snapshot()));
  const commit = () => {
    write();
    emit();
  };
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    const d = read();
    if (d) {
      data = d;
      emit();
    }
  });
  const find = (list, id) => list.find((x) => x.id === id);

  return {
    mode: "local",
    subscribe(fn) {
      listeners.add(fn);
      fn(snapshot());
    },
    async addPerson(p) {
      data.people.push(clean(p));
      commit();
    },
    async updatePerson(id, patch) {
      const p = find(data.people, id);
      if (p) Object.assign(p, clean(patch));
      commit();
    },
    async addItem(it) {
      data.items.push(clean(it));
      commit();
    },
    async updateItem(id, patch) {
      const it = find(data.items, id);
      if (it) Object.assign(it, clean(patch));
      commit();
    },
    async deleteItem(id) {
      data.items = data.items.filter((i) => i.id !== id);
      commit();
    },
    async markBought(id, buyer) {
      const it = find(data.items, id);
      if (!it) throw new Error("That item was deleted.");
      if (it.purchased) throw alreadyBought();
      Object.assign(it, clean({ ...buyer, purchased: true }));
      commit();
    },
    async updateSettings(patch) {
      Object.assign(data.settings, clean(patch));
      commit();
    },
  };
}

/* ------------------------------------------------------------------ cloud */

async function cloudStore(cfg) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [{ initializeApp }, F] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  const app = initializeApp(cfg);
  let db;
  try {
    db = F.initializeFirestore(app, {
      localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
    });
  } catch {
    db = F.getFirestore(app);
  }

  const settingsRef = F.doc(db, "meta", "settings");
  const itemRef = (id) => F.doc(db, "items", id);
  const personRef = (id) => F.doc(db, "people", id);

  // First ever visit: create the settings and the starting names, exactly once.
  try {
    await F.runTransaction(db, async (tx) => {
      const s = await tx.get(settingsRef);
      if (s.exists()) return;
      tx.set(settingsRef, { currentYear: new Date().getFullYear(), createdAt: Date.now() });
      for (const p of seedPeople()) {
        const { id, ...rest } = p;
        tx.set(personRef(id), rest);
      }
    });
  } catch (e) {
    console.warn("Setup check skipped:", e);
  }

  const state = { people: [], items: [], settings: {} };
  const got = { people: false, items: false, settings: false };
  const listeners = new Set();
  const errorListeners = new Set();
  const emit = () => {
    if (!(got.people && got.items && got.settings)) return;
    const snap = { people: [...state.people], items: [...state.items], settings: { ...state.settings } };
    listeners.forEach((fn) => fn(snap));
  };
  const onErr = (err) => {
    console.error(err);
    errorListeners.forEach((fn) => fn(err));
  };
  const docs = (snap) => snap.docs.map((d) => ({ ...d.data(), id: d.id }));

  F.onSnapshot(F.collection(db, "people"), (s) => { state.people = docs(s); got.people = true; emit(); }, onErr);
  F.onSnapshot(F.collection(db, "items"), (s) => { state.items = docs(s); got.items = true; emit(); }, onErr);
  F.onSnapshot(settingsRef, (s) => { state.settings = s.data() || {}; got.settings = true; emit(); }, onErr);

  const strip = ({ id, ...rest }) => clean(rest);

  return {
    mode: "cloud",
    subscribe(fn, onError) {
      listeners.add(fn);
      if (onError) errorListeners.add(onError);
      emit();
    },
    addPerson: (p) => F.setDoc(personRef(p.id), strip(p)),
    updatePerson: (id, patch) => F.updateDoc(personRef(id), clean(patch)),
    addItem: (it) => F.setDoc(itemRef(it.id), strip(it)),
    updateItem: (id, patch) => F.updateDoc(itemRef(id), clean(patch)),
    deleteItem: (id) => F.deleteDoc(itemRef(id)),
    markBought: (id, buyer) =>
      F.runTransaction(db, async (tx) => {
        const s = await tx.get(itemRef(id));
        if (!s.exists()) throw new Error("That item was deleted.");
        if (s.data().purchased) throw alreadyBought();
        tx.update(itemRef(id), clean({ ...buyer, purchased: true }));
      }),
    updateSettings: (patch) => F.setDoc(settingsRef, clean(patch), { merge: true }),
  };
}
