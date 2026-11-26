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
  3: { label: "Most wanted", color: "bubblegum" },
  2: { label: "Really want", color: "lemon" },
  1: { label: "Nice to have", color: "sky" },
};

const possessive = (n) => (/s$/i.test(n) ? `${n}’` : `${n}’s`);
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

const AVATAR_COLORS = ["var(--lemon)", "var(--mint)", "var(--sky)", "var(--bubblegum)"];
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
const FAM_IDS = FAMILIES.map((f) => f.id);
const ALL = "all";
const famName = (id) => (FAMILIES.find((f) => f.id === id) || { name: id }).name;
function personFams(p) {
  const f = (p && Array.isArray(p.families) ? p.families : []).filter((x) => FAM_IDS.includes(x));
  return f.length ? f : FAM_IDS; // no family set (older data): show everywhere
}
// The family a person's screens open to (Tim and Ellen: Mitchell).
function homeFamily(p) {
  const fams = personFams(p);
  return p && fams.includes(p.homeFamily) ? p.homeFamily : fams[0];
}
// The dropdown choice lasts for this visit only; every visit opens on your family.
let famChoice = null;
function currentFam() {
  if (famChoice === ALL || FAM_IDS.includes(famChoice)) return famChoice;
  const me = person(getMeId());
  return me ? homeFamily(me) : ALL;
}
const inFam = (p, fam = currentFam()) => fam === ALL || personFams(p).includes(fam);
const famHeading = (fam = currentFam()) => (fam === ALL ? "Both families" : `${famName(fam)} family`);

function famPicker() {
  const cur = currentFam();
  const opts = [...FAMILIES.map((f) => [f.id, `${f.name} family`]), [ALL, FAMILIES.length === 2 ? "Both families" : "All families"]];
  return `<label class="fam-picker"><span class="sr-only">Showing lists for</span>
    <select data-change="set-family">${opts.map(([id, label]) =>
      `<option value="${id}" ${cur === id ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>`;
}

function famChecks(selected) {
  return `<fieldset class="checks"><legend>Which family list?</legend>${FAMILIES.map((f) =>
    `<label class="chip"><input type="checkbox" name="fam" value="${f.id}" ${selected.includes(f.id) ? "checked" : ""}><span>${esc(f.name)} family</span></label>`).join("")}</fieldset>`;
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
const famTags = (p) => personFams(p).map((f) => `<span class="pill pill--sky">${esc(famName(f))}</span>`).join("");

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
    app.innerHTML = `<div class="center-msg"><h1>Can’t reach the family list</h1>
      <p>${esc(S.error)}</p><button class="btn btn--primary" onclick="location.reload()">Try again</button></div>`;
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
  if (getMeId() && page !== "who") html += tabbar();
  app.innerHTML = html;
  for (const k of kept) {
    const [form, name] = k.key.split(":");
    const el = app.querySelector(`${form ? `form[data-form="${form}"] ` : ""}input[name="${name}"]:not([type=checkbox]):not([type=radio])`);
    if (!el) continue;
    if (k.value) el.value = k.value;
    if (k.focus) { el.focus(); try { el.setSelectionRange(k.start, k.start); } catch {} }
  }
}

const back = (href = "#/", label = "Back") => `<a class="back" href="${href}">${esc(label)}</a>`;

function pagebar({ href = "#/", label = "Back", picker = false } = {}) {
  return `<div class="pagebar">${back(href, label)}${picker && getMeId() ? famPicker() : ""}</div>`;
}

function tabbar() {
  const [page, a] = route();
  const meId = getMeId();
  const cur = page === "shopping" ? "giving" : page === "list" && a === meId ? "mine" : !page ? "family" : "";
  const tab = (key, href, label) => `<a href="${href}" ${cur === key ? 'aria-current="page"' : ""}>${label}</a>`;
  return `<nav class="tabbar" aria-label="Main">${tab("family", "#/", "Family")}${tab("mine", `#/list/${esc(meId)}`, "My list")}${tab("giving", "#/shopping", "Giving")}</nav>`;
}

function sectionLabel(text, link = "") {
  return `<h2 class="section-label"><span>${text}</span>${link}</h2>`;
}

function modeBanner() {
  if (store.mode !== "local") return "";
  return `<div class="notice notice--lemon"><p><strong>Demo mode.</strong> Lists are saved on this device only. The README explains how to share them with the family.</p></div>`;
}

function rolloverBanner() {
  const s = S.settings;
  if (!s.rolledOverAt || !s.archivedYear) return "";
  if (Date.now() - s.rolledOverAt > 45 * 864e5) return "";
  if (ls.get("wishlist-banner-" + year())) return "";
  return `<div class="notice notice--mint">
    <p><strong>Welcome to the ${year()} lists.</strong> Last year’s lists are saved in <a href="#/past/${s.archivedYear}">Past years</a>.</p>
    <button class="btn btn--ghost btn--small" data-action="dismiss-banner">Got it</button></div>`;
}

/* ---------------------------------------------------------- who are you */

function viewWho(first) {
  const meId = getMeId();
  const people = activePeople().slice().sort((x, y) => x.name.localeCompare(y.name));
  return `<div class="page">
    ${first ? "" : pagebar()}
    <div class="welcome-head"><div><p class="hi">Welcome to the family wish lists</p>
      <h1 class="hello">${first ? "Who are you?" : "Switch person"}</h1></div></div>
    <p class="lede" style="margin:-12px 0 20px">Tap your name. This phone will remember you.</p>
    <ul class="name-list">
      ${people.map((p) => `<li><button class="name-btn" data-action="choose-me" data-id="${esc(p.id)}"><span>${esc(p.name)}</span>${p.id === meId ? `<span class="pill pill--electric">You</span>` : ""}</button></li>`).join("")}
    </ul>
    <details class="add-self removed">
      <summary>Not on the list? Add your name</summary>
      <form data-form="add-self" class="form-card">
        <div class="inline-form">
          <label class="sr-only" for="self-name">Your name</label>
          <input id="self-name" name="name" placeholder="First and last name" maxlength="40" autocomplete="name" required>
          <button class="btn btn--primary">Add me</button>
        </div>
        ${famChecks([])}
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
  const names = activePeople().filter((p) => inFam(p)).length;

  const row = (p) => {
    const list = itemsFor(p.id);
    const bought = list.filter((i) => i.purchased).length;
    const meta = list.length
      ? `<span class="rc-meta">${plural(list.length, "wish", "wishes")}${bought ? ` · ${bought} bought` : ""}</span>`
      : `<span class="rc-meta quiet">No wishes yet</span>`;
    return `<li><a class="row-card person-row" href="#/list/${esc(p.id)}">${avatar(p)}
      <span class="rc-text"><strong class="rc-name">${esc(p.name)}</strong>${meta}</span>
      <span class="corner-action">See list</span></a></li>`;
  };

  return `<div class="page">
    <header class="welcome-head">
      <div><p class="hi">Welcome,</p><h1 class="hello">${esc(me.name)}</h1></div>
      ${famPicker()}
    </header>
    ${rolloverBanner()}${modeBanner()}

    ${sectionLabel(`My ${year()} wish list`)}
    <div class="tile-row">
      <button class="tile tile--electric" data-action="add-item" data-person="${esc(me.id)}">Add a wish</button>
      <a class="tile tile--paper" href="#/list/${esc(me.id)}">My list<span class="num">${mine.length}</span></a>
      <a class="tile tile--lemon" href="#/shopping">I’m giving<span class="num">${giving.length}</span></a>
      <a class="tile tile--mint" href="#/past">Past years<span class="num">${pastYears().length}</span></a>
      <a class="tile tile--bubblegum" href="#/family">Names<span class="num">${names}</span></a>
    </div>

    ${sectionLabel(currentFam() === ALL ? "Everyone" : esc(famHeading()), `<a href="#/family">Edit names</a>`)}
    <ul class="row-list">${others.map(row).join("") || `<li class="empty">No one else yet. <a href="#/family">Add names</a></li>`}</ul>

    <ul class="foot-links">
      <li><a href="#/help">How it works</a></li>
      <li><button type="button" data-action="share">Send this site to family</button></li>
      <li><a href="#/who">Not ${esc(firstName(me))}? Switch person</a></li>
      ${store.mode === "cloud" ? `<li><button type="button" data-action="sign-out">Sign out on this phone</button></li>` : ""}
    </ul>
  </div>`;
}

/* ---------------------------------------------------------- item cards */

function pic(it, pill) {
  const img = safeUrl(it.image);
  const label = it.siteName || "No photo";
  return `<div class="pic">${img
    ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-thumb data-label="${esc(label)}">`
    : `<span class="ph">${esc(label)}</span>`}${pill}</div>`;
}

function itemCard(it, mode) {
  const me = person(getMeId());
  const showBought = mode !== "owner" && it.purchased;
  const url = safeUrl(it.url);
  const pr = PRIORITY[it.priority] || PRIORITY[2];
  const owner = firstOf(it.personId, "them");
  const buyer = nameOf(it.purchasedBy, it.purchasedByName || "someone");
  const id = esc(it.id);
  const view = url ? `<a class="btn btn--secondary btn--small" href="${esc(url)}" target="_blank" rel="noopener noreferrer">View</a>` : "";

  const pill = showBought ? `<span class="pill pill--ink">Purchased</span>`
    : it.isSecret && mode !== "owner" ? `<span class="pill pill--bubblegum">Secret idea</span>`
    : `<span class="pill pill--${pr.color}">${pr.label}</span>`;

  let actions = "";
  let two = false;
  if (mode === "owner") {
    actions = `<button class="btn btn--secondary btn--small" data-action="edit-item" data-id="${id}">Edit</button><button class="btn btn--danger btn--small" data-action="delete-item" data-id="${id}">Delete</button>${view ? `<div style="grid-column:1/-1;display:grid">${view}</div>` : ""}`;
    two = true;
  } else if (mode === "viewer") {
    actions = it.purchased
      ? `${view}<button class="btn btn--ghost btn--small" data-action="unbuy-item" data-id="${id}">Undo purchase</button>`
      : `<button class="btn btn--primary btn--small buy" data-action="buy-item" data-id="${id}">I bought this</button>${view}`;
    if (it.isSecret) actions += `<div class="actions two" style="padding:0"><button class="btn btn--ghost btn--small" data-action="edit-item" data-id="${id}">Edit</button><button class="btn btn--ghost btn--small" data-action="delete-item" data-id="${id}">Delete</button></div>`;
  } else if (mode === "shopping") {
    actions = `${view}<button class="btn btn--ghost btn--small" data-action="unbuy-item" data-id="${id}">Not bought after all</button>`;
  } else {
    actions = view;
  }

  const meta = [it.price ? `<strong>${esc(it.price)}</strong>` : "", url ? esc(it.siteName || siteNameFor(url)) : ""].filter(Boolean).join(" · ");
  return `<article class="item-card ${showBought ? "is-bought" : ""} ${it.isSecret ? "is-secret" : ""}">
    ${pic(it, pill)}
    <div class="body">
      <h3>${esc(it.title)}</h3>
      ${meta ? `<p class="meta">${meta}</p>` : ""}
      ${it.notes ? `<p class="notes">${esc(it.notes)}</p>` : ""}
      ${it.isSecret && mode !== "owner" && !showBought ? `<p class="note-line">From ${esc(firstOf(it.addedBy))}. ${esc(owner)} can’t see this.</p>` : ""}
      ${showBought ? `<p class="bought-by">Bought by ${esc(it.purchasedBy === (me && me.id) ? "you" : buyer)}</p>` : ""}
    </div>
    ${actions ? `<div class="actions ${two ? "two" : ""}">${actions}</div>` : ""}
  </article>`;
}

/* --------------------------------------------------------------- lists */

function viewList(pid) {
  const p = person(pid);
  if (!p || p.removed) return `<div class="page">${pagebar()}<p class="empty">That list isn’t here anymore.</p></div>`;
  return p.id === getMeId() ? viewMyList(p) : viewTheirList(p);
}

function viewMyList(me) {
  const items = sortItems(itemsFor(me.id).filter((i) => !i.isSecret), false);
  const carry = carryOverCandidates(me.id);
  return `<div class="page">
    <div class="welcome-head"><div><p class="hi">My ${year()}</p><h1 class="hello">Wish list</h1></div></div>
    <p class="lede" style="margin:-12px 0 20px">Your family can see this list. <strong>You won’t see what’s been bought</strong>, so it stays a surprise.</p>
    <button class="btn btn--primary btn--block" data-action="add-item" data-person="${esc(me.id)}">Add a wish</button>
    ${carry.items.length ? `<div class="notice notice--lemon" style="margin-top:16px"><p>You had ${plural(carry.items.length, "wish", "wishes")} in ${carry.year} that nobody bought.</p>
      <button class="btn btn--small" data-action="copy-last-year" data-person="${esc(me.id)}">Bring them back</button></div>` : ""}
    ${sectionLabel(items.length ? plural(items.length, "wish", "wishes") : "Nothing here yet")}
    ${items.length ? `<div class="item-grid">${items.map((i) => itemCard(i, "owner")).join("")}</div>`
      : `<div class="empty"><p class="title">Your list is empty</p><p>Tap <strong>Add a wish</strong>. Paste a link from any store, or just type an idea like “warm socks, size M”.</p></div>`}
  </div>`;
}

function viewTheirList(p) {
  const items = sortItems(itemsFor(p.id), true);
  const open = items.filter((i) => !i.purchased).length;
  const name = esc(firstName(p));
  return `<div class="page">
    ${pagebar()}
    <div class="list-head">${avatar(p, "lg")}<div><p class="label">Wish list of</p><h1>${esc(p.name)}</h1></div></div>
    ${items.length ? `<div class="stat-pills"><span class="pill pill--lemon">${plural(items.length, "wish", "wishes")}</span><span class="pill pill--mint">${open} still available</span></div>
      <p class="lede">Bought something? Tap <strong>I bought this</strong> so nobody else buys it. ${name} won’t see it.</p>` : ""}
    ${sectionLabel("Wishes")}
    ${items.length ? `<div class="item-grid">${items.map((i) => itemCard(i, "viewer")).join("")}</div>`
      : `<div class="empty"><p class="title">No wishes yet</p><p>${name} hasn’t added anything. Check back later, or add a gift idea below.</p></div>`}
    <section class="panel">
      <span class="pill pill--bubblegum">Secret idea</span>
      <h2>Have a gift idea for ${name}?</h2>
      <p>Add it here. Everyone can see it except ${name}.</p>
      <button class="btn btn--primary btn--block" data-action="add-item" data-person="${esc(p.id)}" data-secret="1">Add a secret idea</button>
    </section>
    <p class="muted" style="margin-top:24px;font-size:15px">Is this your list, or are you helping ${name} with it?
      <button class="btn btn--ghost btn--small" style="color:var(--on-ink)" data-action="choose-me" data-id="${esc(p.id)}" data-go="list">Switch to ${esc(possessive(firstName(p)))} own view</button></p>
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
  return `<div class="page">
    <div class="welcome-head"><div><p class="hi">Gifts</p><h1 class="hello">I’m giving</h1></div></div>
    <p class="lede" style="margin:-12px 0 8px">Everything you’ve marked as bought in ${year()}.</p>
    ${Object.keys(groups).map((pid) => `${sectionLabel(`For ${esc(nameOf(pid))}`)}
      <div class="item-grid">${groups[pid].map((i) => itemCard(i, "shopping")).join("")}</div>`).join("") ||
      `${sectionLabel("Nothing yet")}<div class="empty"><p>Open someone’s list and tap <strong>I bought this</strong> on a gift you’ve bought.</p></div>`}
  </div>`;
}

/* -------------------------------------------------------------- family */

function viewFamily() {
  const fam = currentFam();
  const people = famSort(activePeople().filter((p) => inFam(p)));
  const removed = S.people.filter((p) => p.removed);
  return `<div class="page">
    ${pagebar({ href: getMeId() ? "#/" : "#/who", picker: true })}
    <h1 class="title">${fam === ALL ? "Family names" : `${esc(famHeading())} names`}</h1>
    <p class="lede">Anyone can add a name, fix a spelling, or change which family list someone is on.</p>
    ${sectionLabel("Add a name")}
    <form data-form="add-person" class="add-person form-card">
      <div class="inline-form">
        <label class="sr-only" for="new-name">New name</label>
        <input id="new-name" name="name" placeholder="First and last name" maxlength="40" required>
        <button class="btn btn--primary">Add</button>
      </div>
      ${famChecks(fam === ALL ? [] : [fam])}
    </form>
    ${sectionLabel(plural(people.length, "person", "people"))}
    <ul class="row-list manage">
      ${people.map((p) => `<li class="row-card">${avatar(p)}
        <span class="rc-text"><span class="rc-name m-name">${esc(p.name)}</span><span class="fam-tags">${famTags(p)}</span></span>
        <span class="rc-actions"><button class="btn btn--secondary btn--small" data-action="rename-person" data-id="${esc(p.id)}">Edit</button>
        <button class="btn btn--danger btn--small" data-action="remove-person" data-id="${esc(p.id)}">Remove</button></span></li>`).join("")}
    </ul>
    ${removed.length ? `<details class="removed"><summary>Removed names (${removed.length})</summary><ul class="row-list manage">
      ${removed.map((p) => `<li class="row-card">${avatar(p)}<span class="rc-text"><span class="rc-name m-name">${esc(p.name)}</span></span>
        <span class="rc-actions"><button class="btn btn--secondary btn--small" data-action="restore-person" data-id="${esc(p.id)}">Bring back</button></span></li>`).join("")}
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
  return `<div class="page">
    ${pagebar()}
    <h1 class="title">Past years</h1>
    <p class="lede">Every January, last year’s lists are saved here and everyone starts a fresh list.</p>
    ${sectionLabel("Saved lists")}
    <ul class="row-list">
      ${years.map((y) => {
        const n = S.items.filter((i) => Number(i.year) === y).length;
        return `<li><a class="row-card person-row" href="#/past/${y}"><span class="year-block">${y}</span>
          <span class="rc-text"><span class="rc-meta">${plural(n, "wish", "wishes")}</span></span><span class="corner-action">Open</span></a></li>`;
      }).join("") || `<li class="empty">Nothing saved yet. The ${year()} lists will be saved here in January ${next}.</li>`}
    </ul>
    <section class="panel">
      <h2>Start ${next} early?</h2>
      <p>This saves the ${year()} lists here and gives everyone a fresh list now. It happens on its own on January 1, so you normally don’t need this.</p>
      <button class="btn btn--on-ink btn--block" data-action="start-next-year">Save ${year()} and start ${next}</button>
    </section>
  </div>`;
}

function viewPastYear(y) {
  const ids = [...new Set(S.items.filter((i) => Number(i.year) === y).map((i) => i.personId))];
  const ppl = ids.map((id) => person(id) || { id, name: "Removed name" }).filter((p) => inFam(p))
    .sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="page">
    ${pagebar({ href: "#/past", label: "Past years", picker: true })}
    <h1 class="title">${y} wish lists</h1>
    <p class="lede">Saved for remembering. These can’t be changed.</p>
    ${sectionLabel(esc(famHeading()))}
    <ul class="row-list">${ppl.map((p) => {
      const list = itemsFor(p.id, y);
      return `<li><a class="row-card person-row" href="#/past/${y}/${esc(p.id)}">${avatar(p)}
        <span class="rc-text"><strong class="rc-name">${esc(p.name)}</strong><span class="rc-meta">${plural(list.length, "wish", "wishes")} · ${list.filter((i) => i.purchased).length} bought</span></span>
        <span class="corner-action">Open</span></a></li>`;
    }).join("") || `<li class="empty">No lists that year.</li>`}</ul>
  </div>`;
}

function viewPastPerson(y, pid) {
  const p = person(pid) || { id: pid, name: "Removed name" };
  const items = sortItems(itemsFor(pid, y), true);
  return `<div class="page">
    ${pagebar({ href: `#/past/${y}`, label: `${y} lists` })}
    <div class="list-head">${avatar(p, "lg")}<div><p class="label">${y} wish list of</p><h1>${esc(p.name)}</h1></div></div>
    ${sectionLabel("Wishes")}
    ${items.length ? `<div class="item-grid">${items.map((i) => itemCard(i, "archive")).join("")}</div>` : `<p class="empty">No wishes.</p>`}
  </div>`;
}

/* ---------------------------------------------------------------- help */

function viewHelp() {
  const qa = [
    ["How do I add something I want?", "Tap <strong>My list</strong> at the bottom, then <strong>Add a wish</strong>. Paste a link from any store (we’ll try to fetch the picture and name), or just type what you’d like."],
    ["How do I copy a link from a store?", "On your phone, open the item in the store’s app or website, tap <strong>Share</strong> and choose <strong>Copy</strong> (or <strong>Copy link</strong>). Then come back here and tap <strong>Paste</strong>."],
    ["How do I mark a gift as bought?", "Open the person’s list and tap <strong>I bought this</strong>. Everyone else sees the item turn green with a <strong>Purchased</strong> label, so they don’t buy it too."],
    ["Can people see what was bought for them?", "No. On your own list, bought items look exactly the same as before. It stays a surprise."],
    ["What’s a secret idea?", "On someone else’s list you can add a gift idea for them. Everyone can see it except that person."],
    ["How do I see the other family’s lists?", "Use the family menu at the top of the home screen. Pick the other family, or <strong>Both families</strong>."],
    ["I marked something by mistake.", "Tap <strong>Undo purchase</strong> on the item, or open <strong>Giving</strong> and tap <strong>Not bought after all</strong>."],
    ["What happens after the holidays?", "On January 1 the lists are saved under <strong>Past years</strong> and everyone starts a fresh list. Anything you didn’t get can be brought back with one tap."],
    ["How do I remove a name?", "Open <strong>Names</strong>, tap <strong>Remove</strong> and type <strong>APPROVE</strong> in capital letters. This keeps names from being removed by accident."],
    ["Can I put this on my home screen?", "Yes. iPhone: tap Share in Safari, then <strong>Add to Home Screen</strong>. Android: open the Chrome menu, then <strong>Add to Home screen</strong>."],
    ["I picked the wrong name.", "At the bottom of the home screen, tap <strong>Switch person</strong>."],
  ];
  return `<div class="page">
    ${pagebar({ href: getMeId() ? "#/" : "#/who" })}
    <h1 class="title">How it works</h1>
    ${sectionLabel("Questions")}
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
      <div class="sheet-actions"><button value="cancel" class="btn btn--ghost">Cancel</button>
      <button value="ok" class="btn ${danger ? "btn--danger-fill" : "btn--primary"}">${ok}</button></div></form>`);
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
      <div class="sheet-actions"><button value="cancel" class="btn btn--ghost">Cancel</button>
      <button value="ok" class="btn btn--danger-fill" disabled>${ok}</button></div></form>`);
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
      <div class="sheet-actions"><button value="cancel" class="btn btn--ghost" formnovalidate>Cancel</button><button value="ok" class="btn btn--primary">${ok}</button></div></form>`);
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
    ${isSecret ? `<p class="help">${esc(owner.name)} won’t see this.</p>` : ""}
    <div class="field">
      <label for="f-url">Link to the item <em>(optional)</em></label>
      <div class="row">
        <input id="f-url" name="url" type="url" inputmode="url" placeholder="Paste a store link" value="${esc(it.url || "")}" autocomplete="off" autocapitalize="off" spellcheck="false">
        <button type="button" class="btn btn--secondary" data-paste>Paste</button>
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
    <fieldset class="checks"><legend>How much ${isSecret ? "would they" : "do you"} want it?</legend>
      ${[1, 2, 3].map((n) => `<label class="chip"><input type="radio" name="priority" value="${n}" ${Number(it.priority || 2) === n ? "checked" : ""}><span>${PRIORITY[n].label}</span></label>`).join("")}
    </fieldset>
    <p class="form-error" role="alert" hidden></p>
    <div class="sheet-actions"><button type="button" class="btn btn--ghost" data-cancel>Cancel</button>
      <button type="submit" class="btn btn--primary">${isEdit ? "Save changes" : isSecret ? "Add idea" : "Add to my list"}</button></div>
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
    prev.innerHTML = `${image ? `<img src="${esc(image)}" alt="" referrerpolicy="no-referrer" data-thumb>` : `<span class="ph">No photo</span>`}
      <div><strong>${esc(siteName || siteNameFor(url) || "Link")}</strong>${msg ? `<small>${esc(msg)}</small>` : ""}
      ${image ? `<button type="button" class="btn btn--ghost" data-noimg>Remove picture</button>` : ""}</div>`;
  }

  async function lookup() {
    const url = normalizeUrl(urlIn.value);
    if (!url) { if (urlIn.value.trim()) { err.hidden = false; err.textContent = "That doesn’t look like a web link. You can leave it empty."; } return; }
    err.hidden = true;
    urlIn.value = url;
    if (url === looked) return;
    looked = url;
    prev.hidden = false;
    prev.innerHTML = `<div class="spinner spinner--small" aria-hidden="true"></div><div><strong>Looking up the item…</strong><small>${esc(hostOf(url))}</small></div>`;
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
      save(store.updateItem(it.id, data), "Saved");
    } else {
      save(store.addItem({
        ...data, id: uid(), personId, year: year(), isSecret, addedBy: me.id, createdAt: Date.now(),
        purchased: false, purchasedBy: null, purchasedByName: null, purchasedAt: null,
      }), isSecret ? "Idea added" : "Added to your list");
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
  return { id: `${slug}-${uid().slice(-5)}`, name, families, homeFamily: families[0], order, createdAt: Date.now() };
}

const actions = {
  "choose-me"(el) {
    setMeId(el.dataset.id);
    famChoice = null;
    location.hash = el.dataset.go === "list" ? `#/list/${el.dataset.id}` : "#/";
    render();
    toast(`Hi, ${firstOf(el.dataset.id)}!`);
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
      ok: "Yes, I bought it",
    });
    if (!ok) return;
    try {
      await store.markBought(it.id, { purchasedBy: me.id, purchasedByName: me.name, purchasedAt: Date.now() });
      toast("Marked as bought");
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
    const home = res.families.includes(p.homeFamily) ? p.homeFamily : res.families[0];
    save(store.updatePerson(p.id, { name: res.name, families: res.families, homeFamily: home }), "Saved");
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
    save(store.updatePerson(p.id, { removed: false, removedAt: null }), `${p.name} is back`);
  },
  async "copy-last-year"(el) {
    const pid = el.dataset.person;
    const { year: y, items } = carryOverCandidates(pid);
    if (!items.length) return;
    const ok = await confirmBox({ title: `Bring back ${plural(items.length, "wish", "wishes")} from ${y}?`, text: items.map((i) => esc(i.title)).join("<br>"), ok: "Bring them back" });
    if (!ok) return;
    const now = Date.now();
    for (const [n, i] of items.entries()) {
      const { id, purchased, purchasedBy, purchasedByName, purchasedAt, ...rest } = i;
      save(store.addItem({ ...rest, id: uid(), year: year(), copiedFrom: id, createdAt: now + n, purchased: false, purchasedBy: null, purchasedByName: null, purchasedAt: null }));
    }
    toast("Added back to your list");
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
    const data = { title: "Family Wish Lists", text: "Here’s our family wish list site. Ask me for the family password, then tap your name to start!", url };
    try {
      if (navigator.share) return await navigator.share(data);
      await navigator.clipboard.writeText(url);
      toast("Link copied. Paste it in a text or email.");
    } catch (e) {
      if (e && e.name === "AbortError") return;
      prompt("Copy this link and send it to your family:", url);
    }
  },
  async "sign-out"() {
    const ok = await confirmBox({ title: "Sign out on this phone?", text: "You’ll need the family password to open the lists again.", ok: "Sign out" });
    if (!ok) return;
    await store.signOut();
    location.hash = "";
    location.reload();
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

document.addEventListener("change", (e) => {
  if (e.target.matches("[data-show-pw]")) {
    const pw = e.target.closest("form").elements.password;
    pw.type = e.target.checked ? "text" : "password";
    return;
  }
  const el = e.target.closest("[data-change=set-family]");
  if (!el) return;
  famChoice = el.value;
  render();
});

document.addEventListener("submit", (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === "password") return unlock(form);
  const name = (form.elements.name.value || "").trim().replace(/\s+/g, " ");
  if (!name) return;
  if (nameTaken(name)) return toast(`${name} is already on the list.`);
  const families = [...form.querySelectorAll('input[name="fam"]:checked')].map((i) => i.value);
  if (!families.length) return toast("Tick which family list they belong to.");
  const p = newPerson(name, families);
  form.elements.name.value = "";
  save(store.addPerson(p), `${name} added`);
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
    ph.textContent = t.dataset.label || "No photo";
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

function viewPassword(msg = "") {
  return `<div class="page page--narrow">
    <div class="welcome-head"><div><p class="hi">Welcome to the</p><h1 class="hello">Family Wish Lists</h1></div></div>
    <form data-form="password" class="password-form form-card">
      <p class="help" style="margin:0">Enter the family password. You only need to do this once on each phone.</p>
      <label class="field"><span>Family password</span>
        <input name="password" type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" required>
      </label>
      <label class="show-pw"><input type="checkbox" data-show-pw> Show password</label>
      <p class="form-error" role="alert" ${msg ? "" : "hidden"}>${esc(msg)}</p>
      <button class="btn btn--primary btn--block">Open the lists</button>
    </form>
    <p class="muted" style="margin-top:16px;font-size:15px">Don’t have it? Ask a family member who’s already using the lists.</p>
  </div>`;
}

function start() {
  store.subscribe(
    (snap) => {
      S = { ...S, ...snap, ready: true, error: "" };
      maybeRollover();
      render();
    },
    (err) => {
      S.error = err && err.code === "permission-denied"
        ? "The family database isn’t allowing access. Try signing in again, or check the setup steps in the README."
        : "Please check your internet connection.";
      render();
    },
  );
}

async function unlock(form) {
  const pw = form.elements.password.value;
  if (!pw) return;
  const btn = form.querySelector("button");
  btn.disabled = true;
  btn.textContent = "Checking…";
  try {
    store = await store.unlock(pw);
    start();
  } catch (e) {
    const code = (e && e.code) || "";
    const msg = code === "auth/too-many-requests" ? "Too many tries. Please wait a few minutes and try again."
      : code === "auth/network-request-failed" ? "You seem to be offline. Check your internet and try again."
      : "That password isn’t right. Check the spelling and try again.";
    app.innerHTML = viewPassword(msg);
    app.querySelector("input[name=password]").focus();
  }
}

(async function init() {
  try {
    store = await createStore();
  } catch (e) {
    console.error(e);
    S.error = "Please check your internet connection.";
    render();
    return;
  }
  if (store.locked) {
    app.innerHTML = viewPassword();
    return;
  }
  start();
})();
