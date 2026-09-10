// วงจรเต็ม: กรอกในฟอร์มจริง → กดบันทึก → อ่านกลับจากฐานข้อมูล → เปิดมาแก้ → ออกเอกสาร
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';

const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT=9434, PROFILE=path.join(process.env.TEMP,'pb-rt');
const APP='http://localhost:8080';
const chrome=spawn(CHROME,['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${PROFILE}`,
  '--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore'});

let ws,id=0; const pending=new Map(); const errors=[];
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));
  return new Promise((r,j)=>pending.set(i,{r,j}));};
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:`(async()=>{${e}})()`,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
  return r.result?.value;};
const results=[]; const check=(n,ok,d='')=>{results.push({n,ok});console.log((ok?'  PASS  ':'  FAIL  ')+n+(d?'  → '+d:''));};

try {
  let u;
  for(let i=0;i<60;i++){try{const l=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const p=l.find(t=>t.type==='page'); if(p){u=p.webSocketDebuggerUrl;break;}}catch{} await sleep(250);}
  ws=new WebSocket(u); await new Promise(r=>ws.addEventListener('open',r));
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);
    if(m.id&&pending.has(m.id)){const{r,j}=pending.get(m.id);pending.delete(m.id);m.error?j(new Error(m.error.message)):r(m.result);return;}
    if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
    if(m.method==='Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog',{accept:true});});
  await send('Page.enable'); await send('Runtime.enable');

  const cred={email:'tester@ha.or.th',password:'testpass123'};
  let tok=await fetch(APP+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(cred)}).then(r=>r.json()).then(j=>j.token).catch(()=>null);
  if(!tok) tok=await fetch(APP+'/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(cred)}).then(r=>r.json()).then(j=>j.token);

  await send('Page.navigate',{url:APP+'/login.html'}); await sleep(1200);
  await ev(`localStorage.setItem('token', ${JSON.stringify(tok)}); return 1`);
  await send('Page.navigate',{url:APP+'/expense.html'}); await sleep(4000);

  console.log('═══ 1. กรอกฟอร์มจริงแล้วกดบันทึก ═══');
  await ev(`
    const set=(id,v)=>{const e=document.getElementById(id); if(!e) throw new Error('ไม่พบ '+id);
      e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));};
    const sel=document.getElementById('categorySelect');
    sel.value='TRAVEL003'; sel.dispatchEvent(new Event('change',{bubbles:true}));
    return 1;`);
  await sleep(1000);
  await ev(`
    const set=(id,v)=>{const e=document.getElementById(id); if(!e) throw new Error('ไม่พบ '+id);
      e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));};
    set('requestedBy','ทดสอบ วงจรเต็ม');
    set('position','ที่ปรึกษา'); set('affiliation','อิสระ');
    set('activityName','ทดสอบวันที่');
    set('docDate','2026-08-01');
    set('dateStart','2026-08-26'); set('dateEnd','2026-08-28');
    set('periodStart','2026-09-01'); set('periodEnd','2026-09-05');
    set('targetProv','นนทบุรี');
    set('hotelName','โรงแรม เดอะ เล็ค กาซี่');
    // ต้องมียอดเงินมากกว่า 0 ไม่งั้นระบบไม่ให้บันทึก
    const first = document.querySelector('.accommodation-entry');
    if (!first && window.addAccommodationEntry) addAccommodationEntry();
    const row = document.querySelector('.accommodation-entry');
    if (!row) throw new Error('ไม่พบรายการที่พัก');
    const put=(sel,v)=>{const e=row.querySelector(sel); e.value=v;
      e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));};
    put('.accommodation-rate','1400'); put('.accommodation-nights','2');
    if (window.calculateTravelTotal) calculateTravelTotal();
    return 1;`);
  await sleep(700);
  check('ช่วงวันที่ที่แก้เองไม่ถูกวันเดินทางเขียนทับ',
        (await ev(`return document.getElementById('periodStart').value`)) === '2026-09-01');

  const before = await fetch(APP+'/expenses',{headers:{Authorization:'Bearer '+tok}}).then(r=>r.json());
  // เก็บข้อความแจ้งเตือนไว้ดู เผื่อบันทึกไม่ผ่านเพราะกรอกไม่ครบ
  const alerts = [];
  await ev(`window.__alerts=[]; const oa=window.alert; window.alert=m=>{window.__alerts.push(String(m));}; return 1`);
  await ev(`document.getElementById('submitBtn').click(); return 1`);
  await sleep(4000);
  const alertTxt = await ev(`return JSON.stringify(window.__alerts||[])`);
  if (alertTxt && alertTxt !== '[]') console.log('   ข้อความจากระบบ: ' + alertTxt.slice(0, 300));
  const after = await fetch(APP+'/expenses',{headers:{Authorization:'Bearer '+tok}}).then(r=>r.json());
  check('บันทึกลงฐานข้อมูลสำเร็จ', after.length === before.length + 1,
        'ก่อน '+before.length+' หลัง '+after.length);
  if (after.length === before.length) throw new Error('ไม่มีใบใหม่ถูกบันทึก — หยุดทดสอบ');

  const rec = after.find(r => !before.some(b => b.id === r.id));
  const meta = rec.inputMetadata || {};
  console.log('\n═══ 2. ค่าที่เก็บลงฐานข้อมูลจริง ═══');
  check('เก็บวันที่บนเอกสาร', meta._docDate === '2026-08-01', String(meta._docDate));
  check('เก็บช่วงวันที่ที่แก้เอง',
        meta._travel?.periodStart === '2026-09-01' && meta._travel?.periodEnd === '2026-09-05',
        meta._travel?.periodStart + ' → ' + meta._travel?.periodEnd);
  check('วันเดินทางจริงยังเก็บแยกไว้',
        meta._travel?.startDate === '2026-08-26' && meta._travel?.endDate === '2026-08-28',
        meta._travel?.startDate + ' → ' + meta._travel?.endDate);
  check('หมวดใบรายงานอย่างเดียว → ระยะทางเป็น 0',
        String(meta._travel?.distOut) === '0' && String(meta._travel?.distRet) === '0',
        meta._travel?.distOut + ' / ' + meta._travel?.distRet);

  console.log('\n═══ 3. เปิดใบนี้กลับมาแก้ ค่าต้องกลับมาครบ ═══');
  await send('Page.navigate',{url:APP+'/expense.html?edit='+rec.id}); await sleep(4500);
  const back = await ev(`return JSON.stringify({
      doc: document.getElementById('docDate').value,
      ps: document.getElementById('periodStart').value,
      pe: document.getElementById('periodEnd').value,
      ds: document.getElementById('dateStart').value,
      touched: (typeof periodTouched!=='undefined') ? periodTouched : null,
      resetShown: !document.getElementById('periodReset').classList.contains('hidden')
    })`);
  const B = JSON.parse(back);
  check('วันที่บนเอกสารกลับมาถูก', B.doc === '2026-08-01', B.doc);
  check('ช่วงวันที่กลับมาถูก', B.ps === '2026-09-01' && B.pe === '2026-09-05', B.ps+' → '+B.pe);
  check('วันเดินทางกลับมาถูก', B.ds === '2026-08-26', B.ds);
  check('รู้ว่าเคยแก้ช่วงวันที่ไว้ จึงไม่เขียนทับและโชว์ปุ่มคืนค่า',
        B.touched === true && B.resetShown === true, JSON.stringify(B));

  console.log('\n═══ 4. ออกเอกสารจากใบที่บันทึกจริง ═══');
  await send('Page.navigate',{url:APP+'/history.html'}); await sleep(3500);
  const doc = await ev(`
    return new Promise(res=>{
      window.html2pdf = () => ({ set:()=>({ from:()=>({ save:()=>Promise.resolve() }) }) });
      const b=document.createElement('button'); b.innerHTML='x'; document.body.appendChild(b);
      window.event={currentTarget:b,target:b};
      // ไม่มี route ดึงใบเดี่ยว ต้องดึงทั้งรายการแล้วหาใบที่ต้องการ
      fetch('/expenses',{headers:{Authorization:'Bearer '+localStorage.getItem('token')}})
        .then(r=>r.json())
        .then(list=>{
          const rc=list.find(x=>x.id===${JSON.stringify(rec.id)});
          if(!rc) throw new Error('หาใบที่บันทึกไว้ไม่เจอในรายการ');
          return exportPDF(rc);
        })
        .then(()=>{const el=document.getElementById('formal-doc')||document.getElementById('pdf-container');
                   res(el?el.innerText.replace(/\\s+/g,' '):'ไม่พบเอกสาร');})
        .catch(e=>res('ล้มเหลว: '+e.message));
    });`);
  await sleep(400);
  const has = s => typeof doc==='string' && doc.includes(s);
  console.log('   ' + String(doc).slice(0,130));
  check('เอกสารพิมพ์วันที่ 01/08/2569 (ไม่ใช่วันที่บันทึกวันนี้)', has('01/08/2569'));
  check('เอกสารพิมพ์ในระหว่างวันที่ 01/09/2569 - 05/09/2569',
        has('01/09/2569') && has('05/09/2569'));
  check('เอกสารยังพิมพ์วันออกเดินทางจริง 26/08/2569', has('26/08/2569'));

  // เก็บกวาด
  await fetch(APP+'/expenses/'+rec.id,{method:'DELETE',headers:{Authorization:'Bearer '+tok}}).catch(()=>{});

  const realErr = errors.filter(e=>!/favicon|fonts\.g|ERR_|html2pdf/i.test(e));
  check('ไม่มี JavaScript error', realErr.length===0, realErr.slice(0,2).join(' | '));

  const pass=results.filter(r=>r.ok).length, fail=results.filter(r=>!r.ok);
  console.log('\n'+'═'.repeat(60));
  console.log('  ผ่าน '+pass+' / '+results.length);
  fail.forEach(f=>console.log('    ✗ '+f.n));
  console.log('═'.repeat(60));
  process.exitCode = fail.length?1:0;
} catch(e){ console.error('ล้มเหลว:', e.message); process.exitCode=2; }
finally { try{ws.close();}catch{} chrome.kill(); }
