// PDF ต้องออกมาเหมือนกันทุกครั้ง ไม่ว่าผู้ใช้จะเลื่อนหน้าประวัติลงไปไกลแค่ไหนก่อนกด
//
// 27 ต.ค. 2569 — ผู้ใช้หลายคนได้ PDF "หน้าตก": หน้าแรกว่างทั้งหน้า เนื้อหาเลื่อนลง
// ท้ายเอกสารล้นไปหัวหน้าถัดไป แผนที่ถูกตัดครึ่ง ในขณะที่เจ้าของงานกดใบเดียวกันแล้วปกติ
//
// ต้นเหตุ: html2pdf แปลงเอกสารทั้งชุดเป็นภาพยาวภาพเดียวแล้วหั่นเป็นหน้า A4
// ถ้าหน้าเว็บถูกเลื่อนลงอยู่ตอนกด ตัวแปลงเอาระยะที่เลื่อนไปเป็นระยะเยื้องของภาพ
// เอกสารทั้งชุดจึงเลื่อนลงตามระยะนั้น และทุกรอยหั่นหน้าผิดที่หมด
// จึง "ดูสุ่ม" เพราะขึ้นกับว่าแต่ละคนเลื่อนรายการลงไปกดแถวที่เท่าไหร่
//
// ทำไมชุดทดสอบเดิมไม่เคยจับได้: ทุกชุดสร้างเอกสารจากหน้าที่ไม่ได้เลื่อนเลย
// ชุดนี้จึง "กดปุ่ม PDF จริงในตารางประวัติ" หลังเลื่อนหน้าลงหลายระยะ
// แล้วรับไฟล์ที่ดาวน์โหลดได้จริงมาแกะดู ไม่ได้จำลองขั้นตอนเอง
//
// เกณฑ์: ทุกระยะเลื่อนต้องได้จำนวนหน้าเท่ากับตอนไม่เลื่อน
// และภาพของแต่ละหน้าต้องมีขนาดไฟล์ใกล้เคียงตอนไม่เลื่อน
// (ภาพ JPEG ที่เนื้อหาหายหรือว่างจะเล็กลงชัดเจน — ไม่เลื่อน 884 KB · เลื่อน 4,000 px เหลือ 42 KB)
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-pdf-scroll.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures-date-regression.json'), 'utf8'));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';
const NL = String.fromCharCode(10);

/** ระยะเลื่อนที่ผู้ใช้จริงเป็นไปได้ 0 = กดจากบนสุด · 4000 = รายการท้าย ๆ */
const SCROLLS = [0, 600, 1500, 4000];
/** ใบตัวอย่าง (ลบข้อมูลคนจริงแล้ว) ค่าเริ่มต้น 158 = สองเอกสาร มี Taxi หลายเที่ยวและแผนที่
    FIXTURE_ID=<id> เลือกใบอื่นจาก fixtures-date-regression.json ได้ ใช้ไล่ครบทุกหมวด */
const FID = parseInt(process.env.FIXTURE_ID || '158', 10);
const FX = FIXTURES.find(f => f.id === FID);
if (!FX) throw new Error('ไม่พบใบตัวอย่าง id=' + FID);

const results = [];
const ok = (n, pass, d = '') => { results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

const REC = JSON.parse(JSON.stringify(FX.rec));
REC.id = FID; REC.userId = 1; REC.createdAt = REC.createdAt || FX.createdAt;

const STUB = [
  "localStorage.setItem('token','x');",
  "const REC=" + JSON.stringify(REC) + ";",
  "const CATS=" + JSON.stringify([{ id: (REC.inputMetadata || {})._budgetCategoryId || 'TRAVEL001', name: 'หมวดทดสอบ',
    pdfTemplates: (REC.inputMetadata || {})._pdfTemplates || ['REPORT', 'TRANSPORT_RECEIPT'], fuelRate: 5, taxiMaxPerTrip: 750 }]) + ";",
  "const of=window.fetch;",
  "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
  "  const J=(o)=>Promise.resolve(new Response(JSON.stringify(o),{status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(s.indexOf('/auth/me')>=0) return J({id:1,email:'t@example.invalid',name:'t',role:'admin'});",
  "  if(s.indexOf('/settings')>=0) return J({fuelRate:5,taxiMaxPerTrip:750,positionList:[],affiliationList:[],activityList:[]});",
  "  if(s.indexOf('/budget-categories')>=0) return J(CATS);",
  "  if(s.indexOf('/expenses')>=0) return J([REC]);",
  "  if(s.indexOf('/profiles')>=0||s.indexOf('/feedback')>=0) return J([]);",
  "  return of(u,i);};"
].join(NL);

/** อ่าน PDF: จำนวนหน้า และขนาดไบต์ของภาพแต่ละหน้า */
function readPdf(file) {
  const buf = fs.readFileSync(file);
  const txt = buf.toString('latin1');
  const pages = (txt.match(/\/Type\s*\/Page[^s]/g) || []).length;
  const imgs = [];
  const re = /\/Subtype\s*\/Image[\s\S]*?\/Length\s+(\d+)/g;
  let m; while ((m = re.exec(txt))) imgs.push(+m[1]);
  return { bytes: buf.length, pages, imgs };
}

/** เปิด Chrome หนึ่งตัว เลื่อนหน้า กดปุ่ม PDF จริง แล้วรอไฟล์ดาวน์โหลด */
async function runAt(scroll, port, jiggle) {
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-pdfscroll-dl-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-pdfscroll-prof-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile, '--no-first-run', '--disable-gpu',
    '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
  let ws, id = 0; const pending = new Map(); const errors = [];
  const send = (mth, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: mth, params: p }));
    return new Promise((r, j) => pending.set(i, { r, j })); };
  const ev = async e => {
    const r = await send('Runtime.evaluate',
      { expression: '(async()=>{' + e + '})()', awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  try {
    let u;
    for (let i = 0; i < 100; i++) {
      try { const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
        const p = l.find(t => t.type === 'page'); if (p) { u = p.webSocketDebuggerUrl; break; } } catch {}
      await sleep(250);
    }
    if (!u) throw new Error('Chrome ไม่ขึ้น');
    ws = new WebSocket(u); await new Promise(r => ws.addEventListener('open', r));
    ws.addEventListener('message', e => { const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { const { r, j } = pending.get(m.id); pending.delete(m.id);
        m.error ? j(new Error(m.error.message)) : r(m.result); return; }
      if (m.method === 'Runtime.exceptionThrown')
        errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
    await send('Page.enable'); await send('Runtime.enable');
    await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
    /* ปิดภาพพื้นแผนที่ (tile) จาก OpenStreetMap ทุกรอบ ให้ผลแน่นอน
       tile โหลดทันบ้างไม่ทันบ้างตามเน็ต ภาพหน้าแผนที่จึงเปลี่ยนขนาดเองได้ 256-792 KB
       หมุด เส้นทาง และตำแหน่งในกรอบยังถูกวาดและถูกตรวจครบ */
    await send('Network.setBlockedURLs', { urls: ['*tile.openstreetmap.org*'] });
    await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
    await send('Page.navigate', { url: APP + '/history.html' });
    await sleep(6000);

    const before = await ev([
      "const btn=document.querySelector(\"button[onclick*=\\\"exportPDFById('" + FID + "')\\\"]\");",
      "if(!btn) return { found:false };",
      /* หน้าประวัติจริงมีรายการยาวเป็นร้อยแถว จำลองความยาวนั้นด้วยกล่องเปล่าท้ายหน้า */
      "const sp=document.createElement('div'); sp.style.height='7000px'; document.body.appendChild(sp);",
      "window.scrollTo(0," + scroll + "); await new Promise(r=>setTimeout(r,400));",
      "const y=window.scrollY; btn.click(); return { found:true, y:y };"
    ].join(NL));
    if (!before.found) throw new Error('ไม่พบปุ่ม PDF ในตาราง');

    /* jiggle = ผู้ใช้หมุนล้อเมาส์ / กด PageDown / End ระหว่างที่ระบบกำลังสร้าง PDF
       ส่งเป็นอินพุตจริงของเบราว์เซอร์ (ไม่ได้สั่ง scrollTo เอง) จึงเหมือนคนใช้งานจริง */
    const wheel = dy => send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 450, deltaX: 0, deltaY: dy });
    const key = (k, code, vk) => send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk })
      .then(() => send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }));
    let tick = 0;
    const jig = async () => {
      for (let i = 0; i < 6; i++) {
        tick++;
        if (tick % 5 === 0) await key('PageDown', 'PageDown', 34);
        else if (tick % 7 === 0) await key('End', 'End', 35);
        else await wheel(tick % 2 ? 1200 : -700);
        await sleep(160);
      }
    };

    // รอไฟล์ PDF ขึ้นในโฟลเดอร์ดาวน์โหลด และขนาดนิ่งแล้ว
    let file = null, last = -1;
    for (let i = 0; i < 180; i++) {
      const f = fs.readdirSync(dl).filter(n => n.endsWith('.pdf'));
      if (f.length) {
        const p = path.join(dl, f[0]); const sz = fs.statSync(p).size;
        if (sz > 0 && sz === last) { file = p; break; }
        last = sz;
      }
      if (jiggle) await jig(); else await sleep(1000);
    }
    if (!file) throw new Error('ไม่ได้ไฟล์ PDF ภายใน 3 นาที');
    await sleep(500);
    const after = await ev("return window.scrollY;");
    // หลังเสร็จ หน้าจอต้องกลับมาใช้งานได้: ไม่มีกล่องทับค้าง และเลื่อนด้วยล้อเมาส์ได้อีก
    const veilLeft = await ev("return document.querySelectorAll('[data-html2canvas-ignore][role=alert]').length;");
    const y0 = await ev("return window.scrollY;");
    // หมุนขึ้นถ้าไม่ได้อยู่บนสุด (อาจโดนเลื่อนจนสุดล่างไปแล้ว) ไม่งั้นหมุนลง
    await wheel(y0 > 0 ? -300 : 300); await sleep(500);
    const wheelWorks = (await ev("return window.scrollY;")) !== y0;


    /* หน้า "ตัวอย่างเอกสาร" วาดภาพแผนที่ด้วยตัวแปลงเดียวกัน จึงต้องตรวจด้วย
       เปิดหน้าใหม่ เลื่อนลงระยะเดิม กดดูตัวอย่าง แล้วเอาภาพแผนที่ในหน้าตัวอย่างมาเทียบ */
    await send('Page.navigate', { url: APP + '/history.html' });
    await sleep(6000);
    const pv = await ev([
      "const sp=document.createElement('div'); sp.style.height='7000px'; document.body.appendChild(sp);",
      "window.scrollTo(0," + scroll + "); await new Promise(r=>setTimeout(r,400));",
      "const y0=window.scrollY;",
      "await openDetailsModal('" + FID + "');",
      "for (let i=0;i<60;i++){ if(document.querySelector('#detailsContent .doc-preview')) break;",
      "  await new Promise(r=>setTimeout(r,500)); }",
      "const img=[...document.querySelectorAll('#detailsContent img')].find(i=>/^data:image/.test(i.src||''));",
      "return { y0:y0, y1:window.scrollY, map: img ? img.src : '' };"
    ].join(NL));
    // KEEP=<โฟลเดอร์> เก็บไฟล์ไว้ดูด้วยตา (ไม่ใส่ = ลบทิ้งตามปกติ)
    if (process.env.KEEP) { try { fs.copyFileSync(file, path.join(process.env.KEEP, 'scroll-' + scroll + '.pdf')); } catch (e) {} }
    return { scroll: before.y, after, pdf: readPdf(file), errors, pv, veilLeft, wheelWorks };
  } finally {
    try { ws.close(); } catch {} chrome.kill();
    await sleep(800);
    try { fs.rmSync(dl, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

try {
  console.log('ใบตัวอย่าง id=' + FID + ' · เอกสาร ' + JSON.stringify((REC.inputMetadata || {})._pdfTemplates || []) + ' · กดปุ่ม PDF จริงในตาราง');
  console.log('');
  const out = {};
  let port = 9731;
  for (const s of SCROLLS) {
    out[s] = await runAt(s, port++);
    const p = out[s].pdf;
    console.log('  เลื่อน ' + String(s).padStart(4) + ' px · ' + p.pages + ' หน้า · ' +
      (p.bytes / 1024).toFixed(0) + ' KB · ภาพแต่ละหน้า [' + p.imgs.map(b => (b / 1024).toFixed(0)).join(', ') + '] KB');
  }
  console.log('');

  const base = out[0].pdf;
  ok('ตอนไม่เลื่อน ได้ PDF ที่มีเนื้อหา (ฐานสำหรับเทียบ)', base.pages >= 1 && base.imgs.length >= 1,
     base.pages + ' หน้า');

  for (const s of SCROLLS.slice(1)) {
    const p = out[s].pdf;
    ok('เลื่อน ' + s + ' px ได้จำนวนหน้าเท่าตอนไม่เลื่อน', p.pages === base.pages,
       p.pages + ' หน้า (ควรเป็น ' + base.pages + ')');
    const worst = base.imgs.reduce((w, b, i) => {
      const d = Math.abs((p.imgs[i] || 0) - b) / b; return Math.max(w, d); }, 0);
    ok('เลื่อน ' + s + ' px ทุกหน้ามีเนื้อหาเท่าตอนไม่เลื่อน (ต่างกันไม่เกิน 5%)', worst <= 0.05,
       'ต่างสุด ' + (worst * 100).toFixed(1) + '%');
    ok('เลื่อน ' + s + ' px กดเสร็จแล้วหน้าเว็บกลับไปที่เดิมที่ผู้ใช้เลื่อนไว้',
       Math.abs(out[s].after - out[s].scroll) <= 2, 'ก่อน ' + out[s].scroll + ' หลัง ' + out[s].after);
  }

  console.log('');
  console.log('── หน้าตัวอย่างเอกสาร (ภาพแผนที่) ──');
  const pv0 = out[0].pv.map;
  // ใบที่ไม่มีแผนที่ (เช่นไม่ได้ปักหมุด) ไม่มีภาพให้เทียบ ตรวจแค่ว่าหน้ารายการไม่เลื่อน
  const hasMap = pv0.length > 1000;
  console.log('  ' + (hasMap ? 'มีภาพแผนที่ ' + (pv0.length / 1024).toFixed(0) + ' KB' : 'ใบนี้ไม่มีภาพแผนที่ในหน้าตัวอย่าง'));
  for (const sc of SCROLLS.slice(1)) {
    const m = out[sc].pv.map;
    if (hasMap) ok('เลื่อน ' + sc + ' px ภาพแผนที่ในหน้าตัวอย่างเหมือนตอนไม่เลื่อนทุกไบต์', m === pv0,
       m === pv0 ? 'เหมือน' : ('ต่าง ' + (m.length / 1024).toFixed(0) + ' KB vs ' + (pv0.length / 1024).toFixed(0) + ' KB'));
    ok('เลื่อน ' + sc + ' px เปิดตัวอย่างแล้วหน้ารายการยังอยู่ที่เดิม',
       Math.abs(out[sc].pv.y1 - out[sc].pv.y0) <= 2, 'ก่อน ' + out[sc].pv.y0 + ' หลัง ' + out[sc].pv.y1);
  }

  console.log('');
  console.log('── ผู้ใช้เลื่อนหน้าไปมาระหว่างที่ระบบกำลังสร้าง PDF ──');
  for (const s of [0, 1500]) {
    const r = await runAt(s, port++, true);
    out['jig' + s] = r;
    const p = r.pdf;
    console.log('  เริ่มที่ ' + s + ' px แล้วเลื่อนไปมา · ' + p.pages + ' หน้า · ภาพแต่ละหน้า [' + p.imgs.map(b => (b / 1024).toFixed(0)).join(', ') + '] KB');
    ok('กดที่ ' + s + ' px แล้วเลื่อนไปมาระหว่างสร้าง ได้จำนวนหน้าเท่าตอนปกติ', p.pages === base.pages,
       p.pages + ' หน้า (ควรเป็น ' + base.pages + ')');
    const worst = base.imgs.reduce((w, b, i) => Math.max(w, Math.abs((p.imgs[i] || 0) - b) / b), 0);
    ok('กดที่ ' + s + ' px แล้วเลื่อนไปมาระหว่างสร้าง ทุกหน้ามีเนื้อหาเท่าตอนปกติ (ต่างไม่เกิน 5%)', worst <= 0.05,
       'ต่างสุด ' + (worst * 100).toFixed(1) + '%');
    ok('กดที่ ' + s + ' px แล้วเลื่อนไปมา เสร็จแล้วไม่มีกล่องทับหน้าจอค้าง และล้อเมาส์เลื่อนหน้าได้ตามปกติ',
       r.veilLeft === 0 && r.wheelWorks, 'กล่องค้าง ' + r.veilLeft + ' · ล้อเมาส์ ' + (r.wheelWorks ? 'ใช้ได้' : 'ใช้ไม่ได้'));
  }

  const allErr = Object.values(out).flatMap(o => o.errors);
  ok('ไม่มี JavaScript error ตลอดการทดสอบ', allErr.length === 0, allErr.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
