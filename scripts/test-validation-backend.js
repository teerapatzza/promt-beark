// ตรวจกฎฝั่งเซิร์ฟเวอร์ให้ตัดสินเหมือนฝั่งหน้าเว็บ
//
// ที่มา: 25 ก.ย. 2569 หน้าเว็บผ่านแล้ว แต่เซิร์ฟเวอร์ตีกลับด้วยข้อความเดียวกัน
// คือ "ยังไม่ได้แนบใบเสร็จ!" เพราะกฎชุดเดียวกันถูกเขียนไว้สองที่
// และฝั่งเซิร์ฟเวอร์ยังนับช่อง "ภาพแผนที่" เป็นช่องแนบไฟล์อยู่
//
//   node scripts/test-validation-backend.js
const path = require('path');
const { validateExpense } = require(path.join(__dirname, '..', 'backend', 'validation'));

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++;
  console.log((c ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };
const attachErr = errs => errs.find(e => e.field === 'attachments');

// หมวดแบบเดียวกับของจริง: แผนที่บังคับ ใบเสร็จไม่บังคับ
const CAT_MAP_ONLY = {
  id: 'ATT', name: 'ทดสอบ', fuelRate: 5,
  attachmentRules: {
    LOCATION:    { show: true, required: true },
    RECEIPT:     { show: true, required: false },
    TAX_INVOICE: { show: true, required: false },
    PHOTO:       { show: true, required: false }
  }
};
const CAT_RECEIPT_REQ = JSON.parse(JSON.stringify(CAT_MAP_ONLY));
CAT_RECEIPT_REQ.attachmentRules.RECEIPT.required = true;

// หมวดแบบเก่าที่ใช้ requiredFields แทน attachmentRules
const CAT_LEGACY_MAP = { id: 'OLD', name: 'เก่า', requiredFields: ['LOCATION'] };
const CAT_LEGACY_RECEIPT = { id: 'OLD2', name: 'เก่า2', requiredFields: ['LOCATION', 'RECEIPT'] };

const mk = costs => ({
  requestedBy: 'ทดสอบ', amount: 3226.5, date: '2025-10-20',
  attachments: { images: [] },
  inputMetadata: {
    _pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT'],
    _activityName: 'ประชุม', _position: 'ที่ปรึกษา', _carType: 'ไป-กลับ',
    _addr: { no: '1', sub: 'บางรัก', dist: 'บางรัก', prov: 'กรุงเทพมหานคร', zip: '10500' },
    _travel: { startDate: '2025-10-20', endDate: '2025-10-22',
               from: 'บ้าน', to: 'ที่ทำงาน', distOut: '28.65', distRet: '28.65',
               fromGeo: { lat: 13.70, lng: 100.50 }, toGeo: { lat: 13.80, lng: 100.55 } },
    _costs: Object.assign({ hotelEntries: { entries: [] }, fuelRate: '5', taxiEntries: [],
                            airAmount: 0, tollAmount: 0, parkingAmount: 0, otherAmount: 0 }, costs)
  }
});

// ใบจริงที่ผู้ใช้เจอปัญหา: ตั๋วเครื่องบิน 1,000 · ทางด่วน 140 · ที่จอดรถ 300 · อื่นๆ 1,500
const REAL = mk({ airAmount: 1000, tollAmount: 140, parkingAmount: 300, otherAmount: 1500 });

console.log('═══ 1. แผนที่บังคับ ใบเสร็จไม่บังคับ — ต้องไม่เรียกร้องไฟล์แนบ ═══');
const e1 = validateExpense(REAL, CAT_MAP_ONLY, 600);
ok('ไม่มีคำเตือนเรื่องไฟล์แนบ', !attachErr(e1),
   attachErr(e1) ? String(attachErr(e1).message).replace(/\n+/g, ' ').slice(0, 120) : 'ไม่มี');
ok('ไม่มีข้อผิดพลาดระดับ error เลย',
   e1.filter(x => x.level === 'error').length === 0,
   e1.filter(x => x.level === 'error').map(x => String(x.message).split('\n')[0]).join(' | ') || 'ไม่มี');

console.log('');
console.log('═══ 2. หมวดแบบเก่าที่ตั้ง requiredFields ก็ต้องได้ผลเดียวกัน ═══');
ok('requiredFields = [LOCATION] ไม่เรียกร้องไฟล์แนบ',
   !attachErr(validateExpense(REAL, CAT_LEGACY_MAP, 600)));

console.log('');
console.log('═══ 3. ถ้าแอดมินตั้งว่าใบเสร็จบังคับจริง ต้องยังบังคับอยู่ ═══');
const e3 = validateExpense(REAL, CAT_RECEIPT_REQ, 600);
ok('ไม่แนบไฟล์ → ถูกกันไว้', !!attachErr(e3),
   attachErr(e3) ? String(attachErr(e3).message).split('\n')[0] : 'ไม่ถูกกัน');
ok('บอกยอดที่ต้องมีใบเสร็จครบ รวมค่าที่จอดรถด้วย',
   !!attachErr(e3) && /ค่าที่จอดรถ 300/.test(attachErr(e3).message),
   attachErr(e3) ? String(attachErr(e3).message).replace(/\n+/g, ' ').slice(0, 150) : '');
ok('requiredFields = [LOCATION, RECEIPT] ก็ยังบังคับ',
   !!attachErr(validateExpense(REAL, CAT_LEGACY_RECEIPT, 600)));

const withFile = JSON.parse(JSON.stringify(REAL));
withFile.attachments.images = ['data:image/png;base64,iVBORw0KGgo='];
ok('แนบไฟล์แล้ว → ผ่าน', !attachErr(validateExpense(withFile, CAT_RECEIPT_REQ, 600)));

console.log('');
console.log('═══ 4. ค่าใช้จ่ายที่ไม่ต้องมีใบเสร็จ ไม่ควรถูกเรียกร้อง ═══');
const onlyFuel = mk({});
ok('มีแต่ค่าน้ำมัน ไม่มีค่าที่ต้องมีใบเสร็จ → ไม่ถูกกัน แม้ใบเสร็จจะบังคับ',
   !attachErr(validateExpense(onlyFuel, CAT_RECEIPT_REQ, 600)));
const onlyParking = mk({ parkingAmount: 300 });
ok('มีแต่ค่าที่จอดรถ → ถูกกันเหมือนฝั่งหน้าเว็บ (สองฝั่งตัดสินตรงกัน)',
   !!attachErr(validateExpense(onlyParking, CAT_RECEIPT_REQ, 600)));

console.log('');
console.log('══════════════════════════════════════');
console.log('  ผ่าน ' + pass + ' / ' + (pass + fail));
console.log('══════════════════════════════════════');
process.exit(fail ? 1 : 0);
