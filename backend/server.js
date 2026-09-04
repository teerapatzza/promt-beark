const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const { validateExpense } = require('./validation');
const { mountMicrosoftAuth, MICROSOFT_LOGIN_ENABLED, NO_PASSWORD } = require('./microsoft-auth');

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

  -- แคชผลค้นหาพิกัด: ตำบล/อำเภอ/จังหวัด ไม่ย้ายที่ ถามครั้งเดียวใช้ได้ตลอด
  -- ช่วยไม่ให้ยิงถาม OSM/Longdo ซ้ำ ซึ่งเป็นบริการฟรีที่มีขีดจำกัด
  CREATE TABLE IF NOT EXISTS geocode_cache (
    q          TEXT PRIMARY KEY,
    result     TEXT NOT NULL,
    provider   TEXT,
    hits       INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- สมุดสถานที่ขององค์กร: จำทุกที่ที่มีคนเลือกใช้จริง
  -- ผู้ให้บริการภายนอกจับคู่แบบตรงตัว พิมพ์ผิดนิดเดียวก็ไม่เจอ
  -- ตารางนี้ใช้เทียบความคล้ายในเครื่อง เพื่อเสนอ "คุณหมายถึง...?" ได้แม้พิมพ์ผิด
  -- และยิ่งใช้บ่อยยิ่งแม่น เพราะผู้ประสานงานมักไปที่เดิมซ้ำๆ
  CREATE TABLE IF NOT EXISTS places (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    norm     TEXT NOT NULL,
    address  TEXT,
    lat      REAL NOT NULL,
    lng      REAL NOT NULL,
    source   TEXT,
    uses     INTEGER DEFAULT 1,
    last_at  TEXT DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_places_norm ON places(norm);
`);

// Add columns to existing tables if they don't exist yet (idempotent)
try { db.exec(`ALTER TABLE expenses ADD COLUMN user_id INTEGER REFERENCES users(id)`); } catch (_) {}
try { db.exec(`ALTER TABLE profiles ADD COLUMN owner_user_id INTEGER REFERENCES users(id)`); } catch (_) {}
try { db.exec(`ALTER TABLE profiles ADD COLUMN is_global INTEGER DEFAULT 0`); } catch (_) {}

// Delete old expenses with no user_id (orphan records from pre-auth era)
db.prepare(`DELETE FROM expenses WHERE user_id IS NULL`).run();

// ── Settings helpers ──────────────────────────────────────

const DEFAULT_SETTINGS = {
  taxiMaxPerTrip: 300,  // บาท/เที่ยว
  fuelRate: 4,          // บาท/กม.
  hotelRateSingle: 1500, // บาท/คืน (พักเดี่ยว)
  hotelRateDouble: 1000, // บาท/คืน (พักคู่)
  positionList: [       // รายการตำแหน่งงาน (สำหรับ dropdown)
    'นพ.',
    'พญ.',
    'ทพ.',
    'ทพญ.',
    'ภก.',
    'ภญ.',
    'พยาบาล',
    'นักวิชาการ',
    'เจ้าหน้าที่',
    'ผู้อำนวยการ',
    'รองผู้อำนวยการ'
  ],
  affiliationList: [    // รายการสังกัด/กลุ่มงาน (สำหรับ dropdown)
    'กลุ่มงานบริหารทั่วไป',
    'กลุ่มงานการพยาบาล',
    'กลุ่มงานเภสัชกรรม',
    'กลุ่มงานทันตกรรม',
    'กลุ่มงานเวชกรรม',
    'กลุ่มงานเทคนิคการแพทย์',
    'กลุ่มงานรังสีวิทยา',
    'กลุ่มงานโภชนศาสตร์',
    'กลุ่มงานสาธารณสุข',
    'กลุ่มงานการเงินและบัญชี',
    'กลุ่มงานพัฒนาคุณภาพ',
    'กลุ่มงานทรัพยากรบุคคล',
    'งานอื่นๆ'
  ]
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

/**
 * หลักฐานยืนยันตัวตนที่ผู้ใช้ส่งมา เรียงตามลำดับที่ควรเชื่อ
 *
 * Bearer มาก่อนคุกกี้ — token ใน header คือของที่หน้าเว็บเพิ่งได้จากการล็อกอิน
 * ส่วนคุกกี้เป็นของที่ค้างอยู่ในเบราว์เซอร์เอง อาจเป็นเซสชันเก่าที่ถูกลบไปแล้ว
 *
 * เดิมให้คุกกี้ชนะ ผลคือใครที่มีคุกกี้ค้างจะล็อกอินใหม่ไม่ผ่านเลย
 * เข้า 365 สำเร็จ ได้ token ใหม่มาแล้ว แต่ backend ไปหยิบคุกกี้เก่ามาตรวจ
 * แล้วตอบ 401 หน้าเว็บจึงขึ้น "เซสชันหมดอายุ" แล้วเด้งกลับหน้าล็อกอิน
 * ติดวนอยู่อย่างนั้นจนกว่าผู้ใช้จะล้างคุกกี้เอง ซึ่งไม่มีทางเดาได้
 */
function authCandidates(req) {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  return [bearer ? bearer[1].trim() : null, req.cookies?.session || null].filter(Boolean);
}

function readToken(req) {
  return authCandidates(req)[0] || null;
}

function requireAuth(req, res, next) {
  // ลองทีละใบจนกว่าจะเจอใบที่ใช้ได้จริง ใบที่หมดอายุไม่ควรบังใบที่ยังดี
  let user = null;
  for (const token of authCandidates(req)) {
    user = getSessionUser(token);
    if (user) { req.authToken = token; break; }
  }
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

// เข้าสู่ระบบด้วย Microsoft 365 — เพิ่ม /auth/config, /auth/microsoft, /auth/microsoft/callback
// ถ้ายังไม่ได้ตั้งค่า MS_* จะเพิ่มแค่ /auth/config แล้วทุกอย่างทำงานเหมือนเดิม
mountMicrosoftAuth(app, { db, createSession, sessionTtlHours: SESSION_TTL_HOURS });

app.post('/auth/register', (req, res) => {
  // เปิด M365 เมื่อไหร่ = ปิดการสมัครเอง ผู้ใช้ใหม่เกิดจากการล็อกอินด้วยบัญชีองค์กรเท่านั้น
  if (MICROSOFT_LOGIN_ENABLED)
    return res.status(403).json({ error: 'กรุณาเข้าสู่ระบบด้วยบัญชี Microsoft 365 ขององค์กร' });

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
  res.status(201).json({ id: result.lastInsertRowid, email: email.toLowerCase(), role, token: token });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const user = db.prepare('SELECT id, email, password_hash, role FROM users WHERE email = ?').get(email.toLowerCase());

  // บัญชีที่เกิดจาก M365 ไม่มีรหัสผ่าน — กันไว้ก่อนถึง bcrypt
  if (user && user.password_hash === NO_PASSWORD)
    return res.status(403).json({ error: 'บัญชีนี้ใช้เข้าสู่ระบบด้วย Microsoft 365 เท่านั้น' });

  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });

  // เปิด M365 แล้ว รหัสผ่านเหลือไว้เป็นทางเข้าสำรองของผู้ดูแลระบบเท่านั้น
  // (เผื่อ Entra ล่มหรือตั้งค่าผิด จะได้ไม่ถูกล็อกออกจากระบบตัวเอง)
  if (MICROSOFT_LOGIN_ENABLED && user.role !== 'admin')
    return res.status(403).json({ error: 'กรุณาเข้าสู่ระบบด้วยบัญชี Microsoft 365 ขององค์กร' });

  const token = createSession(user.id);
  res.cookie('session', token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_HOURS * 3600 * 1000 });
  res.json({ id: user.id, email: user.email, role: user.role, token: token });
});

app.post('/auth/logout', (req, res) => {
  // ลบทุกใบที่เบราว์เซอร์ถืออยู่ ทั้งใน header และในคุกกี้
  // ถ้าลบแค่ใบเดียว อีกใบจะค้างในฐานข้อมูลและยังใช้เข้าระบบได้
  const del = db.prepare('DELETE FROM sessions WHERE token = ?');
  for (const token of authCandidates(req)) del.run(token);
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
  // เก็บใบที่ใช้เข้ามาครั้งนี้ไว้ใบเดียว (req.authToken คือใบที่ผ่านการตรวจจริง)
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token IS NOT ?').run(req.user.id, req.authToken);
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

  // Get category for validation
  const categoryId = expense.inputMetadata?._budgetCategoryId;
  let category = null;
  if (categoryId) {
    const catRow = db.prepare('SELECT id, data FROM budget_categories WHERE id = ?').get(categoryId);
    if (catRow) {
      category = JSON.parse(catRow.data);
      category.id = catRow.id;
    }
  }

  // Validate expense
  const errors = validateExpense(expense, category, getSetting('taxiMaxPerTrip'));
  if (errors.length > 0) {
    return res.status(422).json({
      error: 'Validation failed',
      errors: errors
    });
  }

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

  // Get category for validation
  const categoryId = expense.inputMetadata?._budgetCategoryId;
  let category = null;
  if (categoryId) {
    const catRow = db.prepare('SELECT id, data FROM budget_categories WHERE id = ?').get(categoryId);
    if (catRow) {
      category = JSON.parse(catRow.data);
      category.id = catRow.id;
    }
  }

  // Validate expense
  const errors = validateExpense(expense, category, getSetting('taxiMaxPerTrip'));
  if (errors.length > 0) {
    return res.status(422).json({
      error: 'Validation failed',
      errors: errors
    });
  }

  const original = JSON.parse(exists.data);
  if (original.createdAt) expense.createdAt = original.createdAt;

  // ตาข่ายกันข้อมูลหาย: ใบเดิมมีไฟล์แนบ แต่ payload ไม่ส่งมาเลย = หน้าเว็บไม่ได้เอาของเดิมติดมา
  // ไม่ใช่เจตนาลบ เพราะการลบต้องส่งรายการที่เหลือมาให้ (อาจเป็นอาร์เรย์ที่สั้นลง)
  // เดิม UPDATE เขียนทับทั้งก้อน ใบเสร็จเดิมจึงหายทุกครั้งที่กดแก้ไข
  const oldImgs = (original.attachments && Array.isArray(original.attachments.images))
    ? original.attachments.images : [];
  const newImgs = (expense.attachments && Array.isArray(expense.attachments.images))
    ? expense.attachments.images : null;
  if (oldImgs.length && (newImgs === null || newImgs.length === 0)) {
    expense.attachments = Object.assign({}, expense.attachments, { images: oldImgs });
    console.log('[expenses] #' + id + ' คืนไฟล์แนบเดิม ' + oldImgs.length + ' ไฟล์ (payload ไม่ได้ส่งมา)');
  }

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

/**
 * เติมรายการใหม่เข้า "ตำแหน่ง" หรือ "สังกัด" — ผู้ใช้ทั่วไปทำได้
 *
 * เหตุผล: ไม่มีใครรู้ทุกตำแหน่งตั้งแต่วันแรก ถ้าล็อกให้เลือกจาก dropdown อย่างเดียว
 * คนที่ตำแหน่งยังไม่มีในรายการจะทำงานไม่ได้ จึงให้พิมพ์เองได้ก่อน แล้วระบบเก็บสะสมไว้
 * เมื่อรายการครบพอแล้ว admin ค่อยพิจารณาล็อกเป็น dropdown อย่างเดียว
 *
 * ขอบเขตแคบไว้เพื่อความปลอดภัย: เพิ่มได้เฉพาะ 2 รายการนี้ แก้/ลบของเดิมไม่ได้
 */
const APPENDABLE_LISTS = ['positionList', 'affiliationList'];

app.post('/settings/list-append', requireAuth, (req, res) => {
  const { key, value } = req.body || {};
  if (APPENDABLE_LISTS.indexOf(key) < 0)
    return res.status(400).json({ error: 'เพิ่มได้เฉพาะรายการตำแหน่งและสังกัดเท่านั้น' });

  const v = String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  if (!v)            return res.status(400).json({ error: 'ค่าว่าง' });
  if (v.length > 120) return res.status(400).json({ error: 'ข้อความยาวเกินไป (เกิน 120 ตัวอักษร)' });

  const cur = getSetting(key);
  const list = Array.isArray(cur) ? cur.slice() : [];
  // มีอยู่แล้วก็ถือว่าสำเร็จ ไม่ต้องเพิ่มซ้ำ
  if (list.some(x => String(x).trim() === v))
    return res.json({ ok: true, added: false, list });

  list.push(v);
  setSetting(key, list);
  console.log('[list-append] ' + key + ' += "' + v + '" โดย ' + req.user.email);
  res.json({ ok: true, added: true, list });
});

// ── Profiles ──────────────────────────────────────────────

app.get('/profiles', requireAuth, (req, res) => {
  let rows;
  if (req.user.role === 'user') {
    // own profiles + global profiles (is_global = 1)
    rows = db.prepare('SELECT id, data, owner_user_id, is_global FROM profiles WHERE owner_user_id = ? OR is_global = 1 ORDER BY id ASC').all(req.user.id);
  } else {
    rows = db.prepare('SELECT p.id, p.data, p.owner_user_id, p.is_global, u.email as owner_email FROM profiles p LEFT JOIN users u ON u.id = p.owner_user_id ORDER BY p.id ASC').all();
  }
  res.json(rows.map(r => {
    const o = JSON.parse(r.data);
    o.id = r.id;
    o.ownerUserId = r.owner_user_id ?? null;
    o.isGlobal = r.is_global === 1;
    if (r.owner_email) o.ownerEmail = r.owner_email;
    return o;
  }));
});

app.post('/profiles', requireAuth, (req, res) => {
  if (req.user.role === 'approver') return res.status(403).json({ error: 'Approvers cannot create profiles' });
  const p = req.body;
  if (!p.profileName || !p.fullName) return res.status(400).json({ error: 'profileName and fullName are required' });

  // ใครก็ตั้งเป็นโปรไฟล์ที่ใช้ร่วมกันได้ ไม่ใช่แค่ผู้ดูแลระบบ
  // เหตุผลเดียวกับรายการตำแหน่ง/สังกัด: ไม่มีใครรู้ทุกชื่อตั้งแต่วันแรก
  // ถ้าล็อกไว้ที่แอดมินคนเดียว งานจะติดคอขวดโดยไม่จำเป็น
  //
  // เก็บ owner ไว้เสมอแม้เป็นโปรไฟล์ร่วม (ต่างจากเดิมที่ตั้ง null)
  // เพื่อให้คนที่สร้างลบของตัวเองได้ ถ้าติ๊กผิดจะได้ไม่ต้องรอแอดมิน
  // ส่วนรายการเก่าที่ owner เป็น null ยังคงลบได้เฉพาะแอดมินเหมือนเดิม
  const ownerUserId = req.user.id;
  const isGlobal = p.isGlobal === true ? 1 : 0;

  const result = db.prepare('INSERT INTO profiles (data, owner_user_id, is_global) VALUES (?, ?, ?)').run(
    JSON.stringify(p), ownerUserId, isGlobal
  );

  p.id = result.lastInsertRowid;
  p.ownerUserId = ownerUserId;
  p.isGlobal = isGlobal === 1;
  res.status(201).json(p);
});

app.put('/profiles/:id', requireAuth, (req, res) => {
  if (req.user.role === 'approver') return res.status(403).json({ error: 'Approvers cannot edit profiles' });
  const id = parseInt(req.params.id);
  const exists = db.prepare('SELECT id, owner_user_id, is_global FROM profiles WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'Profile not found' });

  // โปรไฟล์ส่วนกลาง: ผู้ใช้ทุกคนแก้ไขได้ (ผู้ประสานงานต้องดูแลทะเบียนนี้เป็นงานประจำ)
  // แต่ "ลบ" ยังสงวนไว้ให้ admin เพราะย้อนกลับไม่ได้ — ดู DELETE ด้านล่าง
  // โปรไฟล์ส่วนตัวของคนอื่น ยังแก้ไม่ได้เหมือนเดิม
  if (exists.is_global !== 1 &&
      exists.owner_user_id !== null &&
      req.user.role !== 'admin' &&
      exists.owner_user_id !== req.user.id)
    return res.status(403).json({ error: 'แก้ไขได้เฉพาะโปรไฟล์ของตัวเอง' });

  const p = req.body;
  // บันทึกว่าใครแก้ล่าสุด เพื่อให้ตรวจย้อนหลังได้ว่าใครเปลี่ยนอะไร
  p.lastEditedBy = req.user.email;
  p.lastEditedAt = new Date().toISOString();

  // สลับ "ใช้ร่วมกัน" <-> "ส่วนตัว" ได้ ใครที่แก้โปรไฟล์นี้ได้ก็สลับได้
  // (สิทธิ์แก้ถูกตรวจไปแล้วด้านบน) เก็บเจ้าของเดิมไว้เสมอเพื่อให้ยังลบของตัวเองได้
  let nextGlobal = exists.is_global;
  const nextOwner = exists.owner_user_id;
  if (typeof p.isGlobal === 'boolean') nextGlobal = p.isGlobal ? 1 : 0;

  db.prepare("UPDATE profiles SET data = ?, is_global = ?, owner_user_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(p), nextGlobal, nextOwner, id);
  p.id = id;
  p.ownerUserId = nextOwner;
  p.isGlobal = nextGlobal === 1;
  res.json(p);
});

app.delete('/profiles/:id', requireAuth, (req, res) => {
  if (req.user.role === 'approver') return res.status(403).json({ error: 'Approvers cannot delete profiles' });
  const id = parseInt(req.params.id);
  const exists = db.prepare('SELECT id, owner_user_id, is_global FROM profiles WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'Profile not found' });

  // ลบได้เมื่อเป็นเจ้าของ หรือเป็นผู้ดูแลระบบ
  // โปรไฟล์ที่ใช้ร่วมกันซึ่งไม่มีเจ้าของ (ทะเบียนเก่าที่ย้ายเข้าระบบ) สงวนให้แอดมิน
  // เพราะไม่รู้ว่าใครสร้าง และคนอื่นอาจกำลังใช้อยู่
  if (exists.owner_user_id === null && req.user.role !== 'admin')
    return res.status(403).json({ error: 'โปรไฟล์กลางของระบบ ลบได้เฉพาะผู้ดูแลระบบ' });
  if (req.user.role !== 'admin' && exists.owner_user_id !== req.user.id)
    return res.status(403).json({ error: 'ลบได้เฉพาะโปรไฟล์ที่ตัวเองสร้าง' });

  db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ── Longdo Proxy ──────────────────────────────────────────

// กุญแจมาจากไฟล์ .env เท่านั้น — repo นี้เป็น public ห้ามเขียนความลับลงโค้ด
const LONGDO_API_KEY = process.env.LONGDO_API_KEY || '';
if (!LONGDO_API_KEY) console.warn('[longdo] ไม่พบ LONGDO_API_KEY ใน .env — ค้นหาสถานที่ผ่าน Longdo จะใช้ไม่ได้');

// ── แคชผลค้นหาพิกัด ────────────────────────────────────────
// ตำบล/อำเภอ/จังหวัดไม่ย้ายที่ ถามครั้งเดียวเก็บไว้ใช้ตลอด
// ลดการยิงถาม OSM (จำกัด 1 คำขอ/วินาที) และ Longdo (มีโควตา) ลงเกือบเป็นศูนย์
const cacheGet = db.prepare(
  "SELECT result, provider, (julianday('now') - julianday(created_at)) age FROM geocode_cache WHERE q = ?");
const cacheHit = db.prepare('UPDATE geocode_cache SET hits = hits + 1 WHERE q = ?');
const cachePut = db.prepare(
  'INSERT OR REPLACE INTO geocode_cache (q, result, provider, hits) VALUES (?, ?, ?, 0)'
);

const cacheKey = s => s.trim().replace(/\s+/g, ' ').toLowerCase();

// OSM ขอไม่ให้ยิงถี่กว่า 1 ครั้ง/วินาที — เข้าคิวให้ห่างกันอย่างน้อย 1.1 วินาที
let osmLast = 0;
async function osmThrottle() {
  const wait = 1100 - (Date.now() - osmLast);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  osmLast = Date.now();
}

/* ── แตกคำค้นเป็นหลายแบบ ───────────────────────────────────
   ทั้ง Longdo และ OSM จับคู่แบบตรงตัว ไม่ได้ตัดคำภาษาไทยให้
   วัดจริงแล้ว: "โรงแรมทีเค.พาเลซ" -> ไม่เจอทั้งสองเจ้า
                "โรงแรม ทีเค.พาเลซ" -> OSM เจอ
                "ทีเค พาเลซ"       -> Longdo เจอ
   ข้อมูลมีอยู่ครบ แค่คำนำหน้าที่เขียนติดกันกับจุด . ทำให้จับคู่ไม่ติด
   จึงสร้างคำค้นหลายแบบแล้วไล่ถามจนกว่าจะเจอ — ทดสอบแล้วกู้กลับได้ 5/5 เคส */

const PLACE_PREFIX = [
  'โรงพยาบาลส่งเสริมสุขภาพตำบล', 'โรงพยาบาลสมเด็จพระยุพราช', 'โรงพยาบาล',
  'สำนักงานสาธารณสุขจังหวัด', 'สำนักงานสาธารณสุขอำเภอ', 'สำนักงาน',
  'มหาวิทยาลัยราชภัฏ', 'มหาวิทยาลัย', 'วิทยาลัย', 'โรงเรียน', 'โรงแรม',
  'สถาบัน', 'ศูนย์', 'ที่ว่าการอำเภอ', 'ที่ว่าการ', 'เทศบาลตำบล', 'เทศบาลเมือง',
  'เทศบาลนคร', 'เทศบาล', 'องค์การบริหารส่วนตำบล', 'อาคาร', 'บริษัท', 'ห้างสรรพสินค้า', 'วัด'
];

const PLACE_ABBR = [
  ['รพ.สต.', 'โรงพยาบาลส่งเสริมสุขภาพตำบล'], ['รพ.', 'โรงพยาบาล'],
  ['สสจ.', 'สำนักงานสาธารณสุขจังหวัด'],      ['สสอ.', 'สำนักงานสาธารณสุขอำเภอ'],
  ['ม.', 'มหาวิทยาลัย'],  ['รร.', 'โรงเรียน'],
  ['สนง.', 'สำนักงาน'],   ['อบต.', 'องค์การบริหารส่วนตำบล'], ['ทต.', 'เทศบาลตำบล']
];

function expandQuery(q) {
  const out = [], seen = new Set();
  const add = s => {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    if (s.length >= 2 && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); }
  };
  add(q);

  // ขยายตัวย่อที่ขึ้นต้น เช่น รพ.ศิริราช -> โรงพยาบาล ศิริราช
  let base = q;
  for (const [ab, full] of PLACE_ABBR) {
    if (q.startsWith(ab)) { base = full + ' ' + q.slice(ab.length); add(base); break; }
  }

  add(base.replace(/\./g, ' '));   // จุด -> เว้นวรรค  (ท่าที่ Longdo ชอบ)
  add(base.replace(/\./g, ''));    // ตัดจุดทิ้ง

  // แยกคำนำหน้าที่เขียนติดกันออก  "โรงแรมทีเค" -> "โรงแรม ทีเค" และ "ทีเค"
  for (const p of PLACE_PREFIX) {
    if (base.startsWith(p) && base.length > p.length) {
      const rest = base.slice(p.length).trim();
      if (rest.length >= 2) {
        add(p + ' ' + rest);
        add(p + ' ' + rest.replace(/\./g, ' '));
        add(rest);
        add(rest.replace(/\./g, ' '));
      }
      break;
    }
  }
  return out.slice(0, 8);
}

/* ── เทียบความคล้ายของข้อความ (สำหรับกรณีพิมพ์ผิด) ────────── */
// ตัดเว้นวรรค จุด และวรรณยุกต์ออกก่อนเทียบ
// "โรงเรม" กับ "โรงแรม" จะต่างกันแค่ 1 ตัวอักษร จับได้
const normPlace = s => String(s || '')
  .toLowerCase()
  .replace(/[่-๎]/g, '')     // ่ ้ ๊ ๋ ็ ์ ฯลฯ
  .replace(/[\s.,\-()"'’]/g, '');

function editDistance(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
      if (cur[j] < best) best = cur[j];
    }
    if (best > cap) return cap + 1;   // ตัดออกเร็ว ไม่ต้องคำนวณต่อ
    prev = cur;
  }
  return prev[b.length];
}

const placeAll    = db.prepare('SELECT name, address, lat, lng, uses FROM places');
const placeUpsert = db.prepare(`
  INSERT INTO places (name, norm, address, lat, lng, source)
  VALUES (@name, @norm, @address, @lat, @lng, @source)
  ON CONFLICT(norm) DO UPDATE SET uses = uses + 1, last_at = datetime('now')`);

// เริ่มต้นสมุดสถานที่จากผลค้นหาที่เคยสำเร็จมาแล้ว จะได้ไม่ว่างเปล่าตั้งแต่วันแรก
try {
  if (db.prepare('SELECT COUNT(*) n FROM places').get().n === 0) {
    let n = 0;
    const seed = db.transaction(rows => {
      for (const r of rows) {
        let d; try { d = JSON.parse(r.result).data; } catch (_) { continue; }
        if (!Array.isArray(d)) continue;
        for (const x of d.slice(0, 2)) {
          const la = parseFloat(x.lat), lo = parseFloat(x.lon);
          const norm = normPlace(x.name);
          if (!isFinite(la) || !isFinite(lo) || norm.length < 2) continue;
          placeUpsert.run({
            name: String(x.name).slice(0, 200), norm,
            address: String(x.address || '').slice(0, 300),
            lat: la, lng: lo, source: 'seed'
          });
          n++;
        }
      }
    });
    seed(db.prepare("SELECT result FROM geocode_cache WHERE provider NOT IN ('none','suggest')").all());
    if (n) console.log(`[places] เริ่มต้นสมุดสถานที่จากแคชเดิม ${n} รายการ`);
  }
} catch (e) { console.error('[places] seed failed:', e.message); }

/** หาสถานที่ในสมุดขององค์กรที่ชื่อใกล้เคียงกับที่พิมพ์มา */
function similarPlaces(q, limit) {
  const nq = normPlace(q);
  if (nq.length < 3) return [];
  // ยอมให้ผิดได้ราว 1 ใน 4 ของความยาว อย่างน้อย 1 อย่างมาก 4
  const cap = Math.max(1, Math.min(4, Math.floor(nq.length / 4)));
  const scored = [];
  for (const p of placeAll.all()) {
    const np = normPlace(p.name);
    let d;
    if (np.indexOf(nq) >= 0) d = 0;                       // เป็นส่วนหนึ่งของชื่อ = ตรงเป๊ะ
    else {
      d = editDistance(nq, np, cap);
      // เทียบกับช่วงต้นของชื่อด้วย เผื่อพิมพ์มาแค่บางส่วน
      if (d > cap && np.length > nq.length)
        d = editDistance(nq, np.slice(0, nq.length), cap);
    }
    if (d <= cap) scored.push({ d, uses: p.uses, p });
  }
  scored.sort((a, b) => a.d - b.d || b.uses - a.uses);
  return scored.slice(0, limit || 5).map(s => ({
    name: s.p.name, address: s.p.address || '', lat: s.p.lat, lon: s.p.lng,
    source: 'saved', uses: s.p.uses
  }));
}

async function askLongdo(q) {
  const url = `https://search.longdo.com/mapsearch/json/search?keyword=${encodeURIComponent(q)}&limit=6&key=${LONGDO_API_KEY}`;
  const d = await (await fetch(url)).json();
  return (d.data || [])
    .filter(x => x.lat && x.lon && !/^tag:/i.test(x.name || ''))
    .map(x => ({ name: x.name, address: x.address || '', lat: x.lat, lon: x.lon, source: 'longdo' }));
}

async function askOsm(q) {
  await osmThrottle();
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&countrycodes=th&accept-language=th`;
  const d = await (await fetch(url, { headers: { 'User-Agent': 'promt-beark-app/1.0' } })).json();
  return (d || []).map(x => ({
    name: x.display_name.split(',')[0].trim(), address: x.display_name,
    lat: x.lat, lon: x.lon, source: 'osm'
  }));
}

/** รวมผลจากหลายแหล่ง ตัดตัวซ้ำ (ชื่อคล้ายกัน + พิกัดใกล้กันมาก) */
function mergeHits(lists, limit) {
  const out = [], seen = [];
  for (const it of [].concat(...lists)) {
    if (!it.lat || !it.lon) continue;
    const la = parseFloat(it.lat), lo = parseFloat(it.lon);
    if (!isFinite(la) || !isFinite(lo)) continue;
    const nn = normPlace(it.name);
    const dup = seen.some(s =>
      Math.abs(s.la - la) < 0.002 && Math.abs(s.lo - lo) < 0.002 &&
      (s.nn === nn || s.nn.indexOf(nn) === 0 || nn.indexOf(s.nn) === 0));
    if (dup) continue;
    seen.push({ la, lo, nn });
    out.push(it);
    if (out.length >= (limit || 8)) break;
  }
  return out;
}

app.get('/map-search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });

  const key = cacheKey(q);
  const cached = cacheGet.get(key);
  // ผลว่างเก็บไว้ได้ไม่เกิน 1 วัน — สถานที่ใหม่ถูกเพิ่มลงแผนที่ตลอด
  // ถ้าจำ "ไม่เจอ" ไว้ตลอดกาล ที่ที่เพิ่งถูกเพิ่มจะไม่มีวันค้นเจอเลย
  const stale = cached && cached.provider === 'none' && cached.age > 1;
  if (cached && !stale) {
    cacheHit.run(key);
    res.set('X-Geocode-Cache', 'hit');
    const c = JSON.parse(cached.result);
    // ผลว่างที่เคยแคชไว้ ยังต้องลองเทียบกับสมุดสถานที่ เพราะสมุดโตขึ้นทุกวัน
    if (!(c.data || []).length) c.didYouMean = similarPlaces(q, 5);
    return res.json(c);
  }

  try {
    // สมุดสถานที่ขององค์กรมาก่อน — ที่ที่เคยใช้จริงย่อมตรงใจกว่าผลจากภายนอก
    const saved = similarPlaces(q, 3).filter(p => normPlace(p.name).indexOf(normPlace(q)) >= 0);

    let hits = [], usedQuery = q;
    for (const v of expandQuery(q)) {
      const [lo, os] = await Promise.all([
        askLongdo(v).catch(() => []),
        askOsm(v).catch(() => [])
      ]);
      const m = mergeHits([lo, os], 8);
      if (m.length) { hits = m; usedQuery = v; break; }
    }

    const merged = mergeHits([saved, hits], 8);
    const out = { data: merged };
    // บอกผู้ใช้ด้วยว่าระบบไปค้นด้วยคำอะไรจริงๆ จะได้ไม่งงว่าทำไมผลไม่ตรงกับที่พิมพ์
    if (merged.length && usedQuery !== q) out.usedQuery = usedQuery;
    if (!merged.length) out.didYouMean = similarPlaces(q, 5);

    cachePut.run(key, JSON.stringify({ data: merged, usedQuery: out.usedQuery }),
      merged.length ? 'expanded' : 'none');
    res.set('X-Geocode-Cache', 'miss');
    return res.json(out);
  } catch (e) {
    res.status(502).json({ error: 'ค้นหาไม่สำเร็จ ระบบแผนที่ภายนอกไม่ตอบสนอง ลองใหม่อีกครั้ง' });
  }
});

/* ── คำแนะนำระหว่างพิมพ์ ────────────────────────────────────
   Longdo มี endpoint suggest ที่เติมชื่อเต็มให้จากคำที่พิมพ์ไม่จบ
   วัดแล้ว: "โรงพยาบาลศิร" -> 8 ชื่อ มีโรงพยาบาลศิริราชอยู่ด้วย
   ผสมกับสมุดสถานที่ขององค์กร ซึ่งทนคำพิมพ์ผิดได้ */
app.get('/map-suggest', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ data: [] });

  const key = 'sg:' + cacheKey(q);
  const cached = cacheGet.get(key);
  let remote;
  // คำแนะนำที่ว่างเปล่าก็เก็บไว้ไม่เกิน 1 วันเช่นกัน ด้วยเหตุผลเดียวกัน
  if (cached && !(cached.age > 1 && !JSON.parse(cached.result).length)) {
    cacheHit.run(key); remote = JSON.parse(cached.result);
  }
  else {
    remote = [];
    // ถามไม่เกิน 3 แบบ เพราะ suggest ต้องตอบไว ผู้ใช้กำลังพิมพ์อยู่
    for (const v of expandQuery(q).slice(0, 3)) {
      try {
        const url = `https://search.longdo.com/mapsearch/json/suggest?keyword=${encodeURIComponent(v)}&limit=8&key=${LONGDO_API_KEY}`;
        const d = await (await fetch(url)).json();
        (d.data || []).forEach(x => {
          const w = String((x && x.w) || '').replace(/^tag:\s*/i, '').trim();
          if (w) remote.push(w);
        });
      } catch (_) { /* ผู้ให้บริการล่ม ยังมีสมุดสถานที่ในเครื่องให้ใช้ */ }
      if (remote.length >= 8) break;
    }
    cachePut.run(key, JSON.stringify(remote), 'suggest');
  }

  // สถานที่ที่องค์กรเคยใช้ ขึ้นก่อนเสมอ — ทนคำพิมพ์ผิด และตรงกับงานจริงมากกว่า
  const out = [], seen = new Set();
  const push = (text, kind, extra) => {
    const n = normPlace(text);
    if (!text || seen.has(n)) return;
    seen.add(n);
    out.push(Object.assign({ text, kind }, extra || {}));
  };
  similarPlaces(q, 4).forEach(p => push(p.name, 'saved', { address: p.address, uses: p.uses }));
  remote.forEach(w => push(w, 'remote'));

  res.json({ data: out.slice(0, 8) });
});

/* ── จัดการสมุดสถานที่ (แอดมินเท่านั้น) ────────────────────
   สมุดโตเองอัตโนมัติจากการใช้งาน จึงมีโอกาสมีขยะปนเข้ามา
   เช่นตอนเริ่มต้นระบบดึงจากแคชเดิม ซึ่งมีทั้งชื่อสถานที่และชื่อถนน/ซอย
   ที่มาจากการค้นหาที่อยู่บ้านปนกัน แอดมินต้องกวาดออกได้ */
app.get('/places', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  let rows = db.prepare(`
    SELECT id, name, address, lat, lng, source, uses, last_at
    FROM places ORDER BY uses DESC, name COLLATE NOCASE`).all();
  if (q) rows = rows.filter(r =>
    (r.name + ' ' + (r.address || '')).toLowerCase().indexOf(q) >= 0);
  res.json({
    items: rows.slice(0, 500),
    total: rows.length,
    bySource: db.prepare('SELECT source, COUNT(*) n FROM places GROUP BY source').all()
  });
});

app.delete('/places/:id', requireAdmin, (req, res) => {
  const r = db.prepare('DELETE FROM places WHERE id = ?').run(parseInt(req.params.id, 10));
  if (!r.changes) return res.status(404).json({ error: 'ไม่พบสถานที่นี้ อาจถูกลบไปแล้ว' });
  res.json({ ok: true });
});

/** จำสถานที่ที่ผู้ใช้เลือกจริง เพื่อให้ครั้งต่อไปค้นเจอแม้พิมพ์ผิด */
app.post('/map-pick', requireAuth, (req, res) => {
  const { name, address, lat, lng, source } = req.body || {};
  const nm = String(name || '').trim();
  const la = parseFloat(lat), lo = parseFloat(lng);
  if (!nm || !isFinite(la) || !isFinite(lo))
    return res.status(400).json({ error: 'ต้องมีชื่อสถานที่และพิกัด' });
  const norm = normPlace(nm);
  if (norm.length < 2) return res.status(400).json({ error: 'ชื่อสถานที่สั้นเกินไป' });
  placeUpsert.run({
    name: nm.slice(0, 200), norm, address: String(address || '').slice(0, 300),
    lat: la, lng: lo, source: String(source || 'search').slice(0, 20)
  });
  res.json({ ok: true });
});

// สถิติแคช — ให้ admin ดูว่าประหยัดการเรียกภายนอกไปเท่าไร
app.get('/map-cache-stats', requireAdmin, (_req, res) => {
  const rows = db.prepare(
    'SELECT provider, COUNT(*) n, SUM(hits) hits FROM geocode_cache GROUP BY provider'
  ).all();
  const total = db.prepare('SELECT COUNT(*) n, SUM(hits) hits FROM geocode_cache').get();
  res.json({
    entries: total.n || 0,
    servedFromCache: total.hits || 0,
    byProvider: rows
  });
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

// ── สถิติสำหรับ Dashboard ─────────────────────────────────
// รวบรวม 5 มุมมอง: หน่วยงาน / เวลา / ประเภทค่าใช้จ่าย / ปลายทาง / รายบุคคล

const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

/** แยกยอดเงินของใบเบิกออกเป็นประเภทค่าใช้จ่าย */
function costBreakdown(md) {
  const c = (md && md._costs) || {};
  const t = (md && md._travel) || {};
  const km = num(t.distOut) + num(t.distRet);
  const fuel = km * num(c.fuelRate);

  let hotel = 0;
  const h = c.hotelEntries;
  if (Array.isArray(h)) {
    h.forEach(x => (x && Array.isArray(x.entries) ? x.entries : [x]).forEach(e => {
      if (e) hotel += num(e.rate) * num(e.nights);
    }));
  } else if (h && Array.isArray(h.entries)) {
    h.entries.forEach(e => { if (e) hotel += num(e.rate) * num(e.nights); });
  }

  let taxi = 0;
  (Array.isArray(c.taxiEntries) ? c.taxiEntries : []).forEach(e => { taxi += num(e && e.amount); });

  return {
    fuel, hotel, taxi,
    air:   num(c.airAmount),
    toll:  num(c.tollAmount),
    other: num(c.otherAmount),
    km
  };
}

app.get('/stats', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT id, data, created_at FROM expenses').all();
  const exps = rows.map(r => {
    let o = {}; try { o = JSON.parse(r.data); } catch (e) {}
    o.id = r.id;
    if (!o.createdAt) o.createdAt = r.created_at;
    return o;
  });

  const add = (map, key, amount, extraKm) => {
    const k = (key && String(key).trim()) || 'ไม่ระบุ';
    if (!map[k]) map[k] = { name: k, count: 0, total: 0, km: 0 };
    map[k].count++;
    map[k].total += amount;
    map[k].km += extraKm || 0;
  };

  const byAffil = {}, byMonth = {}, byProv = {}, byPerson = {};
  const cost = { fuel: 0, hotel: 0, taxi: 0, air: 0, toll: 0, other: 0 };
  let grand = 0, totalKm = 0;

  exps.forEach(e => {
    const md = e.inputMetadata || {};
    const amt = num(e.amount);
    const b = costBreakdown(md);
    grand += amt;
    totalKm += b.km;
    Object.keys(cost).forEach(k => { cost[k] += b[k]; });

    add(byAffil, md._affiliation, amt, 0);
    add(byPerson, e.requestedBy, amt, 0);
    add(byProv, md._travel && md._travel.toProv, amt, b.km);
    add(byMonth, String(e.createdAt || '').slice(0, 7), amt, 0);
  });

  const sortDesc = m => Object.values(m)
    .map(x => ({ ...x, avg: x.count ? Math.round((x.total / x.count) * 100) / 100 : 0 }))
    .sort((a, b) => b.total - a.total);

  // ใครยังไม่เคยเบิก — เทียบรายชื่อในทะเบียนโปรไฟล์กับผู้ที่เคยยื่น
  const claimed = new Set(Object.keys(byPerson));
  const never = [];
  db.prepare('SELECT data FROM profiles').all().forEach(r => {
    let p = {}; try { p = JSON.parse(r.data); } catch (e) { return; }
    if (p.fullName && !claimed.has(p.fullName.trim())) never.push(p.fullName.trim());
  });

  const months = Object.values(byMonth).sort((a, b) => a.name.localeCompare(b.name));
  const peak = months.reduce((m, x) => (!m || x.total > m.total ? x : m), null);

  res.json({
    summary: {
      users:     db.prepare('SELECT COUNT(*) c FROM users').get().c,
      profiles:  db.prepare('SELECT COUNT(*) c FROM profiles').get().c,
      expenses:  exps.length,
      totalAmount: Math.round(grand * 100) / 100,
      avgAmount:   exps.length ? Math.round((grand / exps.length) * 100) / 100 : 0,
      totalKm:     Math.round(totalKm),
      currency: 'THB'
    },
    byAffiliation: sortDesc(byAffil),
    byMonth: months.map(m => ({ ...m, avg: m.count ? Math.round((m.total / m.count) * 100) / 100 : 0 })),
    peakMonth: peak ? peak.name : null,
    byCostType: Object.entries(cost)
      .map(([k, v]) => ({
        type: { fuel: 'ค่าน้ำมัน', hotel: 'ค่าที่พัก', taxi: 'ค่าแท็กซี่',
                air: 'ค่าเครื่องบิน', toll: 'ค่าทางด่วน', other: 'อื่นๆ' }[k],
        key: k,
        total: Math.round(v * 100) / 100,
        pct: grand ? Math.round((v / grand) * 1000) / 10 : 0
      }))
      .sort((a, b) => b.total - a.total),
    byProvince: sortDesc(byProv).map(x => ({ ...x, km: Math.round(x.km) })),
    byPerson: { top: sortDesc(byPerson).slice(0, 10), neverClaimed: never.length, neverList: never.slice(0, 20) }
  });
});

/* ── บันทึกรายการทั้งระบบ (แอดมินเท่านั้น) ─────────────────
   ผู้ใช้ทั่วไปเห็นเฉพาะรายการของตัวเอง (ดู GET /expenses)
   ตรงนี้ให้แอดมินไล่ดูของทุกคนได้ ไว้ตรวจสอบเวลามีคนติดปัญหา
   อ่านอย่างเดียว ไม่มีทางแก้หรือลบจากช่องทางนี้ */
app.get('/expense-log', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT e.id, e.data, e.created_at, e.user_id, u.email owner_email
    FROM expenses e LEFT JOIN users u ON u.id = e.user_id
    ORDER BY e.id DESC`).all();

  const items = rows.map(r => {
    let o = {}; try { o = JSON.parse(r.data); } catch (_) {}
    const md = o.inputMetadata || {};
    const tv = md._travel || {};
    return {
      id: r.id,
      createdAt: o.createdAt || r.created_at,
      byUserId: r.user_id,
      byUser: r.owner_email || 'ไม่ทราบผู้บันทึก',
      byEmail: r.owner_email || '',
      traveler: (o.requestedBy || '').trim() || 'ไม่ระบุ',
      affiliation: (md._affiliation || '').trim(),
      position: (md._position || '').trim(),
      category: md._budgetCategoryId || '',
      purpose: (o.purpose || o.description || '').trim(),
      toProv: (tv.toProv || '').trim(),
      travelFrom: (tv.from || '').trim(),
      travelTo: (tv.to || '').trim(),
      dateFrom: tv.dateFrom || o.dateFrom || '',
      dateTo: tv.dateTo || o.dateTo || '',
      amount: Number(o.amount) || 0,
      km: costBreakdown(md).km,
      // ธงเตือน ช่วยให้แอดมินเห็นทันทีว่ารายการไหนน่าจะมีปัญหา
      flags: [
        !(Number(o.amount) > 0)                        ? 'ยอดเงินเป็นศูนย์' : '',
        tv.distanceSource === 'manual'                 ? 'กรอกระยะทางเอง'   : '',
        (tv.toGeo && tv.toGeo.precision === 'province')? 'หมุดปลายทางหยาบ'  : '',
        !(o.requestedBy || '').trim()                  ? 'ไม่ระบุผู้เดินทาง' : ''
      ].filter(Boolean)
    };
  });

  const norm = s => String(s || '').toLowerCase().trim();
  let out = items;

  const qs = norm(req.query.q);
  if (qs) out = out.filter(x =>
    [x.traveler, x.byUser, x.byEmail, x.purpose, x.toProv, x.affiliation, String(x.id)]
      .some(v => norm(v).indexOf(qs) >= 0));

  if (req.query.user)  out = out.filter(x => String(x.byUserId) === String(req.query.user));
  if (req.query.prov)  out = out.filter(x => x.toProv === req.query.prov);
  if (req.query.from)  out = out.filter(x => String(x.createdAt).slice(0, 10) >= req.query.from);
  if (req.query.to)    out = out.filter(x => String(x.createdAt).slice(0, 10) <= req.query.to);
  if (req.query.flagged === '1') out = out.filter(x => x.flags.length > 0);

  const page  = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
  const size  = Math.min(200, Math.max(10, parseInt(req.query.size || '50', 10) || 50));
  const total = out.length;

  res.json({
    items: out.slice((page - 1) * size, page * size),
    page, size, total,
    pages: Math.max(1, Math.ceil(total / size)),
    sumAmount: Math.round(out.reduce((s, x) => s + x.amount, 0) * 100) / 100,
    flaggedCount: out.filter(x => x.flags.length).length,
    // ตัวเลือกสำหรับช่องกรอง สร้างจากข้อมูลจริง ไม่ต้องพิมพ์เอง
    users: Object.values(items.reduce((m, x) => {
      if (x.byUserId != null && !m[x.byUserId])
        m[x.byUserId] = { id: x.byUserId, name: x.byUser };
      return m;
    }, {})).sort((a, b) => a.name.localeCompare(b.name, 'th')),
    provinces: Array.from(new Set(items.map(x => x.toProv).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'th'))
  });
});

/** รายการเดียวแบบเต็ม ให้แอดมินเปิดดู/ออก PDF ได้ */
app.get('/expense-log/:id', requireAdmin, (req, res) => {
  const r = db.prepare(`
    SELECT e.id, e.data, e.created_at, e.user_id, u.email owner_email
    FROM expenses e LEFT JOIN users u ON u.id = e.user_id WHERE e.id = ?`).get(parseInt(req.params.id, 10));
  if (!r) return res.status(404).json({ error: 'ไม่พบรายการนี้ อาจถูกลบไปแล้ว' });
  let o = {}; try { o = JSON.parse(r.data); } catch (_) {}
  o.id = r.id;
  o.userId = r.user_id;
  o.ownerEmail = r.owner_email || '';
  if (!o.createdAt) o.createdAt = r.created_at;
  res.json(o);
});

// ── สำรองข้อมูลอัตโนมัติ ──────────────────────────────────
// สำรองตอนเปิดระบบ แล้วทุก 6 ชั่วโมง เก็บย้อนหลัง 14 ชุด
// ใช้ db.backup() ของ SQLite ซึ่งสำรองได้ปลอดภัยแม้มีคนใช้งานอยู่
const BACKUP_DIR   = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups');
const BACKUP_KEEP  = parseInt(process.env.BACKUP_KEEP || '14', 10);
const BACKUP_HOURS = parseInt(process.env.BACKUP_HOURS || '6', 10);

async function runBackup(tag) {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(BACKUP_DIR, `prompt-berk-${stamp}${tag ? '-' + tag : ''}.db`);
    await db.backup(file);

    // ลบชุดเก่าเกินจำนวนที่เก็บ
    const all = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('prompt-berk-') && f.endsWith('.db'))
      .sort();
    while (all.length > BACKUP_KEEP) {
      const old = all.shift();
      try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch (_) {}
    }
    const kb = Math.round(fs.statSync(file).size / 1024);
    console.log(`[backup] ${path.basename(file)} (${kb} KB) — เก็บไว้ ${all.length} ชุด`);
    return { file: path.basename(file), sizeKb: kb, kept: all.length };
  } catch (e) {
    console.error('[backup] ล้มเหลว:', e.message);
    return { error: e.message };
  }
}

runBackup('startup');
setInterval(() => runBackup('auto'), BACKUP_HOURS * 3600 * 1000);

// สำรองทันทีตามคำสั่ง — ใช้ก่อนทำอะไรที่เสี่ยง
app.post('/backup', requireAdmin, async (_req, res) => {
  const r = await runBackup('manual');
  if (r.error) return res.status(500).json({ error: r.error });
  res.json(r);
});

// ดูรายการไฟล์สำรองที่มี
app.get('/backup', requireAdmin, (_req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return res.json({ dir: BACKUP_DIR, files: [] });
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db'))
      .map(f => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, sizeKb: Math.round(st.size / 1024), at: st.mtime.toISOString() };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
    res.json({ dir: BACKUP_DIR, keep: BACKUP_KEEP, everyHours: BACKUP_HOURS, files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Health ────────────────────────────────────────────────

app.get('/health', (_req, res) => res.type('text').send('ok'));

app.listen(PORT, () => console.log(`Prompt-Berk backend :${PORT}  db=${DB_PATH}`));
