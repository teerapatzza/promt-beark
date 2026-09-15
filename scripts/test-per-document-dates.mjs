// ทดสอบวันที่แยกรายเอกสาร: ตามวันที่หลักจนกว่าจะแตะ · เก็บลงฐานข้อมูล · ไปโผล่ถูกใบ
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs'; import path from 'node:path';
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT=9510, PROFILE=path.join(process.env.TEMP,'pb-split');
const APP='http://localhost:8080';
const chrome=spawn(CHROME,['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${PROFILE}`,
  '--no-first-run','--disable-gpu','--window-size=1400,1000','about:blank'],{stdio:'ignore'});
let ws,id=0; const pending=new Map(); const errors=[];
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));
  return new Promise((r,j)=>pending.set(i,{r,j}));};
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:`(async()=>{${e}})()`,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
  return r.result?.value;};
const results=[]; const check=(n,ok,d='')=>{results.push({n,ok});console.log((ok?'  PASS  ':'  FAIL  ')+n+(d?'  → '+d:''));};

const MAIN='2026-08-01', REP='2026-08-05', RCP='2026-08-09';
try{
  let u; for(let i=0;i<60;i++){try{const l=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const p=l.find(t=>t.type==='page'); if(p){u=p.webSocketDebuggerUrl;break;}}catch{} await sleep(250);}
  ws=new WebSocket(u); await new Promise(r=>ws.addEventListener('open',r));
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);
    if(m.id&&pending.has(m.id)){const{r,j}=pending.get(m.id);pending.delete(m.id);m.error?j(new Error(m.error.message)):r(m.result);return;}
    if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
    if(m.method==='Page.javascriptDialogOpening')send('Page.handleJavaScriptDialog',{accept:true});});
  await send('Page.enable'); await send('Runtime.enable');
  const cred={email:'tester@ha.or.th',password:'testpass123'};
  let tok=await fetch(APP+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(cred)}).then(r=>r.json()).then(j=>j.token).catch(()=>null);
  if(!tok) tok=await fetch(APP+'/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(cred)}).then(r=>r.json()).then(j=>j.token);
  await send('Page.navigate',{url:APP+'/login.html'}); await sleep(1200);
  await ev(`localStorage.setItem('token', ${JSON.stringify(tok)}); return 1`);
  await send('Page.navigate',{url:APP+'/expense.html'}); await sleep(4000);

  console.log('═══ 1. ปุ่มโผล่เฉพาะหมวดที่ออกหลายใบ ═══');
  await ev(`const s=document.getElementById('categorySelect'); s.value='TRAVEL003';
            s.dispatchEvent(new Event('change',{bubbles:true})); return 1`);
  await sleep(900);
  check('หมวดออกใบเดียว → ไม่มีปุ่มตั้งวันที่แยก',
        (await ev(`return document.getElementById('docDateSplitToggle').classList.contains('hidden')`)) === true);

  await ev(`const s=document.getElementById('categorySelect'); s.value='TRAVEL001';
            s.dispatchEvent(new Event('change',{bubbles:true})); return 1`);
  await sleep(900);
  check('หมวดออกสองใบ → มีปุ่มตั้งวันที่แยก',
        (await ev(`return document.getElementById('docDateSplitToggle').classList.contains('hidden')`)) === false);
  check('ยังพับเก็บไว้ ไม่รบกวนคนที่ไม่ใช้',
        (await ev(`return document.getElementById('docDateSplitBox').classList.contains('hidden')`)) === true);

  console.log('\n═══ 2. กางออกมาแล้วตามวันที่หลักให้เอง ═══');
  await ev(`toggleDocDateSplit(); return 1`); await sleep(300);
  await ev(`const e=document.getElementById('docDate'); e.value='${MAIN}';
            e.dispatchEvent(new Event('change',{bubbles:true})); return 1`);
  await sleep(400);
  const follow = await ev(`return JSON.stringify([...document.querySelectorAll('#docDateSplitRows [data-doc]')]
    .map(i=>i.dataset.doc+'='+i.value))`);
  check('ทุกช่องตามวันที่หลัก', JSON.parse(follow).every(x=>x.endsWith(MAIN)), follow);
  const labels = await ev(`return JSON.stringify([...document.querySelectorAll('#docDateSplitRows [data-doc]')].map(i=>i.dataset.doc))`);
  check('สร้างช่องเฉพาะใบที่หมวดนี้ออก', labels === '["REPORT","TRANSPORT_RECEIPT"]', labels);

  console.log('\n═══ 3. แก้เองแล้วหยุดตาม ═══');
  await ev(`const i=document.querySelector('[data-doc="REPORT"]'); i.value='${REP}';
            i.dispatchEvent(new Event('change',{bubbles:true})); return 1`);
  await sleep(300);
  await ev(`const e=document.getElementById('docDate'); e.value='2026-07-01';
            e.dispatchEvent(new Event('change',{bubbles:true})); return 1`);
  await sleep(400);
  check('ใบที่แก้เองไม่ถูกวันที่หลักเขียนทับ',
        (await ev(`return document.querySelector('[data-doc="REPORT"]').value`)) === REP);
  check('ใบที่ยังไม่แตะ เดินตามวันที่หลักต่อ',
        (await ev(`return document.querySelector('[data-doc="TRANSPORT_RECEIPT"]').value`)) === '2026-07-01');
  await ev(`resetDocDateSplit(); return 1`); await sleep(300);
  check('กดคืนค่าแล้วกลับไปตามวันที่หลักทุกใบ',
        (await ev(`return document.querySelector('[data-doc="REPORT"]').value`)) === '2026-07-01');

  console.log('\n═══ 4. บันทึกแล้วเก็บถูก ═══');
  await ev(`
    const set=(id,v)=>{const e=document.getElementById(id); e.value=v;
      e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));};
    set('docDate','${MAIN}');
    const a=document.querySelector('[data-doc="REPORT"]'); a.value='${REP}'; a.dispatchEvent(new Event('change',{bubbles:true}));
    const b=document.querySelector('[data-doc="TRANSPORT_RECEIPT"]'); b.value='${RCP}'; b.dispatchEvent(new Event('change',{bubbles:true}));
    set('requestedBy','ทดสอบ วันที่แยก'); set('position','ที่ปรึกษา'); set('affiliation','อิสระ');
    set('activityName','ทดสอบวันที่แยก');
    set('dateStart','2026-08-26'); set('dateEnd','2026-08-28'); set('targetProv','นนทบุรี');
    set('travelFrom','สรพ. นนทบุรี'); set('travelTo','โรงพยาบาลมหาราช นครราชสีมา');
    set('distOutbound','100'); set('distReturn','100');
    const ct=document.getElementById('carType'); if(ct){ct.value='ไป-กลับ'; ct.dispatchEvent(new Event('change',{bubbles:true}));}
    setPoint('from',13.8620,100.5140,'สรพ.'); setPoint('to',14.9799,102.0977,'รพ.มหาราช');
    if(window.calculateTravelTotal) calculateTravelTotal();
    return 1;`);
  await sleep(900);
  await ev(`
    return new Promise(res=>{
      const cv=document.createElement('canvas'); cv.width=40; cv.height=40;
      cv.getContext('2d').fillRect(0,0,40,40);
      cv.toBlob(b=>{
        document.querySelectorAll('.general-file-upload').forEach((inp,i)=>{
          const f=new File([b],'r'+i+'.png',{type:'image/png'});
          const dt=new DataTransfer(); dt.items.add(f);
          inp.files=dt.files; inp.dispatchEvent(new Event('change',{bubbles:true}));
        }); res(1);
      },'image/png');
    });`);
  await sleep(1200);
  const before=await fetch(APP+'/expenses',{headers:{Authorization:'Bearer '+tok}}).then(r=>r.json());
  await ev(`window.__a=[]; window.alert=m=>window.__a.push(String(m));
            document.getElementById('submitBtn').click(); return 1`);
  await sleep(4000);
  const al=await ev(`return JSON.stringify(window.__a||[])`);
  const after=await fetch(APP+'/expenses',{headers:{Authorization:'Bearer '+tok}}).then(r=>r.json());
  check('บันทึกสำเร็จ', after.length===before.length+1, al.slice(0,120));
  if(after.length===before.length) throw new Error('ไม่มีใบใหม่ — หยุด');
  const rec=after.find(r=>!before.some(b=>b.id===r.id));
  const m=rec.inputMetadata||{};
  check('เก็บวันที่หลัก', m._docDate===MAIN, String(m._docDate));
  check('เก็บวันที่แยกครบสองใบ',
        m._docDates && m._docDates.REPORT===REP && m._docDates.TRANSPORT_RECEIPT===RCP,
        JSON.stringify(m._docDates));

  console.log('\n═══ 5. เอกสารพิมพ์วันถูกใบ ═══');
  await send('Page.navigate',{url:APP+'/history.html'}); await sleep(3000);
  const doc=await ev(`
    window.renderRouteMapImage=async()=>'data:image/png;base64,MAPSTUB'; window.alert=()=>{};
    const list=await fetch('/expenses',{headers:{Authorization:'Bearer '+localStorage.getItem('token')}}).then(r=>r.json());
    const rc=list.find(x=>String(x.id)===${JSON.stringify(String(rec.id))});
    const built=await buildDocumentHtml(rc);
    const d=document.createElement('div'); d.innerHTML=built.html;
    const pages=[...d.querySelectorAll('.pdf-page')].map(p=>(p.textContent||'').replace(/\\s+/g,' '));
    return JSON.stringify(pages.map(t=>t.slice(0,400)));`);
  const P=JSON.parse(doc);
  const repPage = P.find(t=>t.includes('ใบรายงานการเดินทางไปปฏิบัติงาน')) || '';
  const rcpPage = P.find(t=>t.includes('ใบรับรองแทนใบเสร็จรับเงิน')) || '';
  check('ใบรายงานใช้ 05/08/2569', repPage.includes('05/08/2569'), repPage.slice(0,110));
  check('ใบค่าพาหนะใช้ 09/08/2569', rcpPage.includes('09/08/2569'), rcpPage.slice(0,110));
  check('ไม่มีวันที่หลัก 01/08/2569 หลุดไปในสองใบนี้',
        !repPage.includes('01/08/2569') && !rcpPage.includes('01/08/2569'));

  console.log('\n═══ 6. เปิดใบเดิมกลับมาแก้ ═══');
  await send('Page.navigate',{url:APP+'/expense.html?edit='+rec.id}); await sleep(4500);
  const back=await ev(`return JSON.stringify({
    main: document.getElementById('docDate').value,
    rep: document.querySelector('[data-doc="REPORT"]')?.value,
    rcp: document.querySelector('[data-doc="TRANSPORT_RECEIPT"]')?.value,
    opened: !document.getElementById('docDateSplitBox').classList.contains('hidden')})`);
  const B=JSON.parse(back);
  check('ค่าที่ตั้งไว้กลับมาครบ', B.main===MAIN && B.rep===REP && B.rcp===RCP, back);
  check('กางให้เห็นเองเพราะมีการตั้งไว้', B.opened===true);

  await fetch(APP+'/expenses/'+rec.id,{method:'DELETE',headers:{Authorization:'Bearer '+tok}}).catch(()=>{});
  const realErr=errors.filter(e=>!/favicon|fonts\.g|ERR_|tile/i.test(e));
  check('ไม่มี JavaScript error', realErr.length===0, realErr.slice(0,2).join(' | '));

  const pass=results.filter(r=>r.ok).length, fail=results.filter(r=>!r.ok);
  console.log('\n'+'═'.repeat(60));
  console.log('  ผ่าน '+pass+' / '+results.length);
  fail.forEach(f=>console.log('    ✗ '+f.n));
  console.log('═'.repeat(60));
  process.exitCode=fail.length?1:0;
}catch(e){console.error('ล้มเหลว:',e.message); process.exitCode=2;}
finally{try{ws.close()}catch{};chrome.kill();}
