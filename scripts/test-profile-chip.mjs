// เลือกโปรไฟล์แล้วชื่อที่ลงเอกสารต้องเป็น "ชื่อเต็ม" ไม่ใช่ "ชื่อโปรไฟล์"
//
// ที่มา: 12 ต.ค. 2569 ย่อแถบเลือกโปรไฟล์ให้กระชับและเพิ่มป้ายบอกโปรไฟล์ที่เลือกอยู่
// สองค่านี้คนละอย่างกัน — profileName เป็นป้ายกำกับ (เช่น "ธีรภัทร (IT)")
// ส่วน fullName คือชื่อที่พิมพ์ลงเอกสารราชการ ถ้าสลับกันคือเอกสารผิด
//
//   cd public && python -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-profile-chip.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9593;
const PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-chip';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const pageErrors = [];
const send = (m, p = {}) => {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
  return new Promise((r, j) => pending.set(i, { r, j }));
};
const ev = async (e) => {
  const r = await send('Runtime.evaluate', {
    expression: '(async()=>{' + e + '})()', awaitPromise: true, returnByValue: true
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ผ่าน  ' + name); }
  else { fail++; console.log('ตก    ' + name + (detail !== undefined ? '  <-- ' + JSON.stringify(detail) : '')); }
};

// ตั้งใจให้ชื่อโปรไฟล์กับชื่อเต็ม "ต่างกันชัด ๆ" เพื่อจับการสลับค่า
const PROFILES = [
  { id: 1, profileName: 'ธีรภัทร (ไอที)', fullName: 'นายธีรภัทร ใจดี',
    position: 'นักวิเคราะห์ธุรกิจ', affiliation: 'ฝ่ายเทคโนโลยีสารสนเทศ',
    no: '1', road: 'สาทร', sub: 'ทุ่งมหาเมฆ', dist: 'สาทร', prov: 'กรุงเทพมหานคร', zip: '10120' },
  { id: 2, profileName: 'สมชาย (การเงิน)', fullName: 'นางสาวสมชาย รักงาน',
    position: 'นักบัญชี', affiliation: 'ฝ่ายการเงิน' }
];

const stub = [
  "localStorage.setItem('token','x');",
  "const of = window.fetch;",
  "window.fetch = function (u,i) { const s=(typeof u==='string')?u:(u&&u.url)||'';",
  "  if (s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if (s.indexOf('/profiles')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify(" + JSON.stringify(PROFILES) + "),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if (s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify([{ id:'DEMO', name:'ค่าใช้จ่ายที่เป็นเงินสด', fuelRate: 4,",
  "      pdfTemplates:['REPORT','TRANSPORT_RECEIPT'],",
  "      attachmentRules:{LOCATION:{show:true,required:true},RECEIPT:{show:true,required:false}},",
  "      attachmentOrder:['LOCATION','RECEIPT'] }]),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if (s.indexOf('/expenses')>=0)",
  "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
  "  return of(u,i); };",
  "window.routeLeg = async () => ({ km: 100, meters: 100000, coords: [] });"
].join('\n');

try {
  let u;
  for (let i = 0; i < 80; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(t => t.type === 'page');
      if (p) { u = p.webSocketDebuggerUrl; break; }
    } catch { /* ยังไม่พร้อม */ }
    await sleep(250);
  }
  ws = new WebSocket(u);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { r, j } = pending.get(m.id); pending.delete(m.id);
      m.error ? j(new Error(m.error.message)) : r(m.result); return;
    }
    if (m.method === 'Runtime.exceptionThrown')
      pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: stub });
  await send('Page.navigate', { url: APP + '/expense.html' });
  await sleep(4500);

  console.log('── ก่อนเลือกโปรไฟล์ ──');
  const before = await ev([
    "return { chipName: document.getElementById('pbProfileName')?.textContent.trim(),",
    "         chipAvatar: document.getElementById('pbProfileAvatar')?.textContent.trim(),",
    "         requestedBy: document.getElementById('requestedBy')?.value,",
    "         boxExists: !!document.getElementById('profileSelectorBox') };"
  ].join('\n'));
  check('มีแถบเลือกโปรไฟล์อยู่', before.boxExists === true, before);
  check('ป้ายบอกว่ายังไม่ได้เลือกโปรไฟล์', before.chipName === 'ยังไม่ได้เลือกโปรไฟล์', before.chipName);
  check('ช่องชื่อยังว่าง', (before.requestedBy || '') === '', before.requestedBy);

  console.log('');
  console.log('── เปิดรายการแล้วเลือกโปรไฟล์แรก ──');
  const picked = await ev([
    "document.getElementById('profileSearch').focus();",
    "openProfileDropdown();",
    "await new Promise(r=>setTimeout(r,300));",
    "const rows = [...document.querySelectorAll('#profileDropdown > div')];",
    "const target = rows.find(d => d.textContent.includes('ธีรภัทร (ไอที)'));",
    "if (!target) return { error: 'ไม่พบรายการโปรไฟล์ในรายการเลือก', rows: rows.length };",
    "target.click();",
    "await new Promise(r=>setTimeout(r,600));",
    "return { requestedBy: document.getElementById('requestedBy').value,",
    "         position:    document.getElementById('position').value,",
    "         affiliation: document.getElementById('affiliation').value,",
    "         searchBox:   document.getElementById('profileSearch').value,",
    "         chipName:    document.getElementById('pbProfileName').textContent.trim(),",
    "         chipAvatar:  document.getElementById('pbProfileAvatar').textContent.trim(),",
    "         dropdownHidden: document.getElementById('profileDropdown').classList.contains('hidden'),",
    "         clearBtnShown: !document.getElementById('profileClearBtn').classList.contains('hidden') };"
  ].join('\n'));

  if (picked.error) {
    check('เลือกโปรไฟล์จากรายการได้', false, picked);
  } else {
    check('ชื่อที่ลงเอกสารเป็น "ชื่อเต็ม" ไม่ใช่ชื่อโปรไฟล์',
          picked.requestedBy === 'นายธีรภัทร ใจดี', picked.requestedBy);
    check('ชื่อโปรไฟล์ไม่ได้หลุดไปอยู่ในช่องชื่อ',
          picked.requestedBy !== 'ธีรภัทร (ไอที)', picked.requestedBy);
    check('บทบาทถูกเติมจากโปรไฟล์', picked.position === 'นักวิเคราะห์ธุรกิจ', picked.position);
    check('สังกัดถูกเติมจากโปรไฟล์', picked.affiliation === 'ฝ่ายเทคโนโลยีสารสนเทศ', picked.affiliation);
    check('ช่องค้นหายังเก็บชื่อโปรไฟล์ไว้เหมือนเดิม',
          picked.searchBox === 'ธีรภัทร (ไอที)', picked.searchBox);
    check('ป้ายขึ้นชื่อเต็มของคนที่เลือก', picked.chipName === 'นายธีรภัทร ใจดี', picked.chipName);
    check('วงกลมย่อชื่อมีตัวอักษรขึ้น', (picked.chipAvatar || '').length > 0 && picked.chipAvatar !== '—',
          picked.chipAvatar);
    check('รายการเลือกถูกปิดหลังเลือก', picked.dropdownHidden === true, picked.dropdownHidden);
    check('ปุ่มล้างโผล่ขึ้นมา', picked.clearBtnShown === true, picked.clearBtnShown);
  }

  console.log('');
  console.log('── กดล้างโปรไฟล์ ──');
  const cleared = await ev([
    "clearProfileSelection();",
    "await new Promise(r=>setTimeout(r,300));",
    "return { requestedBy: document.getElementById('requestedBy').value,",
    "         searchBox:   document.getElementById('profileSearch').value,",
    "         chipName:    document.getElementById('pbProfileName').textContent.trim(),",
    "         chipAvatar:  document.getElementById('pbProfileAvatar').textContent.trim() };"
  ].join('\n'));
  check('ช่องค้นหาถูกล้าง', cleared.searchBox === '', cleared.searchBox);
  check('ป้ายกลับไปเป็นยังไม่ได้เลือก', cleared.chipName === 'ยังไม่ได้เลือกโปรไฟล์', cleared.chipName);
  check('วงกลมกลับเป็นขีด', cleared.chipAvatar === '—', cleared.chipAvatar);
  check('ชื่อที่กรอกไว้ "ไม่ถูกล้างทิ้ง" (พฤติกรรมเดิมของระบบ)',
        cleared.requestedBy === 'นายธีรภัทร ใจดี', cleared.requestedBy);

  console.log('');
  console.log('── เช็กลิสต์ข้างกล่องสรุป ──');
  const cl = await ev([
    "const box = document.getElementById('pbChecklist');",
    "return { exists: !!box, text: box ? box.textContent.replace(/\\s+/g,' ').trim() : '',",
    "         items: box ? box.querySelectorAll('button').length : 0 };"
  ].join('\n'));
  check('เช็กลิสต์แสดงครบ 4 รายการ', cl.items === 4, cl.items);
  check('เช็กลิสต์ขึ้นชื่อเต็ม ไม่ใช่ชื่อโปรไฟล์',
        cl.text.includes('นายธีรภัทร ใจดี') && !cl.text.includes('ธีรภัทร (ไอที)'), cl.text.slice(0, 160));

  check('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2));

} catch (e) {
  fail++;
  console.log('ล้มเหลว: ' + e.message);
} finally {
  try { ws && ws.close(); } catch { /* ปิดไปแล้ว */ }
  chrome.kill();
}

console.log('');
console.log('สรุป: ผ่าน ' + pass + '  ตก ' + fail);
process.exit(fail ? 1 : 0);
