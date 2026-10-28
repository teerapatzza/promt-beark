// API ทะเบียนผู้เยี่ยมสำรวจสำหรับ HA Data Warehouse (/dw/surveyor*)
//
// 28 ต.ค. 2569 — HA PORTAL ต้องใช้ข้อมูลผู้เยี่ยมสำรวจ ตกลงกันว่าเอาข้อมูลทั้งหมดเข้า DW ก่อน
// แล้วค่อยคัดส่ง Portal ด้วย SQL ใน DS  ต้นทางเป็น Excel ที่มีเลขบัตรประชาชน ที่อยู่ เบอร์โทร
// ไฟล์จริงจึงเข้า repo ไม่ได้ ชุดนี้สร้าง Excel ปลอมที่หัวคอลัมน์เหมือนของจริงทุกช่อง (คนสมมติ)
//
// ตรวจสามชั้น
//   1. ตัวแปลง: แปลงครบ ไม่หล่น ปรับรูปแบบที่ทำให้ join ผิด และหยุดเมื่อไฟล์ไม่ตรงแบบ
//   2. API: กุญแจแยกจากของยอดค่าเบิก ไม่มีกุญแจ = ปิด ข้อมูลตรงกับไฟล์
//   3. server.js: ติดตั้งก่อน dw-export และ /dw/expense-summary ยังทำงานเหมือนเดิม
//
//   NODE_PATH=<repo>/backend/node_modules node scripts/test-dw-surveyors.mjs
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'backend', 'package.json'));
const PY = process.env.PYTHON || 'python';
const SERVERS = [];
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-dwsur-'));

const results = [];
const ok = (n, pass, d = '') => { results.push(!!pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + n + (d !== '' ? '  -> ' + d : '')); };

/* ── Excel ปลอม: หัวคอลัมน์ตามไฟล์ต้นทางทุกช่อง ── */
const MAKE = String.raw`
import openpyxl, sys, json, datetime
spec = json.loads(open(sys.argv[1], encoding='utf-8').read())
wb = openpyxl.Workbook(); ws = wb.active; ws.title = spec.get('sheet', 'sur')
for row in spec['rows']:
    ws.append([datetime.datetime.fromisoformat(v[2:]) if isinstance(v, str) and v.startswith('D:') else v for v in row])
wb.save(sys.argv[2])
`;
fs.writeFileSync(path.join(TMP, 'make.py'), MAKE);

const W = 201;
const H1 = Array(W).fill(null), H2 = Array(W).fill(null);
const set = (i, h) => { H1[i] = h; };
['เลข\nทะเบียน', 'คำนำหน้า', 'ชื่อ-สกุล', 'ชื่อภาษาอังกฤษ', 'ชื่อเล่น', 'ปฎิบัติ\nงาน', 'หน่วยงาน', 'Hcode', 'สังกัด',
 'จังหวัดที่ปฏิบัติงาน', 'ภูมิภาค', 'เขตสุขภาพ', 'ผู้เยี่ยมมาตรฐานอื่น', 'วิชาชีพ', 'วิชาชีพ filter',
 'ตำแหน่งบริหารปัจจุบัน (รวมอดีต)', 'เลขประกอบวิชาชีพ  เลขสมาชิกแพทย์สภา/ สภาการพยาบาล',
 'เยี่ยม AS/RS', 'เยี่ยม AHA', 'เยี่ยม PDSC', 'เยี่ยม HNA', 'เยี่ยม DHSA', 'เยี่ยม PHCA',
 'Clinical team', 'Nurse team', 'Admin team', 'Phamacy team', 'สถานะ'].forEach((h, i) => set(i, h));
set(28, 'ประวัติการเยี่ยม (mandays) (SUR = ผู้เยี่ยมสำรวจ,  LS = หัวหน้าทีม,  ST = ครูฝึก)');
for (let y = 2553, i = 28; y <= 2569; y++) for (const r of ['SUR', 'LS', 'ST']) H2[i++] = y + '\n' + r;
set(79, 'ประวัติการเข้าการอบรม (ครั้ง)');
for (let y = 2553, i = 79; y <= 2568; y++) H2[i++] = y;
set(95, 'Exist SUR'); H2[95] = 'ปีที่'; set(96, 'จำนวนปี'); H2[96] = 'ปีปัจจุบัน - ปีขึ้นทะเบียน';
const pairs = (start, heads) => heads.forEach((h, k) => { set(start + 2 * k, h); if (h) set(start + 2 * k + 1, 'หมดอายุ'); });
pairs(97, ['ขึ้นทะเบียน New surveyor', 'ต่ออายุ กรณีพิเศษ', 'ต่ออายุ ครั้งที่ 2 กรณีพิเศษ', 'ต่ออายุ Experience ปีที่ 1',
           'ต่ออายุครั้งที่ 2', 'ต่ออายุครั้งที่ 3', 'ต่ออายุครั้งที่ 4', 'ต่ออายุครั้งที่ 5', 'ต่ออายุครั้งที่ 6', 'ต่ออายุครั้งที่ 7']);
set(119, 'จำนวนปี หน.ทีม');
pairs(120, ['ขึ้นทะเบียน หน.ทีม', 'ต่ออายุครั้งที่ 1', 'ต่ออายุครั้งที่ 2', 'ต่ออายุครั้งที่ 3', 'ต่ออายุครั้งที่ 4']);
set(132, 'จำนวนปี ครู');
pairs(133, ['ขึ้นทะเบียน ครู', 'ต่ออายุครั้งที่ 1', 'ต่ออายุครั้งที่ 2']);
['โทร', 'Line ID', 'e-mail ผู้เยี่ยมสำรวจ', 'e-mail สารบรรณอิเล็กทรอนิกส์', 'ที่อยู่ที่ทำงาน', 'แขวง/ตำบล', 'อำเภอ/เขต',
 'จังหวัด', 'รหัสไปรษณีย์', 'ที่อยู่บ้านพัก', 'ตำบล/แขวง', 'อำเภอ/เขต', 'จังหวัด', 'รหัสไปรษณีย์', 'ทะเบียนรถ', 'ประเภทรถ',
 'Royal orcrid plus', 'แอร์เอเชีย', 'นกแอร์', 'บางกอกแอร์', 'วันเกิด', 'อายุ', 'คศ.', 'หมายเลขบัตรประชาชน', 'หมายเหตุ',
 'หมายเหตุการแจ้งต้นสังกัด'].forEach((h, k) => set(141 + k, h));
H2[157] = 'การบินไทย';

/* เลขบัตรสมมติที่ผ่านการตรวจหลักสุดท้าย */
const idWithCheck = d12 => { let s = 0; for (let i = 0; i < 12; i++) s += +d12[i] * (13 - i); return d12 + ((11 - s % 11) % 10); };
const ID_A = idWithCheck('110000000001'), ID_B = idWithCheck('310000000002');

function person(o) {
  const r = Array(W).fill(null);
  Object.entries(o).forEach(([k, v]) => { r[+k] = v; });
  return r;
}
const A = person({ 0: 'S901', 1: 'นาย', 2: 'ทดสอบ หนึ่ง', 3: 'Test One', 5: 'FT', 6: 'โรงพยาบาลทดสอบ', 7: 10671, 8: '-',
  9: 'นนทบุรี', 10: 'กลาง', 11: 4, 13: 'แพทย์', 14: 'แพทย์', 16: 12345, 17: 1, 19: 1, 23: 1, 27: 'หัวหน้าทีม ',
  28: 3, 29: 0, 30: 0, 76: 12, 77: 4, 78: 0, 79: 1, 94: 2, 95: 5, 96: 6,
  97: 'D:2020-06-07', 98: 'D:2022-06-06', 103: 'D:2022-06-07', 104: 'D:2024-06-06',
  115: 'D:2025-01-31', 116: 'D:1930-01-30', 117: 'D:2026-01-31', 118: 'D:2099-12-31',
  119: 2, 120: 'D:2023-01-01', 121: 'D:2099-01-01',
  141: 812345678, 143: 'one@example.invalid', 149: 10110, 154: '10120 10120', 161: 'D:2532-02-21', 162: 99,
  163: 'D:1989-02-21', 164: ID_A.replace(/^(\d)(\d{4})(\d{5})(\d{2})(\d)$/, '$1 $2 $3 $4 $5'), 165: '  หมายเหตุ  ' });
const B = person({ 0: 'S902', 1: 'นาง', 2: 'ทดสอบ สอง', 3: 'Test Two', 5: 'PT', 6: 'หน่วยงานทดสอบ', 7: '-', 9: 'ตาก', 10: 'เหนือ', 11: 2,
  13: 'พยาบาล', 14: 'พยาบาล', 17: 1, 27: 'ผู้เยี่ยมสำรวจ', 76: 0, 77: 0, 78: 0, 95: 1, 96: 1,
  97: 'D:2010-01-01', 98: 'D:2012-01-01', 113: 'D:2020-01-28',
  141: '081-234-5678', 143: 'two@example.invalid', 154: '10120 10130', 163: 'D:1970-01-15', 164: ID_B });
const JUNK = person({ 7: 0, 12: 'x' });

async function makeXlsx(name, rows, sheet) {
  const spec = path.join(TMP, name + '.json'), out = path.join(TMP, name + '.xlsx');
  fs.writeFileSync(spec, JSON.stringify({ sheet: sheet || 'sur', rows }));
  const r = spawnSync(PY, ['-I', path.join(TMP, 'make.py'), spec, out], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('สร้าง Excel ไม่ได้: ' + r.stderr);
  return out;
}
const convert = (xlsx, out) => spawnSync(PY, ['-X', 'utf8', path.join(ROOT, 'scripts', 'convert-surveyors.py'), xlsx, out],
  { encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });

const get = (port, p, key) => new Promise((res, rej) => {
  const req = http.request({ host: '127.0.0.1', port, path: p, headers: key ? { 'x-api-key': key } : {} }, r => {
    let b = ''; r.setEncoding('utf8'); r.on('data', c => { b += c; });
    r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) {} res({ status: r.statusCode, body: j }); });
  });
  req.on('error', rej); req.end();
});

try {
  console.log('═══ 1. ตัวแปลง ═══');
  const xlsx = await makeXlsx('ok', [H1, H2, A, B, JUNK]);
  const out = path.join(TMP, 'surveyors.json');
  const c = convert(xlsx, out);
  ok('แปลงสำเร็จ', c.status === 0, (c.stderr || c.stdout).trim().slice(0, 200));
  const d = c.status === 0 ? JSON.parse(fs.readFileSync(out, 'utf8')) : { surveyors: [], visits: [], trainings: [], registrations: [], issues: [] };
  const a = d.surveyors.find(s => s.surveyor_id === 'S901') || {}, b = d.surveyors.find(s => s.surveyor_id === 'S902') || {};
  ok('ได้ 2 คน แถวเศษไม่มีเลขทะเบียนถูกข้ามและถูกบันทึก', d.surveyors.length === 2
     && d.issues.some(i => i.field === 'row'), d.surveyors.length + ' คน');
  ok('เบอร์ที่ Excel ตัด 0 ทิ้ง ได้ 0 คืน / เบอร์มีขีดเหลือตัวเลขล้วน', a.phone === '0812345678' && b.phone === '0812345678',
     a.phone + ' / ' + b.phone);
  ok('เลขบัตรประชาชนเหลือ 13 หลักล้วน', a.national_id === ID_A && b.national_id === ID_B, a.national_id + ' / ' + b.national_id);
  ok('Hcode ตัวเลขเป็นข้อความ / "-" เป็นค่าว่าง', a.hcode === '10671' && b.hcode === null && a.affiliation === null,
     JSON.stringify([a.hcode, b.hcode, a.affiliation]));
  ok('เลขใบประกอบวิชาชีพเป็นข้อความ', a.license_no === '12345');
  ok('สถานะตัดช่องว่างท้าย', a.status === 'หัวหน้าทีม', JSON.stringify(a.status));
  ok('รหัสไปรษณีย์ซ้ำสองชุดเหมือนกันเหลือชุดเดียว / ต่างกันส่งตามต้นทาง',
     a.home_postcode === '10120' && b.home_postcode === '10120 10130', a.home_postcode + ' / ' + b.home_postcode);
  ok('รหัสไปรษณีย์ที่ทำงานเป็นข้อความ', a.work_postcode === '10110');
  ok('วันเกิดใช้คอลัมน์ ค.ศ. ไม่ใช่คอลัมน์ที่ปน พ.ศ.', a.birth_date === '1989-02-21', a.birth_date);
  ok('โปรแกรม/ทีม เป็นจริงเท็จ', a.program_asrs === true && a.program_aha === false && a.program_pdsc === true
     && a.team_clinical === true && a.team_nurse === false);
  ok('ประวัติเยี่ยม: เก็บช่องที่มีค่า รวมค่า 0 ข้ามช่องว่าง',
     d.visits.filter(v => v.surveyor_id === 'S901').length === 6 && d.visits.filter(v => v.surveyor_id === 'S902').length === 3,
     d.visits.length + ' แถว');
  const v = d.visits.find(x => x.surveyor_id === 'S901' && x.year_be === 2569 && x.role === 'LS') || {};
  ok('ประวัติเยี่ยมมีปี พ.ศ./ค.ศ. บทบาท และ mandays ถูกช่อง', v.mandays === 4 && v.year_ce === 2026 && v.role_name === 'หัวหน้าทีม',
     JSON.stringify(v));
  ok('ประวัติอบรมถูกปี', d.trainings.length === 2 && (d.trainings.find(t => t.year_be === 2568) || {}).trainings === 2);
  const regA = d.registrations.filter(r => r.surveyor_id === 'S901');
  ok('ทะเบียน S901 ครบ 5 ครั้ง (ผู้เยี่ยม 4 + หัวหน้าทีม 1)', regA.length === 5, regA.map(r => r.track + ':' + r.event_order).join(','));
  ok('คอลัมน์ไม่มีหัวถัดจากครั้งที่ 7 = ต่ออายุครั้งที่ 8',
     regA.some(r => r.event_order === 10 && /ครั้งที่ 8/.test(r.event_name) && r.expire_date === '2099-12-31'));
  ok('วันหมดอายุมาก่อนวันเริ่ม ส่งตามต้นทางและรายงาน',
     regA.some(r => r.expire_date === '1930-01-30') && d.issues.some(i => i.surveyor_id === 'S901' && /มาก่อนวันเริ่ม/.test(i.issue)));
  ok('มีวันเริ่มไม่มีวันหมดอายุ ส่งได้และรายงาน',
     d.registrations.some(r => r.surveyor_id === 'S902' && r.start_date === '2020-01-28' && r.expire_date === null)
     && d.issues.some(i => i.surveyor_id === 'S902' && /ไม่มีวันหมดอายุ/.test(i.issue)));
  ok('วันหมดอายุล่าสุดแต่ละสายอยู่ในข้อมูลรายคน', a.surveyor_expire_date === '2099-12-31'
     && a.team_leader_expire_date === '2099-01-01' && a.trainer_expire_date === null && a.surveyor_registered_date === '2020-06-07');
  ok('ไม่มีคอลัมน์อายุค่านิ่งจากต้นทาง', !('age' in a));

  console.log('');
  console.log('═══ 2. ตัวแปลงต้องหยุดเมื่อไฟล์ไม่ตรงแบบ ไม่แปลงผิดเงียบ ๆ ═══');
  const badHead = H1.slice(); badHead[6] = 'ชื่อหน่วยงาน';
  const c2 = convert(await makeXlsx('badhead', [badHead, H2, A]), path.join(TMP, 'x.json'));
  ok('หัวคอลัมน์ไม่ตรง: หยุด', c2.status !== 0 && /\[6\]/.test(c2.stdout + c2.stderr));
  const extra = A.slice(); extra[170] = 'ข้อมูลในคอลัมน์ที่ไม่มีในแบบ';
  const c3 = convert(await makeXlsx('extra', [H1, H2, extra]), path.join(TMP, 'x.json'));
  ok('มีข้อมูลในคอลัมน์ที่ไม่อยู่ในแบบ: หยุด', c3.status !== 0 && /\[170\]/.test(c3.stdout + c3.stderr));
  const noId = B.slice(); noId[0] = null;
  const c4 = convert(await makeXlsx('noid', [H1, H2, noId]), path.join(TMP, 'x.json'));
  ok('คนที่มีชื่อแต่ไม่มีเลขทะเบียน: หยุด ไม่ข้าม', c4.status !== 0);
  const c5 = convert(await makeXlsx('dup', [H1, H2, A, A]), path.join(TMP, 'x.json'));
  ok('เลขทะเบียนซ้ำ: หยุด', c5.status !== 0);
  const c6 = convert(await makeXlsx('sheet', [H1, H2, A], 'อื่น'), path.join(TMP, 'x.json'));
  ok('ชื่อแผ่นงานไม่ตรง: หยุด', c6.status !== 0);

  console.log('');
  console.log('═══ 3. API ═══');
  const express = require('express');
  const mk = (surKey, file, expKey) => {
    const app = express();
    const fakeDb = { prepare: q => ({ all: () => /budget_categories/.test(q)
      ? [{ id: 'T1', data: JSON.stringify({ name: 'หมวด' }) }]
      : [{ data: JSON.stringify({ amount: 100, inputMetadata: { _budgetCategoryId: 'T1' } }), created_at: '2026-10-01 00:00:00' }] }) };
    app.use('/dw', require(path.join(ROOT, 'backend', 'dw-surveyors'))({ apiKey: surKey, file }));
    app.use('/dw', require(path.join(ROOT, 'backend', 'dw-export'))({ db: fakeDb, apiKey: expKey }));
    return new Promise(r => { const s = app.listen(0, '127.0.0.1', () => { SERVERS.push(s); r(s); }); });
  };
  const SK = 'sur-key-' + 'a'.repeat(40), EK = 'exp-key-' + 'b'.repeat(40);
  const srv = await mk(SK, out, EK); const port = srv.address().port;
  const P = ['/dw/surveyors', '/dw/surveyor-visits', '/dw/surveyor-trainings', '/dw/surveyor-registrations'];
  for (const p of P) {
    const r0 = await get(port, p), r1 = await get(port, p, 'wrong-key'), r2 = await get(port, p, EK), r3 = await get(port, p, SK);
    ok(p + ': ไม่มีกุญแจ 401 / กุญแจผิด 401 / กุญแจค่าเบิก 401 / กุญแจถูก 200',
       r0.status === 401 && r1.status === 401 && r2.status === 401 && r3.status === 200,
       [r0, r1, r2, r3].map(x => x.status).join(' '));
    ok(p + ': ได้เป็นรายการหลายแถว generated_at เท่ากันทุกแถว', Array.isArray(r3.body) && r3.body.length > 0
       && new Set(r3.body.map(x => x.generated_at)).size === 1);
  }
  const counts = await Promise.all(P.map(p => get(port, p, SK)));
  ok('จำนวนแถวตรงกับไฟล์ทุกตาราง', counts.map(x => x.body.length).join(',') ===
     [d.surveyors.length, d.visits.length, d.trainings.length, d.registrations.length].join(','),
     counts.map(x => x.body.length).join(','));
  /* ?format=data ห่อเป็น { data, meta } ให้ตัวเขียนของ DW (ไม่ใส่ = รายการชั้นนอกสุดแบบเดิม) */
  const wrapped = await Promise.all(P.map(p => get(port, p + '?format=data', SK)));
  ok('?format=data: ทุกตารางได้ { data: [...], meta } จำนวนแถวเท่ารูปแบบเดิม',
     wrapped.every((w, i) => w.status === 200 && Array.isArray(w.body.data)
       && w.body.data.length === counts[i].body.length && w.body.meta.total_count === counts[i].body.length),
     wrapped.map(w => w.status + ':' + (w.body && w.body.data ? w.body.data.length : '-')).join(','));
  ok('?format=data: แถวข้างในเหมือนรูปแบบเดิมทุกช่อง (ยกเว้นเวลา generated_at)',
     wrapped.every((w, i) => JSON.stringify(w.body.data.map(r => Object.assign({}, r, { generated_at: 0 })))
       === JSON.stringify(counts[i].body.map(r => Object.assign({}, r, { generated_at: 0 })))));
  ok('?format=data ไม่มีกุญแจยังได้ 401', (await get(port, '/dw/surveyors?format=data')).status === 401);
  const sv = counts[0].body.find(s => s.surveyor_id === 'S901') || {};
  const svB = counts[0].body.find(s => s.surveyor_id === 'S902') || {};
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const age = (+today.slice(0, 4) - 1989) - (today.slice(5) < '02-21' ? 1 : 0);
  ok('สถานะยังไม่หมดอายุคิด ณ วันที่ดึง', sv.surveyor_active === true && sv.team_leader_active === true
     && sv.trainer_active === false && svB.surveyor_active === false);
  ok('อายุคิด ณ วันที่ดึง', sv.age === age, sv.age + ' (ควรเป็น ' + age + ')');
  ok('ไม่มีรายงานปัญหาหลุดออกทาง API', !counts.some(x => JSON.stringify(x.body).includes('"issue"')));
  const ex = await get(port, '/dw/expense-summary', EK), ex2 = await get(port, '/dw/expense-summary', SK);
  ok('/dw/expense-summary ยังใช้กุญแจเดิมได้ และกุญแจผู้เยี่ยมเปิดไม่ได้',
     ex.status === 200 && Array.isArray(ex.body) && ex.body[0].totalAmount === 100 && ex2.status === 401,
     ex.status + ' / ' + ex2.status);
  srv.close();

  const srv2 = await mk('', out, EK);
  const n1 = await get(srv2.address().port, '/dw/surveyors', SK);
  ok('ไม่ตั้ง DW_SURVEYOR_KEY = ปิดสนิท 503', n1.status === 503, n1.status);
  srv2.close();
  const srv3 = await mk(SK, path.join(TMP, 'ไม่มีไฟล์.json'), EK);
  const n2 = await get(srv3.address().port, '/dw/surveyors', SK);
  ok('ยังไม่ได้วางไฟล์ข้อมูล = 503 พร้อมข้อความ ไม่ล่ม', n2.status === 503, n2.status);
  srv3.close();

  console.log('');
  console.log('═══ 4. การติดตั้งใน server.js และค่าตั้ง ═══');
  const server = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
  const iSur = server.indexOf("require('./dw-surveyors')"), iExp = server.indexOf("require('./dw-export')");
  ok('ติดตั้ง dw-surveyors ใต้ /dw และก่อน dw-export', iSur > 0 && iExp > 0 && iSur < iExp
     && /app\.use\('\/dw',\s*require\('\.\/dw-surveyors'\)/.test(server));
  ok('กุญแจอ่านจาก DW_SURVEYOR_KEY ไม่ใช่ DW_API_KEY', /dw-surveyors'\)\(\{[^}]*process\.env\.DW_SURVEYOR_KEY/.test(server));
  const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
  ok('docker-compose ส่ง DW_SURVEYOR_KEY เข้า backend', /DW_SURVEYOR_KEY=\$\{DW_SURVEYOR_KEY:-\}/.test(compose));
  const nginx = fs.readFileSync(path.join(ROOT, 'docker', 'nginx.conf'), 'utf8');
  ok('nginx ส่ง /dw/... ถึง backend อยู่แล้ว', /\|dw\|/.test(nginx));
  const tracked = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\n');
  ok('ไม่มีไฟล์ข้อมูลผู้เยี่ยมหรือ Excel อยู่ใน git', !tracked.some(f => /surveyors?\.json$|\.xlsx$/i.test(f)),
     tracked.filter(f => /surveyors?\.json$|\.xlsx$/i.test(f)).join(','));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.stack || e.message); process.exitCode = 2; }
finally { SERVERS.forEach(s => { try { s.closeAllConnections(); s.close(); } catch {} }); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} }
