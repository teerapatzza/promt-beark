const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'prompt-berk.db');
const PORT = process.env.PORT || 3000;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS budget_categories (
    id   TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    data       TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS profiles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    data       TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

const DEFAULT_SETTINGS = {
  taxiMaxPerTrip: 600,
};

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row) return JSON.parse(row.value);
  return DEFAULT_SETTINGS[key] ?? null;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

const app = express();
app.use(express.json({ limit: '50mb' }));

// ── Budget Categories ─────────────────────────────────────

app.get('/budget-categories', (_req, res) => {
  const rows = db.prepare('SELECT data FROM budget_categories ORDER BY rowid').all();
  res.json(rows.map(r => JSON.parse(r.data)));
});

app.post('/budget-categories', (req, res) => {
  const cat = req.body;
  if (!cat.id || !cat.name) return res.status(400).json({ error: 'id and name are required' });
  cat.id = cat.id.toUpperCase();

  const exists = db.prepare('SELECT id FROM budget_categories WHERE id = ?').get(cat.id);
  if (exists) return res.status(409).json({ error: 'Category ID already exists' });

  db.prepare('INSERT INTO budget_categories (id, data) VALUES (?, ?)').run(cat.id, JSON.stringify(cat));
  res.status(201).json(cat);
});

app.put('/budget-categories/:id', (req, res) => {
  const id = req.params.id.toUpperCase();
  const cat = req.body;
  cat.id = id;

  const exists = db.prepare('SELECT id FROM budget_categories WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'Category not found' });

  db.prepare("UPDATE budget_categories SET data = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(cat), id);
  res.json(cat);
});

app.delete('/budget-categories/:id', (req, res) => {
  const id = req.params.id.toUpperCase();
  const result = db.prepare('DELETE FROM budget_categories WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Category not found' });
  res.json({ ok: true });
});

// ── Expenses ──────────────────────────────────────────────

app.get('/expenses', (_req, res) => {
  const rows = db.prepare('SELECT id, data, created_at FROM expenses ORDER BY id DESC').all();
  res.json(rows.map(r => {
    const obj = JSON.parse(r.data);
    obj.id = r.id;
    if (!obj.createdAt) obj.createdAt = r.created_at;
    return obj;
  }));
});

app.post('/expenses', (req, res) => {
  const expense = req.body;
  expense.createdAt = new Date().toISOString();
  const result = db.prepare('INSERT INTO expenses (data) VALUES (?)').run(JSON.stringify(expense));
  expense.id = result.lastInsertRowid;
  res.status(201).json(expense);
});

app.put('/expenses/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const exists = db.prepare('SELECT id, data FROM expenses WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'Expense not found' });
  const expense = req.body;
  const original = JSON.parse(exists.data);
  if (original.createdAt) expense.createdAt = original.createdAt;
  db.prepare('UPDATE expenses SET data = ? WHERE id = ?').run(JSON.stringify(expense), id);
  expense.id = id;
  res.json(expense);
});

app.delete('/expenses/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const result = db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Expense not found' });
  res.json({ ok: true });
});

// ── Settings ──────────────────────────────────────────────

app.get('/settings', (_req, res) => {
  const keys = Object.keys(DEFAULT_SETTINGS);
  const result = {};
  keys.forEach(k => { result[k] = getSetting(k); });
  res.json(result);
});

app.put('/settings', (req, res) => {
  const updates = req.body;
  if (typeof updates !== 'object' || Array.isArray(updates))
    return res.status(400).json({ error: 'body must be an object' });
  Object.entries(updates).forEach(([k, v]) => setSetting(k, v));
  res.json({ ok: true });
});

// ── Profiles ──────────────────────────────────────────────

app.get('/profiles', (_req, res) => {
  const rows = db.prepare('SELECT id, data FROM profiles ORDER BY id ASC').all();
  res.json(rows.map(r => { const o = JSON.parse(r.data); o.id = r.id; return o; }));
});

app.post('/profiles', (req, res) => {
  const p = req.body;
  if (!p.profileName || !p.fullName) return res.status(400).json({ error: 'profileName and fullName are required' });
  const result = db.prepare('INSERT INTO profiles (data) VALUES (?)').run(JSON.stringify(p));
  p.id = result.lastInsertRowid;
  res.status(201).json(p);
});

app.put('/profiles/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const exists = db.prepare('SELECT id FROM profiles WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'Profile not found' });
  const p = req.body;
  db.prepare("UPDATE profiles SET data = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(p), id);
  p.id = id;
  res.json(p);
});

app.delete('/profiles/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const result = db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Profile not found' });
  res.json({ ok: true });
});

// ── Longdo Proxy (หลีกเลี่ยง CORS บน client) ────────────────
const LONGDO_API_KEY = '5528d1b402a5fd11be6eec82fd167c4b';

app.get('/map-search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });
  try {
    const url = `https://search.longdo.com/mapsearch/json/search?keyword=${encodeURIComponent(q)}&limit=6&key=${LONGDO_API_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'upstream error' });
  }
});

app.get('/map-route', async (req, res) => {
  const { flat, flon, tlat, tlon } = req.query;
  if (!flat || !flon || !tlat || !tlon) return res.status(400).json({ error: 'flat, flon, tlat, tlon required' });
  try {
    const url = `https://api.longdo.com/RouteService/geojson/route?flat=${flat}&flon=${flon}&tlat=${tlat}&tlon=${tlon}&mode=t&key=${LONGDO_API_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'upstream error' });
  }
});

// ── Health ────────────────────────────────────────────────

app.get('/health', (_req, res) => res.type('text').send('ok'));

app.listen(PORT, () => console.log(`Prompt-Berk backend :${PORT}  db=${DB_PATH}`));
