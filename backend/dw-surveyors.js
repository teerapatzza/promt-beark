/* ══════════════════════════════════════════════════════════════════
   ทะเบียนผู้เยี่ยมสำรวจ ส่งให้ HA Data Warehouse — อ่านอย่างเดียว
   ──────────────────────────────────────────────────────────────────
   28 ต.ค. 2569 — HA PORTAL ต้องใช้ข้อมูลผู้เยี่ยมสำรวจ ทางที่ตกลงกันคือ
   เอาข้อมูลทั้งหมดเข้า DW ก่อน แล้วค่อยคัดส่ง Portal ด้วย SQL ใน DS
   API นี้จึงส่ง "ครบทุกคอลัมน์" ไม่ได้จัดรูปตามสเปก Portal

   ต้นทางเป็น Excel ที่ไม่อัปเดต (ของแก้ขัดจนกว่า Smart Survey จะต่อ DW ได้)
   แปลงด้วย scripts/convert-surveyors.py แล้ววางไฟล์ JSON ไว้ในโฟลเดอร์ข้อมูลของ backend
   ไฟล์มีเลขบัตรประชาชน ที่อยู่ เบอร์โทร — ไม่อยู่ใน git เพราะ repo เป็น public

   4 ตาราง ทุกตารางมี surveyor_id ไว้ join กัน และ generated_at เท่ากันทั้งรอบ
     /dw/surveyors               1 แถว = 1 คน
     /dw/surveyor-visits         1 แถว = คน × ปี × บทบาท (SUR / LS / ST) → mandays
     /dw/surveyor-trainings      1 แถว = คน × ปี → จำนวนครั้งที่อบรม
     /dw/surveyor-registrations  1 แถว = การขึ้นทะเบียนหรือต่ออายุหนึ่งครั้ง

   กุญแจแยกจาก DW_API_KEY ของยอดค่าเบิก ถ้ากุญแจตัวใดรั่วจะไม่ลามถึงอีกชุด
   ไม่ตั้ง DW_SURVEYOR_KEY = ปิดสนิท ตอบ 503

   ต้องติดตั้งก่อน dw-export ใน server.js เพราะตัวนั้นตรวจกุญแจของตัวเอง
   กับทุกเส้นทางใต้ /dw ส่วนตัวนี้ตรวจเฉพาะเส้นทางของตัวเอง เส้นทางอื่นจึงผ่านไปถึงตัวนั้นได้
   ══════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

const KEY_HEADER = 'x-api-key';

function sameKey(given, expected) {
    if (typeof given !== 'string' || typeof expected !== 'string') return false;
    const a = Buffer.from(given, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/** วันนี้ตามเวลาไทย 'YYYY-MM-DD' — สถานะยังไม่หมดอายุและอายุคิดตามวันไทย ไม่ใช่ UTC */
function todayBangkok(now) {
    return new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function ageOn(birth, today) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birth || ''))) return null;
    let age = Number(today.slice(0, 4)) - Number(birth.slice(0, 4));
    if (today.slice(5) < birth.slice(5)) age -= 1;
    return age;
}

/* ลำดับฟิลด์สำหรับตัวจับคู่ของ DW
   28 ต.ค. 2569 — ตัวจับคู่อัตโนมัติของ DW เลือกฟิลด์ต้นทางตัวแรกในรายการที่ชื่อ "อยู่ข้างใน" ชื่อปลายทาง
   DATA_EMAIL_SARABAN จึงได้ email, DATA_WORK_PROVINCE ได้ province และแก้ด้วยมือแล้วบันทึกไม่ติด
   เลื่อนฟิลด์ที่ชื่อมีชื่อฟิลด์อื่นซ้อนอยู่ไปไว้ก่อนตัวนั้น ตัวจับคู่จะเจอตัวที่ตรงก่อน
   ชื่อและค่าไม่เปลี่ยน เปลี่ยนแค่ลำดับ */
function dwKeyOrder(keys) {
    const out = keys.slice();
    let moved = true;
    while (moved) {
        moved = false;
        for (let i = 0; i < out.length && !moved; i++) {
            const k = out[i];
            const j = out.findIndex(o => o !== k && k.includes(o));
            if (j !== -1 && j < i) {
                out.splice(i, 1);
                out.splice(j, 0, k);
                moved = true;
            }
        }
    }
    return out;
}

module.exports = ({ apiKey, file }) => {
    const router = express.Router();
    const key = String(apiKey || '').trim();

    // อ่านไฟล์ครั้งเดียว อ่านใหม่เมื่อไฟล์ถูกแทนที่ (เวลาแก้ไขเปลี่ยน) ไม่ต้อง restart
    let cache = null, cacheStamp = '';
    function load() {
        const st = fs.statSync(file);
        const stamp = st.mtimeMs + ':' + st.size;
        if (!cache || stamp !== cacheStamp) {
            cache = JSON.parse(fs.readFileSync(file, 'utf8'));
            cacheStamp = stamp;
        }
        return cache;
    }

    const guard = (req, res, next) => {
        if (!key) {
            return res.status(503).json({
                error: 'ช่องส่งข้อมูลผู้เยี่ยมสำรวจยังไม่ได้เปิดใช้งาน ผู้ดูแลระบบต้องตั้งค่า DW_SURVEYOR_KEY ก่อน'
            });
        }
        if (!sameKey(req.get(KEY_HEADER) || '', key)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        try {
            req.surveyorData = load();
        } catch (e) {
            return res.status(503).json({ error: 'ยังไม่มีไฟล์ข้อมูลผู้เยี่ยมสำรวจบนเซิร์ฟเวอร์' });
        }
        next();
    };

    /* 28 ต.ค. 2569 — Pipeline ของ DW อ่านรายการชั้นนอกสุดได้ตอนแสดงตัวอย่าง (199 RECORDS)
       แต่ตอนเขียนจริงได้แถวว่างแถวเดียว จึงเพิ่ม ?format=data ห่อเป็น { data, meta }
       แบบเดียวกับที่ DS ของ HA ส่งออก  ไม่ใส่พารามิเตอร์ = รูปแบบเดิมทุกไบต์ */
    const send = (req, res, rows) => {
        const generatedAt = new Date().toISOString();
        const order = dwKeyOrder(Object.keys(Object.assign({}, rows[0] || {}, { generated_at: '' })));
        const out = rows.map(r => {
            const o = {};
            order.forEach(k => { o[k] = k === 'generated_at' ? generatedAt : r[k]; });
            return o;
        });
        if (req.query.format === 'data') {
            return res.json({ data: out, meta: { total_count: out.length, generated_at: generatedAt } });
        }
        res.json(out);
    };

    /* ข้อมูลรายคน + สถานะคำนวณ ณ วันที่ดึง
       *_active = วันหมดอายุล่าสุดของสายนั้นยังไม่ผ่านไป (นับวันไทย)
       age = อายุเต็มปี ณ วันที่ดึง (ไฟล์ต้นทางมีอายุแบบค่านิ่ง ซึ่งจะผิดไปเรื่อย ๆ จึงไม่ใช้) */
    router.get('/surveyors', guard, (req, res) => {
        const today = todayBangkok(new Date());
        const act = d => (d ? d >= today : false);
        send(req, res, (req.surveyorData.surveyors || []).map(s => Object.assign({}, s, {
            age: ageOn(s.birth_date, today),
            surveyor_active: act(s.surveyor_expire_date),
            team_leader_active: act(s.team_leader_expire_date),
            trainer_active: act(s.trainer_expire_date)
        })));
    });
    router.get('/surveyor-visits', guard, (req, res) => send(req, res, req.surveyorData.visits || []));
    router.get('/surveyor-trainings', guard, (req, res) => send(req, res, req.surveyorData.trainings || []));
    router.get('/surveyor-registrations', guard, (req, res) => send(req, res, req.surveyorData.registrations || []));

    return router;
};
