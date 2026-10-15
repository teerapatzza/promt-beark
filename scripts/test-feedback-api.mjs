// แบบประเมิน — ตรวจเส้นทาง API จริง ยิงผ่าน express กับฐานข้อมูลชั่วคราว
// ไม่แตะฐานข้อมูลของจริงแม้แต่น้อย สร้างไฟล์ใหม่ในโฟลเดอร์ชั่วคราวแล้วลบทิ้ง
//
// ตรวจสามเรื่องที่เจ้าของงานสั่ง และกติกาการไม่ระบุตัวตนที่ตกลงกันไว้
//   node scripts/test-feedback-api.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
// express ติดตั้งอยู่ใต้ backend/ ไม่ได้อยู่ที่รากโปรเจกต์ จึงต้องชี้ตัวโหลดไปที่นั่น
const brequire = createRequire(new URL('../backend/package.json', import.meta.url));

const express = brequire('express');
const feedbackRoutes = require('../backend/feedback.js');

/* ใช้ SQLite ที่ติดมากับ Node 24 แทน better-sqlite3
   เพราะตัวหลังเป็นโมดูลที่ต้องคอมไพล์ให้ตรงรุ่น Node ของแต่ละเครื่อง
   เทสต์จะได้รันได้ทันทีโดยไม่ต้อง npm rebuild ก่อน
   ผูกเมธอดที่ feedback.js เรียกใช้ให้เหมือน better-sqlite3 เท่าที่ใช้จริง */
const { DatabaseSync } = require('node:sqlite');
function openTestDb(file) {
    const d = new DatabaseSync(file);
    d.transaction = (fn) => (...args) => {
        d.exec('BEGIN');
        try { const out = fn(...args); d.exec('COMMIT'); return out; }
        catch (e) { try { d.exec('ROLLBACK'); } catch (_) {} throw e; }
    };
    return d;
}

const results = [];
const ok = (name, pass, detail = '') => {
    results.push(pass);
    console.log((pass ? '  ผ่าน  ' : '  ตก    ') + name + (detail ? '  -> ' + detail : ''));
};

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-fb-')), 'test.db');
const db = openTestDb(dbFile);

db.exec(`
  CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT);
  CREATE TABLE feedback_forms (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, intro TEXT DEFAULT '',
    status TEXT DEFAULT 'draft', opens_at TEXT, closes_at TEXT,
    questions TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE feedback_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT, form_id INTEGER NOT NULL,
    answers TEXT NOT NULL DEFAULT '{}', edit_token TEXT NOT NULL,
    submitted_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  CREATE UNIQUE INDEX idx_fb_token ON feedback_responses(edit_token);
  CREATE TABLE feedback_submitted (
    form_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    submitted_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (form_id, user_id));
`);
db.prepare('INSERT INTO users (email) VALUES (?)').run('a@ha.or.th');
db.prepare('INSERT INTO users (email) VALUES (?)').run('b@ha.or.th');
db.prepare('INSERT INTO users (email) VALUES (?)').run('c@ha.or.th');

// ผู้ใช้ปลอม สลับได้ระหว่างเทส เพื่อดูว่าสิทธิ์ถูกกั้นจริง
let who = { id: 1, role: 'admin' };
const requireAuth = (req, _res, next) => { req.user = who; next(); };
const requireAdmin = (req, res, next) => {
    req.user = who;
    if (who.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    next();
};

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/feedback', feedbackRoutes({ db, requireAuth, requireAdmin }));

const server = app.listen(0);
const port = server.address().port;
const api = async (method, url, body, asUser) => {
    if (asUser) who = asUser;
    const r = await fetch('http://127.0.0.1:' + port + '/feedback' + url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    // เก็บไบต์ดิบไว้ด้วย เพราะ fetch ตัด BOM ทิ้งตอนถอดรหัสเป็นข้อความ
    // ถ้าวัดจาก .text() จะสรุปผิดว่าเซิร์ฟเวอร์ไม่ได้ส่ง BOM มา
    const buf = Buffer.from(await r.arrayBuffer());
    const text = buf.toString('utf8');
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { status: r.status, body: json, text, bytes: buf };
};

const ADMIN = { id: 1, role: 'admin' };
const USER_B = { id: 2, role: 'user' };
const USER_C = { id: 3, role: 'user' };

try {
    console.log('═══ 1. ผู้ดูแลสร้างและเปิดแบบประเมิน ═══');

    const made = await api('POST', '/forms', {
        title: 'ความพึงพอใจพร้อมเบิก รอบที่ 1',
        questions: [
            { kind: 'face',   title: 'พอใจแค่ไหน', required: true },
            { kind: 'choice', title: 'ตรงไหนติดขัด', options: ['Taxi', 'แผนที่'] },
            { kind: 'text',   title: 'ข้อเสนอแนะ' }
        ]
    }, ADMIN);
    ok('สร้างแบบประเมินได้', made.status === 200 && made.body.id > 0);
    const fid = made.body.id;

    const beforeOpen = await api('GET', '/active', undefined, USER_B);
    ok('ยังเป็นฉบับร่าง ผู้ใช้จึงยังไม่เห็น', beforeOpen.body.form === null);

    const opened = await api('PUT', '/forms/' + fid, { title: 'ความพึงพอใจพร้อมเบิก รอบที่ 1', status: 'open' }, ADMIN);
    ok('เปิดรับคำตอบได้', opened.status === 200);

    const active = await api('GET', '/active', undefined, USER_B);
    ok('ผู้ใช้เห็นแบบประเมินที่เปิดอยู่', active.body.form && active.body.form.id === fid);
    ok('ส่งคำถามมาครบ 3 ข้อ', (active.body.form.questions || []).length === 3);
    const q = active.body.form.questions;

    console.log('');
    console.log('═══ 2. สิทธิ์ — ผลสรุปต้องเห็นได้เฉพาะผู้ดูแล ═══');

    ok('ผู้ใช้ทั่วไปดูรายการแบบประเมินไม่ได้',
       (await api('GET', '/forms', undefined, USER_B)).status === 403);
    ok('ผู้ใช้ทั่วไปดูผลสรุปไม่ได้',
       (await api('GET', '/forms/' + fid + '/summary', undefined, USER_B)).status === 403);
    ok('ผู้ใช้ทั่วไปดาวน์โหลดไฟล์ผลไม่ได้',
       (await api('GET', '/forms/' + fid + '/export', undefined, USER_B)).status === 403);
    ok('ผู้ใช้ทั่วไปสร้างแบบประเมินไม่ได้',
       (await api('POST', '/forms', { title: 'แอบสร้าง' }, USER_B)).status === 403);

    console.log('');
    console.log('═══ 3. ตอบใหม่ทับของเดิมได้ ═══');

    const first = await api('POST', '/respond', {
        answers: { [q[0].id]: 2, [q[2].id]: 'ตอนแรกว่ายาก' }
    }, USER_B);
    ok('ส่งคำตอบครั้งแรกได้', first.status === 200 && !!first.body.token);
    ok('ครั้งแรกไม่ใช่การแก้ของเดิม', first.body.updated === false);
    const token = first.body.token;

    const again = await api('POST', '/respond', {
        token: token,
        answers: { [q[0].id]: 5, [q[1].id]: 'แผนที่', [q[2].id]: 'ใช้ไปสักพักแล้วคล่องขึ้น' }
    }, USER_B);
    ok('ส่งซ้ำด้วยกุญแจเดิม ระบบบอกว่าเป็นการแก้', again.body.updated === true);
    ok('ได้กุญแจเดิมกลับมา ไม่ออกใบใหม่', again.body.token === token);

    const n1 = db.prepare('SELECT COUNT(*) n FROM feedback_responses WHERE form_id = ?').get(fid).n;
    ok('มีคำตอบแถวเดียว ไม่เพิ่มแถวใหม่', n1 === 1, n1 + ' แถว');

    const saved = JSON.parse(db.prepare('SELECT answers FROM feedback_responses WHERE form_id = ?').get(fid).answers);
    ok('คำตอบถูกทับด้วยของใหม่', saved[q[0].id] === 5, 'หน้ายิ้ม = ' + saved[q[0].id]);

    const mine = await api('GET', '/active?token=' + token, undefined, USER_B);
    ok('กลับมาเปิดใหม่ เห็นคำตอบเดิมของตัวเอง',
       mine.body.mine && mine.body.mine.answers[q[0].id] === 5);

    const stranger = await api('GET', '/active?token=ไม่ใช่กุญแจจริง', undefined, USER_C);
    ok('กุญแจผิด ไม่เห็นคำตอบของใคร', stranger.body.mine === null);

    console.log('');
    console.log('═══ 4. คำตอบต้องสืบย้อนกลับไปหาคนตอบไม่ได้ ═══');

    const cols = db.prepare('PRAGMA table_info(feedback_responses)').all().map(c => c.name);
    ok('ตารางคำตอบไม่มีคอลัมน์ที่บอกตัวตน',
       !cols.some(c => /user|email|name|ip/i.test(c)), cols.join(' · '));

    const marks = db.prepare('PRAGMA table_info(feedback_submitted)').all().map(c => c.name);
    ok('ตารางบันทึกผู้ตอบไม่มีคอลัมน์ชี้ไปหาคำตอบ',
       !marks.some(c => /response|answer|token/i.test(c)), marks.join(' · '));

    await api('POST', '/respond', { answers: { [q[0].id]: 4 } }, USER_C);
    const people = db.prepare('SELECT COUNT(*) n FROM feedback_submitted WHERE form_id = ?').get(fid).n;
    ok('นับจำนวนผู้ตอบได้ แม้ไม่รู้ว่าใครตอบว่าอะไร', people === 2, people + ' คน');

    console.log('');
    console.log('═══ 5. กันคำตอบเสีย ═══');

    const bad = await api('POST', '/respond', { answers: { [q[1].id]: 'แผนที่' } }, USER_C);
    ok('ไม่ตอบข้อบังคับ ถูกตีกลับพร้อมบอกว่าข้อไหน',
       bad.status === 400 && /ยังไม่ได้ตอบ/.test(bad.body.error || ''), bad.body && bad.body.error);

    const fake = await api('POST', '/respond', { answers: { [q[0].id]: 4, [q[1].id]: 'ยัดมาเอง' } }, USER_C);
    ok('ตัวเลือกที่ไม่มีในรายการ ถูกตีกลับ', fake.status === 400);

    console.log('');
    console.log('═══ 6. แดชบอร์ดผลสรุป ═══');

    const sum = await api('GET', '/forms/' + fid + '/summary', undefined, ADMIN);
    ok('ผู้ดูแลเปิดผลสรุปได้', sum.status === 200);
    ok('นับจำนวนคำตอบถูก', sum.body.responses === 2, sum.body.responses + ' ชุด');
    ok('บอกสัดส่วนผู้ตอบจากผู้ใช้ทั้งระบบ',
       sum.body.rate === 66.7, sum.body.people + '/' + sum.body.staff + ' = ' + sum.body.rate + '%');
    const fq = sum.body.questions.find(x => x.kind === 'face');
    ok('ค่าเฉลี่ยหน้ายิ้มถูกต้อง (5+4)/2 = 4.5', fq.average === 4.5, String(fq.average));

    const csv = await api('GET', '/forms/' + fid + '/export', undefined, ADMIN);
    ok('ดาวน์โหลดไฟล์ผลได้', csv.status === 200);
    ok('ไฟล์มี BOM นำหน้า เปิดใน Excel แล้วภาษาไทยไม่เพี้ยน', csv.text.charCodeAt(0) === 0xFEFF);
    ok('ไฟล์ไม่มีคอลัมน์ชื่อผู้ตอบ',
       !/อีเมล|ผู้ตอบ|ชื่อ/.test(csv.text.split('\n')[0]), csv.text.split('\n')[0].slice(1, 60));

    console.log('');
    console.log('═══ 7. เปิดได้ทีละชุด ═══');

    const second = await api('POST', '/forms', {
        title: 'รอบที่ 2', questions: [{ kind: 'yesno', title: 'ดีขึ้นไหม' }]
    }, ADMIN);
    await api('PUT', '/forms/' + second.body.id, { title: 'รอบที่ 2', status: 'open' }, ADMIN);
    const firstNow = db.prepare('SELECT status FROM feedback_forms WHERE id = ?').get(fid).status;
    ok('เปิดชุดใหม่แล้วชุดเก่าถูกปิดให้เอง', firstNow === 'closed', 'ชุดแรกเป็น ' + firstNow);

    const activeNow = await api('GET', '/active', undefined, USER_B);
    ok('ผู้ใช้เห็นชุดล่าสุดชุดเดียว', activeNow.body.form.id === second.body.id);

    console.log('');
    console.log('═══ 8. ลบแบบประเมิน ═══');

    await api('DELETE', '/forms/' + fid, undefined, ADMIN);
    ok('ลบแล้วคำตอบถูกลบตามไปด้วย ไม่ค้างเป็นขยะ',
       db.prepare('SELECT COUNT(*) n FROM feedback_responses WHERE form_id = ?').get(fid).n === 0);
    ok('บันทึกผู้ตอบถูกลบตามไปด้วย',
       db.prepare('SELECT COUNT(*) n FROM feedback_submitted WHERE form_id = ?').get(fid).n === 0);
} catch (e) {
    console.error('ทดสอบล้มเหลว:', e.message);
    results.push(false);
} finally {
    server.close();
    db.close();
    try { fs.rmSync(path.dirname(dbFile), { recursive: true, force: true }); } catch (_) {}
}

console.log('');
const pass = results.filter(Boolean).length;
console.log('สรุป ' + pass + '/' + results.length + (pass === results.length ? '  ผ่านทั้งหมด' : '  ยังไม่ผ่าน'));
process.exitCode = pass === results.length ? 0 : 1;
