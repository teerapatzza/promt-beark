// ตรวจว่าการเรียกบริการแผนที่ทนการสะดุดได้จริง
// เรียกฟังก์ชันตัวเดียวกับที่ระบบใช้จริง ไม่ใช่โค้ดที่คัดลอกมา
//
// ที่มา: 22 ก.ย. 2569 ผู้ใช้เจอ "คำนวณไม่สำเร็จ: HTTP 502" ตอนลากหมุด
// ไล่ดูแล้วพบว่า Longdo สะดุดชั่วคราว คำขอแรกค้างจน nginx ตัดที่ 30 วินาที (504)
// คำขอถัดมาได้ 502 และโค้ดเดิมไม่ได้บันทึกสาเหตุไว้เลย จึงไล่ย้อนหลังไม่ได้
//
//   node scripts/test-longdo-resilience.js
const http = require('http');
const path = require('path');
const { longdoFetch, isTimeout } = require(path.join(__dirname, '..', 'backend', 'longdo-fetch'));

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++;
  console.log((c ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

// เซิร์ฟเวอร์จำลองปลายทาง: /ok ตอบปกติ  /hang ไม่ตอบเลย  /boom ตอบ 500
// /flaky ครั้งแรกพัง ครั้งที่สองสำเร็จ
let hits = 0, flakyHits = 0;
const srv = http.createServer((req, res) => {
  hits++;
  if (req.url === '/hang') return;                        // เงียบตลอดกาล
  if (req.url === '/boom') { res.writeHead(500); return res.end('boom'); }
  if (req.url === '/flaky') {
    flakyHits++;
    if (flakyHits === 1) { res.writeHead(503); return res.end('busy'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"recovered":true}');
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{"ok":true}');
});

srv.listen(0, '127.0.0.1', async () => {
  const B = 'http://127.0.0.1:' + srv.address().port;
  // ย่นเวลาลงเพื่อให้ชุดทดสอบจบไว พฤติกรรมที่ตรวจเป็นตัวเดียวกับของจริง
  const fast = { timeoutMs: 700, gapMs: 50, warn: () => {} };

  try {
    console.log('═══ 1. ปลายทางปกติ ═══');
    hits = 0;
    const a = await longdoFetch(B + '/ok', 'ปกติ', fast);
    ok('ได้ผลลัพธ์กลับมา', a && a.ok === true);
    ok('ยิงครั้งเดียวพอ ไม่ลองซ้ำโดยไม่จำเป็น', hits === 1, hits + ' ครั้ง');

    console.log('');
    console.log('═══ 2. ปลายทางค้าง — ต้องตัดเวลา ไม่รอจนกว่า nginx จะตัด ═══');
    hits = 0;
    const t0 = Date.now();
    let err = null;
    try { await longdoFetch(B + '/hang', 'ปลายทางค้าง', fast); } catch (e) { err = e; }
    const took = Date.now() - t0;
    ok('โยน error ออกมา ไม่เงียบหาย', !!err, err && err.name);
    ok('ตัดด้วยกำหนดเวลาจริง', isTimeout(err), err && err.name);
    ok('ไม่รอเกินสองรอบของกำหนดเวลา', took < 700 * 2 + 400, took + ' มิลลิวินาที');
    ok('ลองซ้ำครบสองครั้ง', hits === 2, hits + ' ครั้ง');

    console.log('');
    console.log('═══ 3. ปลายทางตอบว่าผิดพลาด ═══');
    hits = 0; err = null;
    try { await longdoFetch(B + '/boom', 'ปลายทางพัง', fast); } catch (e) { err = e; }
    ok('ถือว่าไม่สำเร็จ ไม่ส่งขยะต่อให้หน้าเว็บ', !!err, err && err.message);
    ok('บอกได้ว่าไม่ใช่การหมดเวลา', isTimeout(err) === false);
    ok('ลองซ้ำครบสองครั้ง', hits === 2, hits + ' ครั้ง');

    console.log('');
    console.log('═══ 4. สะดุดครั้งเดียว — ผู้ใช้ไม่ควรเห็นเลย ═══');
    flakyHits = 0;
    const b = await longdoFetch(B + '/flaky', 'สะดุดครั้งเดียว', fast);
    ok('ครั้งที่สองสำเร็จ และคืนผลลัพธ์ให้ตามปกติ', b && b.recovered === true);
    ok('ใช้ไปสองครั้งพอดี', flakyHits === 2, flakyHits + ' ครั้ง');
  } catch (e) {
    console.error('  ล้มเหลว:', e.message); fail++;
  }

  console.log('');
  console.log('══════════════════════════════════════');
  console.log('  ผ่าน ' + pass + ' / ' + (pass + fail));
  console.log('══════════════════════════════════════');
  srv.close();
  process.exit(fail ? 1 : 0);
});
