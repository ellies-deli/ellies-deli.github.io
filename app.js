// Student ordering page. Menu lives in menu.js; nothing here needs editing.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, query, where, onSnapshot, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { MENU, BREADS, ADDONS, HALLS, STATUS_LABEL, money, plural, ms, el, itemsList } from "./menu.js";

const $ = (id) => document.getElementById(id);
const EMAIL_OK = /^[^\s@]+@nd\.edu$/i;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};

/* ---- state ---- */
let cart = [];              // {key, name, mods, cents, qty}
let uid = null;
let connected = false;
let connError = "";
let shopOpen = false;
let myOrders = [];          // this browser's orders, newest first
let line = null;            // anonymous queue: [{id, createdAt, status}]
let payment = "";
let currentTab = "order";
let lastStatus = null;

const activeOrder = () => myOrders.find((o) => o.status !== "done" && o.status !== "cancelled") || null;
const aheadOf = (o) => (line || []).filter((x) => x.id !== o.id && ms(x) < ms(o)).length;

/* ---- menu ---- */
function renderMenu() {
  const root = $("menu");
  root.textContent = "";
  MENU.forEach((sec) => {
    const list = el("div", { class: "items" });
    sec.items.forEach((it) => list.append(itemCard(it)));
    root.append(el("section", { class: "cat" }, el("h2", { text: sec.cat }), list));
  });
}
function itemCard(it) {
  let bread = BREADS[0], choice = it.choices ? it.choices[0] : null;
  const addons = new Set();
  const opts = el("div", { class: "opts", hidden: "" });
  const priceEl = el("span", { class: "price", text: money(it.cents) });
  const cardPrice = () => it.cents + [...addons].reduce((s, id) => s + ADDONS.find((a) => a.id === id).cents, 0);
  const groups = [];
  const chipGroup = (label, values, isActive, onPick) => {
    const box = el("div", { class: "chips" });
    const sync = () => box.querySelectorAll(".chip").forEach((c, i) => c.setAttribute("aria-pressed", String(isActive(values[i]))));
    values.forEach((v) => {
      const b = el("button", { class: "chip", type: "button", "aria-pressed": "false", text: v.name || v });
      b.addEventListener("click", () => { onPick(v); sync(); priceEl.textContent = money(cardPrice()); });
      box.append(b);
    });
    sync(); groups.push(sync);
    return el("div", {}, el("span", { class: "grp", text: label }), box);
  };
  if (it.sandwich) {
    opts.append(chipGroup("Bread", BREADS, (v) => v === bread, (v) => { bread = v; }));
    opts.append(chipGroup("Add-ons", ADDONS, (v) => addons.has(v.id), (v) => { addons.has(v.id) ? addons.delete(v.id) : addons.add(v.id); }));
  }
  if (it.choices) opts.append(chipGroup("Choose one", it.choices, (v) => v === choice, (v) => { choice = v; }));

  const needsOpts = it.sandwich || it.choices;
  const addBtn = el("button", { class: "btn small", type: "button", text: needsOpts ? "Customize" : "Add" });
  const confirm = el("button", { class: "btn primary small", type: "button", text: "Add to order" });
  confirm.addEventListener("click", () => {
    const mods = [];
    if (it.sandwich) mods.push(bread);
    if (choice) mods.push(choice);
    addons.forEach((id) => mods.push("+ " + ADDONS.find((a) => a.id === id).name));
    addToCart({ name: it.name, mods, cents: cardPrice() });
    addons.clear(); groups.forEach((g) => g()); priceEl.textContent = money(cardPrice());
    opts.hidden = true; addBtn.textContent = "Customize";
  });
  opts.append(confirm);
  addBtn.addEventListener("click", () => {
    if (!needsOpts) { addToCart({ name: it.name, mods: [], cents: it.cents }); return; }
    opts.hidden = !opts.hidden; addBtn.textContent = opts.hidden ? "Customize" : "Close";
  });
  return el("article", { class: "item" },
    el("div", { class: "item-top" },
      el("div", { style: "min-width:0" }, el("h3", { text: it.name }), it.desc ? el("p", { text: it.desc }) : null),
      el("div", { style: "text-align:right; display:grid; gap:8px; justify-items:end" }, priceEl, addBtn)),
    opts);
}

/* ---- cart ---- */
function addToCart(lineItem) {
  const key = lineItem.name + "|" + lineItem.mods.join(",");
  const found = cart.find((l) => l.key === key);
  if (found) found.qty += 1; else cart.push({ key, ...lineItem, qty: 1 });
  renderCart();
}
const cartTotal = () => cart.reduce((s, l) => s + l.cents * l.qty, 0);
function renderCart() {
  const ul = $("lines"); ul.textContent = "";
  cart.forEach((l) => {
    const minus = el("button", { type: "button", "aria-label": "Remove one " + l.name, text: "−" });
    const plus = el("button", { type: "button", "aria-label": "Add one " + l.name, text: "+" });
    minus.addEventListener("click", () => { l.qty -= 1; if (l.qty <= 0) cart = cart.filter((x) => x !== l); renderCart(); });
    plus.addEventListener("click", () => { l.qty += 1; renderCart(); });
    ul.append(el("li", { class: "line" },
      el("span", { class: "nm", text: l.name }),
      el("span", { class: "price", text: money(l.cents * l.qty) }),
      l.mods.length ? el("span", { class: "mods", text: l.mods.join(" · ") }) : null,
      el("span", { class: "qty" }, minus, el("span", { class: "price", text: String(l.qty) }), plus)));
  });
  const n = cart.reduce((s, l) => s + l.qty, 0);
  $("empty").hidden = n > 0;
  $("total").textContent = money(cartTotal());
  $("ticket-sub").textContent = n ? plural(n, "item") : "Nothing added yet";
  $("cartbar").classList.toggle("show", n > 0 && currentTab === "order");
  $("cartbar-n").textContent = plural(n, "item") + " · View order";
  $("cartbar-total").textContent = money(cartTotal());
  updatePlace();
}

/* ---- form ---- */
function pickupSlots() {
  const sel = $("f-time"); sel.textContent = "";
  sel.append(el("option", { value: "ASAP", text: "As soon as possible" }));
  const t = new Date(); t.setSeconds(0, 0);
  t.setMinutes(Math.ceil((t.getMinutes() + 20) / 15) * 15);
  for (let i = 0; i < 8; i++) {
    const label = t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    sel.append(el("option", { value: label, text: label }));
    t.setMinutes(t.getMinutes() + 15);
  }
}
{
  const hall = $("f-hall");
  hall.append(el("option", { value: "", text: "Select your hall" }));
  HALLS.forEach((h) => hall.append(el("option", { value: h, text: h })));
}
["f-email", "f-hall", "f-name"].forEach((id) => {
  $(id).value = store.get("ellies-" + id) || "";
  $(id).addEventListener(id === "f-hall" ? "change" : "input", () => { store.set("ellies-" + id, $(id).value); updatePlace(); });
});
document.querySelectorAll("#f-pay .chip").forEach((b) => b.addEventListener("click", () => {
  payment = b.dataset.pay;
  document.querySelectorAll("#f-pay .chip").forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
  updatePlace();
}));

let placing = false;
function setMsg(text, isErr) {
  const m = $("place-msg");
  m.hidden = !text; m.textContent = text || ""; m.className = "msg" + (isErr ? " err" : "");
}
function updatePlace() {
  const email = $("f-email").value.trim();
  const ready = cart.length > 0 && EMAIL_OK.test(email) && $("f-hall").value && $("f-name").value.trim() && payment;
  let note = "";
  if (connError) note = connError;
  else if (!connected) note = "Connecting to Ellie's...";
  else if (!shopOpen) note = "Ellie's Deli is closed right now. Check back soon.";
  else if (activeOrder()) note = "You already have an order in progress. See the My order tab.";
  else if (email && !EMAIL_OK.test(email)) note = "Use your Notre Dame email (ends in @nd.edu).";
  $("place").disabled = placing || !(ready && connected && shopOpen && !activeOrder());
  if (!placing && !$("place-msg").dataset.sticky) setMsg(note, false);
}

$("place").addEventListener("click", async () => {
  placing = true; $("place").disabled = true; delete $("place-msg").dataset.sticky;
  setMsg("Sending your order...", false);
  const ref = doc(collection(db, "orders"));
  const order = {
    uid,
    name: $("f-name").value.trim().slice(0, 80),
    email: $("f-email").value.trim().toLowerCase(),
    hall: $("f-hall").value,
    payment,
    pickup: $("f-time").value,
    notes: $("f-notes").value.trim().slice(0, 300),
    items: cart.map((l) => ({ name: l.name, mods: l.mods, cents: l.cents, qty: l.qty })),
    totalCents: cartTotal(),
    status: "new",
    code: String(Math.floor(Math.random() * 900) + 100),
    createdAt: serverTimestamp()
  };
  try {
    const batch = writeBatch(db);
    batch.set(ref, order);
    batch.set(doc(db, "line", ref.id), { createdAt: serverTimestamp(), status: "new" });
    await batch.commit();
    cart = []; $("f-notes").value = "";
    placing = false;
    $("place-msg").dataset.sticky = "1";
    setMsg("Order #" + order.code + " sent. Track it in the My order tab.", false);
    renderCart(); setTab("mine");
    setTimeout(() => { delete $("place-msg").dataset.sticky; updatePlace(); }, 8000);
  } catch (e) {
    placing = false;
    $("place-msg").dataset.sticky = "1";
    setMsg(shopOpen ? "Your order didn't go through. Check your connection and try again." : "Ellie's just closed, so the order wasn't sent.", true);
    updatePlace();
    setTimeout(() => { delete $("place-msg").dataset.sticky; updatePlace(); }, 6000);
  }
});

/* ---- tabs ---- */
function setTab(t) {
  currentTab = t;
  ["order", "mine"].forEach((k) => {
    $("view-" + k).hidden = k !== t;
    $("tab-" + k).setAttribute("aria-selected", String(k === t));
  });
  renderCart();
}
document.querySelectorAll("nav.tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
$("cartbar-btn").addEventListener("click", () => $("ticket").scrollIntoView({ behavior: "smooth" }));

/* ---- my order ---- */
function renderMine() {
  const root = $("view-mine"); root.textContent = "";
  const o = activeOrder() || myOrders[0];
  if (!o) { root.append(el("div", { class: "card" }, el("p", { class: "empty", text: "You have no orders yet. Pick something from the Order tab." }))); return; }
  const steps = ["new", "making", "ready", "done"], at = steps.indexOf(o.status);
  const waiting = o.status === "new" || o.status === "making";
  const ahead = waiting && line ? aheadOf(o) : null;
  root.append(el("div", { class: "card" },
    el("div", { class: "hint", text: activeOrder() ? "Your ticket" : "Last order" }),
    el("h3", { text: "#" + o.code + " · " + o.name }),
    el("p", { class: "hint", text: "Pickup: " + o.pickup + " · Paying by " + (o.payment || "").toLowerCase() + " at Ellie's" }),
    el("div", { class: "steps" }, steps.map((s, i) => el("span", { class: i <= at ? "on" : "", text: STATUS_LABEL[s] }))),
    ahead !== null ? el("p", { class: "msg", text: ahead === 0 ? "You're next up." : plural(ahead, "order") + " ahead of you." }) : null,
    o.status === "ready" ? el("p", { class: "status ready", text: "Ready for pickup. Head to Ellie's." }) : null,
    o.status === "cancelled" ? el("p", { class: "msg err", text: "Ellie's cancelled this order. Ask at the counter if you're not sure why." }) : null,
    itemsList(o),
    el("p", { class: "price", text: "Total " + money(o.totalCents) + " · pay at the counter" }),
    o.notes ? el("p", { class: "hint", text: "Notes: " + o.notes }) : null));
  // Flag the browser tab when the order turns ready, so a student on another tab notices.
  document.title = o.status === "ready" ? "READY · Ellie's Deli" : "Ellie's Deli";
  if (o.status === "ready" && lastStatus && lastStatus !== "ready") setTab("mine");
  lastStatus = o.status;
}

/* ---- live line ---- */
function renderQueue() {
  const chip = $("queue-text"), note = $("ticket-queue");
  if (line === null) { chip.textContent = connected ? "Line unavailable" : "Checking the line..."; note.hidden = true; return; }
  const n = line.length;
  chip.textContent = n === 0 ? "No line right now" : plural(n, "order") + " in line";
  note.hidden = !shopOpen || !!activeOrder();
  note.textContent = n === 0 ? "No one is ahead of you. Your order starts right away." : plural(n, "order") + " ahead of you if you order now.";
}
function renderShop() {
  $("shopstate").classList.toggle("closed", !shopOpen);
  $("shopstate-text").textContent = !connected ? (connError ? "Offline" : "Connecting...") : shopOpen ? "Open for orders" : "Closed";
  renderQueue(); updatePlace();
}

/* ---- Firebase ---- */
let db = null;
renderMenu(); pickupSlots(); renderCart(); renderMine(); renderShop();

if (firebaseConfig.apiKey === "PASTE_HERE") {
  connError = "This site isn't connected to its database yet. Paste the Firebase config into firebase-config.js.";
  renderShop();
} else {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  db = getFirestore(app);
  let subscribed = false;
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      signInAnonymously(auth).catch(() => { connError = "Couldn't connect to Ellie's. Refresh the page to try again."; renderShop(); });
      return;
    }
    uid = user.uid; connected = true; renderShop();
    if (subscribed) return;
    subscribed = true;
    onSnapshot(doc(db, "settings", "shop"),
      (s) => { shopOpen = s.exists() && s.data().open === true; renderShop(); },
      () => { shopOpen = false; renderShop(); });
    onSnapshot(query(collection(db, "orders"), where("uid", "==", uid)),
      (snap) => {
        myOrders = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })).sort((a, b) => ms(b) - ms(a));
        renderMine(); renderQueue(); updatePlace();
      }, () => {});
    onSnapshot(query(collection(db, "line"), where("status", "in", ["new", "making"])),
      (snap) => {
        line = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })).sort((a, b) => ms(a) - ms(b));
        renderQueue(); renderMine();
      }, () => { line = null; renderQueue(); });
  });
}
