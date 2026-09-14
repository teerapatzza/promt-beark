// ดึงใบเบิกจริงออกมาเป็นตัวเทียบสำหรับทดสอบ — อ่านอย่างเดียว ไม่แก้อะไรในฐานข้อมูล
// แทนรูป base64 ด้วยข้อความสั้น ๆ ที่คงที่ เพื่อให้ไฟล์เล็กและเทียบกันได้แน่นอน
// (โครง HTML ของส่วนรูปยังถูกเทียบเหมือนเดิม เพราะใช้ตัวแทนชุดเดียวกันทั้งก่อนและหลัง)
const fs = require('fs');
const Database = require('better-sqlite3');
const db = new Database('/app/data/prompt-berk.db', { readonly: true });

const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function stripImages(v) {
  if (typeof v === 'string') return v.startsWith('data:image/') ? PLACEHOLDER : v;
  if (Array.isArray(v)) return v.map(stripImages);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = stripImages(v[k]);
    return o;
  }
  return v;
}

const out = db.prepare('SELECT id, data, created_at FROM expenses ORDER BY id ASC').all().map(r => {
  const d = stripImages(JSON.parse(r.data));
  d.id = r.id;
  if (!d.createdAt) d.createdAt = r.created_at;
  // แผนที่ต้องโหลดภาพจากเน็ต ผลจะไม่เหมือนเดิมทุกครั้ง ปิดไว้ให้การเทียบแน่นอน
  if (d.inputMetadata && d.inputMetadata._travel) d.inputMetadata._travel.useAppMap = false;
  return d;
});

fs.writeFileSync('/app/data/expenses-snapshot-input.json', JSON.stringify(out));
console.log('  ดึงมา ' + out.length + ' ใบ  ขนาดไฟล์ ' +
            Math.round(fs.statSync('/app/data/expenses-snapshot-input.json').size / 1024) + ' KB');

const shapes = {};
for (const d of out) {
  const m = d.inputMetadata || {};
  const t = (m._pdfTemplates || []).slice().sort().join('+') || '(ไม่มี)';
  shapes[t] = (shapes[t] || 0) + 1;
}
console.log('  รูปแบบเอกสารที่มีในข้อมูลจริง:');
for (const [k, v] of Object.entries(shapes)) console.log('    ' + String(v).padStart(3) + ' ใบ  ' + k);
