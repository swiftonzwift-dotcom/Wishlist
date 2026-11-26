import { createStore, uid } from "./store.js";
import { FAMILIES } from "./config.js";
import { fetchPreview, normalizeUrl, safeUrl, hostOf, siteNameFor } from "./preview.js";

const app = document.getElementById("app");
const toastEl = document.getElementById("toast");

let store = null;
let S = { people: [], items: [], settings: {}, ready: false, error: "" };
let rolloverChecked = false;

/* =========================================================== helpers */

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const memStore = {};
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return memStore[k] ?? null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { memStore[k] = v; } },
  del(k) { try { localStorage.removeItem(k); } catch { delete memStore[k]; } },
};

const ME_KEY = "wishlist-me";
const getMeId = () => ls.get(ME_KEY) || "";
const setMeId = (id) => (id ? ls.set(ME_KEY, id) : ls.del(ME_KEY));

const PRIORITY = {
  3: { label: "Most wanted", stars: "★★★" },
  2: { label: "Really want", stars: "★★" },
  1: { label: "Nice to have", stars: "★" },
};

const possessive = (n) => (/s$/i.test(n) ? `${n}’` : `${n}’s`);
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

const AVATAR_COLORS = ["#b3261e", "#1e7a46", "#9a5b13", "#2f5d9e", "#7b3f99", "#0f766e", "#a23c6b", "#5b6b1f"];
function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = (parts[0] || "?").charAt(0);
  const b = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return (a + b).toUpperCase();
}

function avatar(p, size = "") {
  const name = (p && p.name) || "?";
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const bg = AVATAR_COLORS[h % AVATAR_COLORS.length];
  return `<span class="avatar ${size}" style="background:${bg}" aria-hidden="true">${esc(initials(name))}</span>`;
}

const year = () => Number(S.settings.currentYear) || new Date().getFullYear();
const person = (id) => S.people.find((p) => p.id === id);
const activePeople = () =>
  S.people.filter((p) => !p.removed).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name));
const itemsFor = (pid, yr = year()) => S.items.filter((i) => i.personId === pid && Number(i.year) === yr);
const nameOf = (id, fallback = "someone") => (person(id) && person(id).name) || fallback;
const firstName = (p) => String((p && p.name) || "").trim().split(/\s+/)[0] || "them";
const firstOf = (id, fallback = "someone") => (person(id) ? firstName(person(id)) : fallback);

/* families: each person belongs to one or more; the toggle picks which to show */
const FAM_KEY = "wishlist-family";
const FAM_IDS = FAMILIES.map((f) => f.id);
const ALL = "all";
const famName = (id) => (FAMILIES.find((f) => f.id === id) || { name: id }).name;
function personFams(p) {
  const f = (p && Array.isArray(p.families) ? p.families : []).filter((x) => FAM_IDS.includes(x));
  return f.length ? f : FAM_IDS; // no family set (older data): show everywhere
}
function currentFam() {
  const saved = ls.get(FAM_KEY);
  if (saved === ALL || FAM_IDS.includes(saved)) return saved;
  const me = person(getMeId());
  const mine = me ? personFams(me) : FAM_IDS;
  return mine.length === 1 ? mine[0] : ALL;
}
const inFam = (p, fam = currentFam()) => fam === ALL || personFams(p).includes(fam);
const famHeading = (fam = currentFam()) => (fam === ALL ? "Both families" : `${famName(fam)} family`);

function famToggle() {
  const cur = currentFam();
  const opts = [...FAMILIES.map((f) => [f.id, `${f.name}s`]), [ALL, FAMILIES.length === 2 ? "Both" : "Everyone"]];
  return `<div class="fam-toggle" role="group" aria-label="Show which family">${opts.map(([id, label]) =>
    `<button type="button" class="${cur === id ? "on" : ""}" aria-pressed="${cur === id}" data-action="set-family" data-fam="${id}">${esc(label)}</button>`).join("")}</div>`;
}

function famChecks(selected) {
  return `<fieldset class="fam-checks"><legend>Which family list?</legend>${FAMILIES.map((f) =>
    `<label><input type="checkbox" name="fam" value="${f.id}" ${selected.includes(f.id) ? "checked" : ""}> ${esc(f.name)}s</label>`).join("")}</fieldset>`;
}
// Keep each family in the order its names were listed in config.js.
function famSort(list, fam = currentFam()) {
  const members = fam === ALL ? [] : ((FAMILIES.find((f) => f.id === fam) || {}).members || []).map((n) => n.toLowerCase());
  const rank = (p) => {
    const i = members.indexOf(p.name.trim().toLowerCase());
    return i >= 0 ? i : 1000 + (p.order ?? 0);
  };
  return list.slice().sort((a, b) => rank(a) - rank(b));
}
const famTags = (p) => personFams(p).map((f) => `<span class="fam-tag">${esc(famName(f))}</span>`).join("");

function sortItems(list, boughtLast) {
  return list.slice().sort((a, b) => {
    if (boughtLast && !!a.purchased !== !!b.purchased) return a.purchased ? 1 : -1;
    return (b.priority || 2) - (a.priority || 2) || (a.createdAt || 0) - (b.createdAt || 0);
  });
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

// Writes show success right away (the screen updates instantly) and only
// speak up if saving actually fails.
function save(promise, okMsg) {
  if (okMsg) toast(okMsg);
  Promise.resolve(promise).catch((e) => {
    console.error(e);
    toast("Couldn’t save that. Check your internet and try again.");
  });
}

function route() {
  return (location.hash.replace(/^#\/?/, "") || "").split("/").filter(Boolean).map(decodeURIComponent);
}

/* =========================================================== rendering */

function render() {
  if (S.error) {
    app.innerHTML = `<div class="center-msg"><p class="big-emoji">😕</p><h1>Can’t reach the family list</h1>
      <p>${esc(S.error)}</p><button class="btn primary" onclick="location.reload()">Try again</button></div>`;
    return;
  }
  if (!S.ready) return;

  const meId = getMeId();
  const me = person(meId);
  if (meId && (!me || me.removed)) setMeId("");

  const [page, a, b] = route();
  let html;
  if (!getMeId() && !["help", "family"].includes(page)) html = viewWho(true);
  else {
    switch (page) {
      case "who": html = viewWho(false); break;
      case "list": html = viewList(a); break;
      case "family": html = viewFamily(); break;
      case "past": html = b ? viewPastPerson(Number(a), b) : a ? viewPastYear(Number(a)) : viewPast(); break;
      case "shopping": html = viewShopping(); break;
      case "help": html = viewHelp(); break;
      default: html = viewHome();
    }
  }

  // Keep anything the person is typing if the list updates underneath them.
  const kept = [...app.querySelectorAll("input[name]:not([type=checkbox]):not([type=radio])")].map((el) => ({
    key: (el.form?.dataset.form || "") + ":" + el.name, value: el.value,
    focus: el === document.activeElement, start: el.selectionStart,
  }));
  app.innerHTML = html;
  for (const k of kept) {
    const [form, name] = k.key.split(":");
    const el = app.querySelector(`${form ? `form[data-form="${form}"] ` : ""}input[name="${name}"]:not([type=checkbox]):not([type=radio])`);
    if (!el) continue;
    if (k.value) el.value = k.value;
    if (k.focus) { el.focus(); try { el.setSelectionRange(k.start, k.start); } catch {} }
  }
}

function topbar(toggle = false) {
  const me = person(getMeId());
  return `<header class="topbar"><div class="topbar-row">
    <a class="brand" href="#/"><span aria-hidden="true">🎁</span> Wish Lists <span class="yr">${year()}</span></a>
    ${me ? `<a class="me-chip" href="#/who" aria-label="You are ${esc(me.name)}. Tap to change.">${avatar(me, "sm")}<span>${esc(me.name)}</span><span class="chev" aria-hidden="true">▾</span></a>` : ""}
  </div>${toggle ? famToggle() : ""}</header>`;
}

const back = (href = "#/", label = "All lists") => `<a class="back" href="${href}">‹ ${esc(label)}</a>`;

function modeBanner() {
  if (store.mode !== "local") return "";
  return `<div class="banner info"><strong>Demo mode:</strong> lists are saved on this device only. To share with the family, follow the setup steps in the README.</div>`;
}

function rolloverBanner() {
  const s = S.settings;
  if (!s.rolledOverAt || !s.archivedYear) return "";
  if (Date.now() - s.rolledOverAt > 45 * 864e5) return "";
  if (ls.get("wishlist-banner-" + year())) return "";
  return `<div class="banner celebrate">
    <p>🎉 <strong>Welcome to the ${year()} lists!</strong> Last year’s lists are saved in <a href="#/past/${s.archivedYear}">Past years</a>.</p>
    <button class="link-btn" data-action="dismiss-banner">Got it</button></div>`;
}

/* ---------------------------------------------------------- who are you */

function viewWho(first) {
  const people = activePeople();
  const fam = currentFam();
  const fams = fam === ALL ? FAMILIES : FAMILIES.filter((f) => f.id === fam);
  const btn = (p) => `<button class="who-btn ${p.id === getMeId() ? "current" : ""}" data-action="choose-me" data-id="${esc(p.id)}">${avatar(p)}<span>${esc(p.name)}</span></button>`;
  return `${first ? "" : topbar(true)}
  <div class="page">
    ${first ? `<div class="welcome"><p class="big-emoji">🎁</p><h1>Welcome to the family wish lists!</h1></div>${famToggle()}` : back()}
    <h2 class="who-q">${first ? "First, who are you?" : "Who are you?"}</h2>
    <p class="hint">Tap your name. This phone will remember you.</p>
    ${fams.map((f) => `<h3 class="fam-h">${esc(f.name)} family</h3>
      <div class="who-grid">${famSort(people.filter((p) => inFam(p, f.id)), f.id).map(btn).join("")}</div>`).join("")}
    <details class="add-self">
      <summary>Not on the list? Add your name</summary>
      <form data-form="add-self" class="inline-form">
        <label class="sr-only" for="self-name">Your name</label>
        <input id="self-name" name="name" placeholder="First and last name" maxlength="40" autocomplete="name" required>
        <button class="btn primary">Add me</button>
        ${famChecks(fam === ALL ? [] : [fam])}
      </form>
    </details>
  </div>`;
}

/* ---------------------------------------------------------------- home */

function viewHome() {
  const me = person(getMeId());
  const others = famSort(activePeople().filter((p) => p.id !== me.id && inFam(p)));
  const mine = itemsFor(me.id).filter((i) => !i.isSecret);
  const giving = S.items.filter((i) => Number(i.year) === year() && i.purchased && i.purchasedBy === me.id);

  const row = (p) => {
    const list = itemsFor(p.id);
    const bought = list.filter((i) => i.purchased).length;
    const meta = list.length
      ? `${plural(list.length, "wish", "wishes")}${bought ? ` · <span class="ok">${bought} bought</span>` : ""}`
      : `<span class="muted">No wishes yet</span>`;
    return `<li><a class="person-row" href="#/list/${esc(p.id)}">${avatar(p)}<span class="pr-text"><strong>${esc(p.name)}</strong><small>${meta}</small></span><span class="arrow" aria-hidden="true">›</span></a></li>`;
  };

  return `${topbar(true)}
  <div class="page">
    ${rolloverBanner()}${modeBanner()}
    <h1 class="hello">Hi, ${esc(firstName(me))}!</h1>
    <a class="card-btn primary" href="#/list/${esc(me.id)}">
      <span class="ico" aria-hidden="true">📝</span>
      <span class="cb-text"><strong>My wish list</strong><small>${mine.length ? `${plural(mine.length, "wish", "wishes")} · tap to add or change` : "Empty · tap to add your first wish"}</small></span>
      <span class="arrow" aria-hidden="true">›</span>
    </a>

    <h2>${currentFam() === ALL ? "Everyone’s lists" : `${esc(famHeading())} lists`}</h2>
    <p class="hint">Tap a name to see their wishes. When you buy something, mark it so nobody else buys the same thing.</p>
    <ul class="people">${others.map(row).join("") || `<li class="muted">No one else yet. <a href="#/family">Add names</a></li>`}</ul>

    <a class="card-btn" href="#/shopping">
      <span class="ico" aria-hidden="true">🛍️</span>
      <span class="cb-text"><strong>Gifts I’m giving</strong><small>${giving.length ? `${plural(giving.length, "gift")} marked as bought` : "Nothing marked yet"}</small></span>
      <span class="arrow" aria-hidden="true">›</span>
    </a>

    <nav class="links" aria-label="More">
      <a href="#/family">👪 Add or edit names</a>
      <a href="#/past">🗂️ Past years</a>
      <a href="#/help">❓ How it works</a>
      <button type="button" data-action="share">📤 Send this site to family</button>
    </nav>
  </div>`;
}

/* ---------------------------------------------------------- item cards */

function thumb(it) {
  const img = safeUrl(it.image);
  return `<div class="thumb">${img
    ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-thumb>`
    : `<span class="ph" aria-hidden="true">🎁</span>`}</div>`;
}

function itemCard(it, mode) {
  const me = person(getMeId());
  const showBought = mode !== "owner" && it.purchased;
  const url = safeUrl(it.url);
  const pr = PRIORITY[it.priority] || PRIORITY[2];
  const owner = firstOf(it.personId, "them");
  const buyer = nameOf(it.purchasedBy, it.purchasedByName || "someone");
  const id = esc(it.id);
  const viewBtn = url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">View item ↗</a>` : "";

  let actions = "";
  if (mode === "owner") {
    actions = `${viewBtn}<button class="btn" data-action="edit-item" data-id="${id}">✏️ Edit</button><button class="btn danger-ghost" data-action="delete-item" data-id="${id}">🗑️ Delete</button>`;
  } else if (mode === "viewer") {
    actions = viewBtn + (it.purchased
      ? `<button class="btn ghost small" data-action="unbuy-item" data-id="${id}">Undo</button>`
      : `<button class="btn buy" data-action="buy-item" data-id="${id}">✓ I bought this</button>`);
    if (it.isSecret) actions += `<button class="btn ghost small" data-action="edit-item" data-id="${id}">Edit idea</button><button class="btn ghost small" data-action="delete-item" data-id="${id}">Delete idea</button>`;
  } else if (mode === "shopping") {
    actions = `${viewBtn}<button class="btn ghost small" data-action="unbuy-item" data-id="${id}">Not bought after all</button>`;
  } else {
    actions = viewBtn;
  }

  return `<article class="item ${showBought ? "is-bought" : ""} ${it.isSecret ? "is-secret" : ""}">
    ${showBought ? `<div class="bought-flag"><span aria-hidden="true">✓</span> PURCHASED</div>` : ""}
    <div class="item-main">
      <div class="thumb-wrap">${thumb(it)}${showBought ? `<span class="check-badge" aria-hidden="true">✓</span>` : ""}</div>
      <div class="item-info">
        <h3>${esc(it.title)}</h3>
        <div class="tags">
          <span class="tag prio p${it.priority || 2}"><span aria-hidden="true">${pr.stars}</span> ${pr.label}</span>
          ${it.price ? `<span class="tag">${esc(it.price)}</span>` : ""}
          ${url ? `<span class="tag site">${esc(it.siteName || siteNameFor(url))}</span>` : ""}
        </div>
        ${it.notes ? `<p class="notes">${esc(it.notes)}</p>` : ""}
        ${it.isSecret && mode !== "owner" ? `<p class="secret-note">🤫 Gift idea from ${esc(nameOf(it.addedBy))}. ${esc(owner)} can’t see this.</p>` : ""}
        ${showBought ? `<p class="bought-by">🎁 Bought by <strong>${esc(it.purchasedBy === (me && me.id) ? "you" : buyer)}</strong></p>` : ""}
      </div>
    </div>
    ${actions ? `<div class="item-actions">${actions}</div>` : ""}
  </article>`;
}

/* --------------------------------------------------------------- lists */

function viewList(pid) {
  const p = person(pid);
  if (!p || p.removed) return `${topbar()}<div class="page">${back()}<p class="empty">That list isn’t here anymore.</p></div>`;
  return p.id === getMeId() ? viewMyList(p) : viewTheirList(p);
}

function viewMyList(me) {
  const items = sortItems(itemsFor(me.id).filter((i) => !i.isSecret), false);
  const carry = carryOverCandidates(me.id);
  return `${topbar()}
  <div class="page">
    ${back()}
    <h1>My wish list</h1>
    <p class="hint">Add things you’d love to get. Your family can see this list.
      <strong>You won’t see what’s been bought</strong>, so it stays a surprise 🤫</p>
    <button class="btn primary big-add" data-action="add-item" data-person="${esc(me.id)}">＋ Add a wish</button>
    ${carry.items.length ? `<div class="carry"><p>You had ${plural(carry.items.length, "wish", "wishes")} in ${carry.year} that nobody bought.</p>
      <button class="btn" data-action="copy-last-year" data-person="${esc(me.id)}">Bring them back</button></div>` : ""}
    <div class="items">
      ${items.map((i) => itemCard(i, "owner")).join("") ||
        `<div class="empty"><p class="big-emoji">✨</p><p>Your list is empty.</p><p class="muted">Tap <strong>Add a wish</strong>. You can paste a link from any store, or just type an idea like “warm socks, size M”.</p></div>`}
    </div>
  </div>`;
}

function viewTheirList(p) {
  const items = sortItems(itemsFor(p.id), true);
  const open = items.filter((i) => !i.purchased).length;
  const name = esc(firstName(p));
  return `${topbar()}
  <div class="page">
    ${back()}
    <div class="list-head">${avatar(p, "lg")}<div><h1>${esc(possessive(p.name))} wish list</h1>
      <p class="muted">${items.length ? `${plural(items.length, "wish", "wishes")} · ${open} still available` : "No wishes yet"}</p></div></div>
    ${items.length ? `<p class="hint">Bought something? Tap <strong>✓ I bought this</strong> so nobody else buys it. ${name} won’t see it.</p>` : ""}
    <div class="items">
      ${items.map((i) => itemCard(i, "viewer")).join("") ||
        `<div class="empty"><p class="big-emoji">📭</p><p>${name} hasn’t added any wishes yet.</p><p class="muted">Check back later, or add a gift idea below.</p></div>`}
    </div>
    <section class="secret-box">
      <h2>💡 Have a gift idea for ${name}?</h2>
      <p>Add it here to share with everyone except ${name}.</p>
      <button class="btn" data-action="add-item" data-person="${esc(p.id)}" data-secret="1">＋ Add a secret idea</button>
    </section>
    <p class="switch-note">Is this your list, or are you helping ${name} with it?
      <button class="link-btn" data-action="choose-me" data-id="${esc(p.id)}" data-go="list">Switch to ${esc(possessive(firstName(p)))} own view</button></p>
  </div>`;
}

function carryOverCandidates(pid) {
  const cur = year();
  const prevYears = [...new Set(S.items.filter((i) => i.personId === pid && Number(i.year) < cur).map((i) => Number(i.year)))];
  if (!prevYears.length) return { year: null, items: [] };
  const prev = Math.max(...prevYears);
  const copied = new Set(itemsFor(pid).map((i) => i.copiedFrom).filter(Boolean));
  const items = itemsFor(pid, prev).filter((i) => !i.purchased && !i.isSecret && !copied.has(i.id));
  return { year: prev, items };
}

/* ------------------------------------------------------------ shopping */

function viewShopping() {
  const meId = getMeId();
  const mine = S.items.filter((i) => Number(i.year) === year() && i.purchased && i.purchasedBy === meId);
  const groups = {};
  for (const i of mine) (groups[i.personId] ||= []).push(i);
  return `${topbar()}
  <div class="page">
    ${back()}
    <h1>Gifts I’m giving</h1>
    <p class="hint">Everything you’ve marked as bought this year, so you can keep track.</p>
    ${Object.keys(groups).map((pid) => `<h2 class="group-h">${avatar(person(pid))} For ${esc(nameOf(pid))}</h2>
      <div class="items">${groups[pid].map((i) => itemCard(i, "shopping")).join("")}</div>`).join("") ||
      `<div class="empty"><p class="big-emoji">🛍️</p><p>Nothing yet.</p><p class="muted">Open someone’s list and tap <strong>✓ I bought this</strong> on a gift you’ve bought.</p></div>`}
  </div>`;
}

/* -------------------------------------------------------------- family */

function viewFamily() {
  const fam = currentFam();
  const people = famSort(activePeople().filter((p) => inFam(p)));
  const removed = S.people.filter((p) => p.removed);
  return `${topbar(true)}
  <div class="page">
    ${back(getMeId() ? "#/" : "#/who", getMeId() ? "All lists" : "Back")}
    <h1>${fam === ALL ? "Family names" : `${esc(famHeading())} names`}</h1>
    <p class="hint">Anyone can add a name, fix a spelling, or change which family list someone is on.</p>
    <form data-form="add-person" class="add-person">
      <div class="inline-form">
        <label class="sr-only" for="new-name">New name</label>
        <input id="new-name" name="name" placeholder="First and last name" maxlength="40" required>
        <button class="btn primary">＋ Add</button>
      </div>
      ${famChecks(fam === ALL ? [] : [fam])}
    </form>
    <ul class="manage">
      ${people.map((p) => `<li>${avatar(p)}<span class="m-name">${esc(p.name)}<span class="fam-tags">${famTags(p)}</span></span>
        <button class="btn small" data-action="rename-person" data-id="${esc(p.id)}">Edit</button>
        <button class="btn small danger-ghost" data-action="remove-person" data-id="${esc(p.id)}">Remove</button></li>`).join("")}
    </ul>
    ${removed.length ? `<details class="removed"><summary>Removed names (${removed.length})</summary><ul class="manage">
      ${removed.map((p) => `<li>${avatar(p)}<span class="m-name">${esc(p.name)}</span><button class="btn small" data-action="restore-person" data-id="${esc(p.id)}">Bring back</button></li>`).join("")}
    </ul></details>` : ""}
  </div>`;
}

/* ---------------------------------------------------------------- past */

function pastYears() {
  const cur = year();
  return [...new Set(S.items.map((i) => Number(i.year)).filter((y) => y && y < cur))].sort((a, b) => b - a);
}

function viewPast() {
  const years = pastYears();
  const next = year() + 1;
  return `${topbar(true)}
  <div class="page">
    ${back()}
    <h1>Past years</h1>
    <p class="hint">Every January, last year’s lists are saved here automatically and everyone gets a fresh, empty list for the new year.</p>
    <ul class="people">
      ${years.map((y) => {
        const n = S.items.filter((i) => Number(i.year) === y).length;
        return `<li><a class="person-row" href="#/past/${y}"><span class="ico-yr">${y}</span><span class="pr-text"><strong>${y} wish lists</strong><small>${plural(n, "wish", "wishes")}</small></span><span class="arrow">›</span></a></li>`;
      }).join("") || `<li class="empty-inline muted">Nothing saved yet. The ${year()} lists will be saved here in January ${next}.</li>`}
    </ul>
    <section class="secret-box">
      <h2>Start ${next} early?</h2>
      <p>This saves the ${year()} lists here and gives everyone a fresh list now. It happens on its own on January 1, so you normally don’t need this.</p>
      <button class="btn danger-ghost" data-action="start-next-year">Save ${year()} and start ${next}</button>
    </section>
  </div>`;
}

function viewPastYear(y) {
  const ids = [...new Set(S.items.filter((i) => Number(i.year) === y).map((i) => i.personId))];
  const ppl = ids.map((id) => person(id) || { id, name: "Removed name" }).filter((p) => inFam(p))
    .sort((a, b) => a.name.localeCompare(b.name));
  return `${topbar(true)}
  <div class="page">
    ${back("#/past", "Past years")}
    <h1>${y} wish lists</h1>
    <p class="hint">Saved for remembering. These can’t be changed.</p>
    <ul class="people">${ppl.map((p) => {
      const list = itemsFor(p.id, y);
      return `<li><a class="person-row" href="#/past/${y}/${esc(p.id)}">${avatar(p)}<span class="pr-text"><strong>${esc(p.name)}</strong><small>${plural(list.length, "wish", "wishes")} · ${list.filter((i) => i.purchased).length} bought</small></span><span class="arrow">›</span></a></li>`;
    }).join("") || `<li class="muted">No lists that year.</li>`}</ul>
  </div>`;
}

function viewPastPerson(y, pid) {
  const p = person(pid) || { id: pid, name: "Removed name" };
  const items = sortItems(itemsFor(pid, y), true);
  return `${topbar()}
  <div class="page">
    ${back(`#/past/${y}`, `${y} lists`)}
    <h1>${esc(possessive(p.name))} ${y} list</h1>
    <div class="items">${items.map((i) => itemCard(i, "archive")).join("") || `<p class="empty">No wishes.</p>`}</div>
  </div>`;
}

/* ---------------------------------------------------------------- help */

function viewHelp() {
  const qa = [
    ["How do I add something I want?", "Tap <strong>My wish list</strong>, then <strong>＋ Add a wish</strong>. Paste a link from any store (we’ll try to fetch the picture and name), or just type what you’d like."],
    ["How do I copy a link from a store?", "On your phone, open the item in the store’s app or website, tap the <strong>Share</strong> button and choose <strong>Copy</strong> (or <strong>Copy link</strong>). Then come back here and tap <strong>Paste</strong>."],
    ["How do I mark a gift as bought?", "Open the person’s list and tap <strong>✓ I bought this</strong>. Everyone else will see a big green <strong>PURCHASED</strong> tag so they don’t buy it too."],
    ["Can people see what was bought for them?", "No. When you look at your own list, bought items look exactly the same as before. It stays a surprise."],
    ["What’s a secret idea?", "On someone else’s list you can add a gift idea for them. Everyone can see it except that person. It’s handy for things you know they’d love."],
    ["I marked something by mistake.", "Tap <strong>Undo</strong> on the item, or go to <strong>Gifts I’m giving</strong> and tap <strong>Not bought after all</strong>."],
    ["What happens after the holidays?", "On January 1 the lists are saved under <strong>Past years</strong> and everyone starts with a fresh list. Anything you didn’t get can be brought back with one tap."],
    ["How do I remove a name?", "Go to <strong>Add or edit names</strong>, tap <strong>Remove</strong> and type <strong>APPROVE</strong> in capital letters. This keeps names from being removed by accident."],
    ["Can I put this on my home screen?", "Yes! iPhone: tap the Share button in Safari, then <strong>Add to Home Screen</strong>. Android: tap the ⋮ menu in Chrome, then <strong>Add to Home screen</strong>."],
    ["I picked the wrong name.", "Tap your name in the top corner to switch."],
  ];
  return `${topbar()}
  <div class="page">
    ${back(getMeId() ? "#/" : "#/who", getMeId() ? "All lists" : "Back")}
    <h1>How it works</h1>
    <div class="faq">${qa.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join("")}</div>
  </div>`;
}

/* =========================================================== dialogs */

function dialog(html) {
  const d = document.createElement("dialog");
  d.className = "sheet";
  d.innerHTML = html;
  document.body.appendChild(d);
  d.addEventListener("close", () => setTimeout(() => d.remove(), 0));
  d.addEventListener("click", (e) => { if (e.target === d) d.close("cancel"); });
  d.showModal();
  return d;
}

function confirmBox({ title, text = "", ok = "OK", danger = false }) {
  return new Promise((resolve) => {
    const d = dialog(`<form method="dialog">
      <h2>${title}</h2>${text ? `<p>${text}</p>` : ""}
      <div class="dlg-actions"><button value="cancel" class="btn ghost">Cancel</button>
      <button value="ok" class="btn ${danger ? "danger" : "primary"}">${ok}</button></div></form>`);
    d.addEventListener("close", () => resolve(d.returnValue === "ok"));
  });
}

/** Requires typing APPROVE (capital letters) before the action button works. */
function approveBox({ title, text, ok }) {
  return new Promise((resolve) => {
    const d = dialog(`<form method="dialog">
      <h2>${title}</h2><p>${text}</p>
      <label class="field"><span>To confirm, type <strong>APPROVE</strong> in capital letters</span>
        <input name="approve" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="APPROVE"></label>
      <p class="approve-hint muted" aria-live="polite"></p>
      <div class="dlg-actions"><button value="cancel" class="btn ghost">Cancel</button>
      <button value="ok" class="btn danger" disabled>${ok}</button></div></form>`);
    const input = d.querySelector("input");
    const btn = d.querySelector('button[value="ok"]');
    const hint = d.querySelector(".approve-hint");
    const valid = () => input.value.trim() === "APPROVE";
    input.addEventListener("input", () => {
      btn.disabled = !valid();
      const v = input.value.trim();
      hint.textContent = v && !valid() && v.toUpperCase() === "APPROVE" ? "Almost! It needs to be all capital letters." : "";
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (valid()) d.close("ok");
    });
    d.addEventListener("close", () => resolve(d.returnValue === "ok" && valid()));
  });
}

function personDialog({ title, value = "", families = [], ok }) {
  return new Promise((resolve) => {
    const d = dialog(`<form method="dialog">
      <h2>${title}</h2>
      <label class="field"><span>Name</span><input name="name" maxlength="40" value="${esc(value)}" required></label>
      ${famChecks(families)}
      <p class="form-error" role="alert" hidden></p>
      <div class="dlg-actions"><button value="cancel" class="btn ghost" formnovalidate>Cancel</button><button value="ok" class="btn primary">${ok}</button></div></form>`);
    const form = d.querySelector("form");
    const input = form.elements.name;
    const picked = () => [...form.querySelectorAll('input[name="fam"]:checked')].map((i) => i.value);
    form.addEventListener("submit", (e) => {
      if (e.submitter && e.submitter.value === "ok" && !picked().length) {
        e.preventDefault();
        const err = d.querySelector(".form-error");
        err.hidden = false;
        err.textContent = "Tick at least one family.";
      }
    });
    input.focus();
    d.addEventListener("close", () =>
      resolve(d.returnValue === "ok" ? { name: input.value.trim().replace(/\s+/g, " "), families: picked() } : null));
  });
}

function itemDialog({ personId, item, secret }) {
  const me = person(getMeId());
  const owner = person(personId);
  const isEdit = !!item;
  const it = item || { priority: 2 };
  const isSecret = isEdit ? !!it.isSecret : !!secret;
  let image = it.image || "";
  let siteName = it.siteName || "";
  let looked = it.url || "";

  const heading = isEdit ? (isSecret ? "Edit gift idea" : "Edit wish") : isSecret ? `Gift idea for ${esc(owner.name)}` : "Add a wish";
  const d = dialog(`<form class="item-form" novalidate>
    <h2>${heading}</h2>
    ${isSecret ? `<p class="hint">🤫 ${esc(owner.name)} won’t see this.</p>` : ""}
    <div class="field">
      <label for="f-url">Link to the item <em>(optional)</em></label>
      <div class="row">
        <input id="f-url" name="url" type="url" inputmode="url" placeholder="Paste a store link" value="${esc(it.url || "")}" autocomplete="off" autocapitalize="off" spellcheck="false">
        <button type="button" class="btn" data-paste>Paste</button>
      </div>
      <small class="help">Copy the item’s link from any store, then tap Paste. We’ll try to grab the picture and name.</small>
    </div>
    <div class="preview" hidden></div>
    <label class="field"><span>What is it?</span>
      <input name="title" maxlength="150" placeholder="e.g. Blue wool scarf" value="${esc(it.title || "")}"></label>
    <label class="field"><span>Price <em>(optional)</em></span>
      <input name="price" maxlength="30" placeholder="e.g. $25" value="${esc(it.price || "")}"></label>
    <label class="field"><span>Details <em>(optional)</em></span>
      <textarea name="notes" rows="3" maxlength="500" placeholder="Size, color, model…">${esc(it.notes || "")}</textarea></label>
    <fieldset class="field prio-pick"><legend>How much ${isSecret ? "would they" : "do you"} want it?</legend>
      ${[1, 2, 3].map((n) => `<label class="chip"><input type="radio" name="priority" value="${n}" ${Number(it.priority || 2) === n ? "checked" : ""}><span><span aria-hidden="true">${PRIORITY[n].stars}</span> ${PRIORITY[n].label}</span></label>`).join("")}
    </fieldset>
    <p class="form-error" role="alert" hidden></p>
    <div class="dlg-actions"><button type="button" class="btn ghost" data-cancel>Cancel</button>
      <button type="submit" class="btn primary">${isEdit ? "Save changes" : isSecret ? "Add idea" : "Add to my list"}</button></div>
  </form>`);

  const form = d.querySelector("form");
  const urlIn = form.elements.url;
  const titleIn = form.elements.title;
  const prev = d.querySelector(".preview");
  const err = d.querySelector(".form-error");

  function showPreview(msg = "") {
    const url = normalizeUrl(urlIn.value);
    if (!url && !image) { prev.hidden = true; return; }
    prev.hidden = false;
    prev.innerHTML = `${image ? `<img src="${esc(image)}" alt="" referrerpolicy="no-referrer" data-thumb>` : `<span class="ph">🎁</span>`}
      <div><strong>${esc(siteName || siteNameFor(url) || "Link")}</strong>${msg ? `<small>${esc(msg)}</small>` : ""}
      ${image ? `<button type="button" class="link-btn" data-noimg>Remove picture</button>` : ""}</div>`;
  }

  async function lookup() {
    const url = normalizeUrl(urlIn.value);
    if (!url) { if (urlIn.value.trim()) { err.hidden = false; err.textContent = "That doesn’t look like a web link. You can leave it empty."; } return; }
    err.hidden = true;
    urlIn.value = url;
    if (url === looked) return;
    looked = url;
    prev.hidden = false;
    prev.innerHTML = `<div class="spinner small" aria-hidden="true"></div><div><strong>Looking up the item…</strong><small>${esc(hostOf(url))}</small></div>`;
    const p = await fetchPreview(url);
    if (looked !== url || !d.open) return;
    image = p.image || "";
    siteName = p.siteName || siteNameFor(url);
    if (p.title && !titleIn.value.trim()) titleIn.value = p.title;
    showPreview(p.image || p.title ? "" : "Couldn’t get a picture for this link. That’s okay, just type the name below.");
    if (!titleIn.value.trim()) titleIn.focus();
  }

  let typingTimer;
  urlIn.addEventListener("input", () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { if (normalizeUrl(urlIn.value)) lookup(); }, 700);
  });
  urlIn.addEventListener("change", lookup);
  d.querySelector("[data-paste]").addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) throw new Error("empty");
      urlIn.value = text.trim();
      lookup();
    } catch {
      urlIn.focus();
      toast("Press and hold in the link box, then choose Paste.");
    }
  });
  prev.addEventListener("click", (e) => {
    if (e.target.closest("[data-noimg]")) { image = ""; showPreview(); }
  });
  d.querySelector("[data-cancel]").addEventListener("click", () => d.close());
  if (image || it.url) showPreview();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const url = normalizeUrl(urlIn.value);
    let title = titleIn.value.trim();
    if (!title && url) title = siteName ? `Item from ${siteName}` : "";
    if (!title) {
      err.hidden = false;
      err.textContent = "Please type what the item is.";
      titleIn.focus();
      return;
    }
    if (!url) { image = ""; siteName = ""; }
    const data = {
      title,
      url,
      image,
      siteName: url ? siteName || siteNameFor(url) : "",
      price: form.elements.price.value.trim(),
      notes: form.elements.notes.value.trim(),
      priority: Number(form.elements.priority.value) || 2,
    };
    if (isEdit) {
      save(store.updateItem(it.id, data), "Saved ✓");
    } else {
      save(store.addItem({
        ...data, id: uid(), personId, year: year(), isSecret, addedBy: me.id, createdAt: Date.now(),
        purchased: false, purchasedBy: null, purchasedByName: null, purchasedAt: null,
      }), isSecret ? "Idea added 🤫" : "Added to your list ✓");
    }
    d.close();
  });
  if (!isEdit) setTimeout(() => urlIn.focus(), 50);
}

/* =========================================================== actions */

function nameTaken(name, exceptId) {
  const n = name.trim().toLowerCase();
  return activePeople().some((p) => p.id !== exceptId && p.name.trim().toLowerCase() === n);
}

function newPerson(name, families) {
  const order = Math.max(-1, ...S.people.map((p) => p.order ?? 0)) + 1;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "person";
  return { id: `${slug}-${uid().slice(-5)}`, name, families, order, createdAt: Date.now() };
}

const actions = {
  "choose-me"(el) {
    setMeId(el.dataset.id);
    location.hash = el.dataset.go === "list" ? `#/list/${el.dataset.id}` : "#/";
    render();
    toast(`Hi, ${nameOf(el.dataset.id)}!`);
  },
  "add-item"(el) {
    itemDialog({ personId: el.dataset.person, secret: el.dataset.secret === "1" });
  },
  "edit-item"(el) {
    const it = S.items.find((i) => i.id === el.dataset.id);
    if (it) itemDialog({ personId: it.personId, item: it });
  },
  async "delete-item"(el) {
    const it = S.items.find((i) => i.id === el.dataset.id);
    if (!it) return;
    const ok = await confirmBox({ title: it.isSecret ? "Delete this idea?" : "Delete this wish?", text: `<strong>${esc(it.title)}</strong> will be removed from the list.`, ok: "Delete", danger: true });
    if (ok) save(store.deleteItem(it.id), "Deleted");
  },
  async "buy-item"(el) {
    const me = person(getMeId());
    const it = S.items.find((i) => i.id === el.dataset.id);
    if (!it || !me) return;
    const owner = firstOf(it.personId, "them");
    const ok = await confirmBox({
      title: "Did you buy this?",
      text: `<strong>${esc(it.title)}</strong> for ${esc(owner)}.<br><br>Everyone except ${esc(owner)} will see it’s been bought, so nobody buys it twice.`,
      ok: "✓ Yes, I bought it",
    });
    if (!ok) return;
    try {
      await store.markBought(it.id, { purchasedBy: me.id, purchasedByName: me.name, purchasedAt: Date.now() });
      toast("Marked as bought 🎁");
    } catch (e) {
      if (e.code === "already-bought") confirmBox({ title: "Someone beat you to it!", text: "This was just marked as bought by someone else. You may want to pick a different gift.", ok: "OK" });
      else toast(e.code === "unavailable" ? "You seem to be offline. Try again when connected." : "Couldn’t save that. Please try again.");
    }
  },
  async "unbuy-item"(el) {
    const me = person(getMeId());
    const it = S.items.find((i) => i.id === el.dataset.id);
    if (!it) return;
    const other = it.purchasedBy && it.purchasedBy !== me.id;
    const ok = await confirmBox({
      title: "Mark as not bought?",
      text: other
        ? `<strong>${esc(nameOf(it.purchasedBy, it.purchasedByName || "Someone"))}</strong> marked this as bought. Only undo it if you’re sure.`
        : `<strong>${esc(it.title)}</strong> will show as available again.`,
      ok: "Yes, undo",
      danger: other,
    });
    if (ok) save(store.updateItem(it.id, { purchased: false, purchasedBy: null, purchasedByName: null, purchasedAt: null }), "Marked as available");
  },
  async "rename-person"(el) {
    const p = person(el.dataset.id);
    if (!p) return;
    const res = await personDialog({ title: "Edit name", value: p.name, families: personFams(p), ok: "Save" });
    if (!res || !res.name) return;
    if (nameTaken(res.name, p.id)) return toast(`${res.name} is already on the list.`);
    save(store.updatePerson(p.id, { name: res.name, families: res.families }), "Saved ✓");
  },
  async "remove-person"(el) {
    const p = person(el.dataset.id);
    if (!p) return;
    const ok = await approveBox({
      title: `Remove ${esc(p.name)}?`,
      text: `${esc(possessive(p.name))} list will be hidden from everyone. Past years are kept, and you can bring the name back later.`,
      ok: `Remove ${esc(p.name)}`,
    });
    if (!ok) return;
    if (p.id === getMeId()) setMeId("");
    save(store.updatePerson(p.id, { removed: true, removedAt: Date.now() }), `${p.name} removed`);
  },
  "restore-person"(el) {
    const p = person(el.dataset.id);
    if (!p) return;
    if (nameTaken(p.name, p.id)) return toast(`${p.name} is already on the list.`);
    save(store.updatePerson(p.id, { removed: false, removedAt: null }), `${p.name} is back ✓`);
  },
  async "copy-last-year"(el) {
    const pid = el.dataset.person;
    const { year: y, items } = carryOverCandidates(pid);
    if (!items.length) return;
    const ok = await confirmBox({ title: `Bring back ${plural(items.length, "wish", "wishes")} from ${y}?`, text: items.map((i) => `• ${esc(i.title)}`).join("<br>"), ok: "Bring them back" });
    if (!ok) return;
    const now = Date.now();
    for (const [n, i] of items.entries()) {
      const { id, purchased, purchasedBy, purchasedByName, purchasedAt, ...rest } = i;
      save(store.addItem({ ...rest, id: uid(), year: year(), copiedFrom: id, createdAt: now + n, purchased: false, purchasedBy: null, purchasedByName: null, purchasedAt: null }));
    }
    toast("Added back to your list ✓");
  },
  async "start-next-year"() {
    const cur = year();
    const ok = await approveBox({
      title: `Start the ${cur + 1} lists now?`,
      text: `The ${cur} lists will be saved under Past years and everyone gets a fresh list. Purchases marked for ${cur} won’t carry over.`,
      ok: `Start ${cur + 1}`,
    });
    if (ok) {
      save(store.updateSettings({ currentYear: cur + 1, archivedYear: cur, rolledOverAt: Date.now() }), `Welcome to ${cur + 1}!`);
      location.hash = "#/";
    }
  },
  async share() {
    const url = location.href.split("#")[0];
    const data = { title: "Family Wish Lists", text: "Here’s our family wish list site. Tap your name to start!", url };
    try {
      if (navigator.share) return await navigator.share(data);
      await navigator.clipboard.writeText(url);
      toast("Link copied. Paste it in a text or email.");
    } catch (e) {
      if (e && e.name === "AbortError") return;
      prompt("Copy this link and send it to your family:", url);
    }
  },
  "set-family"(el) {
    ls.set(FAM_KEY, el.dataset.fam);
    render();
  },
  "dismiss-banner"() {
    ls.set("wishlist-banner-" + year(), "1");
    render();
  },
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || !actions[el.dataset.action]) return;
  e.preventDefault();
  actions[el.dataset.action](el);
});

document.addEventListener("submit", (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const name = (form.elements.name.value || "").trim().replace(/\s+/g, " ");
  if (!name) return;
  if (nameTaken(name)) return toast(`${name} is already on the list.`);
  const families = [...form.querySelectorAll('input[name="fam"]:checked')].map((i) => i.value);
  if (!families.length) return toast("Tick which family list they belong to.");
  const p = newPerson(name, families);
  form.elements.name.value = "";
  save(store.addPerson(p), `${name} added ✓`);
  if (form.dataset.form === "add-self") {
    setMeId(p.id);
    location.hash = "#/";
    render();
  }
});

// Swap broken pictures for the gift placeholder.
document.addEventListener("error", (e) => {
  const t = e.target;
  if (t && t.tagName === "IMG" && t.hasAttribute("data-thumb")) {
    const ph = document.createElement("span");
    ph.className = "ph";
    ph.textContent = "🎁";
    t.replaceWith(ph);
  }
}, true);

window.addEventListener("hashchange", () => {
  render();
  window.scrollTo(0, 0);
});

/* ================================================== yearly rollover */

// On or after January 1, save last year's lists and start the new year.
function maybeRollover() {
  if (rolloverChecked || !S.ready) return;
  rolloverChecked = true;
  const now = new Date().getFullYear();
  const cur = Number(S.settings.currentYear);
  if (!cur) {
    save(store.updateSettings({ currentYear: now }));
  } else if (now > cur) {
    save(store.updateSettings({ currentYear: now, archivedYear: cur, rolledOverAt: Date.now() }));
  }
}

/* ============================================================== start */

(async function init() {
  try {
    store = await createStore();
  } catch (e) {
    console.error(e);
    S.error = "Please check your internet connection.";
    render();
    return;
  }
  store.subscribe(
    (snap) => {
      S = { ...S, ...snap, ready: true, error: "" };
      maybeRollover();
      render();
    },
    (err) => {
      S.error = err && err.code === "permission-denied"
        ? "The family database isn’t allowing access. (Setup tip: check the Firestore rules in the README.)"
        : "Please check your internet connection.";
      render();
    },
  );
})();
