/* ══════════════════════════════════════════════════════════════════
   ช่องส่งข้อมูลให้ HA Data Warehouse — อ่านอย่างเดียว แยกออกจากระบบเบิก
   ──────────────────────────────────────────────────────────────────
   22 ต.ค. 2569 — เจ้าของงานต้องการพิสูจน์ว่าแอปที่เขียนเองต่อ DW ได้

   เรื่องการเชื่อมต่อพิสูจน์ไปแล้วด้วย /auth/config: DW ยิงเข้ามา 5 ครั้ง
   ได้ 200 ทุกครั้ง จาก 160.187.249.114 และอ่านโครงสร้าง JSON ของเราออกเอง
   แต่ Pipeline ไปค้างตอนเขียนลง Dataset เพราะ /auth/config คืน "ก้อนเดียว"
   ส่วน DW ออกแบบมารับ "หลายแถว" — ช่องนี้จึงคืนเป็นอาร์เรย์ตั้งแต่ชั้นนอกสุด

   ทำไมต้องเป็น API ไม่ใช่ให้ DW ต่อฐานข้อมูลตรง ๆ
     พร้อมเบิกใช้ SQLite ซึ่งเป็นไฟล์ ไม่ใช่เซิร์ฟเวอร์ ไม่มีพอร์ตให้ต่อ
     และต่อให้ย้ายไป PostgreSQL ก็ยังต่อไม่ได้อยู่ดี เพราะเครื่องนี้
     เปิดจากข้างนอกแค่พอร์ต 80 / 443 / 8839 ซึ่งเป็นการบล็อกชั้นนอก
     ที่เราแก้เองไม่ได้ (ทีมอื่นบนเครื่องเดียวกันก็ติดข้อนี้เหมือนกัน)

   ขอบเขตที่ตั้งใจจำกัดไว้
     อ่านสองตาราง expenses กับ budget_categories เท่านั้น ไม่เขียนอะไรเลย
     ส่งออกเฉพาะ "ยอดรวมรายหมวดรายเดือน" ไม่มีข้อมูลรายใบ
     ไม่มีชื่อ ที่อยู่ พิกัดบ้าน อีเมล หรือเลขที่ใบเบิกหลุดออกไปแม้แต่ตัวเดียว
     ถอดไฟล์นี้กับเส้นทาง /dw ทิ้ง ระบบเบิกยังทำงานครบเหมือนเดิมทุกอย่าง

   ปลอดภัยไว้ก่อนเป็นค่าตั้งต้น
     ไม่ตั้ง DW_API_KEY = ช่องนี้ปิดสนิท ตอบ 503 ไม่ใช่เปิดให้ใครก็ได้ดึง
     กุญแจอยู่ในไฟล์ .env ซึ่งไม่อยู่ใน git เพราะ repo นี้เป็น public
   ══════════════════════════════════════════════════════════════════ */
const crypto = require('crypto');
const express = require('express');

/** ชื่อหัวข้อมูลที่ให้ DW ส่งกุญแจมา — ตั้งใน "Headers" ของ Data Source */
const KEY_HEADER = 'x-api-key';

/* เทียบกุญแจแบบไม่ให้เดาได้จากเวลาที่ใช้เทียบ
   timingSafeEqual พังถ้าความยาวสองฝั่งไม่เท่ากัน จึงต้องกันความยาวก่อน
   แต่การกันความยาวเองก็บอกความยาวที่ถูกต้องได้ ซึ่งยอมรับได้
   เพราะกุญแจเป็นค่าสุ่มยาว รู้แค่ความยาวไม่ได้ช่วยให้เดาเนื้อในง่ายขึ้น */
function sameKey(given, expected) {
    if (typeof given !== 'string' || typeof expected !== 'string') return false;
    const a = Buffer.from(given, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/** '2026-10-21T03:00:00.000Z' -> '2026-10' ; อ่านไม่ออกก็คืนค่าว่าง */
function monthOf(iso) {
    const s = String(iso || '');
    return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : '';
}

module.exports = ({ db, apiKey }) => {
    const router = express.Router();
    const key = String(apiKey || '').trim();

    router.use((req, res, next) => {
        if (!key) {
            return res.status(503).json({
                error: 'ช่องส่งข้อมูลให้ Data Warehouse ยังไม่ได้เปิดใช้งาน '
                     + 'ผู้ดูแลระบบต้องตั้งค่า DW_API_KEY ก่อน'
            });
        }
        if (!sameKey(req.get(KEY_HEADER) || '', key)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
    });

    /* ยอดรวมค่าใช้จ่ายรายหมวดรายเดือน — หนึ่งแถวต่อหนึ่งคู่ (หมวด, เดือน)

       ใช้ created_at ของฐานข้อมูลเป็นตัวแบ่งเดือน ไม่ใช่วันเดินทางในใบ
       เพราะ created_at เซิร์ฟเวอร์เป็นคนใส่ มีครบทุกแถวและแก้ไม่ได้จากหน้าเว็บ
       ส่วนวันเดินทางผู้ใช้กรอกเอง มีสิทธิ์ว่างหรือผิดรูปแบบ
       (ตรวจบนโปรดักชันแล้ว 126 ใบมี created_at ครบทุกใบ) */
    router.get('/expense-summary', (_req, res) => {
        /* ชื่อหมวดเก็บเป็น JSON ในคอลัมน์ data ไม่ใช่คอลัมน์แยก
           อ่านมาทำเป็นพจนานุกรมก่อน จะได้ไม่ต้องแกะ JSON ซ้ำทุกใบ */
        const names = new Map();
        for (const row of db.prepare('SELECT id, data FROM budget_categories').all()) {
            try { names.set(row.id, String(JSON.parse(row.data).name || '')); }
            catch (e) { names.set(row.id, ''); }
        }

        const buckets = new Map();
        for (const row of db.prepare('SELECT data, created_at FROM expenses').all()) {
            let obj;
            try { obj = JSON.parse(row.data); } catch (e) { continue; }

            /* หมวดอ่านจาก inputMetadata._budgetCategoryId เท่านั้น
               ห้ามใช้ obj.projectId — ตรวจบนโปรดักชันแล้วเป็น null ทั้ง 126 ใบ
               เป็นฟิลด์ตกค้างจากโครงสร้างเก่า ถ้าเผลอใช้จะได้ null ทั้งตาราง */
            const categoryId = String((obj.inputMetadata || {})._budgetCategoryId || '').trim();
            if (!categoryId) continue;

            const month = monthOf(row.created_at || obj.createdAt);
            if (!month) continue;

            // บางใบเก็บยอดเป็นข้อความ ('49.50') ต้องรวมได้เหมือนกัน
            const amount = Number(obj.amount);
            const k = categoryId + '|' + month;
            const b = buckets.get(k) || { categoryId, month, claims: 0, totalAmount: 0 };
            b.claims += 1;
            b.totalAmount += Number.isFinite(amount) ? amount : 0;
            buckets.set(k, b);
        }

        /* เวลาที่ดึง ใส่ให้ทุกแถวเท่ากันทั้งรอบ — หลักเดียวกับ synced_at ของ DW
           ปลายทางใช้ค่านี้บอกได้ว่าข้อมูลชุดนี้ถ่ายมาเมื่อไหร่ */
        const generatedAt = new Date().toISOString();

        /* ลำดับต้องคงที่ทุกรอบ ไม่งั้น DW เทียบข้อมูลระหว่างรอบไม่ได้
           เดือนใหม่ก่อน แล้วค่อยเรียงรหัสหมวด */
        const rows = [...buckets.values()]
            .sort((x, y) => (y.month.localeCompare(x.month))
                          || (x.categoryId.localeCompare(y.categoryId)))
            .map(b => ({
                categoryId:  b.categoryId,
                categoryName: names.get(b.categoryId) || '',
                month:       b.month,
                claims:      b.claims,
                // ทศนิยมลอยอาจได้ 399.99999999 ตัดให้เหลือสองตำแหน่งตามหน่วยสตางค์
                totalAmount: Math.round(b.totalAmount * 100) / 100,
                generatedAt: generatedAt
            }));

        res.json(rows);
    });

    return router;
};
