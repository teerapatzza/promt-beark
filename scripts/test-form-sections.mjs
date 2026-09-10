// ตรวจว่าฟอร์มขอเบิกแสดง/ซ่อนส่วนต่าง ๆ ตรงกับเอกสารที่หมวดนั้นออกจริง
// ขับเบราว์เซอร์จริงบน stack ในเครื่อง (localhost:8080) ไม่แตะ production
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9412, PROFILE = path.join(process.env.TEMP, 'pb-sections');
const APP = 'http://localhost:8080';

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio:'ignore' });

let ws, id = 0; const pending = new Map(); const errors = [];
const send = (m, p={}) => { const i = ++id; ws.send(JSON.stringify({ id:i, method:m, params:p }));
  return new Promise((r,j) => pending.set(i, { r, j })); };
const ev = async e => {
  const res = await send('Runtime.evaluate', { expression:`(async()=>{${e}})()`, awaitPromise:true, returnByValue:true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  return res.result?.value;
};

const results = [];
const check = (n, ok, d='') => { results.push({n, ok}); console.log((ok?'  PASS  ':'  FAIL  ')+n+(d?'  → '+d:'')); };

// หมวด → ส่วนที่ควรเห็น / ไม่ควรเห็น  (อ้างจากช่องที่มีอยู่จริงบนกระดาษแต่ละใบ)
const EXPECT = [
  { id:'TRAVEL003', name:'ใบรายงานค่าที่พัก  [REPORT]',
    show:['travelTimeBox','costHotelBox','costAirBox','addressSection'],
    hide:['travelDetailsBox','costTaxiBox','extraEntriesBox'] },
  { id:'TRAVEL004', name:'ใบรับรองค่าพาหนะ  [TRANSPORT_RECEIPT]',
    show:['travelDetailsBox','costTaxiBox','extraEntriesBox','addressSection'],
    hide:['travelTimeBox','costHotelBox','costAirBox'] },
  { id:'TRAVEL001', name:'เบิกค่าเดินทาง+ที่พัก  [REPORT + TRANSPORT_RECEIPT]',
    show:['travelTimeBox','costHotelBox','costAirBox','travelDetailsBox','costTaxiBox','extraEntriesBox'],
    hide:[] },
];
const LABEL = {
  travelDetailsBox:'แผนที่ + ระยะทาง', costTaxiBox:'ค่า Taxi', extraEntriesBox:'กิจกรรมเพิ่มเติม',
  travelTimeBox:'วัน-เวลาเดินทาง', costHotelBox:'ค่าที่พัก', costAirBox:'ค่าตั๋วเครื่องบิน',
  addressSection:'ที่อยู่ผู้เดินทาง',
};

try {
  let u;
  for (let i=0;i<60;i++){ try{ const l=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const p=l.find(t=>t.type==='page'); if(p){u=p.webSocketDebuggerUrl;break;} }catch{} await sleep(250); }
  ws = new WebSocket(u); await new Promise(r=>ws.addEventListener('open',r));
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const {r,j}=pending.get(m.id); pending.delete(m.id);
      m.error ? j(new Error(m.error.message)) : r(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown')
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog',{accept:true});
  });
  await send('Page.enable'); await send('Runtime.enable');

  // สมัคร/ล็อกอินเพื่อให้มี token
  const cred = { email:'tester@ha.or.th', password:'testpass123' };
  let tok = await fetch(APP+'/auth/register', { method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify(cred) }).then(r=>r.json()).then(j=>j.token).catch(()=>null);
  if (!tok) tok = await fetch(APP+'/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify(cred) }).then(r=>r.json()).then(j=>j.token);
  if (!tok) throw new Error('ล็อกอินไม่ได้');
  console.log('ล็อกอินสำเร็จ\n');

  await send('Page.navigate', { url: APP+'/login.html' }); await sleep(1500);
  await ev(`localStorage.setItem('token', ${JSON.stringify(tok)}); return 1`);
  await send('Page.navigate', { url: APP+'/expense.html' }); await sleep(4000);

  const ready = await ev(`return !!document.getElementById('categorySelect') || !!document.querySelector('[id*=categor i]')`);
  const selId = await ev(`
    const cands=[...document.querySelectorAll('select')].map(s=>s.id).filter(Boolean);
    return JSON.stringify(cands);`);
  console.log('  select ที่มีในหน้า: ' + selId + '\n');

  for (const c of EXPECT) {
    console.log('═══ ' + c.name + ' ═══');
    const picked = await ev(`
      const sel=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value===${JSON.stringify(c.id)}));
      if(!sel) return 'ไม่พบ dropdown หมวด';
      sel.value=${JSON.stringify(c.id)};
      sel.dispatchEvent(new Event('change',{bubbles:true}));
      return sel.id||'(ไม่มี id)';`);
    if (String(picked).startsWith('ไม่พบ')) { check('เลือกหมวดได้', false, picked); continue; }
    await sleep(900);

    const vis = await ev(`
      const out={};
      ${JSON.stringify([...c.show, ...c.hide])}.forEach(id=>{
        const el=document.getElementById(id);
        out[id] = !el ? 'ไม่มี element' : (el.getClientRects().length ? 'เห็น' : 'ซ่อน');
      });
      return JSON.stringify(out);`);
    const V = JSON.parse(vis);
    for (const id of c.show) check('  ต้องเห็น  ' + (LABEL[id]||id), V[id]==='เห็น', V[id]);
    for (const id of c.hide) check('  ต้องซ่อน  ' + (LABEL[id]||id), V[id]==='ซ่อน', V[id]);
  }

  console.log('\n═══ เงินต้องไม่มาจากช่องที่ซ่อนอยู่ ═══');
  // เลือกหมวดที่มีแผนที่ กรอกระยะทาง แล้วสลับไปหมวดที่ไม่มีแผนที่
  await ev(`
    const sel=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='TRAVEL004'));
    sel.value='TRAVEL004'; sel.dispatchEvent(new Event('change',{bubbles:true})); return 1;`);
  await sleep(800);
  await ev(`
    const set=(id,v)=>{const e=document.getElementById(id); if(e){e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));}};
    set('distOutbound','100'); set('distReturn','100');
    const ct=document.getElementById('carType'); if(ct){ct.value='ไป-กลับ'; ct.dispatchEvent(new Event('change',{bubbles:true}));}
    if(window.calculateTravelTotal) calculateTravelTotal();
    return 1;`);
  await sleep(600);
  const withMap = await ev(`return (document.getElementById('grandTotal')||{}).textContent || (document.getElementById('totalAmount')||{}).textContent || 'ไม่พบช่องยอดรวม'`);
  console.log('   หมวดใบพาหนะ + ระยะทาง 200 กม. → ยอดรวม ' + withMap);

  await ev(`
    const sel=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='TRAVEL003'));
    sel.value='TRAVEL003'; sel.dispatchEvent(new Event('change',{bubbles:true}));
    if(window.calculateTravelTotal) calculateTravelTotal();
    return 1;`);
  await sleep(900);
  const afterSwitch = await ev(`return (document.getElementById('grandTotal')||{}).textContent || (document.getElementById('totalAmount')||{}).textContent || 'ไม่พบ'`);
  const num = parseFloat(String(afterSwitch).replace(/[^\d.]/g,'')) || 0;
  console.log('   สลับเป็นหมวดใบรายงาน (แผนที่ถูกซ่อน) → ยอดรวม ' + afterSwitch);
  check('สลับหมวดแล้วค่าน้ำมันจากช่องที่ซ่อนไม่ถูกนับ', num === 0, 'ได้ ' + num);

  const realErr = errors.filter(e=>!/favicon|fonts\.g|ERR_/i.test(e));
  check('ไม่มี JavaScript error', realErr.length===0, realErr.slice(0,2).join(' | '));

  const pass = results.filter(r=>r.ok).length, fail = results.filter(r=>!r.ok);
  console.log('\n' + '═'.repeat(58));
  console.log('  ผ่าน ' + pass + ' / ' + results.length);
  fail.forEach(f=>console.log('    ✗ ' + f.n));
  console.log('═'.repeat(58));
  process.exitCode = fail.length ? 1 : 0;
} catch(e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try{ws.close();}catch{} chrome.kill(); }
