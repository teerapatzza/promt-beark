// กรณีออกทั้งใบรายงานและใบค่าพาหนะพร้อมกัน — วันที่แต่ละตัวต้องไปลงถูกที่
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';

const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT=9445, PROFILE=path.join(process.env.TEMP,'pb-both');
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

// วันที่ตั้งใจให้ต่างกันทุกตัว จะได้รู้ว่าอันไหนไปโผล่ตรงไหน
const DOC   = '2026-08-01';  // 01/08/2569  วันที่บนเอกสาร
const TRIP  = ['2026-08-26','2026-08-28'];  // 26/08 - 28/08  วันเดินทางจริง
const PERIOD= ['2026-09-01','2026-09-05'];  // 01/09 - 05/09  ในระหว่างวันที่

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

  console.log('═══ 1. หมวดที่ออกทั้ง 2 ใบ — ช่องวันที่ต้องครบ ═══');
  await ev(`const s=document.getElementById('categorySelect');
            s.value='TRAVEL001'; s.dispatchEvent(new Event('change',{bubbles:true})); return 1`);
  await sleep(1000);
  const boxes = await ev(`return JSON.stringify({
      doc:    !!document.getElementById('docDate')?.getClientRects().length,
      period: !!document.getElementById('periodStart')?.getClientRects().length,
      trip:   !!document.getElementById('dateStart')?.getClientRects().length,
      map:    !!document.getElementById('travelDetailsBox')?.getClientRects().length })`);
  const BX = JSON.parse(boxes);
  check('เห็นช่องวันที่บนเอกสาร', BX.doc === true);
  check('เห็นช่องในระหว่างวันที่', BX.period === true);
  check('เห็นช่องวันเดินทาง', BX.trip === true);
  check('เห็นแผนที่ (เพราะมีใบค่าพาหนะ)', BX.map === true);

  const where = await ev(`return document.getElementById('docDateWhere').textContent.replace(/\s+/g,' ').trim()`);
  console.log('   คำอธิบายบนหน้าจอ: ' + where);
  check('บอกว่าวันที่ไปลงใบรายงานตรงไหน', where.includes('ใบรายงานการเดินทาง'));
  check('บอกว่าวันที่ไปลงใบค่าพาหนะตรงไหน', where.includes('ใบรับรองค่าพาหนะ'));
  check('ชี้ทางไปช่องในระหว่างวันที่', where.includes('ในระหว่างวันที่'));

  console.log('\n═══ 2. กรอกให้วันที่ทุกตัวต่างกัน แล้วบันทึก ═══');
  await ev(`
    const set=(id,v)=>{const e=document.getElementById(id); if(!e) throw new Error('ไม่พบ '+id);
      e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));};
    set('requestedBy','ทดสอบ สองใบ');
    set('position','ที่ปรึกษา'); set('affiliation','อิสระ');
    set('activityName','ทดสอบสองใบ');
    set('docDate',${JSON.stringify(DOC)});
    set('dateStart',${JSON.stringify(TRIP[0])}); set('dateEnd',${JSON.stringify(TRIP[1])});
    set('periodStart',${JSON.stringify(PERIOD[0])}); set('periodEnd',${JSON.stringify(PERIOD[1])});
    set('targetProv','นนทบุรี');
    // ไม่ใส่ค่าที่พัก เพราะระบบบังคับแนบใบเสร็จ ใช้ค่าน้ำมันเป็นยอดเงินแทน
    // ใบค่าพาหนะบังคับต้นทาง-ปลายทาง
    set('travelFrom','สรพ. นนทบุรี'); set('travelTo','โรงพยาบาลมหาราช นครราชสีมา');
    set('distOutbound','100'); set('distReturn','100');
    const ct=document.getElementById('carType'); if(ct){ct.value='ไป-กลับ'; ct.dispatchEvent(new Event('change',{bubbles:true}));}
    // ปักหมุดจริงผ่านฟังก์ชันของแอป ใบค่าพาหนะบังคับให้มีแผนที่
    setPoint('from', 13.8620, 100.5140, 'สรพ. นนทบุรี');
    setPoint('to',   14.9799, 102.0977, 'โรงพยาบาลมหาราช นครราชสีมา');
    if(window.calculateTravelTotal) calculateTravelTotal();
    return 1;`);
  await sleep(800);

  // หมวดนี้บังคับแนบใบเสร็จ ใส่ไฟล์ภาพจำลองให้ครบทุกช่องที่บังคับ
  await ev(`
    return new Promise(res=>{
      const cv=document.createElement('canvas'); cv.width=40; cv.height=40;
      const c=cv.getContext('2d'); c.fillStyle='#eee'; c.fillRect(0,0,40,40);
      cv.toBlob(b=>{
        document.querySelectorAll('.general-file-upload').forEach((inp,i)=>{
          const f=new File([b],'receipt'+i+'.png',{type:'image/png'});
          const dt=new DataTransfer(); dt.items.add(f);
          inp.files=dt.files; inp.dispatchEvent(new Event('change',{bubbles:true}));
        });
        res(document.querySelectorAll('.general-file-upload').length);
      },'image/png');
    });`);
  await sleep(1200);

  check('แก้ช่วงวันที่เองแล้ว วันเดินทางไม่เขียนทับ',
        (await ev(`return document.getElementById('periodStart').value`)) === PERIOD[0]);

  const before=await fetch(APP+'/expenses',{headers:{Authorization:'Bearer '+tok}}).then(r=>r.json());
  await ev(`window.__a=[]; window.alert=m=>window.__a.push(String(m)); return 1`);
  await ev(`document.getElementById('submitBtn').click(); return 1`); await sleep(4000);
  const al=await ev(`return JSON.stringify(window.__a||[])`);
  if(al!=='[]') console.log('   ข้อความจากระบบ: '+al.slice(0,200));
  const after=await fetch(APP+'/expenses',{headers:{Authorization:'Bearer '+tok}}).then(r=>r.json());
  check('บันทึกสำเร็จ', after.length===before.length+1, 'ก่อน '+before.length+' หลัง '+after.length);
  if(after.length===before.length) throw new Error('ไม่มีใบใหม่ — หยุด');
  const rec=after.find(r=>!before.some(b=>b.id===r.id));

  console.log('\n═══ 3. เอกสารที่ออกมา — วันที่แต่ละตัวไปลงถูกใบไหม ═══');
  await send('Page.navigate',{url:APP+'/history.html'}); await sleep(3500);
  const doc=await ev(`
    return new Promise(res=>{
      window.html2pdf=()=>({set:()=>({from:()=>({save:()=>Promise.resolve()})})});
      const b=document.createElement('button'); b.innerHTML='x'; document.body.appendChild(b);
      window.event={currentTarget:b,target:b};
      fetch('/expenses',{headers:{Authorization:'Bearer '+localStorage.getItem('token')}})
        .then(r=>r.json()).then(l=>{
          const rc=l.find(x=>x.id===${JSON.stringify(rec.id)});
          if(!rc) throw new Error('หาใบไม่เจอ');
          return exportPDF(rc);})
        .then(()=>{const el=document.getElementById('formal-doc')||document.getElementById('pdf-container');
                   res(el?el.innerText.replace(/\\s+/g,' '):'ไม่พบเอกสาร');})
        .catch(e=>res('ล้มเหลว: '+e.message));});`);
  await sleep(400);
  const D = String(doc);
  const count = s => D.split(s).length - 1;

  console.log('   ความยาวเอกสาร ' + D.length + ' ตัวอักษร');
  check('เอกสารมีทั้งสองใบ',
        D.includes('ใบรายงานการเดินทางไปปฏิบัติงาน') && D.includes('ใบรับรองแทนใบเสร็จรับเงิน'),
        'รายงาน:' + D.includes('ใบรายงานการเดินทางไปปฏิบัติงาน') + ' พาหนะ:' + D.includes('ใบรับรองแทนใบเสร็จรับเงิน'));

  check('วันที่บนเอกสาร 01/08/2569 ปรากฏ (ทั้งสองใบใช้ตัวนี้)', count('01/08/2569') >= 2,
        'พบ ' + count('01/08/2569') + ' ครั้ง');
  check('ในระหว่างวันที่ 01/09/2569 - 05/09/2569 ปรากฏ',
        D.includes('01/09/2569') && D.includes('05/09/2569'));
  check('วันเดินทางจริง 26/08/2569 และ 28/08/2569 ปรากฏ',
        D.includes('26/08/2569') && D.includes('28/08/2569'));
  check('ไม่มีวันที่บันทึกวันนี้หลุดเข้าไป',
        !D.includes('10/09/2569'), D.includes('10/09/2569') ? 'พบ 10/09/2569 ในเอกสาร' : '');

  // แยกดูทีละใบ เพื่อรู้ว่าวันไหนอยู่ใบไหน
  const iRec = D.indexOf('ใบรับรองแทนใบเสร็จรับเงิน');
  const reportPart = iRec > 0 ? D.slice(0, iRec) : D;
  const receiptPart = iRec > 0 ? D.slice(iRec) : '';
  console.log('\n   ── ใบรายงานการเดินทาง ──');
  console.log('      วันที่บนเอกสาร 01/08 : ' + (reportPart.includes('01/08/2569') ? 'มี' : 'ไม่มี'));
  console.log('      ในระหว่างวันที่ 01/09 : ' + (reportPart.includes('01/09/2569') ? 'มี' : 'ไม่มี'));
  console.log('      วันเดินทาง 26/08      : ' + (reportPart.includes('26/08/2569') ? 'มี' : 'ไม่มี'));
  console.log('   ── ใบรับรองค่าพาหนะ ──');
  console.log('      วันที่บนเอกสาร 01/08 : ' + (receiptPart.includes('01/08/2569') ? 'มี' : 'ไม่มี'));
  console.log('      ในระหว่างวันที่ 01/09 : ' + (receiptPart.includes('01/09/2569') ? 'มี' : 'ไม่มี (ถูกต้อง ใบนี้ไม่มีช่องนี้)'));

  check('ใบรายงานใช้วันที่บนเอกสาร', reportPart.includes('01/08/2569'));
  check('ใบค่าพาหนะใช้วันที่บนเอกสารด้วย (ช่อง วัน เดือน ปี)', receiptPart.includes('01/08/2569'));
  check('ในระหว่างวันที่อยู่บนใบรายงานเท่านั้น',
        reportPart.includes('01/09/2569') && !receiptPart.includes('01/09/2569'));

  await fetch(APP+'/expenses/'+rec.id,{method:'DELETE',headers:{Authorization:'Bearer '+tok}}).catch(()=>{});
  const realErr=errors.filter(e=>!/favicon|fonts\.g|ERR_|html2pdf/i.test(e));
  check('ไม่มี JavaScript error', realErr.length===0, realErr.slice(0,2).join(' | '));

  const pass=results.filter(r=>r.ok).length, fail=results.filter(r=>!r.ok);
  console.log('\n'+'═'.repeat(62));
  console.log('  ผ่าน '+pass+' / '+results.length);
  fail.forEach(f=>console.log('    ✗ '+f.n));
  console.log('═'.repeat(62));
  process.exitCode=fail.length?1:0;
} catch(e){ console.error('ล้มเหลว:', e.message); process.exitCode=2; }
finally { try{ws.close();}catch{} chrome.kill(); }
