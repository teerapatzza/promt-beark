// ตรวจว่าอีเมลสำรองพาผู้ใช้กลับเข้าบัญชีเดิมได้จริง
//
// ที่มา: 7 ต.ค. 2569 ผู้ใช้ล็อกอิน M365 ด้วยบัญชีเดิม แต่โผล่เป็นคนใหม่
// บัญชี Entra ของเขาไม่ได้ตั้งช่อง Email ไว้ Microsoft จึงส่ง UPN มาแทน
//   teerapat@hathailand.onmicrosoft.com  แทน  teerapat@ha.or.th
// ระบบหาไม่เจอ แล้วเพราะเปิดสร้างบัญชีอัตโนมัติไว้ จึงสร้างบัญชีเปล่าให้เงียบ ๆ
// ผู้ใช้เข้ามาเห็นหน้าว่าง นึกว่าข้อมูล 16 ใบหายไป
//
// ชุดนี้ทดสอบตรรกะการจับคู่กับฐานข้อมูลในหน่วยความจำ ไม่แตะของจริง
//
//   node scripts/test-user-aliases.js
const Database = require('better-sqlite3');

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++;
  console.log((c ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE user_aliases (
    email TEXT PRIMARY KEY COLLATE NOCASE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
`);
db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?,?,?)")
  .run('teerapat@ha.or.th', 'x', 'admin');
db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?,?,?)")
  .run('somchai@ha.or.th', 'x', 'user');

/** ตรรกะเดียวกับใน microsoft-auth.js: หาอีเมลหลักก่อน แล้วค่อยหาอีเมลสำรอง */
function findUser(email) {
  let u = db.prepare('SELECT id, email, role FROM users WHERE email = ?').get(email);
  if (u) return { user: u, via: 'อีเมลหลัก' };
  u = db.prepare(
    'SELECT u.id, u.email, u.role FROM user_aliases a JOIN users u ON u.id = a.user_id WHERE a.email = ?'
  ).get(email);
  return u ? { user: u, via: 'อีเมลสำรอง' } : { user: null, via: null };
}

console.log('═══ 1. ยังไม่ผูกอีเมลสำรอง — ต้องหาไม่เจอ (จะได้ไม่สร้างบัญชีซ้ำ) ═══');
ok('UPN แบบ onmicrosoft หาไม่เจอ',
   findUser('teerapat@hathailand.onmicrosoft.com').user === null);
ok('อีเมลหลักยังหาเจอตามปกติ',
   findUser('teerapat@ha.or.th').user?.id === 1);

console.log('');
console.log('═══ 2. ผูกอีเมลสำรองแล้ว — ต้องเข้าบัญชีเดิม ═══');
db.prepare('INSERT INTO user_aliases (email, user_id) VALUES (?,?)')
  .run('teerapat@hathailand.onmicrosoft.com', 1);
const hit = findUser('teerapat@hathailand.onmicrosoft.com');
ok('UPN พาเข้าบัญชี id=1 ที่มีข้อมูลเดิม', hit.user?.id === 1, 'ได้ id ' + hit.user?.id);
ok('บอกได้ว่าเข้ามาทางอีเมลสำรอง', hit.via === 'อีเมลสำรอง', hit.via);
ok('สิทธิ์ยังเป็นของบัญชีเดิม ไม่ถูกลดเป็น user', hit.user?.role === 'admin', hit.user?.role);

console.log('');
console.log('═══ 3. ตัวพิมพ์เล็กใหญ่ไม่มีผล ═══');
ok('พิมพ์ใหญ่ก็ยังเข้าบัญชีเดิม',
   findUser('TEERAPAT@HATHAILAND.ONMICROSOFT.COM'.toLowerCase()).user?.id === 1);
db.prepare('INSERT INTO user_aliases (email, user_id) VALUES (?,?)').run('MiXeD@ha.or.th', 2);
ok('เก็บแบบพิมพ์ใหญ่ แต่ค้นด้วยพิมพ์เล็กก็เจอ', findUser('mixed@ha.or.th').user?.id === 2);

console.log('');
console.log('═══ 4. กันผูกซ้ำข้ามคน ═══');
let blocked = false;
try { db.prepare('INSERT INTO user_aliases (email, user_id) VALUES (?,?)')
        .run('teerapat@hathailand.onmicrosoft.com', 2); }
catch (e) { blocked = true; }
ok('อีเมลสำรองเดียวกันผูกสองคนไม่ได้', blocked);

console.log('');
console.log('═══ 5. ลบผู้ใช้แล้วอีเมลสำรองต้องหายตาม ไม่ค้างเป็นขยะ ═══');
db.pragma('foreign_keys = ON');
db.prepare('DELETE FROM users WHERE id = 2').run();
ok('อีเมลสำรองของคนที่ถูกลบ หายไปด้วย',
   db.prepare('SELECT COUNT(*) c FROM user_aliases WHERE user_id = 2').get().c === 0);
ok('อีเมลสำรองของคนอื่นไม่ถูกแตะ',
   db.prepare('SELECT COUNT(*) c FROM user_aliases WHERE user_id = 1').get().c === 1);

console.log('');
console.log('══════════════════════════════════════');
console.log('  ผ่าน ' + pass + ' / ' + (pass + fail));
console.log('══════════════════════════════════════');
process.exit(fail ? 1 : 0);
