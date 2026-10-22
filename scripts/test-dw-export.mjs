// ช่องส่งข้อมูลให้ HA Data Warehouse — ตรวจเส้นทาง API จริงกับฐานข้อมูลชั่วคราว
// ไม่แตะฐานข้อมูลของจริงแม้แต่น้อย สร้างไฟล์ใหม่ในโฟลเดอร์ชั่วคราวแล้วลบทิ้ง
//
// 22 ต.ค. 2569 — เจ้าของงานต้องการพิสูจน์ว่าแอปที่เขียนเองต่อกับ DW ได้
// พิสูจน์เรื่องการเชื่อมต่อไปแล้วด้วย /auth/config (DW ยิงมา 5 ครั้ง ได้ 200 ทุกครั้ง)
// แต่ Pipeline ค้างตอนเขียนลง Dataset เพราะเราคืนข้อมูลเป็น "ก้อนเดียว"
// ส่วน DW ออกแบบมารับ "หลายแถว" ช่องนี้จึงคืนเป็นอาร์เรย์ตั้งแต่ชั้นนอกสุด
//
// กติกาที่ชุดนี้คุมไว้ และห้ามหลุดไม่ว่าจะแก้อะไรต่อไป
//   1. ไม่มีข้อมูลส่วนบุคคลออกไปเลย — ไม่มีชื่อ ที่อยู่ พิกัดบ้าน อีเมล เลขที่ใบ
//   2. ไม่ตั้งกุญแจ = ปิดสนิท ไม่ใช่เปิดโล่ง (ปลอดภัยไว้ก่อนเป็นค่าตั้งต้น)
//   3. อ่านหมวดจาก inputMetadata._budgetCategoryId เท่านั้น
//      ห้ามใช้ projectId ซึ่งเป็นฟิลด์ตกค้าง เป็น null ทั้ง 126 ใบบนโปรดักชัน
//
//   node scripts/test-dw-export.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const brequire = createRequire(new URL('../backend/package.json', import.meta.url));

const express = brequire('express');
const dwExport = require('../backend/dw-export.js');

/* ใช้ SQLite ที่ติดมากับ Node แทน better-sqlite3 เหตุผลเดียวกับ test-feedback-api
   คือไม่ต้อง npm rebuild ให้ตรงรุ่น Node ของแต่ละเครื่องก่อนรันเทสต์ */
const { DatabaseSync } = require('node:sqlite');

const results = [];
const ok = (name, pass, detail = '') => {
    results.push(pass);
    console.log((pass ? '  ผ่าน  ' : '  ตก    ') + name + (detail ? '  -> ' + detail : ''));
};

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-dw-')), 'test.db');
const db = new DatabaseSync(dbFile);

db.exec(`
  CREATE TABLE expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL,
    created_at TEXT,
    user_id INTEGER
  );
  CREATE TABLE budget_categories (
    id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT, updated_at TEXT
  );
`);

/* ชื่อ ที่อยู่ และพิกัดในชุดทดสอบเป็นของสมมติล้วน
   จงใจใส่ให้ครบเพื่อพิสูจน์ว่า "ใส่เข้าไปแล้วมันต้องไม่หลุดออกมา" */
const SECRETS = {
    name: 'สมชาย ทดสอบ',
    email: 'somchai.test@example.invalid',
    addrNo: '99/1',
    lat: 13.6591,
    lng: 100.5330
};

const mkExpense = (catId, amount, createdAt, extra = {}) => JSON.stringify({
    // ฟิลด์ตกค้าง เป็น null ทั้งฐานข้อมูลจริง ถ้าโค้ดเผลอใช้ตัวนี้ หมวดจะกลายเป็น null ทั้งหมด
    projectId: null,
    requestedBy: SECRETS.name,
    description: 'กิจกรรมเยี่ยมสำรวจ',
    status: 'OBLIGATED',
    amount: amount,
    createdAt: createdAt,
    attachments: { images: [] },
    inputMetadata: {
        _budgetCategoryId: catId,
        _position: 'นักวิเคราะห์ธุรกิจ',
        _addr: { no: SECRETS.addrNo, soi: 'ทดสอบ 7', prov: 'สมุทรปราการ', zip: '10290' },
        _travel: { startDate: '2026-10-22', from: 'บ้าน', to: 'สนามบิน',
                   fromGeo: { lat: SECRETS.lat, lng: SECRETS.lng } },
        _costs: { taxiEntries: [] },
        ...extra
    }
});

const addCat = (id, name) => db.prepare(
    'INSERT INTO budget_categories (id, data) VALUES (?, ?)'
).run(id, JSON.stringify({ id, name }));

const addExp = (catId, amount, createdAt, extra) => db.prepare(
    'INSERT INTO expenses (data, created_at, user_id) VALUES (?, ?, ?)'
).run(mkExpense(catId, amount, createdAt, extra), createdAt, 1);

addCat('TRAVEL001', 'เบิกค่าเดินทาง+ที่พัก');
addCat('TRAVEL004', 'เบิกค่าพาหนะ');

// ตุลาคม TRAVEL001 สามใบ 100 + 250.50 + 49.50 = 400
addExp('TRAVEL001', 100,     '2026-10-02T03:00:00.000Z');
addExp('TRAVEL001', 250.5,   '2026-10-11T03:00:00.000Z');
addExp('TRAVEL001', '49.50', '2026-10-21T03:00:00.000Z');   // เก็บเป็นข้อความ ต้องรวมได้
// ตุลาคม TRAVEL004 หนึ่งใบ
addExp('TRAVEL004', 75,      '2026-10-05T03:00:00.000Z');
// กันยายน TRAVEL001 หนึ่งใบ — ต้องแยกคนละเดือน
addExp('TRAVEL001', 1000,    '2026-09-30T23:30:00.000Z');
// หมวดที่ถูกลบไปแล้ว ไม่มีใน budget_categories — ต้องยังขึ้น ไม่ใช่ทำพังทั้งก้อน
addExp('GONE999',   12,      '2026-10-07T03:00:00.000Z');

const KEY = 'test-key-9f3a';

/** ยิงคำขอจริงผ่าน express โดยไม่เปิดพอร์ต */
function serve(apiKey) {
    const app = express();
    app.use('/dw', dwExport({ db, apiKey }));
    return app;
}
async function call(app, headers = {}) {
    const server = app.listen(0);
    await new Promise(r => server.once('listening', r));
    const port = server.address().port;
    try {
        const res = await fetch('http://127.0.0.1:' + port + '/dw/expense-summary', { headers });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch (e) {}
        return { status: res.status, text, json };
    } finally { server.close(); }
}

try {
    console.log('═══ 1. ไม่ตั้งกุญแจ = ปิดสนิท ไม่ใช่เปิดโล่ง ═══');
    const off = await call(serve(''));
    ok('ตอบ 503 ไม่ใช่ 200', off.status === 503, String(off.status));
    ok('ไม่มีข้อมูลหลุดออกมาแม้แต่แถวเดียว',
       !Array.isArray(off.json), Array.isArray(off.json) ? 'หลุดเป็นอาร์เรย์' : 'ไม่หลุด');
    ok('บอกสาเหตุให้คนตั้งค่าเข้าใจ',
       typeof off.json?.error === 'string' && off.json.error.length > 0, off.json?.error || '-');

    console.log('');
    console.log('═══ 2. ด่านกุญแจ ═══');
    const app = serve(KEY);
    const noKey  = await call(app);
    const badKey = await call(app, { 'X-API-Key': 'wrong-key' });
    const shortKey = await call(app, { 'X-API-Key': 'x' });            // ยาวไม่เท่ากัน ต้องไม่พัง
    const longKey  = await call(app, { 'X-API-Key': KEY + 'extra' });
    ok('ไม่ส่งกุญแจ = 401', noKey.status === 401, String(noKey.status));
    ok('กุญแจผิด = 401', badKey.status === 401, String(badKey.status));
    ok('กุญแจสั้นกว่า = 401 และไม่ทำให้เซิร์ฟเวอร์พัง', shortKey.status === 401, String(shortKey.status));
    ok('กุญแจยาวกว่า = 401', longKey.status === 401, String(longKey.status));
    ok('กุญแจผิดแล้วไม่มีข้อมูลหลุด',
       !Array.isArray(badKey.json), Array.isArray(badKey.json) ? 'หลุด' : 'ไม่หลุด');

    console.log('');
    console.log('═══ 3. กุญแจถูก — รูปร่างข้อมูลต้องตรงกับที่ DW รับได้ ═══');
    const good = await call(app, { 'X-API-Key': KEY });
    ok('ตอบ 200', good.status === 200, String(good.status));
    ok('ชั้นนอกสุดเป็นอาร์เรย์ ไม่ใช่ก้อนเดียว (นี่คือจุดที่ Pipeline เคยค้าง)',
       Array.isArray(good.json), Array.isArray(good.json) ? 'อาร์เรย์' : typeof good.json);

    const rows = Array.isArray(good.json) ? good.json : [];
    ok('ได้ 4 แถว (ต.ค. 3 หมวด + ก.ย. 1 หมวด)', rows.length === 4, rows.length + ' แถว');

    const find = (cat, month) => rows.find(r => r.categoryId === cat && r.month === month);
    const oct1 = find('TRAVEL001', '2026-10');
    ok('ต.ค. TRAVEL001 นับได้ 3 ใบ', oct1?.claims === 3, String(oct1?.claims));
    ok('ต.ค. TRAVEL001 รวมได้ 400 บาท (ใบที่เก็บยอดเป็นข้อความต้องรวมด้วย)',
       oct1?.totalAmount === 400, String(oct1?.totalAmount));
    ok('ชื่อหมวดมาจากตาราง budget_categories',
       oct1?.categoryName === 'เบิกค่าเดินทาง+ที่พัก', oct1?.categoryName || '-');

    const sep1 = find('TRAVEL001', '2026-09');
    ok('ใบวันที่ 30 ก.ย. ไม่ถูกนับรวมเข้าเดือน ต.ค.',
       sep1?.claims === 1 && sep1?.totalAmount === 1000,
       'claims=' + sep1?.claims + ' total=' + sep1?.totalAmount);

    const gone = find('GONE999', '2026-10');
    ok('หมวดที่ถูกลบไปแล้วยังขึ้น ไม่ทำให้ทั้งก้อนพัง',
       !!gone && gone.claims === 1, gone ? 'ขึ้น' : 'หายไป');
    ok('หมวดที่ไม่รู้จักได้ชื่อว่าง ไม่ใช่ undefined หรือ null',
       gone?.categoryName === '', JSON.stringify(gone?.categoryName));

    ok('ทุกแถวมี generatedAt บอกว่าดึงเมื่อไหร่',
       rows.length > 0 && rows.every(r => typeof r.generatedAt === 'string' && r.generatedAt.length >= 20),
       rows[0]?.generatedAt || '-');

    console.log('');
    console.log('═══ 4. ลำดับต้องคงที่ ไม่งั้น DW เทียบข้อมูลแต่ละรอบไม่ได้ ═══');
    const again = await call(app, { 'X-API-Key': KEY });
    ok('เรียกซ้ำได้ลำดับเดิมเป๊ะ',
       JSON.stringify(rows.map(r => r.categoryId + '|' + r.month)) ===
       JSON.stringify((again.json || []).map(r => r.categoryId + '|' + r.month)),
       (again.json || []).map(r => r.categoryId + '|' + r.month).join(' '));
    ok('เรียงเดือนใหม่ไปเก่า',
       rows[0]?.month === '2026-10' && rows[rows.length - 1]?.month === '2026-09',
       rows.map(r => r.month).join(' '));

    console.log('');
    console.log('═══ 5. ข้อมูลส่วนบุคคลต้องไม่หลุดแม้แต่ตัวอักษรเดียว ═══');
    const body = good.text;
    ok('ไม่มีชื่อผู้เบิก', body.indexOf(SECRETS.name) === -1);
    ok('ไม่มีอีเมล', body.indexOf(SECRETS.email) === -1);
    ok('ไม่มีบ้านเลขที่', body.indexOf(SECRETS.addrNo) === -1);
    ok('ไม่มีพิกัดบ้าน',
       body.indexOf(String(SECRETS.lat)) === -1 && body.indexOf(String(SECRETS.lng)) === -1);
    ok('ไม่มีเลขที่ใบเบิกรายใบ', !/"id"\s*:/.test(body));
    ok('ไม่มีคำว่า requestedBy หรือ inputMetadata ติดไปด้วย',
       body.indexOf('requestedBy') === -1 && body.indexOf('inputMetadata') === -1);

    const keys = new Set();
    rows.forEach(r => Object.keys(r).forEach(k => keys.add(k)));
    const allowed = ['categoryId', 'categoryName', 'month', 'claims', 'totalAmount', 'generatedAt'];
    ok('มีเฉพาะคอลัมน์ที่อนุญาตไว้ ไม่มีอะไรงอกเพิ่ม',
       [...keys].every(k => allowed.includes(k)), [...keys].join(', '));

    console.log('');
    console.log('═══ 6. ห้ามอ่านหมวดจาก projectId ซึ่งเป็น null ทั้งฐานข้อมูลจริง ═══');
    ok('ไม่มีแถวไหนที่หมวดเป็น null หรือว่าง',
       rows.every(r => typeof r.categoryId === 'string' && r.categoryId.length > 0),
       rows.map(r => String(r.categoryId)).join(' '));

    console.log('');
    console.log('═══ 7. ฐานข้อมูลว่างต้องได้อาร์เรย์ว่าง ไม่ใช่พัง ═══');
    const emptyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pb-dw2-')), 'empty.db');
    const edb = new DatabaseSync(emptyFile);
    edb.exec('CREATE TABLE expenses (id INTEGER PRIMARY KEY, data TEXT, created_at TEXT, user_id INTEGER);'
           + 'CREATE TABLE budget_categories (id TEXT PRIMARY KEY, data TEXT, created_at TEXT, updated_at TEXT);');
    const eapp = express();
    eapp.use('/dw', dwExport({ db: edb, apiKey: KEY }));
    const empty = await call(eapp, { 'X-API-Key': KEY });
    ok('ตอบ 200 พร้อมอาร์เรย์ว่าง',
       empty.status === 200 && Array.isArray(empty.json) && empty.json.length === 0,
       empty.status + ' ' + empty.text.slice(0, 40));
    edb.close();

    console.log('');
    console.log('═══ 8. ช่องนี้อ่านอย่างเดียว เขียนอะไรกลับไม่ได้ ═══');
    const srv = app.listen(0);
    await new Promise(r => srv.once('listening', r));
    const port = srv.address().port;
    const post = await fetch('http://127.0.0.1:' + port + '/dw/expense-summary',
        { method: 'POST', headers: { 'X-API-Key': KEY } });
    const del = await fetch('http://127.0.0.1:' + port + '/dw/expense-summary',
        { method: 'DELETE', headers: { 'X-API-Key': KEY } });
    srv.close();
    ok('POST ไม่ผ่าน', post.status !== 200, String(post.status));
    ok('DELETE ไม่ผ่าน', del.status !== 200, String(del.status));

    const before = db.prepare('SELECT COUNT(*) c FROM expenses').get().c;
    ok('จำนวนใบเบิกในฐานข้อมูลไม่เปลี่ยนเลยตลอดการทดสอบ', before === 6, String(before));

    console.log('');
    console.log('══════════════════════════════════════════════════');
    console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
    console.log('══════════════════════════════════════════════════');
    process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) {
    console.error('ล้มเหลว:', e.message);
    process.exitCode = 2;
} finally {
    try { db.close(); } catch (e) {}
    try { fs.rmSync(path.dirname(dbFile), { recursive: true, force: true }); } catch (e) {}
}
