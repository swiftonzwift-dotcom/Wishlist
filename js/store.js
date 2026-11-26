// Data storage. Two interchangeable back ends with the same methods:
//  - cloud: Firebase Firestore (shared by the whole family, updates live)
//  - local: this browser only (demo mode, used until Firebase is set up)
//
// Data model
//  people/{id}   { name, families: ["smith", ...], homeFamily, order, createdAt, removed?, removedAt? }
//  items/{id}    { personId, year, title, url, image, siteName, price, notes,
//                  priority (1-3), isSecret, addedBy, createdAt, copiedFrom?,
//                  purchased, purchasedBy, purchasedByName, purchasedAt }
//  meta/settings { currentYear, archivedYear?, rolledOverAt? }
//  backups/{id}  { kind: "daily" | "before-restore", day, createdAt, people, wishes, data (JSON) }
//                 A full copy of people, items and settings, kept for 30 days.
//
// "Archiving" a year never moves data: each item remembers its year, and the
// site simply shows items whose year matches settings.currentYear.

import { FIREBASE_CONFIG, FAMILIES, HOME_FAMILY, FAMILY_ACCOUNT_EMAIL } from "./config.js";

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
  for (const p of byName.values()) {
    const home = HOME_FAMILY[p.name];
    p.homeFamily = p.families.includes(home) ? home : p.families[0];
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

/**
 * Demo mode: returns the local store straight away.
 * Cloud mode: if this device has already entered the family password, returns
 * the cloud store. Otherwise returns { locked: true, unlock(password) }, and
 * unlock() resolves to the cloud store once the password is right.
 */
export async function createStore() {
  if (!isCloudConfigured()) return localStore();
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [{ initializeApp }, A] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
  ]);
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = A.getAuth(app);
  // Stay signed in on this device until someone taps "Sign out".
  await A.setPersistence(auth, A.browserLocalPersistence).catch(() => {});
  const user = await new Promise((resolve) => {
    const stop = A.onAuthStateChanged(auth, (u) => { stop(); resolve(u); });
  });
  const signOut = () => A.signOut(auth);
  if (user) return cloudStore(app, signOut);
  return {
    mode: "cloud",
    locked: true,
    async unlock(password) {
      await A.signInWithEmailAndPassword(auth, FAMILY_ACCOUNT_EMAIL, password);
      return cloudStore(app, signOut);
    },
  };
}

/* ------------------------------------------------------------------ local */

function localStore() {
  const KEY = "family-wishlist-data-v3";
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
    // backups live in their own key so they don't slow down everyday saves
    async saveBackupIfMissing(id, backup) {
      const all = readBackups();
      if (all[id]) return false;
      all[id] = backup;
      writeBackups(all);
      return true;
    },
    async listBackups() {
      return Object.entries(readBackups()).map(([id, b]) => ({ ...b, id }));
    },
    async deleteBackup(id) {
      const all = readBackups();
      delete all[id];
      writeBackups(all);
    },
    async replaceAll(snap) {
      data = { people: snap.people.map((x) => ({ ...x })), items: snap.items.map((x) => ({ ...x })), settings: { ...snap.settings } };
      commit();
    },
  };
}

const BACKUP_KEY = "family-wishlist-backups-v1";
function readBackups() {
  try { return JSON.parse(localStorage.getItem(BACKUP_KEY)) || {}; } catch { return {}; }
}
function writeBackups(all) {
  try { localStorage.setItem(BACKUP_KEY, JSON.stringify(all)); } catch { /* storage full: skip */ }
}

/* ------------------------------------------------------------------ cloud */

async function cloudStore(app, signOutAuth) {
  const F = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`);
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
    async signOut() {
      await signOutAuth();
      // Also wipe the copy of the lists saved on this device.
      try { await F.terminate(db); await F.clearIndexedDbPersistence(db); } catch {}
    },
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

    /* ---- backups ---- */
    saveBackupIfMissing: (id, backup) =>
      F.runTransaction(db, async (tx) => {
        const ref = F.doc(db, "backups", id);
        if ((await tx.get(ref)).exists()) return false;
        tx.set(ref, backup);
        return true;
      }),
    async listBackups() {
      const snap = await F.getDocs(F.collection(db, "backups"));
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    },
    deleteBackup: (id) => F.deleteDoc(F.doc(db, "backups", id)),
    // Make the live lists exactly match a backup: overwrite what's in it,
    // delete anything added since. Written in chunks (Firestore batch limit).
    async replaceAll(snap) {
      const ops = [];
      const keepPeople = new Set(snap.people.map((p) => p.id));
      const keepItems = new Set(snap.items.map((i) => i.id));
      for (const p of state.people) if (!keepPeople.has(p.id)) ops.push((b) => b.delete(personRef(p.id)));
      for (const i of state.items) if (!keepItems.has(i.id)) ops.push((b) => b.delete(itemRef(i.id)));
      for (const p of snap.people) ops.push((b) => b.set(personRef(p.id), strip(p)));
      for (const i of snap.items) ops.push((b) => b.set(itemRef(i.id), strip(i)));
      ops.push((b) => b.set(settingsRef, clean(snap.settings || {})));
      for (let n = 0; n < ops.length; n += 400) {
        const batch = F.writeBatch(db);
        ops.slice(n, n + 400).forEach((op) => op(batch));
        await batch.commit();
      }
    },
  };
}
