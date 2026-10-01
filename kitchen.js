// Staff kitchen board. Only accounts listed in the Firestore "staff" collection can load orders;
// the security rules (firestore.rules) enforce this, not just this page.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, setDoc, query, where, onSnapshot, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { money, plural, ms, el, itemsList } from "./menu.js";

const $ = (id) => document.getElementById(id);
let db = null, auth = null;
let shopOpen = false;
let orders = [];
let seen = null;          // order ids already on the board, to chime only for new ones
let soundOn = true;
let unsubs = [];
let rejectMsg = "";   // survives the sign-out that follows a rejected login

function showLogin(msg) {
  $("view-login").hidden = false; $("view-board").hidden = true;
  $("shopstate-text").textContent = "Signed out"; $("shopstate").classList.add("closed");
  $("queue-text").innerHTML = "&nbsp;";
  $("l-msg").hidden = !msg; $("l-msg").textContent = msg || "";
}
function stopListening() { unsubs.forEach((u) => u()); unsubs = []; orders = []; seen = null; }

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

async function setStatus(o, status) {
  try {
    const b = writeBatch(db);
    b.update(doc(db, "orders", o.id), { status });
    b.update(doc(db, "line", o.id), { status });
    await b.commit();
  } catch (e) {
    alertBox("Couldn't update order #" + o.code + ". Check your connection and try again.");
  }
}
function alertBox(text) {
  const m = el("p", { class: "msg err", text });
  $("board").before(m); setTimeout(() => m.remove(), 5000);
}

function renderShop() {
  $("shopstate").classList.toggle("closed", !shopOpen);
  $("shopstate-text").textContent = shopOpen ? "Taking orders" : "Closed to orders";
  $("shop-toggle").textContent = shopOpen ? "Stop taking orders" : "Open the deli for orders";
  $("shop-toggle").className = "btn " + (shopOpen ? "" : "primary");
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
        el("button", { class: "btn primary small", type: "button", text: next[1], onclick: () => setStatus(o, next[0]) }));
      if (st === "new") actions.append(el("button", { class: "btn small", type: "button", text: "Cancel order", onclick: () => setStatus(o, "cancelled") }));
      if (st === "ready") actions.append(el("button", { class: "btn small", type: "button", text: "Back to making", onclick: () => setStatus(o, "making") }));
      const placed = new Date(ms(o)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      col.append(el("article", { class: "kcard " + st },
        el("header", {}, el("span", { text: "#" + o.code + " " + o.name }), el("span", { class: "price", text: money(o.totalCents) })),
        el("div", { class: "meta", text: (o.hall || "") + " · Pickup " + o.pickup + " · Pays " + (o.payment || "?") }),
        el("div", { class: "meta", text: (o.email || "") + " · placed " + placed }),
        itemsList(o),
        o.notes ? el("div", { class: "hint", text: "Note: " + o.notes }) : null,
        actions));
    });
    if (!list.length) col.append(el("p", { class: "hint", text: "Nothing here." }));
    board.append(col);
  });
}

function startBoard(user) {
  $("view-login").hidden = true; $("view-board").hidden = false;
  $("who").textContent = "Signed in as " + (user.email || "staff");
  unsubs.push(onSnapshot(doc(db, "settings", "shop"),
    (s) => { shopOpen = s.exists() && s.data().open === true; renderShop(); }, () => {}));
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

$("shop-toggle").addEventListener("click", async () => {
  try { await setDoc(doc(db, "settings", "shop"), { open: !shopOpen }); }
  catch (e) { alertBox("Couldn't change the deli status. Is this account on the staff list?"); }
});
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
