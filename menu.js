// EDITA ESTE ARCHIVO para cambiar el menú, los precios (en centavos: 700 = $7.00) y los halls.
// Lo que escribas entre comillas es lo que verán los estudiantes, así que escríbelo en inglés.
export const BREADS = ["Hoagie roll", "Wheat", "White", "Wrap"];
export const ADDONS = [
  { id: "cheese", name: "Extra cheese", cents: 100 },
  { id: "bacon", name: "Bacon", cents: 150 },
  { id: "avocado", name: "Avocado", cents: 150 },
  { id: "meat", name: "Double meat", cents: 250 }
];
export const MENU = [
  { cat: "Sandwiches", items: [
    { id: "turkey", name: "Turkey & Swiss", desc: "Roast turkey, Swiss, lettuce, tomato, mayo", cents: 700, sandwich: true },
    { id: "italian", name: "The Italian", desc: "Ham, salami, pepperoni, provolone, oil & vinegar", cents: 800, sandwich: true },
    { id: "chicken", name: "Chicken Caesar", desc: "Grilled chicken, romaine, parmesan, Caesar dressing", cents: 750, sandwich: true },
    { id: "blt", name: "BLT", desc: "Bacon, lettuce, tomato, mayo", cents: 700, sandwich: true },
    { id: "veggie", name: "Veggie", desc: "Hummus, cucumber, tomato, spinach, provolone", cents: 650, sandwich: true },
    { id: "grilled", name: "Grilled Cheese", desc: "Cheddar and American on buttered bread", cents: 500, sandwich: true }
  ]},
  { cat: "Sides", items: [
    { id: "chips", name: "Chips", desc: "Classic, BBQ, or sour cream & onion", cents: 150, choices: ["Classic", "BBQ", "Sour cream & onion"] },
    { id: "cookie", name: "Cookie", desc: "Chocolate chip", cents: 175 },
    { id: "pickle", name: "Pickle spear", desc: "", cents: 75 }
  ]},
  { cat: "Beverages", items: [
    { id: "soda", name: "Fountain soda", desc: "", cents: 200, choices: ["Coke", "Diet Coke", "Sprite", "Dr Pepper"] },
    { id: "water", name: "Bottled water", desc: "", cents: 150 },
    { id: "tea", name: "Iced tea", desc: "Sweetened or unsweetened", cents: 200, choices: ["Sweetened", "Unsweetened"] },
    { id: "lemonade", name: "Lemonade", desc: "", cents: 225 }
  ]}
];
export const HALLS = ["Coyle", "Alumni", "Badin", "Baumer", "Breen-Phillips", "Carroll", "Cavanaugh", "Dillon", "Duncan", "Dunne", "Farley", "Flaherty", "Graham Family", "Grojean", "Howard", "Johnson Family", "Keenan", "Keough", "Knott", "Lewis", "Lyons", "McGlinn", "Morrissey", "O'Neill Family", "Pasquerilla East", "Pasquerilla West", "Ryan", "Siegfried", "Sorin", "St. Edward's", "Stanford", "Walsh", "Welsh Family", "Fischer (grad/mixed)", "Off campus / other"];

// ---- funciones compartidas (no hace falta editar) ----
export const STATUS_LABEL = { new: "Received", making: "Making it", ready: "Ready", done: "Picked up" };
export const money = (c) => "$" + (c / 100).toFixed(2);
export const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
export const ms = (o) => (o && o.createdAt && o.createdAt.toMillis ? o.createdAt.toMillis() : Date.now());
export function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const k in (attrs || {})) {
    if (k === "class") n.className = attrs[k];
    else if (k === "text") n.textContent = attrs[k];
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), attrs[k]);
    else n.setAttribute(k, attrs[k]);
  }
  kids.flat().forEach((c) => { if (c != null) n.append(c.nodeType ? c : document.createTextNode(c)); });
  return n;
}
export function itemsList(o) {
  return el("ul", {}, o.items.map((i) => el("li", {}, i.qty + "× " + i.name + (i.mods && i.mods.length ? " (" + i.mods.join(", ") + ")" : ""))));
}
