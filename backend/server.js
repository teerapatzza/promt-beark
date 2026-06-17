const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'prompt-berk.db');
const PORT = process.env.PORT || 3000;
const SESSION_TTL_HOURS = 8;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    UNIQUE NOT NULL,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'user',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS budget_categories (
    id   TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    data       TEXT NOT NULL,
    user_id    INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS profiles (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    data          TEXT NOT NULL,
    owner_user_id INTEGER REFERENCES users(id),
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
  );
`);

// Add columns to existing tables if they don't exist yet (idempotent)
try { db.exec(`ALTER TABLE expenses ADD COLUMN user_id INTEGER REFERENCES users(id)`); } catch (_) {}
try { db.exec(`ALTER TABLE profiles ADD COLUMN owner_user_id INTEGER REFERENCES users(id)`); } catch (_) {}

// Delete old expenses with no user_id (orphan records from pre-auth era)
db.prepare(`DELETE FROM expenses WHERE user_id IS NULL`).run();

// ── Settings helpers ──────────────────────────────────────

const DEFAULT_SETTINGS = { taxiMaxPerTrip: 600 };

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row) return JSON.parse(row.value);
  return DEFAULT_SETTINGS[key] ?? null;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

// ── Auth helpers ──────────────────────────────────────────

function createSession(userId) {
  const token = uuidv4();
  const expires = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`).run(token, userId, expires);
  return token;
}

function getSessionUser(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.email, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token);
  return row || null;
}

function requireAuth(req, res, next) {
  const user = getSessionUser(req.cookies?.session);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    next();
  });
}

// ── App setup ─────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

// ── Auth endpoints (public) ───────────────────────────────

app.post('/auth/register', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  // First user becomes admin
  const count = db.prepare('SELECT COUNT(*) as n FROM users').get();
  const role = count.n === 0 ? 'admin' : 'user';

  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)').run(email.toLowerCase(), hash, role);

  const token = createSession(result.lastInsertRowid);
  res.cookie('session', token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_HOURS * 3600 * 1000 });
  res.status(201).json({ id: result.lastInsertRowid, email: email.toLowerCase(), role });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const user = db.prepare('SELECT id, email, password_hash, role FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });

  const token = createSession(user.id);
  res.cookie('session', token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_HOURS * 3600 * 1000 });
  res.json({ id: user.id, email: user.email, role: user.role });
});

app.post('/auth/logout', (req, res) => {
  const token = req.cookies?.session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie('session');
  res.json({ ok: true });
});

app.get('/auth/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, role: req.user.role });
});

app.put('/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'newPassword must be at least 6 characters' });

  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash))
    return res.status(401).json({ error: 'Current password is incorrect' });

  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);

  // Invalidate all other sessions
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, req.cookies.session);
  res.json({ ok: true });
});

// ── User management (admin only) ──────────────────────────

app.get('/users', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT id, email, role, created_at FROM users ORDER BY id').all();
  res.json(rows);
});

app.put('/users/:id/role', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const { role } = req.body || {};
  if (!['user', 'approver', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  res.json({ ok: true });
});

app.post('/users/:id/reset-password', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'newPassword must be at least 6 characters' });

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  res.json({ ok: true });
});

app.delete('/users/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });

  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

// ── Budget Categories (admin only) ────────────────────────

app.get('/budget-categories', requireAuth, (_req, res) => {
  const rows = db.prepare('SELECT data FROM budget_categories ORDER BY rowid').all();
  res.json(rows.map(r => JSON.parse(r.data)));
});

app.post('/budget-categories', requireAdmin, (req, res) => {
  const cat = req.body;
  if (!cat.id || !cat.name) return res.status(400).json({ error: 'id and name are required' });
  cat.id = cat.id.toUpperCase();

  const exists = db.prepare('SELECT id FROM budget_categories WHERE id = ?').get(cat.id);
  if (exists) return res.status(409).json({ error: 'Category ID already exists' });

  db.prepare('INSERT INTO budget_categories (id, data) VALUES (?, ?)').run(cat.id, JSON.stringify(cat));
  res.status(201).json(cat);
});

app.put('/budget-categories/:id', requireAdmin, (req, res) => {
  const id = req.params.id.toUpperCase();
  const cat = req.body;
  cat.id = id;

  const exists = db.prepare('SELECT id FROM budget_categories WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'Category not found' });

  db.prepare("UPDATE budget_categories SET data = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(cat), id);
  res.json(cat);
});

app.delete('/budget-categories/:id', requireAdmin, (req, res) => {
  const id = req.params.id.toUpperCase();
  const result = db.prepare('DELETE FROM budget_categories WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Category not found' });
  res.json({ ok: true });
});

// ── Expenses ──────────────────────────────────────────────

app.get('/expenses', requireAuth, (req, res) => {
  let rows;
  if (req.user.role === 'user') {
    rows = db.prepare('SELECT id, data, user_id, created_at FROM expenses WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  } else {
    rows = db.prepare('SELECT e.id, e.data, e.user_id, e.created_at, u.email as owner_email FROM expenses e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.id DESC').all();
  }
  res.json(rows.map(r => {
    const obj = JSON.parse(r.data);
    obj.id = r.id;
    obj.userId = r.user_id;
    if (r.owner_email) obj.ownerEmail = r.owner_email;
    if (!obj.createdAt) obj.createdAt = r.created_at;
    return obj;
  }));
});

app.post('/expenses', requireAuth, (req, res) => {
  if (req.user.role === 'approver') return res.status(403).json({ error: 'Approvers cannot create expenses' });
  const expense = req.body;
  expense.createdAt = new Date().toISOString();
  const result = db.prepare('INSERT INTO expenses (data, user_id) VALUES (?, ?)').run(JSON.stringify(expense), req.user.id);
  expense.id = result.lastInsertRowid;
  expense.userId = req.user.id;
  res.status(201).json(expense);
});

app.put('/expenses/:id', requireAuth, (req, res) => {
  if (req.user.role === 'approver') return res.status(403).json({ error: 'Approvers cannot edit expenses' });
  const id = parseInt(req.params.id);
  const exists = db.prepare('SELECT id, data, user_id FROM expenses WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'Expense not found' });
  if (req.user.role !== 'admin' && exists.user_id !== req.user.id)
    return res.status(403).json({ error: 'Forbidden' });

  const expense = req.body;
  const original = JSON.parse(exists.data);
  if (original.createdAt) expense.createdAt = original.createdAt;
  db.prepare('UPDATE expenses SET data = ? WHERE id = ?').run(JSON.stringify(expense), id);
  expense.id = id;
  expense.userId = exists.user_id;
  res.json(expense);
});

app.delete('/expenses/:id', requireAuth, (req, res) => {
  if (req.user.role === 'approver') return res.status(403).json({ error: 'Approvers cannot delete expenses' });
  const id = parseInt(req.params.id);
  const exists = db.prepare('SELECT id, user_id FROM expenses WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'Expense not found' });
  if (req.user.role !== 'admin' && exists.user_id !== req.user.id)
    return res.status(403).json({ error: 'Forbidden' });

  db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ── Settings (admin only write, all read) ─────────────────

app.get('/settings', requireAuth, (_req, res) => {
  const keys = Object.keys(DEFAULT_SETTINGS);
  const result = {};
  keys.forEach(k => { result[k] = getSetting(k); });
  res.json(result);
});

app.put('/settings', requireAdmin, (req, res) => {
  const updates = req.body;
  if (typeof updates !== 'object' || Array.isArray(updates))
    return res.status(400).json({ error: 'body must be an object' });
  Object.entries(updates).forEach(([k, v]) => setSetting(k, v));
  res.json({ ok: true });
});

// ── Profiles ──────────────────────────────────────────────

app.get('/profiles', requireAuth, (req, res) => {
  let rows;
  if (req.user.role === 'user') {
    // own profiles + global profiles (owner_user_id IS NULL)
    rows = db.prepare('SELECT id, data, owner_user_id FROM profiles WHERE owner_user_id = ? OR owner_user_id IS NULL ORDER BY id ASC').all(req.user.id);
  } else {
    rows = db.prepare('SELECT p.id, p.data, p.owner_user_id, u.email as owner_email FROM profiles p LEFT JOIN users u ON u.id = p.owner_user_id ORDER BY p.id ASC').all();
  }
  res.json(rows.map(r => {
    const o = JSON.parse(r.data);
    o.id = r.id;
    o.ownerUserId = r.owner_user_id ?? null;
    if (r.owner_email) o.ownerEmail = r.owner_email;
    return o;
  }));
});

app.post('/profiles', requireAuth, (req, res) => {
  if (req.user.role === 'approver') return res.status(403).json({ error: 'Approvers cannot create profiles' });
  const p = req.body;
  if (!p.profileName || !p.fullName) return res.status(400).json({ error: 'profileName and fullName are required' });

  // admin can create global profiles (ownerUserId: null), others own only
  const ownerUserId = req.user.role === 'admin' && p.ownerUserId === null ? null : req.user.id;
  const result = db.prepare('INSERT INTO profiles (data, owner_user_id) VALUES (?, ?)').run(JSON.stringify(p), ownerUserId);
  p.id = result.lastInsertRowid;
  p.ownerUserId = ownerUserId;
  res.status(201).json(p);
});

app.put('/profiles/:id', requireAuth, (req, res) => {
  if (req.user.role === 'approver') return res.status(403).json({ error: 'Approvers cannot edit profiles' });
  const id = parseInt(req.params.id);
  const exists = db.prepare('SELECT id, owner_user_id FROM profiles WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'Profile not found' });

  // Global profiles (owner_user_id NULL) can only be edited by admin
  if (exists.owner_user_id === null && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Only admin can edit global profiles' });
  if (exists.owner_user_id !== null && req.user.role !== 'admin' && exists.owner_user_id !== req.user.id)
    return res.status(403).json({ error: 'Forbidden' });

  const p = req.body;
  db.prepare("UPDATE profiles SET data = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(p), id);
  p.id = id;
  p.ownerUserId = exists.owner_user_id;
  res.json(p);
});

app.delete('/profiles/:id', requireAuth, (req, res) => {
  if (req.user.role === 'approver') return res.status(403).json({ error: 'Approvers cannot delete profiles' });
  const id = parseInt(req.params.id);
  const exists = db.prepare('SELECT id, owner_user_id FROM profiles WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'Profile not found' });

  if (exists.owner_user_id === null && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Only admin can delete global profiles' });
  if (exists.owner_user_id !== null && req.user.role !== 'admin' && exists.owner_user_id !== req.user.id)
    return res.status(403).json({ error: 'Forbidden' });

  db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ── Longdo Proxy ──────────────────────────────────────────

const LONGDO_API_KEY = '5528d1b402a5fd11be6eec82fd167c4b';

app.get('/map-search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });
  try {
    const longdoUrl = `https://search.longdo.com/mapsearch/json/search?keyword=${encodeURIComponent(q)}&limit=6&key=${LONGDO_API_KEY}`;
    const r = await fetch(longdoUrl);
    const data = await r.json();
    if (data.data && data.data.length > 0) return res.json(data);

    const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&countrycodes=th&accept-language=th`;
    const nr = await fetch(nomUrl, { headers: { 'User-Agent': 'promt-beark-app/1.0' } });
    const ndata = await nr.json();
    if (ndata && ndata.length > 0) {
      return res.json({
        data: ndata.map(item => ({
          name: item.display_name.split(',')[0].trim(),
          address: item.display_name,
          lat: item.lat,
          lon: item.lon
        }))
      });
    }
    return res.json({ data: [] });
  } catch (e) {
    res.status(502).json({ error: 'upstream error' });
  }
});

app.get('/map-route', requireAuth, async (req, res) => {
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
