// ตรวจสองเรื่องที่ผู้ใช้แจ้ง 21 ก.ย. 2569
//
//   1. ตัวหนังสือในช่อง "กิจกรรม" ซ้อนทับกันใน PDF
//      สาเหตุ: html2canvas วัดความกว้างรอบหนึ่ง แล้ววาดจริงอีกรอบ
//      ถ้าฟอนต์เปลี่ยนคั่นกลาง จุดตัดบรรทัดไม่ตรงกัน ข้อความชุดเดียวจึงถูกวาดสองแบบทับกัน
//      Google Fonts แบ่งไฟล์ตาม unicode-range และ document.fonts.load() แบบไม่ระบุข้อความ
//      จะโหลดมาแค่ชุดอักษรละติน ชุดอักษรไทยจึงมาไม่ทัน
//
//   2. กรอกค่าที่จอดรถ แต่เอกสารพิมพ์ออกมาเป็นค่าทางด่วน
//      สาเหตุ: ฟอร์มมีช่องรวม "ค่าทางด่วน/ที่จอดรถ" ช่องเดียว
//      ทั้งที่เอกสารมีสองบรรทัดแยกกัน
//
// รันกับเซิร์ฟเวอร์ไฟล์สถิตก็พอ ไม่ต้องใช้ backend
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-doc-overlap-and-parking.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9551, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-overlap';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0; const pending = new Map(); const pageErrors = [];
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p }));
  return new Promise((r, j) => pending.set(i, { r, j })); };
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: '(async()=>{' + e + '})()', awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const results = [];
const ok = (name, pass, detail = '') => { results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + name + (detail ? '  -> ' + detail : '')); };

// ชื่อกิจกรรมจริงจากใบที่ผู้ใช้ส่งภาพมา ยาว 158 ตัวอักษร
const LONG_ACT = 'การอบรมเชิงปฏิบัติการเพื่อพัฒนาระบบการดูแลผู้ป่วยด้วยมิติจิตวิญญาณ '
               + 'ในสถานพยาบาลเพื่อความปลอดภัย  โรงพยาบาลสมเด็จพระยุพราชด่านซ้าย จ.เลย วันที่ 11 กันยายน 2569';

const mkRecord = costs => ({
  id: 9001, requestedBy: 'ทดสอบ ซ้อนทับ', amount: 1385,
  category: 'TRAVEL001', date: '2026-09-11',
  inputMetadata: {
    _pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT'],
    _activityName: LONG_ACT, _extraActivities: [LONG_ACT],
    _position: 'ที่ปรึกษา', _affiliation: 'อิสระ', _docDate: '2026-09-11',
    _addr: { no: '15/10', soi: 'ซอย 17', road: 'พิชัยรณรงค์สงคราม',
             sub: 'ปากเพรียว', dist: 'เมืองสระบุรี', prov: 'สระบุรี', zip: '18000' },
    _travel: { startDate: '2026-09-10', endDate: '2026-09-12', from: 'สระบุรี', to: 'เลย' },
    _carType: 'ไป-กลับ', _costs: costs
  }
});
const BASE_COSTS = { hotelEntries: { name: 'โฮมสเตย์', entries: [{ type: 'พักเดี่ยว', rate: '590', nights: '1' }] },
                     fuelRate: '5', taxiEntries: [], airAmount: 0, otherAmount: 0 };

try {
  let u;
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(t => t.type === 'page'); if (p) { u = p.webSocketDebuggerUrl; break; } } catch {}
    await sleep(250);
  }
  ws = new WebSocket(u); await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { r, j } = pending.get(m.id); pending.delete(m.id);
      m.error ? j(new Error(m.error.message)) : r(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown')
      pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
  });
  await send('Page.enable'); await send('Runtime.enable');
  // ปิดแคชของเบราว์เซอร์ ไม่งั้นโปรไฟล์ที่ใช้ซ้ำจะเสิร์ฟไฟล์เก่าจากดิสก์
  // แล้วผลทดสอบจะเป็นของโค้ดรุ่นก่อนโดยไม่มีใครรู้
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    "localStorage.setItem('token','x');",
    "const of = window.fetch;",
    "window.fetch = function (u, i) {",
    "  const s = (typeof u === 'string') ? u : (u && u.url) || '';",
    "  if (s.indexOf('/auth/me') >= 0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
    "    {status:200, headers:{'Content-Type':'application/json'}}));",
    // หมวดจำลองที่ออกทั้งสองใบ ช่องค่าเดินทางจึงถูกแสดง",
    "  if (s.indexOf('/budget-categories') >= 0) return Promise.resolve(new Response(",
    "    JSON.stringify([{ id:'TRAVEL001', name:'ทดสอบ ออกทั้งสองใบ',",
    "      pdfTemplates:['REPORT','TRANSPORT_RECEIPT'], attachmentRules:{}, attachmentOrder:[] }]),",
    "    {status:200, headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/expenses') >= 0 || s.indexOf('/profiles') >= 0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u, i);",
    "};"
  ].join('\n') });

  // ═══ 1. ฟอนต์ ═══
  await send('Page.navigate', { url: APP + '/history.html' }); await sleep(5000);
  console.log('═══ 1. ต้องรอฟอนต์ให้ครบทุกชุดอักษร ก่อนแปลงเป็น PDF ═══');

  ok('มีฟังก์ชัน waitForDocumentFonts',
     await ev("return typeof waitForDocumentFonts === 'function';") === true);

  // ก่อนแทรกเอกสาร ชุดอักษรไทยของ Sarabun ยังไม่เคยถูกขอ
  // เพราะทั้งหน้าใช้ IBM Plex Sans Thai ไม่ใช่ Sarabun
  const bodyFont = await ev("return getComputedStyle(document.body).fontFamily;");
  ok('หน้าเว็บใช้คนละฟอนต์กับเอกสาร (จึงไม่มีใครโหลดชุดอักษรไทยของ Sarabun ให้)',
     bodyFont.indexOf('Sarabun') === -1, bodyFont);

  const oldWay = await ev([
    "await document.fonts.ready;",
    "await document.fonts.load('400 13.5px Sarabun');",   // แบบเดิม ไม่ส่งข้อความ
    "await document.fonts.load('700 13.5px Sarabun');",
    "return { la: document.fonts.check('400 13.5px Sarabun','A'),",
    "         th: document.fonts.check('400 13.5px Sarabun','ก') };"
  ].join('\n'));
  ok('วิธีเดิมได้ชุดอักษรละตินมา', oldWay.la === true);
  ok('วิธีเดิมไม่ได้ชุดอักษรไทย  <<< ต้นเหตุที่ตัวหนังสือซ้อนกัน',
     oldWay.th === false, 'ไทย=' + oldWay.th);

  const newWay = await ev([
    "const done = await waitForDocumentFonts();",
    "return { done: done, th: document.fonts.check('400 13.5px Sarabun','ก'),",
    "         thBold: document.fonts.check('700 13.5px Sarabun','ก') };"
  ].join('\n'));
  ok('วิธีใหม่ได้ชุดอักษรไทยครบทั้งปกติและตัวหนา',
     newWay.th === true && newWay.thBold === true && newWay.done === true,
     'ไทย=' + newWay.th + ' ไทยหนา=' + newWay.thBold);

  // ═══ 2. เนื้อความกิจกรรมต้องครบถ้วน ไม่หาย ไม่ถูกตัด ═══
  console.log('');
  console.log('═══ 2. ชื่อกิจกรรมยาว 158 ตัวอักษร ต้องออกมาครบทุกตัว ═══');
  const actCheck = await ev([
    "window.renderRouteMapImage = async () => null;",
    "const built = await buildDocumentHtml(" + JSON.stringify(mkRecord({ ...BASE_COSTS, tollAmount: '500' })) + ", function(){});",
    "const d = document.createElement('div'); d.innerHTML = built.html;",
    "const want = " + JSON.stringify(LONG_ACT) + ";",
    "const txt = d.textContent.replace(/\\s+/g,' ');",
    "const norm = want.replace(/\\s+/g,' ');",
    "let hits = 0, i = 0;",
    "while ((i = txt.indexOf(norm, i)) !== -1) { hits++; i += norm.length; }",
    "return { hits: hits, len: want.length };"
  ].join('\n'));
  ok('ชื่อกิจกรรมปรากฏครบถ้วน 2 ครั้ง (ช่องกิจกรรมหลัก + กิจกรรมเพิ่มเติม)',
     actCheck.hits === 2, 'พบ ' + actCheck.hits + ' ครั้ง จาก ' + actCheck.len + ' ตัวอักษร');

  // ═══ 3. ค่าที่จอดรถ ═══
  console.log('');
  console.log('═══ 3. ค่าที่จอดรถต้องลงบรรทัดของตัวเอง ไม่ใช่บรรทัดค่าทางด่วน ═══');
  const rows = await ev([
    "function readRows(costs) {",
    "  const d = document.createElement('div');",
    "  return buildDocumentHtml(costs, function(){}).then(function(b){",
    "    d.innerHTML = b.html;",
    "    const out = {};",
    "    d.querySelectorAll('tr').forEach(function(tr){",
    // คอลัมน์แรกเป็นช่องวันที่ ป้ายรายการอยู่คอลัมน์กลาง
    "      const td = tr.children.length >= 3 ? tr.children[1] : tr.children[0]; if (!td) return;",
    "      const label = (td.textContent||'').replace(/\\s+/g,' ').trim();",
    "      const last = tr.children[tr.children.length-1];",
    "      const amt = (last.textContent||'').replace(/\\s+/g,'').trim();",
    "      const mark = label.charAt(0);",
    "      const name = label.replace(/^[^\\u0E00-\\u0E7F]+/,'').trim();",
    "      if (name === 'ค่าทางด่วน')  out.toll    = { mark: mark, amt: amt };",
    "      if (name === 'ค่าที่จอดรถ') out.parking = { mark: mark, amt: amt };",
    "    });",
    "    return out;",
    "  });",
    "}",
    "const onlyToll    = await readRows(" + JSON.stringify(mkRecord({ ...BASE_COSTS, tollAmount: '500' })) + ");",
    "const onlyParking = await readRows(" + JSON.stringify(mkRecord({ ...BASE_COSTS, tollAmount: 0, parkingAmount: '120' })) + ");",
    "const both        = await readRows(" + JSON.stringify(mkRecord({ ...BASE_COSTS, tollAmount: '500', parkingAmount: '120' })) + ");",
    "return { onlyToll: onlyToll, onlyParking: onlyParking, both: both };"
  ].join('\n'));

  // เอกสารต้นแบบ FM-SAM-095-00 ใช้ช่องสี่เหลี่ยมกับประเภทค่าใช้จ่าย ส่วนวงกลมใช้กับทิศทาง
  const FILLED = '☑', EMPTY = '☐';
  ok('กรอกแต่ค่าทางด่วน: บรรทัดทางด่วนมียอด บรรทัดที่จอดรถว่าง',
     rows.onlyToll.toll.amt === '500.00' && rows.onlyToll.parking.amt === '',
     'ทางด่วน=' + rows.onlyToll.toll.amt + ' ที่จอดรถ=' + (rows.onlyToll.parking.amt || 'ว่าง'));
  ok('กรอกแต่ค่าที่จอดรถ: ยอดลงบรรทัดที่จอดรถ ไม่ไปโผล่บรรทัดทางด่วน',
     rows.onlyParking.parking.amt === '120.00' && rows.onlyParking.toll.amt === '',
     'ทางด่วน=' + (rows.onlyParking.toll.amt || 'ว่าง') + ' ที่จอดรถ=' + rows.onlyParking.parking.amt);
  ok('กรอกทั้งคู่: แยกกันถูกต้องทั้งสองบรรทัด',
     rows.both.toll.amt === '500.00' && rows.both.parking.amt === '120.00',
     'ทางด่วน=' + rows.both.toll.amt + ' ที่จอดรถ=' + rows.both.parking.amt);
  ok('ช่องหน้าบรรทัดถูกทำเครื่องหมายตามยอดที่กรอก',
     rows.onlyParking.parking.mark === FILLED && rows.onlyParking.toll.mark === EMPTY,
     'ที่จอดรถ=' + rows.onlyParking.parking.mark + ' ทางด่วน=' + rows.onlyParking.toll.mark);

  // ใบเก่าที่ไม่มีคีย์ parkingAmount ต้องออกมาเหมือนเดิมเป๊ะ
  const legacy = await ev([
    "window.renderRouteMapImage = async () => null;",
    "const a = await buildDocumentHtml(" + JSON.stringify(mkRecord({ ...BASE_COSTS, tollAmount: '500' })) + ", function(){});",
    "const b = await buildDocumentHtml(" + JSON.stringify(mkRecord({ ...BASE_COSTS, tollAmount: '500', parkingAmount: 0 })) + ", function(){});",
    "return a.html === b.html;"
  ].join('\n'));
  ok('ใบเก่าที่ไม่มีคีย์ค่าที่จอดรถ ให้ผลเหมือนใบที่ระบุ 0 เป๊ะ (ไม่กระทบของเดิม)', legacy === true);

  // ═══ 4. ฟอร์มกรอกได้จริง ═══
  console.log('');
  console.log('═══ 4. ช่องกรอกในฟอร์มต้องใช้งานได้ และรวมเข้ายอดรวม ═══');
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(4500);
  // ต้องเลือกหมวดก่อน ไม่งั้นกล่องค่าเดินทางยังถูกซ่อนอยู่ ช่องจะมีขนาด 0x0
  await ev([
    "const s = document.getElementById('categorySelect');",
    "s.value = 'TRAVEL001'; s.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r => setTimeout(r, 900)); return s.value;"
  ].join('\n'));
  const form = await ev([
    "const p = document.getElementById('parkingCost');",
    "if (!p) return { มีช่อง: false };",
    "const box = document.getElementById('costParkingBox');",
    "const lbl = box ? (box.querySelector('label')||{}).textContent : '';",
    "const r = p.getBoundingClientRect();",
    "const before = parseFloat((document.getElementById('totalAmount').dataset.value)||0);",
    "p.value = '120'; p.dispatchEvent(new Event('input',{bubbles:true}));",
    "const after = parseFloat((document.getElementById('totalAmount').dataset.value)||0);",
    "return { มีช่อง: true, ป้าย: (lbl||'').trim(), ปิดอยู่: p.disabled,",
    "         กว้าง: Math.round(r.width), สูง: Math.round(r.height),",
    "         ยอดก่อน: before, ยอดหลัง: after };"
  ].join('\n'));
  ok('มีช่อง "ค่าที่จอดรถ" ในฟอร์ม', form['มีช่อง'] === true, form['ป้าย'] || '');
  ok('ช่องกรอกได้ ไม่ถูกปิด และมีขนาดกดได้จริง',
     form['มีช่อง'] && !form['ปิดอยู่'] && form['กว้าง'] > 60 && form['สูง'] > 20,
     form['กว้าง'] + 'x' + form['สูง']);
  ok('กรอกแล้วยอดรวมเพิ่มขึ้นเท่าที่กรอก',
     form['มีช่อง'] && Math.round(form['ยอดหลัง'] - form['ยอดก่อน']) === 120,
     form['ยอดก่อน'] + ' -> ' + form['ยอดหลัง']);

  const saved = await ev([
    "const m = {};",
    "m.parkingAmount = document.getElementById('parkingCost')?.value || 0;",
    "return m.parkingAmount;"
  ].join('\n'));
  ok('ค่าที่กรอกอ่านกลับมาได้เพื่อบันทึก', String(saved) === '120', String(saved));

  // ═══ 5. เพดานความยาวชื่อกิจกรรม ═══
  // วัดมาแล้วว่าหน้าเอกสารเริ่มล้น A4 ที่ราว 250 ตัวอักษร จึงตั้งเพดานไว้ 200
  console.log('');
  console.log('═══ 5. ชื่อกิจกรรมต้องยาวได้ไม่เกินเพดานที่วัดมา ═══');
  const cap = await ev([
    "const a = document.getElementById('activityName');",
    "const box = document.getElementById('activityCounter');",
    "const set = v => { a.value = v; a.dispatchEvent(new Event('input',{bubbles:true})); };",
    "set('สั้น');            const shortHidden = box.className.indexOf('hidden') >= 0;",
    "set('ก'.repeat(160));   const warnShown  = box.className.indexOf('hidden') < 0;",
    "const warnText = box.textContent;",
    "a.value = ''; a.focus();",
    "if (typeof addExtraActivity === 'function') addExtraActivity();",
    "const extra = document.querySelector('.extra-act-text');",
    "return { max: a.getAttribute('maxlength'), shortHidden: shortHidden,",
    "         warnShown: warnShown, warnText: warnText.trim(),",
    "         extraMax: extra ? extra.getAttribute('maxlength') : null };"
  ].join('\n'));
  ok('ช่องกิจกรรมมีเพดาน 200 ตัวอักษร', cap.max === '200', 'maxlength=' + cap.max);
  ok('แถวกิจกรรมเพิ่มเติมมีเพดานเท่ากัน', cap.extraMax === '200', 'maxlength=' + cap.extraMax);
  ok('ข้อความสั้นไม่รบกวนด้วยตัวนับ', cap.shortHidden === true);
  ok('ใกล้เพดานแล้วขึ้นตัวนับเตือน', cap.warnShown === true, cap.warnText);

  // maxlength คุมเฉพาะการพิมพ์และการวางของผู้ใช้ ไม่คุมการกำหนดค่าด้วยสคริปต์
  // จึงต้องทดสอบด้วยการป้อนข้อความแบบเดียวกับที่ผู้ใช้ทำจริง
  await ev("const a=document.getElementById('activityName'); a.value=''; a.focus(); return 1;");
  await send('Input.insertText', { text: 'ก'.repeat(250) });
  const typed = await ev("return document.getElementById('activityName').value.length;");
  ok('วางข้อความ 250 ตัวอักษร ระบบรับไว้แค่ 200', typed === 200, 'ได้ ' + typed + ' ตัวอักษร');

  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) {
  console.error('ล้มเหลว:', e.message); process.exitCode = 2;
} finally { try { ws.close(); } catch {} chrome.kill(); }
