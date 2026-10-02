// Staff kitchen board. Only accounts listed in the Firestore "staff" collection can load orders;
// the security rules (firestore.rules) enforce this, not just this page.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, setDoc, updateDoc, query, where, onSnapshot, writeBatch, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { emailjsConfig } from "./emailjs-config.js";
import { MENU, ADDONS, money, plural, ms, el, itemsList } from "./menu.js";

const $ = (id) => document.getElementById(id);
const tsMs = (t) => (t && t.toMillis ? t.toMillis() : null);
let db = null, auth = null;
let shop = { open: false, hours: "", openedAt: null };
let soldOut = new Set();
let orders = [];          // open orders on the board
let shiftOrders = [];     // every order since the deli was last opened (summary)
let seen = null;          // order ids already on the board, to chime only for new ones
let soundOn = true;
let unsubs = [];
let summaryUnsub = null, summaryKey = null;
let rejectMsg = "";       // survives the sign-out that follows a rejected login
let view = "orders";

/* ---------- email (EmailJS) ---------- */
const emailReady = () => window.emailjs && emailjsConfig.publicKey !== "PASTE_HERE" && emailjsConfig.serviceId !== "PASTE_HERE" && emailjsConfig.templateId !== "PASTE_HERE";
if (emailReady()) { try { window.emailjs.init({ publicKey: emailjsConfig.publicKey }); } catch (e) {} }
async function emailOrderReady(o) {
  if (!emailReady() || !o.email || o.emailedAt) return;
  const items = o.items.map((i) => i.qty + "x " + i.name + (i.mods && i.mods.length ? " (" + i.mods.join(", ") + ")" : "")).join("\n");
  try {
    await window.emailjs.send(emailjsConfig.serviceId, emailjsConfig.templateId, {
      to_email: o.email,
      to_name: (o.name || "").split(" ")[0] || "there",
      order_code: o.code,
      items,
      total: money(o.totalCents),
      payment: o.payment || "",
      pickup: o.pickup || ""
    });
    await updateDoc(doc(db, "orders", o.id), { emailedAt: serverTimestamp() });
  } catch (e) {
    alertBox("Order #" + o.code + " is marked ready, but the email to " + o.email + " didn't send.");
  }
}

/* ---------- helpers ---------- */
function showLogin(msg) {
  $("view-login").hidden = false; $("view-board").hidden = true;
  $("shopstate-text").textContent = "Signed out"; $("shopstate").classList.add("closed");
  $("queue-text").innerHTML = "&nbsp;";
  $("l-msg").hidden = !msg; $("l-msg").textContent = msg || "";
}
function stopListening() {
  unsubs.forEach((u) => u()); unsubs = [];
  if (summaryUnsub) summaryUnsub(); summaryUnsub = null; summaryKey = null;
  orders = []; shiftOrders = []; seen = null;
}
function alertBox(text) {
  const m = el("p", { class: "msg err", text });
  $("alerts").append(m); setTimeout(() => m.remove(), 7000);
}
function chime() {
  if (!soundOn) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1175].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.start(t); o.stop(t + 0.17);
    });
  } catch (e) {}
}
function prepMinutes(list) {
  // Average minutes from "Start making" to "Mark ready", over the last 10 orders that have both.
  const done = list.filter((o) => tsMs(o.startedAt) && tsMs(o.readyAt))
    .sort((a, b) => tsMs(b.readyAt) - tsMs(a.readyAt)).slice(0, 10)
    .map((o) => (tsMs(o.readyAt) - tsMs(o.startedAt)) / 60000).filter((m) => m > 0 && m < 90);
  return done.length ? done.reduce((s, m) => s + m, 0) / done.length : null;
}

/* ---------- order status ---------- */
async function setStatus(o, status) {
  const patch = { status };
  if (status === "making" && !o.startedAt) patch.startedAt = serverTimestamp();
  if (status === "ready") patch.readyAt = serverTimestamp();
  if (status === "done") patch.doneAt = serverTimestamp();
  if (status === "cancelled") patch.cancelledAt = serverTimestamp();
  try {
    const b = writeBatch(db);
    b.update(doc(db, "orders", o.id), patch);
    b.update(doc(db, "line", o.id), { status });
    await b.commit();
  } catch (e) {
    alertBox("Couldn't update order #" + o.code + ". Check your connection and try again.");
    return;
  }
  if (status === "ready") {
    emailOrderReady(o);
    // Share the average prep time (no personal data) so students see a wait estimate.
    const avg = prepMinutes(shiftOrders.map((x) => x.id === o.id ? { ...x, startedAt: o.startedAt || x.startedAt, readyAt: Timestamp.now() } : x));
    if (avg) setDoc(doc(db, "settings", "stats"), { avgPrepMin: Math.round(avg * 10) / 10, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
  }
}

/* ---------- rendering ---------- */
function renderShop() {
  $("shopstate").classList.toggle("closed", !shop.open);
  $("shopstate-text").textContent = shop.open ? "Taking orders" : "Closed to orders";
  $("shop-toggle").textContent = shop.open ? "Stop taking orders" : "Open the deli for orders";
  $("shop-toggle").className = "btn " + (shop.open ? "" : "primary");
  if (document.activeElement !== $("hours-input")) $("hours-input").value = shop.hours || "";
  $("email-state").textContent = emailReady() ? "Ready emails: on" : "Ready emails: not set up";
}
function renderBoard() {
  const waiting = orders.filter((o) => o.status === "new" || o.status === "making").length;
  $("queue-text").textContent = plural(waiting, "order") + " in line";
  const board = $("board"); board.textContent = "";
  [["new", "New"], ["making", "Making"], ["ready", "Ready for pickup"]].forEach(([st, label]) => {
    const list = orders.filter((o) => o.status === st);
    const col = el("div", { class: "kcol" }, el("h2", { text: label + " (" + list.length + ")" }));
    list.forEach((o) => {
      const next = st === "new" ? ["making", "Start making"] : st === "making" ? ["ready", "Mark ready"] : ["done", "Picked up"];
      const actions = el("div", { class: "actions" },
        el("button", { class: "btn primary small", type: "button", text: next[1], onclick: (e) => { e.target.disabled = true; setStatus(o, next[0]); } }));
      if (st === "new") actions.append(el("button", { class: "btn small", type: "button", text: "Cancel order", onclick: () => setStatus(o, "cancelled") }));
      if (st === "ready") actions.append(el("button", { class: "btn small", type: "button", text: "Back to making", onclick: () => setStatus(o, "making") }));
      const placed = new Date(ms(o)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      col.append(el("article", { class: "kcard " + st },
        el("header", {}, el("span", { text: "#" + o.code + " " + o.name }), el("span", { class: "price", text: money(o.totalCents) })),
        el("div", { class: "meta", text: (o.hall || "") + " · Pickup " + o.pickup + " · Pays " + (o.payment || "?") }),
        el("div", { class: "meta", text: (o.email || "") + " · placed " + placed + (o.emailedAt ? " · emailed" : "") }),
        itemsList(o),
        o.notes ? el("div", { class: "hint", text: "Note: " + o.notes }) : null,
        actions));
    });
    if (!list.length) col.append(el("p", { class: "hint", text: "Nothing here." }));
    board.append(col);
  });
}
function renderMenuAdmin() {
  const root = $("menu-list"); root.textContent = "";
  const toggle = async (key) => {
    const next = new Set(soldOut);
    next.has(key) ? next.delete(key) : next.add(key);
    try { await setDoc(doc(db, "settings", "menu"), { soldOut: [...next] }, { merge: true }); }
    catch (e) { alertBox("Couldn't update the menu. Check your connection."); }
  };
  const row = (key, name, price) => {
    const out = soldOut.has(key);
    return el("div", { class: "srow" + (out ? " out" : "") },
      el("span", { class: "nm", text: name }),
      el("span", { class: "price", text: price }),
      el("button", { class: "btn small " + (out ? "primary" : ""), type: "button", "aria-pressed": String(out), text: out ? "Sold out · tap to restock" : "Available", onclick: () => toggle(key) }));
  };
  MENU.forEach((sec) => {
    root.append(el("h3", { class: "grp-h", text: sec.cat }));
    sec.items.forEach((it) => root.append(row(it.id, it.name, money(it.cents))));
  });
  root.append(el("h3", { class: "grp-h", text: "Sandwich add-ons" }));
  ADDONS.forEach((a) => root.append(row("addon:" + a.id, a.name, "+" + money(a.cents))));
}
function renderSummary() {
  const root = $("summary-body"); root.textContent = "";
  const since = tsMs(shop.openedAt);
  $("summary-since").textContent = since
    ? "Since the deli opened at " + new Date(since).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })
    : "Last 12 hours (open the deli to start a new shift)";
  const live = shiftOrders.filter((o) => o.status !== "cancelled");
  const picked = live.filter((o) => o.status === "done");
  const open = live.filter((o) => o.status !== "done");
  const sum = (l) => l.reduce((s, o) => s + (o.totalCents || 0), 0);
  const cash = picked.filter((o) => o.payment === "Cash"), card = picked.filter((o) => o.payment === "Card");
  const avg = prepMinutes(shiftOrders);
  const stat = (label, value, sub) => el("div", { class: "stat" }, el("div", { class: "stat-l", text: label }), el("div", { class: "stat-v", text: value }), sub ? el("div", { class: "stat-s", text: sub }) : null);
  root.append(el("div", { class: "stats" },
    stat("Collected (picked up)", money(sum(picked)), plural(picked.length, "order")),
    stat("Cash to count", money(sum(cash)), plural(cash.length, "order")),
    stat("Card", money(sum(card)), plural(card.length, "order")),
    stat("Still open", money(sum(open)), plural(open.length, "order")),
    stat("Avg prep time", avg ? Math.max(1, Math.round(avg)) + " min" : "–", "Start making → Mark ready"),
    stat("Cancelled", String(shiftOrders.length - live.length), "not counted above")));
  const counts = {};
  live.forEach((o) => o.items.forEach((i) => { counts[i.name] = (counts[i.name] || 0) + i.qty; }));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  root.append(el("h3", { class: "grp-h", text: "Top items" }));
  if (!top.length) root.append(el("p", { class: "hint", text: "No orders yet this shift." }));
  else root.append(el("ol", { class: "top" }, top.map(([n, q]) => el("li", {}, el("span", { text: n }), el("span", { class: "price", text: q + " sold" })))));
}
function setView(v) {
  view = v;
  [["orders", "board-wrap"], ["menu", "menu-admin"], ["summary", "summary"]].forEach(([k, id]) => {
    $(id).hidden = k !== v;
    $("v-" + k).setAttribute("aria-pressed", String(k === v));
  });
}

/* ---------- live data ---------- */
function subscribeSummary() {
  const since = tsMs(shop.openedAt) || (Date.now() - 12 * 3600 * 1000);
  const key = String(tsMs(shop.openedAt) || "12h");
  if (key === summaryKey) return;
  if (summaryUnsub) summaryUnsub();
  summaryKey = key;
  summaryUnsub = onSnapshot(query(collection(db, "orders"), where("createdAt", ">=", Timestamp.fromMillis(since))),
    (snap) => { shiftOrders = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })); renderSummary(); },
    () => {});
}
function startBoard(user) {
  $("view-login").hidden = true; $("view-board").hidden = false;
  $("who").textContent = "Signed in as " + (user.email || "staff");
  setView(view);
  unsubs.push(onSnapshot(doc(db, "settings", "shop"),
    (s) => {
      const d = s.exists() ? s.data({ serverTimestamps: "estimate" }) : {};
      shop = { open: d.open === true, hours: d.hours || "", openedAt: d.openedAt || null };
      renderShop(); subscribeSummary(); renderSummary();
    }, () => {}));
  unsubs.push(onSnapshot(doc(db, "settings", "menu"),
    (s) => { soldOut = new Set(s.exists() && Array.isArray(s.data().soldOut) ? s.data().soldOut : []); renderMenuAdmin(); }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "orders"), where("status", "in", ["new", "making", "ready"])),
    (snap) => {
      orders = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })).sort((a, b) => ms(a) - ms(b));
      const ids = new Set(orders.map((o) => o.id));
      if (seen && orders.some((o) => o.status === "new" && !seen.has(o.id))) chime();
      seen = ids;
      renderBoard();
    },
    () => alertBox("Lost access to orders. Sign out and back in.")));
}

/* ---------- controls ---------- */
$("shop-toggle").addEventListener("click", async () => {
  const opening = !shop.open;
  const patch = opening ? { open: true, openedAt: serverTimestamp() } : { open: false, closedAt: serverTimestamp() };
  try { await setDoc(doc(db, "settings", "shop"), patch, { merge: true }); }
  catch (e) { alertBox("Couldn't change the deli status. Is this account on the staff list?"); }
});
$("hours-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const hours = $("hours-input").value.trim().slice(0, 80);
  try { await setDoc(doc(db, "settings", "shop"), { hours }, { merge: true }); $("hours-msg").textContent = "Saved. Students see this when the deli is closed."; }
  catch (err) { $("hours-msg").textContent = "Couldn't save. Check your connection."; }
  setTimeout(() => { $("hours-msg").textContent = ""; }, 4000);
});
["orders", "menu", "summary"].forEach((v) => $("v-" + v).addEventListener("click", () => setView(v)));
$("sound-toggle").addEventListener("click", (e) => {
  soundOn = !soundOn; e.target.textContent = soundOn ? "Sound on" : "Sound off"; e.target.setAttribute("aria-pressed", String(soundOn));
  if (soundOn) chime();
});
$("logout").addEventListener("click", () => signOut(auth));
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("l-btn").disabled = true; $("l-msg").hidden = true;
  try { await signInWithEmailAndPassword(auth, $("l-email").value.trim(), $("l-pass").value); }
  catch (err) { showLogin("Wrong email or password."); }
  $("l-btn").disabled = false;
});

if (firebaseConfig.apiKey === "PASTE_HERE") {
  showLogin("This site isn't connected to its database yet. Paste the Firebase config into firebase-config.js.");
  $("l-btn").disabled = true;
} else {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app); db = getFirestore(app);
  onAuthStateChanged(auth, async (user) => {
    stopListening();
    if (!user || user.isAnonymous) { showLogin(rejectMsg); rejectMsg = ""; return; }
    try {
      const s = await getDoc(doc(db, "staff", user.uid));
      if (!s.exists()) { rejectMsg = "This account isn't on the Ellie's staff list. Ask the manager to add it."; await signOut(auth); return; }
      startBoard(user);
    } catch (e) { showLogin("Couldn't check staff access. Try again."); }
  });
}
