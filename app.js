// Student ordering page. Menu lives in menu.js; nothing here needs editing.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, query, where, onSnapshot, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { emailjsConfig } from "./emailjs-config.js";
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
let soldOut = new Set();    // item ids and "addon:<id>" the staff marked sold out
let hours = "";             // shown when the deli is closed
let avgPrep = 4;            // minutes per order, shared by the kitchen (default until real data)
const emailOn = emailjsConfig.publicKey !== "PASTE_HERE";
const waitMin = (ordersAhead) => Math.max(2, Math.round((ordersAhead + 1) * avgPrep));

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
    // Sold-out add-ons can't be picked.
    opts.querySelectorAll(".chips")[1].querySelectorAll(".chip").forEach((c, i) => { if (soldOut.has("addon:" + ADDONS[i].id)) { c.disabled = true; c.title = "Sold out"; } });
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
    addToCart({ itemId: it.id, addonIds: [...addons], name: it.name, mods, cents: cardPrice() });
    addons.clear(); groups.forEach((g) => g()); priceEl.textContent = money(cardPrice());
    opts.hidden = true; addBtn.textContent = "Customize";
  });
  opts.append(confirm);
  addBtn.addEventListener("click", () => {
    if (!needsOpts) { addToCart({ itemId: it.id, addonIds: [], name: it.name, mods: [], cents: it.cents }); return; }
    opts.hidden = !opts.hidden; addBtn.textContent = opts.hidden ? "Customize" : "Close";
  });
  const out = soldOut.has(it.id);
  if (out) { addBtn.disabled = true; addBtn.textContent = "Sold out"; }
  return el("article", { class: "item" + (out ? " soldout" : "") },
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
const lineSoldOut = (l) => soldOut.has(l.itemId) || (l.addonIds || []).some((a) => soldOut.has("addon:" + a));
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
      lineSoldOut(l) ? el("span", { class: "mods", style: "color:var(--bad)", text: "Sold out. Remove to order." }) : null,
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
  else if (!shopOpen) note = "Ellie's Deli is closed right now." + (hours ? " Hours: " + hours + "." : " Check back soon.");
  else if (cart.some(lineSoldOut)) note = "Something in your order just sold out. Remove it to continue.";
  else if (activeOrder()) note = "You already have an order in progress. See the My order tab.";
  else if (email && !EMAIL_OK.test(email)) note = "Use your Notre Dame email (ends in @nd.edu).";
  $("place").disabled = placing || !(ready && connected && shopOpen && !activeOrder() && !cart.some(lineSoldOut));
  if (!placing && !$("place-msg").dataset.sticky) setMsg(note, false);
}

$("place").addEventListener("click", async () => {
  placing = true; $("place").disabled = true; delete $("place-msg").dataset.sticky;
  unlockAudio(); askNotifications();
  setMsg("Sending your order...", false);
  const ref = doc(collection(db, "orders"));
  const order = {
    uid,
    name: $("f-name").value.trim().slice(0, 80),
    email: $("f-email").value.trim().toLowerCase(),
    hall: $("f-hall").value,
    payment,
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

/* ---- "your order is ready" alert: sound, vibration, notification (while this page is open) ---- */
let audioCtx = null;
function unlockAudio() {
  // Browsers only allow sound after the person has tapped something on the page.
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (e) {}
}
document.addEventListener("pointerdown", unlockAudio);
function askNotifications() {
  try {
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  } catch (e) {}
}
function readyAlert(o) {
  try {
    if (audioCtx) {
      if (audioCtx.state === "suspended") audioCtx.resume();
      [784, 988, 1319].forEach((f, i) => {
        const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
        osc.frequency.value = f; osc.connect(g); g.connect(audioCtx.destination);
        const t = audioCtx.currentTime + i * 0.22;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        osc.start(t); osc.stop(t + 0.21);
      });
    }
  } catch (e) {}
  try { if (navigator.vibrate) navigator.vibrate([250, 120, 250, 120, 400]); } catch (e) {}
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      const title = "Your Ellie's order is ready";
      const opts = { body: "Order #" + o.code + " · Head to Ellie's in Coyle Hall.", icon: "favicon.svg", tag: "ellies-ready" };
      try { new Notification(title, opts); }
      catch (e) { if (navigator.serviceWorker) navigator.serviceWorker.ready.then((r) => r.showNotification(title, opts)).catch(() => {}); }
    }
  } catch (e) {}
}

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
    el("p", { class: "hint", text: "Paying by " + (o.payment || "").toLowerCase() + " at Ellie's" }),
    el("div", { class: "steps" }, steps.map((s, i) => el("span", { class: i <= at ? "on" : "", text: STATUS_LABEL[s] }))),
    ahead !== null ? el("p", { class: "msg", text: (o.status === "making" ? "Being made now." : ahead === 0 ? "You're next up." : plural(ahead, "order") + " ahead of you.")
      + " Ready in about " + (o.status === "making" ? Math.max(1, Math.round(avgPrep)) : waitMin(ahead)) + " min." }) : null,
    waiting ? el("p", { class: "hint", text: "Keep this page open and you'll hear a sound and get a notification when it's ready." + (emailOn ? " We'll also email " + o.email + "." : "") }) : null,
    o.status === "ready" ? el("p", { class: "status ready", text: "Ready for pickup. Head to Ellie's." }) : null,
    o.status === "cancelled" ? el("p", { class: "msg err", text: "Ellie's cancelled this order. Ask at the counter if you're not sure why." }) : null,
    itemsList(o),
    el("p", { class: "price", text: "Total " + money(o.totalCents) + " · pay at the counter" }),
    o.notes ? el("p", { class: "hint", text: "Notes: " + o.notes }) : null));
  // Flag the browser tab when the order turns ready, so a student on another tab notices.
  document.title = o.status === "ready" ? "READY · Ellie's Deli" : "Ellie's Deli";
  if (o.status === "ready" && lastStatus && lastStatus !== "ready") { setTab("mine"); readyAlert(o); }
  lastStatus = o.status;
}

/* ---- live line ---- */
function renderQueue() {
  const chip = $("queue-text"), note = $("ticket-queue");
  if (line === null) { chip.textContent = connected ? "Line unavailable" : "Checking the line..."; note.hidden = true; return; }
  const n = line.length;
  chip.textContent = n === 0 ? "No line right now" : plural(n, "order") + " in line";
  note.hidden = !shopOpen || !!activeOrder();
  note.textContent = (n === 0 ? "No line right now." : plural(n, "order") + " ahead of you if you order now.") + " Ready in about " + waitMin(n) + " min.";
}
function renderShop() {
  $("shopstate").classList.toggle("closed", !shopOpen);
  $("shopstate-text").textContent = !connected ? (connError ? "Offline" : "Connecting...") : shopOpen ? "Open for orders" : (hours ? "Closed · " + hours : "Closed");
  renderQueue(); updatePlace();
}

/* ---- Firebase ---- */
let db = null;
renderMenu(); renderCart(); renderMine(); renderShop();
$("email-note").hidden = !emailOn;

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
      (s) => { const d = s.exists() ? s.data() : {}; shopOpen = d.open === true; hours = d.hours || ""; renderShop(); },
      () => { shopOpen = false; renderShop(); });
    onSnapshot(doc(db, "settings", "menu"),
      (s) => { soldOut = new Set(s.exists() && Array.isArray(s.data().soldOut) ? s.data().soldOut : []); renderMenu(); renderCart(); },
      () => {});
    onSnapshot(doc(db, "settings", "stats"),
      (s) => { const m = s.exists() ? Number(s.data().avgPrepMin) : NaN; if (m > 0 && m < 60) avgPrep = m; renderQueue(); renderMine(); },
      () => {});
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
