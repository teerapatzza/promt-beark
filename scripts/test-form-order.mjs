// ตรวจลำดับที่ผู้ใช้เห็นจริงบนหน้าจอ และว่าทุกช่องกรอกได้ครบ
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs'; import path from 'node:path';
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT=9520, PROFILE=path.join(process.env.TEMP,'pb-order');
const APP='http://localhost:8080';
const chrome=spawn(CHROME,['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${PROFILE}`,
  '--no-first-run','--disable-gpu','--window-size=1400,1200','about:blank'],{stdio:'ignore'});
let ws,id=0; const pending=new Map(); const errors=[];
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));
  return new Promise((r,j)=>pending.set(i,{r,j}));};
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:`(async()=>{${e}})()`,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
  return r.result?.value;};
const results=[]; const check=(n,ok,d='')=>{results.push({n,ok});console.log((ok?'  PASS  ':'  FAIL  ')+n+(d?'  → '+d:''));};

// ลำดับที่ควรเป็น อ้างจากลำดับในเอกสาร PDF
const WANT = ['addressSection','travelTimeBox','secHotel','costHotelBox','secVehicle',
              'costTaxiBox','travelDetailsBox','costAirBox','secOther','costTollBox','costOtherBox',
              'extraEntriesBox','generalReceiptSection'];

try{
  let u; for(let i=0;i<60;i++){try{const l=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const p=l.find(t=>t.type==='page'); if(p){u=p.webSocketDebuggerUrl;break;}}catch{} await sleep(250);}
  ws=new WebSocket(u); await new Promise(r=>ws.addEventListener('open',r));
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);
    if(m.id&&pending.has(m.id)){const{r,j}=pending.get(m.id);pending.delete(m.id);m.error?j(new Error(m.error.message)):r(m.result);return;}
    if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
    if(m.method==='Page.javascriptDialogOpening')send('Page.handleJavaScriptDialog',{accept:true});});
  await send('Page.enable'); await send('Runtime.enable');
  // ปิดแคชของเบราว์เซอร์ ไม่งั้นโปรไฟล์ที่ใช้ซ้ำจะเสิร์ฟไฟล์เก่าจากดิสก์
  // แล้วผลทดสอบจะเป็นของโค้ดรุ่นก่อนโดยไม่มีใครรู้
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  const cred={email:'tester@ha.or.th',password:'testpass123'};
  let tok=await fetch(APP+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(cred)}).then(r=>r.json()).then(j=>j.token).catch(()=>null);
  if(!tok) tok=await fetch(APP+'/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(cred)}).then(r=>r.json()).then(j=>j.token);
  await send('Page.navigate',{url:APP+'/login.html'}); await sleep(1200);
  await ev(`localStorage.setItem('token', ${JSON.stringify(tok)}); return 1`);
  await send('Page.navigate',{url:APP+'/expense.html'}); await sleep(4000);

  console.log('═══ 1. ลำดับในหน้าเว็บตรงกับลำดับใน PDF ═══');
  await ev(`const s=document.getElementById('categorySelect'); s.value='TRAVEL002';
            s.dispatchEvent(new Event('change',{bubbles:true})); return 1`);
  await sleep(1000);
  const order = await ev(`
    const want=${JSON.stringify(WANT)};
    const got = want.map(id=>{const e=document.getElementById(id);
      return e ? {id, top: Math.round(e.getBoundingClientRect().top + window.scrollY)} : {id, top:null};});
    return JSON.stringify(got);`);
  const O = JSON.parse(order);
  const missing = O.filter(x=>x.top===null).map(x=>x.id);
  check('กล่องครบทุกอัน', missing.length===0, missing.join(', '));
  const tops = O.filter(x=>x.top!==null);
  let inOrder = true, badAt = '';
  for (let i=1;i<tops.length;i++) if (tops[i].top < tops[i-1].top) { inOrder=false; badAt=tops[i-1].id+' → '+tops[i].id; break; }
  check('เรียงจากบนลงล่างตามลำดับ PDF', inOrder, badAt || tops.map(t=>t.id).join(' → '));

  console.log('\n═══ 2. หัวข้อบนจอตรงกับเลขข้อในเอกสาร ═══');
  const heads = await ev(`
    return JSON.stringify(['secHotel','secVehicle','secOther'].map(id=>{
      const h=document.getElementById(id)?.querySelector('h3');
      return h ? h.textContent.trim() : '(ไม่มี)';}));`);
  const HD = JSON.parse(heads);
  check('หัวข้อ 1 ค่าที่พัก',      HD[0]==='1. ค่าที่พัก', HD[0]);
  check('หัวข้อ 2 ค่าพาหนะ',       HD[1]==='2. ค่าพาหนะ', HD[1]);
  check('หัวข้อ 3 ค่าใช้จ่ายอื่นๆ', HD[2]==='3. ค่าใช้จ่ายอื่นๆ', HD[2]);
  const subs = await ev(`
    const t=(id,sel)=>{const e=document.getElementById(id)?.querySelector(sel); return e?e.textContent.trim():'';};
    return JSON.stringify({
      taxi: t('costTaxiBox','label'),
      map:  t('travelDetailsBox','label'),
      air:  t('costAirBox','label'),
      toll: t('costTollBox','label'),
      other:t('costOtherBox','label')});`);
  const S = JSON.parse(subs);
  check('2.1 Taxi',            S.taxi.startsWith('2.1'),  S.taxi);
  check('2.2 ค่าน้ำมัน/ระยะทาง', S.map.startsWith('2.2'),   S.map);
  check('2.3 ตั๋วเครื่องบิน',   S.air.startsWith('2.3'),   S.air);
  check('3.1 ค่าทางด่วน',       S.toll.startsWith('3.1'),  S.toll);
  check('3.2 เบี้ยเลี้ยง/อื่นๆ', S.other.startsWith('3.2'), S.other);

  console.log('\n═══ 3. แต่ละหมวดโชว์/ซ่อนถูกต้อง ═══');
  const CASES = [
    ['TRAVEL003','ใบรายงานอย่างเดียว',  {secHotel:true,  secVehicle:true,  secOther:true,  costTaxiBox:false, travelDetailsBox:false, costAirBox:true}],
    ['TRAVEL004','ใบพาหนะอย่างเดียว',   {secHotel:false, secVehicle:true,  secOther:true,  costTaxiBox:true,  travelDetailsBox:true,  costAirBox:false}],
    ['TRAVEL001','ออกสองใบ',            {secHotel:true,  secVehicle:true,  secOther:true,  costTaxiBox:true,  travelDetailsBox:true,  costAirBox:true}],
  ];
  for (const [cat,label,want] of CASES) {
    await ev(`const s=document.getElementById('categorySelect'); s.value='${cat}';
              s.dispatchEvent(new Event('change',{bubbles:true})); return 1`);
    await sleep(900);
    const vis = await ev(`
      const ids=${JSON.stringify(Object.keys(want))};
      const o={}; ids.forEach(i=>{const e=document.getElementById(i); o[i]= e ? e.getClientRects().length>0 : null;});
      return JSON.stringify(o);`);
    const V = JSON.parse(vis);
    const wrong = Object.keys(want).filter(k=>V[k]!==want[k]);
    check('  ' + label, wrong.length===0,
          wrong.length ? wrong.map(k=>k+' ควร'+(want[k]?'เห็น':'ซ่อน')+' แต่'+(V[k]?'เห็น':'ซ่อน')).join(' · ') : '');
  }

  console.log('\n═══ 4. ทุกช่องที่เห็น ต้องกรอกได้จริง ═══');
  await ev(`const s=document.getElementById('categorySelect'); s.value='TRAVEL002';
            s.dispatchEvent(new Event('change',{bubbles:true})); return 1`);
  await sleep(1000);
  const fields = await ev(`
    const out=[];
    document.querySelectorAll('#secHotel input, #secHotel select, #secVehicle input, #secVehicle select, #secOther input, #secOther select')
      .forEach(e=>{
        if(!e.getClientRects().length) return;
        if(e.type==='file') return;
        out.push({id:e.id||e.className.split(' ')[0], ro:!!e.readOnly, dis:!!e.disabled,
                  type:e.type||e.tagName.toLowerCase(),
                  w:Math.round(e.getBoundingClientRect().width), h:Math.round(e.getBoundingClientRect().height)});
      });
    return JSON.stringify(out);`);
  const F = JSON.parse(fields);
  console.log('   ช่องที่มองเห็นในสามกล่อง: ' + F.length + ' ช่อง');
  const blocked = F.filter(f=>f.dis);
  // ช่องติ๊กกับปุ่มวงกลมเล็กโดยธรรมชาติ ไม่เอามาวัดด้วยเกณฑ์เดียวกับช่องพิมพ์
  const TICK = ['checkbox','radio'];
  const tiny = F.filter(f=>!TICK.includes(f.type) && (f.w<40 || f.h<20));
  const ticks = F.filter(f=>TICK.includes(f.type));
  check('ไม่มีช่องที่ถูกปิดจนกรอกไม่ได้', blocked.length===0, blocked.map(f=>f.id).join(', '));
  check('ทุกช่องพิมพ์มีขนาดใช้งานได้จริง', tiny.length===0, tiny.map(f=>f.id+' '+f.w+'x'+f.h).join(', '));
  const noLabel = await ev(`
    const bad=[];
    ${JSON.stringify(ticks.map(t=>t.id))}.forEach(id=>{
      const e=document.getElementById(id); if(!e) return;
      const lab = e.closest('label') || document.querySelector('label[for="'+id+'"]');
      if(!lab || !(lab.textContent||'').trim()) bad.push(id);
    });
    return JSON.stringify(bad);`);
  check('ช่องติ๊กทุกอันมีข้อความกำกับให้กดได้', JSON.parse(noLabel).length===0,
        'ติ๊ก ' + ticks.length + ' อัน · ไม่มีข้อความ: ' + (JSON.parse(noLabel).join(', ')||'ไม่มี'));
  const ro = F.filter(f=>f.ro).map(f=>f.id);
  console.log('   ช่องที่อ่านอย่างเดียวโดยตั้งใจ: ' + (ro.join(', ')||'ไม่มี'));

  console.log('\n═══ 5. พิมพ์ลงได้จริงทุกช่องสำคัญ ═══');
  const typed = await ev(`
    const ids=['hotelName','airfareCost','tollCost','otherCost','distOutbound','distReturn','travelFrom','travelTo'];
    const bad=[];
    ids.forEach(i=>{
      const e=document.getElementById(i);
      if(!e){ bad.push(i+' ไม่มี'); return; }
      if(!e.getClientRects().length){ bad.push(i+' มองไม่เห็น'); return; }
      e.value=''; e.focus();
      e.value = (e.type==='number') ? '123' : 'ทดสอบ';
      e.dispatchEvent(new Event('input',{bubbles:true}));
      if(!e.value) bad.push(i+' พิมพ์ไม่ลง');
    });
    return JSON.stringify(bad);`);
  const B = JSON.parse(typed);
  check('พิมพ์ลงได้ทุกช่อง', B.length===0, B.join(' · '));

  console.log('\n═══ 6. แผนที่ยังทำงานหลังย้ายที่ ═══');
  const map = await ev(`
    const el=document.querySelector('#travelDetailsBox #routeMap, #travelDetailsBox .leaflet-container');
    if(!el) return JSON.stringify({found:false});
    const r=el.getBoundingClientRect();
    return JSON.stringify({found:true, w:Math.round(r.width), h:Math.round(r.height),
      tiles: el.querySelectorAll('img.leaflet-tile').length});`);
  const M = JSON.parse(map);
  check('แผนที่อยู่ในกล่องและมีขนาดจริง', M.found && M.w>200 && M.h>100, JSON.stringify(M));

  const realErr=errors.filter(e=>!/favicon|fonts\.g|ERR_|tile/i.test(e));
  check('ไม่มี JavaScript error', realErr.length===0, realErr.slice(0,2).join(' | '));

  const pass=results.filter(r=>r.ok).length, fail=results.filter(r=>!r.ok);
  console.log('\n'+'═'.repeat(62));
  console.log('  ผ่าน '+pass+' / '+results.length);
  fail.forEach(f=>console.log('    ✗ '+f.n));
  console.log('═'.repeat(62));
  process.exitCode=fail.length?1:0;
}catch(e){console.error('ล้มเหลว:',e.message); process.exitCode=2;}
finally{try{ws.close()}catch{};chrome.kill();}
