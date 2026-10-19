// แนบไฟล์ PDF ได้ และต้องกลายเป็นภาพทุกหน้า
//
// 19 ต.ค. 2569 — เจ้าของงานขอ เพราะใบเสร็จโรงแรมกับตั๋วเครื่องบิน
// สมัยนี้ส่งมาเป็น PDF ไม่ใช่รูป
//
// กับดักที่ทำให้ "แค่เปลี่ยน accept" ไม่พอ:
// เอกสารที่พิมพ์ออกมาวาดไฟล์แนบเป็น <img> ทุกใบ (public/history.html:1377)
// ถ้าเก็บ PDF ดิบลงฐาน ตอนพิมพ์จะได้รูปแตก คนแนบนึกว่าเรียบร้อย
// แต่ผู้อนุมัติเปิดดูไม่เห็นหลักฐาน แย่กว่าแนบไม่ได้เสียอีก
//
// จึงแปลงเป็นภาพตั้งแต่ตอนแนบ ท่อหลังบ้านไม่ต้องแก้สักบรรทัด
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-pdf-attachment.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9602, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-pdfatt';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1400', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0; const pending = new Map(); const pageErrors = [];
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p }));
  return new Promise((r, j) => pending.set(i, { r, j })); };
const ev = async e => {
  const r = await send('Runtime.evaluate',
    { expression: '(async()=>{' + e + '})()', awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const results = [];
const ok = (n, pass, d = '') => { results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

/* สร้าง PDF จริงในหน้าเว็บ เขียนไบต์เอง ไม่พึ่งไลบรารีสร้าง
   จะได้แน่ใจว่าสิ่งที่ทดสอบคือ pdf.js อ่านไฟล์จริง ไม่ใช่ของปลอมที่เราป้อน */
const MAKE_PDF = `
function makePdf(nPages) {
  const enc = s => Array.from(s).map(c => c.charCodeAt(0));
  let objs = [], out = [];
  const pageIds = [];
  for (let i = 0; i < nPages; i++) pageIds.push(4 + i * 2);
  objs.push('1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj');
  objs.push('2 0 obj<</Type/Pages/Kids[' + pageIds.map(i => i + ' 0 R').join(' ')
            + ']/Count ' + nPages + '>>endobj');
  objs.push('3 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj');
  for (let i = 0; i < nPages; i++) {
    const pid = pageIds[i], cid = pid + 1;
    objs.push(pid + ' 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]'
      + '/Resources<</Font<</F1 3 0 R>>>>/Contents ' + cid + ' 0 R>>endobj');
    const txt = 'BT /F1 48 Tf 80 700 Td (PAGE ' + (i + 1) + ') Tj ET';
    objs.push(cid + ' 0 obj<</Length ' + txt.length + '>>stream\\n' + txt + '\\nendstream endobj');
  }
  let pdf = '%PDF-1.4\\n';
  const offsets = [0];
  for (const o of objs) { offsets.push(pdf.length); pdf += o + '\\n'; }
  const xref = pdf.length;
  pdf += 'xref\\n0 ' + (objs.length + 1) + '\\n0000000000 65535 f \\n';
  for (let i = 1; i <= objs.length; i++)
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \\n';
  pdf += 'trailer<</Size ' + (objs.length + 1) + '/Root 1 0 R>>\\nstartxref\\n' + xref + '\\n%%EOF';
  return new Uint8Array(enc(pdf));
}
function pdfFile(name, nPages) {
  return new File([makePdf(nPages)], name, { type: 'application/pdf' });
}
function pngFile(name) {
  const cv = document.createElement('canvas'); cv.width = 40; cv.height = 40;
  const cx = cv.getContext('2d'); cx.fillStyle = '#c00'; cx.fillRect(0, 0, 40, 40);
  const b = atob(cv.toDataURL('image/png').split(',')[1]);
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return new File([u], name, { type: 'image/png' });
}
`;

try {
  let u;
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(t => t.type === 'page'); if (p) { u = p.webSocketDebuggerUrl; break; } } catch {}
    await sleep(250);
  }
  ws = new WebSocket(u); await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { r, j } = pending.get(m.id); pending.delete(m.id);
      m.error ? j(new Error(m.error.message)) : r(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown')
      pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    "localStorage.setItem('token','x');",
    "const of=window.fetch;",
    "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if(s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'test',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify([{id:'TRAVEL002',name:'test',pdfTemplates:['REPORT','TRANSPORT_RECEIPT'],",
    // ต้องมี show:true ไม่งั้นช่องไม่ถูกสร้าง (expense.html: if (!r || !r.show) return)
    // และใส่ LOCATION ด้วย เพื่อให้ช่องแนบแผนที่โผล่มาให้เทียบว่ายังรับแค่รูป
    "      attachmentRules:{LOCATION:{show:true,required:false,label:'แผนที่'},",
    "                       RECEIPT:{show:true,required:false,label:'ใบเสร็จที่พัก'}},",
    "      attachmentOrder:['LOCATION','RECEIPT']}]),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i);};"
  ].join('\n') });
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(5000);

  console.log('═══ 1. ตัวอ่าน PDF ต้องโหลดขึ้นจริง ═══');
  const lib = await ev("return { pdfjs: typeof pdfjsLib !== 'undefined',"
    + " tag: !!document.querySelector('script[src*=\"pdf.min.js\"]'),"
    + " hasFn: typeof fileToImages === 'function' && typeof pdfToImages === 'function' };");
  ok('มีแท็ก <script> ของ pdf.js', lib.tag === true);
  ok('ตัวแปร pdfjsLib ใช้ได้จริง', lib.pdfjs === true);
  ok('มีฟังก์ชัน fileToImages และ pdfToImages', lib.hasFn === true);

  console.log('');
  console.log('═══ 2. ช่องแนบหลักฐานต้องรับ PDF ═══');
  const acc = await ev([
    "const s=document.getElementById('categorySelect');",
    "s.value='TRAVEL002'; s.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,1200));",
    "const g=document.querySelector('.general-file-upload');",
    "const m=document.getElementById('mapManualUpload');",
    "return { general: g ? g.accept : null, map: m ? m.accept : null,",
    "         hint: g ? (g.parentElement.querySelector('p')||{}).textContent : '' };"
  ].join('\n'));
  ok('ช่องหลักฐานทั่วไปรับ PDF', /pdf/i.test(acc.general || ''), acc.general);
  ok('ช่องแนบแผนที่ยังรับแค่รูป ตามที่ตกลงกัน',
     acc.map === 'image/*', acc.map);
  ok('มีข้อความบอกผู้ใช้ว่าแนบ PDF ได้',
     /PDF/.test(acc.hint || ''), (acc.hint || '').trim());

  console.log('');
  console.log('═══ 3. PDF 3 หน้า ต้องได้ภาพ 3 ภาพ ═══');
  const three = await ev([
    MAKE_PDF,
    "const imgs = await fileToImages(pdfFile('ใบเสร็จโรงแรม.pdf', 3));",
    "return { n: imgs.length, allJpeg: imgs.every(s => s.indexOf('data:image/jpeg') === 0),",
    "         sizes: imgs.map(s => Math.round(s.length/1024)) };"
  ].join('\n'));
  ok('ได้ภาพครบ 3 ภาพ จาก PDF 3 หน้า', three.n === 3, three.n + ' ภาพ');
  ok('ทุกภาพเป็น JPEG เข้าท่อเดิมได้เลย', three.allJpeg === true);
  ok('ทุกภาพมีเนื้อจริง ไม่ใช่ภาพเปล่า',
     three.sizes.every(k => k > 1), three.sizes.join(', ') + ' KB');

  console.log('');
  console.log('═══ 4. รูปธรรมดาต้องยังทำงานเหมือนเดิม ═══');
  const one = await ev([
    MAKE_PDF,
    "const imgs = await fileToImages(pngFile('receipt.png'));",
    "return { n: imgs.length, head: imgs[0] ? imgs[0].slice(0, 22) : '' };"
  ].join('\n'));
  ok('รูป 1 ไฟล์ = 1 ภาพเหมือนเดิม', one.n === 1, one.n + ' ภาพ');
  ok('ยังเป็น data URL ของรูปตามปกติ', /^data:image\//.test(one.head), one.head);

  console.log('');
  console.log('═══ 5. PDF เกิน 10 หน้า ต้องถามก่อน ไม่ตัดเงียบ ๆ ═══');
  const many = await ev([
    MAKE_PDF,
    "window.__asked = [];",
    "window.confirm = function (m) { window.__asked.push(String(m)); return false; };",
    "const imgs = await fileToImages(pdfFile('สแกนทั้งเล่ม.pdf', 14));",
    "return { n: imgs.length, asked: window.__asked };"
  ].join('\n'));
  ok('ถามผู้ใช้ก่อน และบอกจำนวนหน้าจริง',
     (many.asked || []).some(m => /14 หน้า/.test(m)),
     (many.asked || []).join(' | ').slice(0, 120) || '(ไม่ถาม)');
  ok('กด "ยกเลิก" = เอาแค่ 10 หน้าแรก', many.n === 10, many.n + ' ภาพ');

  const manyYes = await ev([
    MAKE_PDF,
    "window.confirm = function () { return true; };",
    "const imgs = await fileToImages(pdfFile('สแกนทั้งเล่ม.pdf', 14));",
    "return { n: imgs.length };"
  ].join('\n'));
  ok('กด "ตกลง" = เอาครบทั้ง 14 หน้า', manyYes.n === 14, manyYes.n + ' ภาพ');

  console.log('');
  console.log('═══ 6. ไฟล์เสีย ต้องบอก ไม่เก็บของพังลงฐาน ═══');
  const bad = await ev([
    "window.__alerts=[]; window.alert=function(m){window.__alerts.push(String(m));};",
    "const f = new File([new Uint8Array([1,2,3,4,5])], 'พัง.pdf', { type: 'application/pdf' });",
    "const imgs = await fileToImages(f);",
    "return { n: imgs.length, alerts: window.__alerts };"
  ].join('\n'));
  ok('ไม่เก็บไฟล์ที่อ่านไม่ได้ลงไป', bad.n === 0, bad.n + ' ภาพ');
  ok('เตือนผู้ใช้ว่าไฟล์นี้ไม่ถูกแนบ',
     (bad.alerts || []).some(a => /ไม่สำเร็จ/.test(a) && /ไม่ถูกแนบ/.test(a)),
     (bad.alerts || []).join(' | ').slice(0, 130) || '(ไม่เตือน)');

  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
