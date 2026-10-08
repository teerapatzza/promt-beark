// ตรวจการแปลงโดเมน UPN -> อีเมลจริง และลำดับการจับคู่ผู้ใช้
//
// ที่มา: 8 ต.ค. 2569 พนักงานชื่อ tippayarat เข้าระบบไม่ได้ ลอง 9 ครั้ง
// สาเหตุซ้อนกันสองชั้น
//   1. Entra ส่ง UPN (@hathailand.onmicrosoft.com) แทนอีเมลจริง (@ha.or.th)
//      เพราะบัญชีไม่ได้ตั้งช่อง Email — เป็นทั้งองค์กร ไม่ใช่รายคน
//   2. วันก่อนหน้าผมปิดการสร้างบัญชีอัตโนมัติไว้ คนที่ยังไม่มีบัญชีจึงเข้าไม่ได้เลย
//
// ชุดนี้ทดสอบกับฐานข้อมูลในหน่วยความจำ ไม่แตะของจริง
//
//   node scripts/test-ms-email-mapping.js
const Database = require('better-sqlite3');

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++;
  console.log((c ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

const PRIMARY_DOMAIN = 'ha.or.th';

/** สำเนาตรรกะจาก microsoft-auth.js — ถ้าแก้ที่โน่น ต้องแก้ที่นี่ด้วย */
function normalizeEmail(email, primary) {
  if (!primary) return email;
  const at = email.lastIndexOf('@');
  if (at < 1) return email;
  const local = email.slice(0, at), domain = email.slice(at + 1);
  if (!/\.onmicrosoft\.com$/.test(domain)) return email;
  return local + '@' + primary;
}

console.log('═══ 1. การแปลงโดเมน ═══');
ok('UPN onmicrosoft แปลงเป็นอีเมลองค์กร',
   normalizeEmail('tippayarat@hathailand.onmicrosoft.com', PRIMARY_DOMAIN) === 'tippayarat@ha.or.th');
ok('อีเมลองค์กรที่ถูกอยู่แล้ว ไม่ถูกแตะ',
   normalizeEmail('nualpan@ha.or.th', PRIMARY_DOMAIN) === 'nualpan@ha.or.th');
ok('โดเมนอื่นที่ไม่ใช่ onmicrosoft ไม่ถูกแตะ',
   normalizeEmail('someone@gmail.com', PRIMARY_DOMAIN) === 'someone@gmail.com');
ok('ชื่อที่มีจุดและขีด ยังแปลงถูก',
   normalizeEmail('ake-chittra@hathailand.onmicrosoft.com', PRIMARY_DOMAIN) === 'ake-chittra@ha.or.th');
ok('ถ้าไม่ตั้งค่าโดเมน จะไม่แปลงอะไรเลย',
   normalizeEmail('x@y.onmicrosoft.com', '') === 'x@y.onmicrosoft.com');
ok('ข้อความที่ไม่ใช่อีเมล ไม่ทำให้พัง',
   normalizeEmail('ไม่ใช่อีเมล', PRIMARY_DOMAIN) === 'ไม่ใช่อีเมล');

// ── ฐานข้อมูลจำลองตามของจริง ──
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user');
  CREATE TABLE user_aliases (
    email TEXT PRIMARY KEY COLLATE NOCASE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, note TEXT);
`);
const add = (e, r) => db.prepare('INSERT INTO users (email,password_hash,role) VALUES (?,?,?)').run(e, 'x', r || 'user');
add('teerapat@ha.or.th', 'admin');
add('nualpan@ha.or.th');
db.prepare('INSERT INTO user_aliases (email,user_id,note) VALUES (?,?,?)')
  .run('oldname@hathailand.onmicrosoft.com', 2, 'ชื่อหน้า @ ไม่ตรง แปลงโดเมนช่วยไม่ได้');

/** สำเนาลำดับการจับคู่จาก microsoft-auth.js */
function signIn(email, autoCreate) {
  const normalized = normalizeEmail(email, PRIMARY_DOMAIN);
  let user = db.prepare('SELECT id,email,role FROM users WHERE email = ?').get(email);
  let via = 'อีเมลตรงตัว';

  if (!user) {
    const a = db.prepare('SELECT u.id,u.email,u.role FROM user_aliases a JOIN users u ON u.id=a.user_id WHERE a.email = ?').get(email);
    if (a) { user = a; via = 'อีเมลสำรอง'; }
  }
  if (!user && normalized !== email) {
    const d = db.prepare('SELECT id,email,role FROM users WHERE email = ?').get(normalized);
    if (d) { user = d; via = 'แปลงโดเมน';
      db.prepare('INSERT OR IGNORE INTO user_aliases (email,user_id,note) VALUES (?,?,?)').run(email, d.id, 'อัตโนมัติ'); }
  }
  if (!user) {
    if (!autoCreate) return { user: null, via: 'ถูกปฏิเสธ' };
    const ins = db.prepare('INSERT INTO users (email,password_hash,role) VALUES (?,?,?)').run(normalized, 'x', 'user');
    user = { id: ins.lastInsertRowid, email: normalized, role: 'user' };
    via = 'สร้างใหม่';
  }
  return { user, via };
}

console.log('');
console.log('═══ 2. คนเดิมที่มีบัญชีอยู่แล้ว ต้องเข้าบัญชีตัวเอง ═══');
const r1 = signIn('teerapat@hathailand.onmicrosoft.com', true);
ok('เข้าบัญชีเดิม ไม่ใช่บัญชีใหม่', r1.user?.id === 1, 'id ' + r1.user?.id + ' ทาง ' + r1.via);
ok('สิทธิ์ admin ไม่ถูกลดเป็น user', r1.user?.role === 'admin', r1.user?.role);
ok('ไม่มีบัญชีงอกเพิ่ม', db.prepare('SELECT COUNT(*) c FROM users').get().c === 2);
ok('บันทึก UPN ไว้ให้ผู้ดูแลระบบเห็น',
   !!db.prepare('SELECT 1 FROM user_aliases WHERE email = ?').get('teerapat@hathailand.onmicrosoft.com'));

console.log('');
console.log('═══ 3. คนใหม่ที่ยังไม่มีบัญชี — เคสของ tippayarat ═══');
const r2 = signIn('tippayarat@hathailand.onmicrosoft.com', true);
ok('เข้าได้ ไม่ถูกปฏิเสธ', !!r2.user, r2.via);
ok('บัญชีที่สร้างใช้อีเมลองค์กร ไม่ใช่ UPN',
   r2.user?.email === 'tippayarat@ha.or.th', r2.user?.email);
ok('ได้สิทธิ์ user ตามปกติ ไม่ใช่ admin', r2.user?.role === 'user', r2.user?.role);
const again = signIn('tippayarat@hathailand.onmicrosoft.com', true);
ok('ล็อกอินซ้ำได้บัญชีเดิม ไม่สร้างซ้ำ', again.user?.id === r2.user?.id, 'id ' + again.user?.id);
ok('รวมผู้ใช้เพิ่มแค่ 1 คน', db.prepare('SELECT COUNT(*) c FROM users').get().c === 3);

console.log('');
console.log('═══ 4. อีเมลสำรองยังทำงาน สำหรับรายที่ชื่อหน้า @ ไม่ตรงกัน ═══');
const r3 = signIn('oldname@hathailand.onmicrosoft.com', true);
ok('เข้าบัญชีที่ผูกไว้ ไม่ไปสร้าง oldname@ha.or.th',
   r3.user?.id === 2 && r3.via === 'อีเมลสำรอง', 'id ' + r3.user?.id + ' ทาง ' + r3.via);

console.log('');
console.log('═══ 5. ความปลอดภัย — ต้องไม่พาใครเข้าบัญชีคนอื่น ═══');
const before = db.prepare('SELECT email FROM users WHERE id = 1').get().email;
signIn('teerapat@hathailand.onmicrosoft.com', true);
ok('ล็อกอินซ้ำไม่เปลี่ยนอีเมลบัญชีเดิม',
   db.prepare('SELECT email FROM users WHERE id = 1').get().email === before);
const r4 = signIn('nualpan@ha.or.th', true);
ok('คนที่อีเมลตรงตัวอยู่แล้ว ไม่โดนแปลงไปที่อื่น',
   r4.user?.id === 2 && r4.via === 'อีเมลตรงตัว', 'id ' + r4.user?.id);
// โดเมนอื่นต้องไม่ถูกแปลงมาชนกับพนักงาน
const r5 = signIn('teerapat@gmail.com', true);
ok('อีเมลโดเมนภายนอกไม่ถูกแปลงมาเข้าบัญชีพนักงานชื่อเดียวกัน',
   r5.user?.id !== 1, 'ได้ id ' + r5.user?.id + ' (' + r5.user?.email + ')');

console.log('');
console.log('══════════════════════════════════════');
console.log('  ผ่าน ' + pass + ' / ' + (pass + fail));
console.log('══════════════════════════════════════');
process.exit(fail ? 1 : 0);
