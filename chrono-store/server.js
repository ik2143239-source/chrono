/*
 * CHRONO VAULT — Watch Store
 * ---------------------------------------------------------
 * Public site   :  http://localhost:3000/
 * Admin panel   :  http://localhost:3000/<SECRET ADMIN PATH>
 *
 * The admin path is defined in config.json (adminPath).
 * Default admin password: admin123  (change it from the panel!)
 * All data (watches, orders, customer locations, visitors,
 * site settings) lives in store.db (SQLite) — admin only.
 */

const express = require("express");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

// ---------- Config (secret admin URL) ----------
const CONFIG_FILE = path.join(__dirname, "config.json");
if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify({ adminPath: "/vault-admin-x7k2", port: 3000 }, null, 2)
  );
}
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
const ADMIN_PATH = config.adminPath || "/vault-admin-x7k2";
const PORT = process.env.PORT || config.port || 3000;

// ---------- Database ----------
const db = new Database(path.join(__dirname, "store.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  brand TEXT DEFAULT '',
  price REAL NOT NULL,
  old_price REAL,
  image TEXT DEFAULT '',
  description TEXT DEFAULT '',
  stock INTEGER DEFAULT 10,
  featured INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id INTEGER,
  watch_name TEXT,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  lat REAL, lng REAL, accuracy REAL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS visitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT, user_agent TEXT,
  lat REAL, lng REAL, accuracy REAL,
  page TEXT DEFAULT '/',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS admin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  pass_salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL
);
`);

// ---------- Password helpers ----------
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const test = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(test, "hex"), Buffer.from(hash, "hex"));
}

// Seed default admin password: admin123
if (!db.prepare("SELECT id FROM admin WHERE id = 1").get()) {
  const { salt, hash } = hashPassword("admin123");
  db.prepare("INSERT INTO admin (id, pass_salt, pass_hash) VALUES (1, ?, ?)").run(salt, hash);
  console.log("⚠  Default admin password is admin123 — change it from the admin panel.");
}

// Seed default settings
const defaultSettings = {
  site_name: "CHRONO VAULT",
  tagline: "Time, kept beautifully.",
  hero_title: "Own the hour.",
  hero_subtitle: "Hand-picked timepieces delivered anywhere in Pakistan. Cash on delivery, 7-day returns, genuine warranty.",
  phone: "+92 300 0000000",
  whatsapp: "+92 300 0000000",
  email: "orders@chronovault.pk",
  address: "Main Boulevard, Lahore",
  announcement: "Free delivery on orders above Rs 10,000",
  currency: "Rs"
};
const insSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
for (const [k, v] of Object.entries(defaultSettings)) insSetting.run(k, v);

// Seed sample watches on first run
if (db.prepare("SELECT COUNT(*) AS c FROM watches").get().c === 0) {
  const ins = db.prepare(
    "INSERT INTO watches (name, brand, price, old_price, image, description, stock, featured) VALUES (?,?,?,?,?,?,?,?)"
  );
  ins.run("Heritage Chronograph 42", "Meridian", 24500, 29000,
    "https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=800",
    "Stainless steel chronograph with sapphire glass and genuine leather strap. Water resistant to 50m.", 8, 1);
  ins.run("Midnight Automatic", "Meridian", 38000, null,
    "https://images.unsplash.com/photo-1547996160-81dfa63595aa?w=800",
    "Self-winding automatic movement, exhibition case back, midnight blue dial.", 5, 1);
  ins.run("Field Ranger 38", "Northline", 12800, 15500,
    "https://images.unsplash.com/photo-1524592094714-0f0654e20314?w=800",
    "Rugged field watch with luminous hands and NATO strap. Built for daily wear.", 15, 0);
  ins.run("Rose Classic Petite", "Auria", 16900, null,
    "https://images.unsplash.com/photo-1522312346375-d1a52e2b99b3?w=800",
    "Rose-gold case, mother-of-pearl dial, mesh bracelet. Elegant 32mm profile.", 12, 1);
}

// ---------- Sessions (in-memory tokens) ----------
const sessions = new Map(); // token -> expiry
const SESSION_HOURS = 8;
function newToken() {
  const t = crypto.randomBytes(32).toString("hex");
  sessions.set(t, Date.now() + SESSION_HOURS * 3600 * 1000);
  return t;
}
function checkAuth(req, res, next) {
  const t = req.headers["x-admin-token"];
  const exp = t && sessions.get(t);
  if (!exp || exp < Date.now()) {
    if (t) sessions.delete(t);
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
// simple login rate limit
const loginAttempts = new Map(); // ip -> {count, until}
function loginLimiter(req, res, next) {
  const ip = req.ip;
  const rec = loginAttempts.get(ip) || { count: 0, until: 0 };
  if (rec.until > Date.now())
    return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
  next();
}

// ---------- App ----------
const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));

// Public site
app.use(express.static(path.join(__dirname, "public"), { index: false }));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// Secret admin panel URL (different from the site URL)
app.get(ADMIN_PATH, (req, res) => res.sendFile(path.join(__dirname, "admin.html")));

// ============ PUBLIC API ============
app.get("/api/site", (req, res) => {
  const settings = {};
  for (const row of db.prepare("SELECT key, value FROM settings").all()) settings[row.key] = row.value;
  const watches = db.prepare("SELECT * FROM watches ORDER BY featured DESC, id DESC").all();
  res.json({ settings, watches });
});

// Log visitor location (asked via browser geolocation on the storefront)
app.post("/api/visit", (req, res) => {
  const { lat, lng, accuracy, page } = req.body || {};
  db.prepare("INSERT INTO visitors (ip, user_agent, lat, lng, accuracy, page) VALUES (?,?,?,?,?,?)")
    .run(req.ip, (req.headers["user-agent"] || "").slice(0, 300),
         lat ?? null, lng ?? null, accuracy ?? null, page || "/");
  res.json({ ok: true });
});

// Place order (customer name, phone, address + captured location)
app.post("/api/orders", (req, res) => {
  const { watch_id, customer_name, phone, address, city, lat, lng, accuracy } = req.body || {};
  if (!customer_name || !phone)
    return res.status(400).json({ error: "Name and phone are required." });
  const w = db.prepare("SELECT * FROM watches WHERE id = ?").get(watch_id);
  if (!w) return res.status(404).json({ error: "Watch not found." });
  if (w.stock <= 0) return res.status(400).json({ error: "This watch is out of stock." });

  db.prepare(`INSERT INTO orders
      (watch_id, watch_name, customer_name, phone, address, city, lat, lng, accuracy)
      VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(w.id, `${w.brand} ${w.name}`.trim(), customer_name.slice(0, 100), phone.slice(0, 30),
         (address || "").slice(0, 300), (city || "").slice(0, 80),
         lat ?? null, lng ?? null, accuracy ?? null);
  db.prepare("UPDATE watches SET stock = stock - 1 WHERE id = ?").run(w.id);
  res.json({ ok: true, message: "Order placed! We will call you to confirm." });
});

// ============ ADMIN API ============
app.post("/api/admin/login", loginLimiter, (req, res) => {
  const { password } = req.body || {};
  const admin = db.prepare("SELECT * FROM admin WHERE id = 1").get();
  let ok = false;
  try { ok = password && verifyPassword(password, admin.pass_salt, admin.pass_hash); } catch (e) {}
  const ip = req.ip;
  if (!ok) {
    const rec = loginAttempts.get(ip) || { count: 0, until: 0 };
    rec.count++;
    if (rec.count >= 5) { rec.until = Date.now() + 5 * 60 * 1000; rec.count = 0; }
    loginAttempts.set(ip, rec);
    return res.status(401).json({ error: "Wrong password." });
  }
  loginAttempts.delete(ip);
  res.json({ token: newToken() });
});

app.get("/api/admin/data", checkAuth, (req, res) => {
  const settings = {};
  for (const row of db.prepare("SELECT key, value FROM settings").all()) settings[row.key] = row.value;
  res.json({
    settings,
    watches: db.prepare("SELECT * FROM watches ORDER BY id DESC").all(),
    orders: db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 500").all(),
    visitors: db.prepare("SELECT * FROM visitors ORDER BY id DESC LIMIT 500").all(),
    stats: {
      watches: db.prepare("SELECT COUNT(*) c FROM watches").get().c,
      orders: db.prepare("SELECT COUNT(*) c FROM orders").get().c,
      pending: db.prepare("SELECT COUNT(*) c FROM orders WHERE status='pending'").get().c,
      visitors: db.prepare("SELECT COUNT(*) c FROM visitors").get().c
    }
  });
});

app.post("/api/admin/watches", checkAuth, (req, res) => {
  const { name, brand, price, old_price, image, description, stock, featured } = req.body || {};
  if (!name || !price) return res.status(400).json({ error: "Name and price are required." });
  const r = db.prepare(`INSERT INTO watches (name, brand, price, old_price, image, description, stock, featured)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(name, brand || "", +price, old_price ? +old_price : null, image || "",
         description || "", stock != null ? +stock : 10, featured ? 1 : 0);
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.put("/api/admin/watches/:id", checkAuth, (req, res) => {
  const { name, brand, price, old_price, image, description, stock, featured } = req.body || {};
  db.prepare(`UPDATE watches SET name=?, brand=?, price=?, old_price=?, image=?, description=?, stock=?, featured=?
    WHERE id=?`)
    .run(name, brand || "", +price, old_price ? +old_price : null, image || "",
         description || "", +stock, featured ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.delete("/api/admin/watches/:id", checkAuth, (req, res) => {
  db.prepare("DELETE FROM watches WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.put("/api/admin/orders/:id", checkAuth, (req, res) => {
  const { status } = req.body || {};
  if (!["pending", "confirmed", "shipped", "delivered", "cancelled"].includes(status))
    return res.status(400).json({ error: "Bad status." });
  db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, req.params.id);
  res.json({ ok: true });
});

app.delete("/api/admin/orders/:id", checkAuth, (req, res) => {
  db.prepare("DELETE FROM orders WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.put("/api/admin/settings", checkAuth, (req, res) => {
  const up = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  for (const [k, v] of Object.entries(req.body || {}))
    if (k in defaultSettings) up.run(k, String(v));
  res.json({ ok: true });
});

app.put("/api/admin/password", checkAuth, (req, res) => {
  const { current, next } = req.body || {};
  const admin = db.prepare("SELECT * FROM admin WHERE id = 1").get();
  let ok = false;
  try { ok = current && verifyPassword(current, admin.pass_salt, admin.pass_hash); } catch (e) {}
  if (!ok) return res.status(401).json({ error: "Current password is wrong." });
  if (!next || next.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters." });
  const { salt, hash } = hashPassword(next);
  db.prepare("UPDATE admin SET pass_salt = ?, pass_hash = ? WHERE id = 1").run(salt, hash);
  sessions.clear();
  res.json({ ok: true, message: "Password changed. Please log in again." });
});

app.delete("/api/admin/visitors", checkAuth, (req, res) => {
  db.prepare("DELETE FROM visitors").run();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`\n  CHRONO VAULT running`);
  console.log(`  Store  →  http://localhost:${PORT}/`);
  console.log(`  Admin  →  http://localhost:${PORT}${ADMIN_PATH}\n`);
});
