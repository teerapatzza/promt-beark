// แบบประเมินการใช้งาน — ตรวจตรรกะหลังบ้าน
//
// 15 ต.ค. 2569 — เจ้าของงานสั่งสามข้อ
//   1 ตอบใหม่ทับของเดิมได้
//   2 ผลสรุปเห็นได้เฉพาะผู้ดูแล
//   3 รองรับคำถามทุกชนิด และสรุปผลได้ครบทุกชนิด
// และกติกาที่ตกลงกันไว้ก่อนหน้า คือคำตอบต้องไม่ระบุตัวตน
//
//   node scripts/test-feedback-core.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const F = require('../backend/feedback.js');

const results = [];
const ok = (name, pass, detail = '') => {
    results.push(pass);
    console.log((pass ? '  ผ่าน  ' : '  ตก    ') + name + (detail ? '  -> ' + detail : ''));
};
const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

console.log('═══ 1. ชนิดคำถามต้องครบตามที่สั่ง ═══');

const WANT = ['face', 'star', 'scale', 'choice', 'multi', 'yesno', 'text', 'section'];
ok('รองรับครบทุกชนิดที่ออกแบบไว้',
   WANT.every(k => F.KINDS.indexOf(k) >= 0),
   F.KINDS.join(' · '));

const form = F.cleanQuestions([
    { kind: 'face',    title: 'พอใจแค่ไหน', required: true },
    { kind: 'section', title: 'ความง่ายในการใช้งาน' },
    { kind: 'star',    title: 'กรอกง่ายไหม', max: 5, required: true },
    { kind: 'scale',   title: 'ให้คะแนน 1-10', max: 10 },
    { kind: 'choice',  title: 'ตรงไหนติดขัด', options: ['Taxi', 'แผนที่', 'วันที่'] },
    { kind: 'multi',   title: 'ใช้ฟังก์ชันไหนบ้าง', options: ['เบิก', 'ประวัติ', 'โปรไฟล์'] },
    { kind: 'yesno',   title: 'จะแนะนำไหม', required: true },
    { kind: 'text',    title: 'ข้อเสนอแนะ' }
]);
ok('สร้างชุดคำถามครบ 8 ข้อ', form.length === 8);
ok('ทุกข้อได้รหัสประจำตัวไม่ซ้ำกัน',
   new Set(form.map(q => q.id)).size === 8);
ok('หัวข้อคั่นหมวดถูกบังคับให้ไม่เป็นข้อบังคับตอบ',
   form[1].required === false);

console.log('');
console.log('═══ 2. กันข้อมูลเสียตั้งแต่ตอนสร้างคำถาม ═══');

ok('ชนิดคำถามที่ไม่รู้จัก ถูกตีกลับ',
   /ไม่รู้จัก/.test(throws(() => F.cleanQuestions([{ kind: 'เดาเอา', title: 'x' }])) || ''));
ok('คำถามที่ไม่มีข้อความ ถูกตีกลับ',
   /ยังไม่ได้ตั้งคำถาม/.test(throws(() => F.cleanQuestions([{ kind: 'text', title: '  ' }])) || ''));
ok('ตัวเลือกน้อยกว่า 2 ข้อ ถูกตีกลับ',
   /อย่างน้อย 2/.test(throws(() => F.cleanQuestions([{ kind: 'choice', title: 'x', options: ['ก'] }])) || ''));
ok('ดาวเกิน 10 ดวง ถูกดึงกลับมาเป็น 5',
   F.cleanQuestions([{ kind: 'star', title: 'x', max: 99 }])[0].max === 5);

console.log('');
console.log('═══ 3. ตรวจคำตอบให้ตรงกับคำถาม ═══');

const id = {};
form.forEach(q => { id[q.kind] = q.id; });

const good = F.cleanAnswers(form, {
    [id.face]: 4, [id.star]: 5, [id.scale]: 8,
    [id.choice]: 'แผนที่', [id.multi]: ['เบิก', 'ประวัติ'],
    [id.yesno]: 'yes', [id.text]: 'ใช้ง่ายดีค่ะ'
});
ok('คำตอบครบถ้วนผ่านการตรวจ', Object.keys(good).length === 7);
ok('หัวข้อคั่นหมวดไม่ถูกเก็บเป็นคำตอบ', good[form[1].id] === undefined);

ok('ข้อบังคับตอบที่เว้นว่าง ถูกตีกลับ',
   /ยังไม่ได้ตอบ/.test(throws(() => F.cleanAnswers(form, { [id.star]: 5, [id.yesno]: 'yes' })) || ''));
ok('ดาวเกินจำนวนที่ตั้งไว้ ถูกตีกลับ',
   /ไม่ถูกต้อง/.test(throws(() => F.cleanAnswers(form, { [id.face]: 4, [id.star]: 9, [id.yesno]: 'yes' })) || ''));
ok('ตัวเลือกที่ไม่มีในรายการ ถูกตีกลับ',
   /ไม่อยู่ในตัวเลือก/.test(throws(() => F.cleanAnswers(form,
       { [id.face]: 4, [id.star]: 5, [id.yesno]: 'yes', [id.choice]: 'ยัดมาเอง' })) || ''));
ok('คำตอบของข้อที่ไม่มีอยู่จริง ถูกทิ้ง ไม่หลุดเข้าฐานข้อมูล',
   F.cleanAnswers(form, { [id.face]: 4, [id.star]: 5, [id.yesno]: 'yes', 'ข้อปลอม': 'xx' })['ข้อปลอม'] === undefined);

const longText = F.cleanAnswers(form,
    { [id.face]: 4, [id.star]: 5, [id.yesno]: 'yes', [id.text]: 'ก'.repeat(900) });
ok('ข้อความยาวเกิน ถูกตัดเหลือ 500 ตัวอักษร',
   longText[id.text].length === 500, longText[id.text].length + ' ตัวอักษร');

console.log('');
console.log('═══ 4. สรุปผลต้องได้ครบทุกชนิดคำถาม ═══');

const rows = [
    { answers: JSON.stringify({ [id.face]: 5, [id.star]: 5, [id.scale]: 9, [id.choice]: 'Taxi',  [id.multi]: ['เบิก'],          [id.yesno]: 'yes', [id.text]: 'ดีมาก' }) },
    { answers: JSON.stringify({ [id.face]: 4, [id.star]: 4, [id.scale]: 7, [id.choice]: 'Taxi',  [id.multi]: ['เบิก','ประวัติ'], [id.yesno]: 'yes', [id.text]: 'ใช้ง่าย' }) },
    { answers: JSON.stringify({ [id.face]: 3, [id.star]: 3, [id.scale]: 5, [id.choice]: 'แผนที่', [id.multi]: ['โปรไฟล์'],       [id.yesno]: 'no' }) }
];
const sum = F.summarise(form, rows);
const by = k => sum.find(s => s.kind === k);

ok('สรุปครบทุกข้อ', sum.length === 8);
ok('หน้ายิ้ม คิดค่าเฉลี่ยได้ถูก (5+4+3)/3 = 4',
   by('face').average === 4, String(by('face').average));
ok('หน้ายิ้ม แจกแจงครบ 5 ระดับ', by('face').distribution.length === 5);
ok('ดาว คิดค่าเฉลี่ยได้ถูก', by('star').average === 4, String(by('star').average));
ok('สเกล 1-10 แจกแจงครบ 10 ช่อง', by('scale').distribution.length === 10);
ok('เลือกตอบ นับ Taxi ได้ 2 ครั้ง',
   by('choice').distribution.find(d => d.value === 'Taxi').count === 2);
ok('เลือกหลายข้อ นับ เบิก ได้ 2 ครั้ง',
   by('multi').distribution.find(d => d.value === 'เบิก').count === 2);
ok('ใช่/ไม่ใช่ คิดสัดส่วนได้ 66.7%',
   by('yesno').average === 66.7, String(by('yesno').average));
ok('ข้อเสนอแนะ เก็บมาครบ 2 ข้อความ', by('text').texts.length === 2);
ok('ข้อเสนอแนะ เรียงใหม่ก่อนเก่า', by('text').texts[0] === 'ใช้ง่าย');
ok('หัวข้อคั่นหมวด ไม่มีตัวเลขสรุปติดมา',
   by('section').distribution === undefined && by('section').answered === 0);
ok('ข้อที่บางคนไม่ตอบ นับเฉพาะคนที่ตอบ',
   by('text').answered === 2, by('text').answered + ' จาก 3 คน');

console.log('');
const pass = results.filter(Boolean).length;
console.log('สรุป ' + pass + '/' + results.length + (pass === results.length ? '  ผ่านทั้งหมด' : '  ยังไม่ผ่าน'));
process.exitCode = pass === results.length ? 0 : 1;
