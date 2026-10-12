/**
 * ชื่อประเภทเอกสารแนบต้องขึ้นในหน้าแอดมิน
 *
 * อาการ 12 ต.ค. 2569: หน้าแอดมินช่อง "ชื่อประเภทเอกสาร" ว่างเปล่าทุกแถว
 * แต่หน้าเบิกแสดงชื่อถูกต้อง
 *
 * สาเหตุ: getAttachmentRules() ใส่ label: '' ให้ทุกแถวเสมอ (ไม่ใช่ undefined)
 * แล้ว renderAttachmentRows() เช็คด้วย `!== undefined` ซึ่ง '' ผ่านเงื่อนไข
 * จึงไม่ตกไปใช้ชื่อเริ่มต้น  ส่วน expense.html เช็คด้วยความจริงเท็จ (`r.label ?`)
 * จึงตกไปใช้ชื่อเริ่มต้นได้ถูกต้อง
 *
 * เทสต์นี้อ่านนิพจน์จริงจากไฟล์ ไม่ได้คัดลอกมาเขียนใหม่
 * จึงพังถ้าใครแก้โค้ดกลับไปเป็นแบบเดิม
 */
const fs = require('fs');
const path = require('path');

const ADMIN = path.join(__dirname, '..', 'public', 'admin.html');
const EXPENSE = path.join(__dirname, '..', 'public', 'expense.html');

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log('ผ่าน   ' + name); }
    else { fail++; console.log('ตก     ' + name + (detail ? '  <-- ' + detail : '')); }
}

const admin = fs.readFileSync(ADMIN, 'utf8');
const expense = fs.readFileSync(EXPENSE, 'utf8');

// ── ดึงตาราง ATT_LABELS จริงจากไฟล์ ──
const labelsBlock = admin.match(/const ATT_LABELS = \{([\s\S]*?)\};/);
if (!labelsBlock) { console.log('หา ATT_LABELS ในไฟล์ไม่เจอ'); process.exit(1); }
const ATT_LABELS = {};
for (const m of labelsBlock[1].matchAll(/(\w+)\s*:\s*'([^']*)'/g)) ATT_LABELS[m[1]] = m[2];
check('อ่าน ATT_LABELS จากไฟล์ได้ครบ 4 ชนิด', Object.keys(ATT_LABELS).length === 4,
      JSON.stringify(ATT_LABELS));

// ── ดึงบรรทัดที่คำนวณชื่อที่จะใส่ในช่อง ──
const lineMatch = admin.match(/const currentLabel = ([^;]+);/);
if (!lineMatch) { console.log('หาบรรทัด currentLabel ไม่เจอ'); process.exit(1); }
const expr = lineMatch[1];
console.log('นิพจน์ที่ใช้จริงในไฟล์: ' + expr.trim());
console.log('');

function currentLabelFor(r, id) {
    // eslint-disable-next-line no-new-func
    return new Function('r', 'id', 'ATT_LABELS', 'return (' + expr + ');')(r, id, ATT_LABELS);
}

// ── กรณีที่เกิดขึ้นจริงบนหน้าจอ ──
console.log('-- ชนิดมาตรฐาน ผู้ใช้ไม่เคยตั้งชื่อเอง --');
for (const id of Object.keys(ATT_LABELS)) {
    const r = { show: true, required: false, label: '' };   // สิ่งที่ getAttachmentRules คืนมาจริง
    check('รหัส ' + id + ' ต้องขึ้นชื่อ "' + ATT_LABELS[id] + '"',
          currentLabelFor(r, id) === ATT_LABELS[id],
          'ได้ ' + JSON.stringify(currentLabelFor(r, id)));
}

console.log('');
console.log('-- ชนิดมาตรฐาน ที่หมวดนี้ยังไม่มีกติกาเก็บไว้เลย --');
for (const id of Object.keys(ATT_LABELS)) {
    const r = { show: false, required: false };             // ไม่มีคีย์ label
    check('รหัส ' + id + ' ต้องขึ้นชื่อเริ่มต้น',
          currentLabelFor(r, id) === ATT_LABELS[id],
          'ได้ ' + JSON.stringify(currentLabelFor(r, id)));
}

console.log('');
console.log('-- ผู้ใช้ตั้งชื่อเองทับชื่อเริ่มต้น --');
check('ชื่อที่ตั้งเองต้องชนะชื่อเริ่มต้น',
      currentLabelFor({ show: true, label: 'ใบเสร็จค่าที่พัก' }, 'RECEIPT') === 'ใบเสร็จค่าที่พัก');

console.log('');
console.log('-- ชนิดที่ผู้ใช้สร้างเอง --');
check('ชนิดสร้างเองที่มีชื่อ ต้องขึ้นชื่อนั้น',
      currentLabelFor({ show: true, label: 'asda' }, 'CUSTOM_1') === 'asda',
      'ได้ ' + JSON.stringify(currentLabelFor({ show: true, label: 'asda' }, 'CUSTOM_1')));
check('ชนิดสร้างเองที่ยังไม่ตั้งชื่อ ต้องว่างไว้ให้เห็น placeholder (จำเป็น) ไม่ใช่โชว์รหัสดิบ',
      currentLabelFor({ show: true, label: '' }, 'CUSTOM_1') === '',
      'ได้ ' + JSON.stringify(currentLabelFor({ show: true, label: '' }, 'CUSTOM_1')));

// ── หน้าแอดมินกับหน้าเบิกต้องตัดสินชื่อเหมือนกัน ──
console.log('');
console.log('-- สองหน้าต้องให้ชื่อตรงกัน --');
const expLine = expense.match(/const label = r\.label \? [^;]+;/);
check('หน้าเบิกยังใช้การตกไปใช้ชื่อเริ่มต้นแบบความจริงเท็จ (ตัวตั้งต้นที่ถูก)',
      !!expLine, expLine ? '' : 'หาบรรทัดในหน้าเบิกไม่เจอ');
check('หน้าแอดมินต้องไม่ใช้ !== undefined ซึ่งทำให้ค่าว่างถูกนับว่ามีชื่อ',
      !/r\.label !== undefined/.test(admin),
      'ยังเจอ r.label !== undefined อยู่ในไฟล์');

console.log('');
console.log('สรุป: ผ่าน ' + pass + '  ตก ' + fail);
process.exit(fail ? 1 : 0);
