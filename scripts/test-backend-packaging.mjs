// ไฟล์ที่ backend เรียกใช้ ต้องถูกใส่ลงอิมเมจจริงด้วย
//
// 16 ต.ค. 2569 — backend/validation.js เพิ่ม require('../public/metro-area.js')
// เพื่อให้กฎขอบเขตพื้นที่มีที่เดียว ใช้ร่วมกับหน้าเว็บ
// แต่ docker-compose ตั้ง build context เป็น ./backend ไฟล์ใน public/ จึงอยู่นอกขอบเขต
// COPY ไม่ถึง อิมเมจที่ได้จึงไม่มีไฟล์นั้น backend จะพังตั้งแต่เริ่มทำงาน
// ด้วย MODULE_NOT_FOUND ทั้งที่รันบนเครื่องพัฒนาแล้วผ่านทุกอย่าง
//
// เคสนี้เทสต์ปกติจับไม่ได้เลย เพราะบนเครื่องพัฒนาไฟล์อยู่ครบอยู่แล้ว
// ต้องจำลองว่าอิมเมจมีไฟล์อะไรบ้างตามที่ Dockerfile สั่ง แล้วลองเรียกจากตรงนั้น
//
//   node scripts/test-backend-packaging.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const results = [];
const ok = (name, pass, detail = '') => {
  results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + name + (detail ? '  -> ' + detail : ''));
};

console.log('═══ 1. อ่านว่า docker-compose สั่ง build backend ยังไง ═══');

const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
const backendBlock = compose.split(/^\s{2}\w[\w-]*:$/m)
  .find(b => /DB_PATH|PORT=3000/.test(b)) || compose;

// รองรับทั้งแบบย่อ (build: ./backend) และแบบเต็ม (context: / dockerfile:)
const short = backendBlock.match(/^\s*build:\s*(\S+)\s*$/m);
const ctxM  = backendBlock.match(/^\s*context:\s*(\S+)\s*$/m);
const dfM   = backendBlock.match(/^\s*dockerfile:\s*(\S+)\s*$/m);

const context    = short ? short[1] : (ctxM ? ctxM[1] : null);
const dockerfile = short ? path.posix.join(short[1], 'Dockerfile')
                         : (dfM ? dfM[1] : (ctxM ? path.posix.join(ctxM[1], 'Dockerfile') : null));

ok('หา build context ของ backend เจอ', !!context, 'context = ' + context);
ok('หา Dockerfile ของ backend เจอ', !!dockerfile && fs.existsSync(path.join(ROOT, dockerfile)),
   dockerfile);

const CTX = path.resolve(ROOT, context || '.');
const df  = fs.readFileSync(path.join(ROOT, dockerfile), 'utf8');

console.log('');
console.log('═══ 2. จำลองไฟล์ในอิมเมจตามที่ Dockerfile สั่ง ═══');

/** ขยาย * ตัวเดียวในชื่อไฟล์ ไม่ต้องรองรับ glob เต็มรูปแบบ Dockerfile นี้ใช้แค่นี้ */
function expand(srcPat) {
  const dir  = path.dirname(srcPat);
  const base = path.basename(srcPat);
  if (!base.includes('*')) {
    const p = path.resolve(CTX, srcPat);
    return fs.existsSync(p) ? [p] : [];
  }
  const abs = path.resolve(CTX, dir);
  if (!fs.existsSync(abs)) return [];
  const re = new RegExp('^' + base.split('*').map(s =>
    s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return fs.readdirSync(abs).filter(f => re.test(f)).map(f => path.join(abs, f));
}

const IMG = fs.mkdtempSync(path.join(os.tmpdir(), 'promberk-img-'));
let workdir = '/';
let copied = 0;

for (const raw of df.split(/\r?\n/)) {
  const line = raw.trim();
  if (/^WORKDIR\s/i.test(line)) { workdir = line.replace(/^WORKDIR\s+/i, '').trim(); continue; }
  if (!/^COPY\s/i.test(line)) continue;

  const parts = line.replace(/^COPY\s+/i, '').split(/\s+/).filter(Boolean);
  const dest = parts.pop();
  // ปลายทางที่ขึ้นต้นด้วย / คือ path สัมบูรณ์ในอิมเมจ ไม่งั้นอิงจาก WORKDIR
  const destAbs = dest.startsWith('/') ? dest : path.posix.join(workdir, dest);

  for (const srcPat of parts) {
    const files = expand(srcPat);
    if (!files.length) {
      // ไฟล์ที่ Dockerfile สั่งคัดลอก แต่หาไม่เจอใน context = build จะล้มทันที
      ok('COPY ' + srcPat + ' หาไฟล์ใน context เจอ', false, 'context = ' + CTX);
      continue;
    }
    for (const f of files) {
      // ปลายทางลงท้ายด้วย / หรือเป็นชื่อโฟลเดอร์ = เก็บชื่อไฟล์เดิม
      const asDir = dest.endsWith('/') || dest === '.' || dest === './' || files.length > 1;
      const target = path.join(IMG, asDir ? path.join(destAbs, path.basename(f)) : destAbs);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(f, target);
      copied++;
    }
  }
}

ok('คัดลอกไฟล์เข้าอิมเมจจำลองได้', copied > 0, copied + ' ไฟล์ · WORKDIR = ' + workdir);

console.log('');
console.log('═══ 3. ทุก require ที่ชี้ออกนอกโฟลเดอร์ backend ต้องมีไฟล์อยู่ในอิมเมจ ═══');

const appDir = path.join(IMG, workdir);
const srcFiles = fs.readdirSync(path.join(ROOT, 'backend'))
  .filter(f => f.endsWith('.js'));

let outward = 0;
for (const f of srcFiles) {
  const code = fs.readFileSync(path.join(ROOT, 'backend', f), 'utf8');
  for (const m of code.matchAll(/require\(\s*['"](\.\.\/[^'"]+)['"]\s*\)/g)) {
    outward++;
    const spec = m[1];
    // node หาไฟล์จากที่ตั้งของไฟล์ที่เรียก ซึ่งในอิมเมจคือ WORKDIR
    const want = path.resolve(appDir, spec);
    ok(f + ' เรียก ' + spec + ' แล้วเจอไฟล์ในอิมเมจ', fs.existsSync(want),
       want.replace(IMG, '<image>').replace(/\\/g, '/'));
  }
}
ok('มี require ที่ชี้ออกนอก backend ให้ตรวจจริง', outward > 0, outward + ' รายการ');

console.log('');
console.log('═══ 4. เรียก validation.js จากอิมเมจจำลองได้จริง ═══');

// เช็คแบบคงที่ยังไม่พอ ต้องให้ node เป็นคนหาไฟล์เองจริง ๆ
// validation.js ไม่ได้พึ่ง node_modules จึงเรียกจากอิมเมจจำลองได้ตรง ๆ
let V = null, err = null;
try {
  V = (await import(pathToFileURL(path.join(appDir, 'validation.js')).href)).default;
} catch (e) { err = e; }

ok('import validation.js จากอิมเมจไม่พัง', !!V && !err,
   err ? (err.code || '') + ' ' + err.message.split('\n')[0] : 'โหลดได้');

if (V) {
  const r = V.isMetroTrip({
    fromGeo: { lat: 13.8591, lng: 100.5217 },   // เมืองนนทบุรี
    toGeo:   { lat: 13.6591, lng: 100.5330 }    // พระประแดง
  });
  ok('ตัดสินพื้นที่จากอิมเมจได้ผลเหมือนบนเครื่องพัฒนา',
     r.inMetro === true && r.fromProvince === 'นนทบุรี', r.reason);
}

fs.rmSync(IMG, { recursive: true, force: true });

console.log('');
const pass = results.filter(Boolean).length;
console.log('สรุป ' + pass + '/' + results.length + (pass === results.length ? '  ผ่านทั้งหมด' : '  ยังไม่ผ่าน'));
process.exitCode = pass === results.length ? 0 : 1;
