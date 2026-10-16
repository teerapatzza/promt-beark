// หน้าเว็บต้องใช้ขอบเขตพื้นที่ชุดเดียวกับ backend และต้องเขียนให้คนกรอกถูกช่อง
//
// 16 ต.ค. 2569 — สองเรื่องที่เทสต์นี้ล็อกไว้
//
// 1) ไฟล์ metro-area.js ต้องถูกโหลดในหน้าจริง
//    isMetroTripFE() เรียก MetroArea ตรง ๆ ถ้าลืมใส่ <script> ตัวแปรจะไม่มี
//    หน้าเว็บจะตกไปที่ทางสำรองแล้วบอกผู้ใช้ว่า "ในเขต" กับ "นอกเขต" ไม่ตรงกับที่
//    backend ตัดสินตอนกดบันทึก ผู้ใช้กรอกเสร็จแล้วค่อยเจอว่ายอดไม่ตรง
//
// 2) ข้อความของช่องปลายทาง
//    เดิมเขียนว่า "จุดหมาย" แล้วยกตัวอย่างเป็นโรงพยาบาลปลายทาง
//    เคสที่หักล้างคือ นั่งรถจากบ้านไปสนามบินดอนเมือง แล้วบินไปทำงานต่างจังหวัด
//    อ่านคำว่า "จุดหมาย" แล้วคนจะกรอกโรงพยาบาลปลายทาง ทั้งที่รถวิ่งแค่ถึงสนามบิน
//    ระยะทาง เขตพื้นที่ และเงินที่ได้ จะเพี้ยนทั้งใบโดยที่ไม่มีใครจับได้
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-metro-area-ui.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MetroAreaNode = require('../public/metro-area.js');

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9572, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-metroui';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1200', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0; const pending = new Map(); const pageErrors = [];
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p }));
  return new Promise((r, j) => pending.set(i, { r, j })); };
const ev = async e => {
  const r = await send('Runtime.evaluate',
    { expression: '(async()=>{' + e + '})()', awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const results = [];
const ok = (n, pass, d = '') => { results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

// จุดเดียวกับที่ชุด backend ใช้ คำตอบจริงมาจากการถามแผนที่ย้อนพิกัด ไม่ได้เดา
const POINTS = [
  ['วังน้อย',            14.1906, 100.7217],
  ['บางปะอิน',           14.1950, 100.5800],
  ['บ้านโป่ง',           13.8119,  99.9200],
  ['เมืองสมุทรสงคราม',   13.4600, 100.0000],
  ['บางปะกง',            13.5307, 100.9400],
  ['ศรีราชา',            13.1700, 100.9300],
  ['ดอนเมือง',           13.9126, 100.6068],
  ['พระประแดง',          13.6591, 100.5330],
  ['เมืองนนทบุรี',       13.8591, 100.5217],
  ['เมืองนครปฐม',        13.8196, 100.0620],
  ['สยามสแควร์',         13.7456, 100.5331],
  ['สนามบินสุวรรณภูมิ',  13.6900, 100.7501],
  ['เมืองสมุทรสาคร',     13.5475, 100.2745],
  ['เมืองปทุมธานี',      14.0208, 100.5250],
  ['เมืองอยุธยา',        14.3532, 100.5689],
  ['หัวหิน',             12.5684,  99.9577],
];

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
  // ปิดแคช ไม่งั้นโปรไฟล์ที่ใช้ซ้ำจะเสิร์ฟไฟล์เก่าจากดิสก์ แล้ววัดโค้ดรุ่นก่อนโดยไม่รู้ตัว
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    "localStorage.setItem('token','x');",
    "const of = window.fetch;",
    "window.fetch = function (u,i) { const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if (s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify([{ id:'TRAVEL002', name:'ทดสอบ', pdfTemplates:['REPORT','TRANSPORT_RECEIPT'],",
    "      attachmentRules:{}, attachmentOrder:[] }]),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i); };"
  ].join('\n') });

  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(4500);

  console.log('═══ 1. หน้าเว็บต้องโหลดไฟล์ขอบเขตจริง ═══');

  const loaded = await ev([
    "return { has: typeof MetroArea !== 'undefined',",
    "         tag: !!document.querySelector('script[src*=\"metro-area\"]'),",
    "         provs: (typeof MetroArea !== 'undefined') ? MetroArea.provinces() : [] };"
  ].join('\n'));
  ok('หน้า expense.html มีแท็ก <script src=metro-area.js>', loaded.tag === true);
  ok('ตัวแปร MetroArea ใช้ได้จริงบนหน้าเว็บ', loaded.has === true);
  ok('มีครบหกจังหวัดตามประกาศ',
     loaded.provs.length === 6 && loaded.provs.includes('กรุงเทพมหานคร')
     && loaded.provs.includes('นครปฐม'), loaded.provs.join(' · '));

  console.log('');
  console.log('═══ 2. หน้าเว็บกับ backend ต้องตัดสินตรงกันทุกจุด ═══');

  /* ถ้าสองฝั่งอ่านคนละไฟล์หรือไฟล์ต่างรุ่น ตรงนี้จะโผล่ออกมาทันที
     เคยมีกฎที่เขียนไว้สองที่แล้วตัดสินไม่ตรงกันมาแล้ว จึงต้องเทียบทุกจุด */
  // ถ้าหน้าเว็บไม่มีโมดูล อย่าโยน error ทิ้งทั้งชุด ให้บันทึกว่าตกแล้วตรวจข้ออื่นต่อ
  const fe = await ev("return (typeof MetroArea === 'undefined') ? null : "
    + JSON.stringify(POINTS) + ".map(p => MetroArea.provinceAt(p[1], p[2]));");
  let same = 0; const diff = [];
  if (fe) POINTS.forEach((p, i) => {
    const node = MetroAreaNode.provinceAt(p[1], p[2]);
    if (node === fe[i]) same++; else diff.push(p[0] + ': เว็บ=' + fe[i] + ' backend=' + node);
  });
  ok('ทั้ง ' + POINTS.length + ' จุด หน้าเว็บตอบเหมือน backend ทุกจุด',
     !!fe && same === POINTS.length,
     fe ? (diff.join(' | ') || 'ตรงกันหมด') : 'หน้าเว็บไม่มี MetroArea ให้เทียบ');

  console.log('');
  console.log('═══ 3. isMetroTripFE ต้องอ่านจากหมุด และบอกชื่อจังหวัด ═══');

  const inMetro = await ev([
    "geoFrom = { lat: 13.8591, lng: 100.5217 };",   // เมืองนนทบุรี
    "geoTo   = { lat: 13.6591, lng: 100.5330 };",   // พระประแดง
    "return isMetroTripFE();"
  ].join('\n'));
  ok('นนทบุรี → พระประแดง = ในเขต', inMetro.inMetro === true, inMetro.why);
  ok('บอกชื่อจังหวัดของทั้งสองหมุด',
     inMetro.fromProvince === 'นนทบุรี' && inMetro.toProvince === 'สมุทรปราการ',
     inMetro.fromProvince + ' → ' + inMetro.toProvince);

  // จุดที่กล่องสี่เหลี่ยมเดิมตัดสินผิด ตอนนี้ต้องเป็นนอกเขต
  const edge = await ev([
    "geoFrom = { lat: 13.7456, lng: 100.5331 };",   // สยามสแควร์
    "geoTo   = { lat: 13.5307, lng: 100.9400 };",   // บางปะกง ฉะเชิงเทรา
    "return isMetroTripFE();"
  ].join('\n'));
  ok('สยามสแควร์ → บางปะกง = นอกเขต (กล่องเดิมตัดสินผิดจุดนี้)',
     edge.inMetro === false && edge.toProvince === null, edge.why);

  console.log('');
  console.log('═══ 4. ป้ายวงเงิน Taxi ต้องบอกจังหวัดที่อ่านได้จากหมุด ═══');

  const note = await ev([
    "geoFrom = { lat: 13.8591, lng: 100.5217 };",
    "geoTo   = { lat: 13.6591, lng: 100.5330 };",
    "taxiCapCategory = 750;",
    "recomputeTaxiCap();",
    "await new Promise(r=>setTimeout(r,200));",
    "const n = document.getElementById('taxiCapNote');",
    "return { hidden: n.classList.contains('hidden'), text: n.textContent };"
  ].join('\n'));
  ok('ป้ายวงเงินขึ้นมาและบอกชื่อจังหวัดทั้งสองฝั่ง',
     note.hidden === false && /นนทบุรี/.test(note.text) && /สมุทรปราการ/.test(note.text),
     note.text.trim().slice(0, 120));

  console.log('');
  console.log('═══ 5. ข้อความช่องปลายทาง ต้องไม่ชวนให้กรอกจังหวัดปลายทางของงาน ═══');

  const words = await ev([
    "const inp = document.getElementById('travelTo');",
    "const lab = inp.closest('div').parentElement.querySelector('label');",
    "const hint = document.getElementById('toHint');",
    "return { label: (lab && lab.textContent || '').trim(),",
    "         ph: inp.placeholder, hint: (hint.textContent || '').trim(),",
    "         route: (document.getElementById('legOutRouteTitle').parentElement.textContent || '').trim() };"
  ].join('\n'));

  ok('ป้ายช่องบอกว่าเป็นจุดที่รถไปส่ง ไม่ใช่คำว่า "จุดหมาย" ลอย ๆ',
     /จุดที่รถไปส่ง/.test(words.label) && !/^จุดหมาย/.test(words.label), words.label);
  ok('ตัวอย่างในช่องเลิกยกโรงพยาบาลปลายทางเป็นตัวอย่างเดียว',
     !/รพ\.สต\.บ้านหนองบัว/.test(words.ph), words.ph);
  ok('ตัวอย่างในช่องยกสนามบินขึ้นมาให้เห็น', /สนามบิน/.test(words.ph), words.ph);
  ok('คำอธิบายบอกให้ใส่สนามบิน/สถานีขนส่งเมื่อไปต่อด้วยพาหนะอื่น',
     /สนามบิน/.test(words.hint) && /สถานีขนส่ง/.test(words.hint), words.hint);
  ok('คำอธิบายบอกตรง ๆ ว่าไม่ใช่จังหวัดที่ไปปฏิบัติงาน',
     /ไม่ใช่จังหวัดที่ไปปฏิบัติงาน/.test(words.hint), words.hint);
  ok('หัวข้อเส้นทางบอกว่าใช้สองหมุดนี้ตัดสินเขตพื้นที่',
     /รถวิ่งจริง/.test(words.route) && /ปริมณฑล/.test(words.route),
     words.route.replace(/\s+/g, ' ').slice(0, 140));

  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
