/* ══════════════════════════════════════════════════════════════════
   แบบประเมินการใช้งาน — แยกออกจากระบบเบิกทั้งก้อน
   ──────────────────────────────────────────────────────────────────
   แตะเฉพาะสามตาราง feedback_forms / feedback_responses / feedback_submitted
   ไม่อ่านไม่เขียน expenses profiles budget_categories settings เลยสักบรรทัด
   ถอดไฟล์นี้ออกกับเส้นทาง /feedback ทิ้ง ระบบเบิกยังทำงานครบเหมือนเดิม

   เรื่องการไม่ระบุตัวตน — ตั้งใจออกแบบให้สืบย้อนไม่ได้
     feedback_responses   เก็บคำตอบ ไม่มีคอลัมน์ user_id
     feedback_submitted   เก็บว่าใครตอบแล้ว ไม่มีคอลัมน์ชี้ไปหาคำตอบ
     สองตารางนี้ไม่มีคีย์เชื่อมกัน ต่อให้เปิดฐานข้อมูลดูตรง ๆ ก็จับคู่ไม่ได้

   การกลับมาแก้คำตอบใช้ edit_token ซึ่งเป็นค่าสุ่มล้วน ไม่ได้คิดจากตัวผู้ใช้
   เก็บไว้ฝั่งเบราว์เซอร์ของเจ้าของคำตอบเท่านั้น เซิร์ฟเวอร์จึงยังไม่รู้ว่าเป็นใคร
   ผลคือ ตอบใหม่จากเครื่องเดิม = ทับของเดิม · จากเครื่องอื่น = เป็นคำตอบใหม่
   ══════════════════════════════════════════════════════════════════ */
const crypto = require('crypto');
const express = require('express');

/** ชนิดคำถามที่รองรับ — ต้องตรงกับหน้าเว็บทั้งสองฝั่ง */
const KINDS = ['face', 'star', 'scale', 'choice', 'multi', 'yesno', 'text', 'section'];
/** ชนิดที่ไม่มีคำตอบ ใช้คั่นหมวดอย่างเดียว */
const NO_ANSWER = ['section'];

const MAX_QUESTIONS = 40;
const MAX_OPTIONS = 12;
const MAX_TEXT = 500;
const MAX_TITLE = 160;

const now = () => new Date().toISOString();
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

/**
 * ตรวจชุดคำถามที่ผู้ดูแลส่งมา คืนชุดที่สะอาดแล้ว หรือโยน Error พร้อมเหตุผลไทย
 * ตรวจที่นี่ที่เดียว หน้าเว็บช่วยกันล่วงหน้าได้ แต่ของจริงตัดสินตรงนี้
 */
function cleanQuestions(raw) {
    const list = Array.isArray(raw) ? raw : [];
    if (list.length > MAX_QUESTIONS)
        throw new Error('คำถามได้ไม่เกิน ' + MAX_QUESTIONS + ' ข้อ');

    return list.map((q, i) => {
        const kind = String((q && q.kind) || '').trim();
        if (KINDS.indexOf(kind) < 0)
            throw new Error('ข้อ ' + (i + 1) + ' ใช้ชนิดคำถามที่ระบบไม่รู้จัก');

        const title = str(q && q.title, MAX_TITLE);
        if (!title) throw new Error('ข้อ ' + (i + 1) + ' ยังไม่ได้ตั้งคำถาม');

        const out = {
            id: str(q && q.id, 40) || ('q' + (i + 1) + '_' + crypto.randomBytes(3).toString('hex')),
            kind: kind,
            title: title,
            hint: str(q && q.hint, 200),
            required: NO_ANSWER.indexOf(kind) < 0 && !!(q && q.required)
        };

        if (kind === 'choice' || kind === 'multi') {
            const opts = (Array.isArray(q.options) ? q.options : [])
                .map(o => str(o, 80)).filter(Boolean);
            if (opts.length < 2)
                throw new Error('ข้อ ' + (i + 1) + ' ต้องมีตัวเลือกอย่างน้อย 2 ข้อ');
            if (opts.length > MAX_OPTIONS)
                throw new Error('ข้อ ' + (i + 1) + ' มีตัวเลือกเกิน ' + MAX_OPTIONS + ' ข้อ');
            out.options = opts;
        }

        if (kind === 'star' || kind === 'scale') {
            const n = parseInt(q && q.max, 10);
            // ดาวเกิน 10 ดวงคนแยกไม่ออกอยู่แล้ว และสเกลต่ำกว่า 2 ไม่มีความหมาย
            out.max = (n >= 2 && n <= 10) ? n : 5;
            out.minLabel = str(q && q.minLabel, 40);
            out.maxLabel = str(q && q.maxLabel, 40);
        }

        return out;
    });
}

/**
 * ตรวจคำตอบที่ผู้ใช้ส่งมา ให้ตรงกับชุดคำถามที่ประกาศไว้
 * ทิ้งคำตอบของข้อที่ไม่มีอยู่จริง เพื่อไม่ให้ใครยัดข้อมูลแปลกปลอมเข้ามา
 */
function cleanAnswers(questions, raw) {
    const given = (raw && typeof raw === 'object') ? raw : {};
    const out = {};

    for (const q of questions) {
        if (NO_ANSWER.indexOf(q.kind) >= 0) continue;
        const v = given[q.id];
        const blank = v == null || v === '' || (Array.isArray(v) && !v.length);

        if (blank) {
            if (q.required) throw new Error('ยังไม่ได้ตอบข้อ "' + q.title + '"');
            continue;
        }

        if (q.kind === 'face') {
            const n = parseInt(v, 10);
            if (!(n >= 1 && n <= 5)) throw new Error('คำตอบข้อ "' + q.title + '" ไม่ถูกต้อง');
            out[q.id] = n;
        } else if (q.kind === 'star' || q.kind === 'scale') {
            const n = parseInt(v, 10);
            if (!(n >= 1 && n <= q.max)) throw new Error('คำตอบข้อ "' + q.title + '" ไม่ถูกต้อง');
            out[q.id] = n;
        } else if (q.kind === 'choice') {
            if (q.options.indexOf(String(v)) < 0)
                throw new Error('คำตอบข้อ "' + q.title + '" ไม่อยู่ในตัวเลือก');
            out[q.id] = String(v);
        } else if (q.kind === 'multi') {
            const picks = (Array.isArray(v) ? v : [v]).map(String)
                .filter(x => q.options.indexOf(x) >= 0);
            if (!picks.length && q.required)
                throw new Error('ยังไม่ได้ตอบข้อ "' + q.title + '"');
            if (picks.length) out[q.id] = picks;
        } else if (q.kind === 'yesno') {
            const s = String(v);
            if (s !== 'yes' && s !== 'no')
                throw new Error('คำตอบข้อ "' + q.title + '" ไม่ถูกต้อง');
            out[q.id] = s;
        } else if (q.kind === 'text') {
            const s = str(v, MAX_TEXT);
            if (s) out[q.id] = s;
            else if (q.required) throw new Error('ยังไม่ได้ตอบข้อ "' + q.title + '"');
        }
    }
    return out;
}

/** ชุดที่เปิดรับอยู่จริงตอนนี้ — ดูทั้งสถานะและช่วงวันที่ */
function openForm(db) {
    const today = now().slice(0, 10);
    return db.prepare(`
        SELECT * FROM feedback_forms
        WHERE status = 'open'
          AND (opens_at  IS NULL OR opens_at  = '' OR opens_at  <= ?)
          AND (closes_at IS NULL OR closes_at = '' OR closes_at >= ?)
        ORDER BY id DESC LIMIT 1
    `).get(today, today);
}

const parseQ = row => {
    try { return JSON.parse(row.questions || '[]'); } catch (_) { return []; }
};

/** สรุปผลรายข้อ ให้หน้าแดชบอร์ดเอาไปวาดได้เลย ไม่ต้องคิดซ้ำฝั่งเบราว์เซอร์ */
function summarise(questions, rows) {
    const answers = rows.map(r => {
        try { return JSON.parse(r.answers || '{}'); } catch (_) { return {}; }
    });

    return questions.map(q => {
        const base = { id: q.id, kind: q.kind, title: q.title, answered: 0 };
        if (NO_ANSWER.indexOf(q.kind) >= 0) return base;

        const vals = answers.map(a => a[q.id]).filter(v => v != null && v !== '');
        base.answered = vals.length;

        if (q.kind === 'face' || q.kind === 'star' || q.kind === 'scale') {
            const max = q.kind === 'face' ? 5 : q.max;
            const dist = [];
            for (let i = 1; i <= max; i++) dist.push({ value: i, count: 0 });
            let sum = 0;
            for (const v of vals) {
                const n = parseInt(v, 10);
                if (n >= 1 && n <= max) { dist[n - 1].count++; sum += n; }
            }
            base.max = max;
            base.average = vals.length ? Math.round((sum / vals.length) * 100) / 100 : null;
            base.distribution = dist;
            if (q.minLabel) base.minLabel = q.minLabel;
            if (q.maxLabel) base.maxLabel = q.maxLabel;
        } else if (q.kind === 'choice' || q.kind === 'multi') {
            const counts = q.options.map(o => ({ value: o, count: 0 }));
            for (const v of vals) {
                for (const pick of (Array.isArray(v) ? v : [v])) {
                    const hit = counts.find(c => c.value === String(pick));
                    if (hit) hit.count++;
                }
            }
            base.distribution = counts;
        } else if (q.kind === 'yesno') {
            const yes = vals.filter(v => v === 'yes').length;
            base.distribution = [
                { value: 'yes', count: yes },
                { value: 'no', count: vals.length - yes }
            ];
            base.average = vals.length ? Math.round((yes / vals.length) * 1000) / 10 : null;
        } else if (q.kind === 'text') {
            // เรียงใหม่ก่อนเก่า ข้อความล่าสุดคือสิ่งที่ผู้ดูแลอยากเห็นก่อน
            base.texts = vals.map(String).reverse();
        }
        return base;
    });
}

function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * @param {object} deps  db, requireAuth, requireAdmin จาก server.js
 */
module.exports = function feedbackRoutes({ db, requireAuth, requireAdmin }) {
    const r = express.Router();

    // ── ฝั่งผู้ตอบ ────────────────────────────────────────────

    // ชุดที่เปิดอยู่ พร้อมคำตอบเดิมถ้าเบราว์เซอร์นี้เคยตอบไว้
    r.get('/active', requireAuth, (req, res) => {
        const form = openForm(db);
        if (!form) return res.json({ form: null });

        const token = str(req.query.token, 80);
        let mine = null;
        if (token) {
            const row = db.prepare(
                'SELECT answers, updated_at FROM feedback_responses WHERE form_id = ? AND edit_token = ?'
            ).get(form.id, token);
            if (row) {
                try { mine = { answers: JSON.parse(row.answers || '{}'), updatedAt: row.updated_at }; }
                catch (_) { mine = { answers: {}, updatedAt: row.updated_at }; }
            }
        }

        res.json({
            form: {
                id: form.id, title: form.title, intro: form.intro,
                questions: parseQ(form), closesAt: form.closes_at
            },
            mine: mine
        });
    });

    // ส่งคำตอบ — ส่งซ้ำพร้อม token เดิมคือทับของเดิม ไม่ใช่เพิ่มแถวใหม่
    r.post('/respond', requireAuth, (req, res) => {
        const form = openForm(db);
        if (!form) return res.status(409).json({ error: 'ตอนนี้ยังไม่มีแบบประเมินที่เปิดรับอยู่' });

        const questions = parseQ(form);
        let answers;
        try { answers = cleanAnswers(questions, (req.body || {}).answers); }
        catch (e) { return res.status(400).json({ error: e.message }); }

        const sent = str((req.body || {}).token, 80);
        const existing = sent ? db.prepare(
            'SELECT id FROM feedback_responses WHERE form_id = ? AND edit_token = ?'
        ).get(form.id, sent) : null;

        const token = existing ? sent : crypto.randomBytes(24).toString('hex');

        /* เขียนทั้งสองตารางในรายการเดียว ถ้าพังกลางทางต้องไม่เหลือสภาพครึ่ง ๆ
           ที่บันทึกว่าตอบแล้วแต่ไม่มีคำตอบ หรือมีคำตอบแต่ยังขึ้นว่ายังไม่ตอบ */
        db.transaction(() => {
            if (existing) {
                db.prepare('UPDATE feedback_responses SET answers = ?, updated_at = ? WHERE id = ?')
                    .run(JSON.stringify(answers), now(), existing.id);
            } else {
                db.prepare('INSERT INTO feedback_responses (form_id, answers, edit_token, submitted_at, updated_at) VALUES (?,?,?,?,?)')
                    .run(form.id, JSON.stringify(answers), token, now(), now());
            }
            // บันทึกแยกว่าคนนี้ตอบแล้ว ใช้สำหรับนับผู้ตอบเท่านั้น
            // ไม่มีคอลัมน์ไหนชี้กลับไปหาแถวคำตอบด้านบน
            db.prepare('INSERT OR REPLACE INTO feedback_submitted (form_id, user_id, submitted_at) VALUES (?,?,?)')
                .run(form.id, req.user.id, now());
        })();

        res.json({ ok: true, token: token, updated: !!existing });
    });

    // ── ฝั่งผู้ดูแล ───────────────────────────────────────────

    r.get('/forms', requireAdmin, (_req, res) => {
        const rows = db.prepare(`
            SELECT f.*,
                   (SELECT COUNT(*) FROM feedback_responses x WHERE x.form_id = f.id) AS responses
            FROM feedback_forms f ORDER BY f.id DESC
        `).all();
        res.json(rows.map(f => ({
            id: f.id, title: f.title, intro: f.intro, status: f.status,
            opensAt: f.opens_at, closesAt: f.closes_at,
            questions: parseQ(f), responses: f.responses,
            createdAt: f.created_at, updatedAt: f.updated_at
        })));
    });

    r.post('/forms', requireAdmin, (req, res) => {
        const b = req.body || {};
        const title = str(b.title, MAX_TITLE);
        if (!title) return res.status(400).json({ error: 'ยังไม่ได้ตั้งชื่อแบบประเมิน' });

        let questions;
        try { questions = cleanQuestions(b.questions); }
        catch (e) { return res.status(400).json({ error: e.message }); }

        const info = db.prepare(`
            INSERT INTO feedback_forms (title, intro, status, opens_at, closes_at, questions, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?)
        `).run(title, str(b.intro, 500), 'draft',
               str(b.opensAt, 10) || null, str(b.closesAt, 10) || null,
               JSON.stringify(questions), now(), now());

        res.json({ ok: true, id: info.lastInsertRowid });
    });

    r.put('/forms/:id', requireAdmin, (req, res) => {
        const id = parseInt(req.params.id, 10);
        const form = db.prepare('SELECT * FROM feedback_forms WHERE id = ?').get(id);
        if (!form) return res.status(404).json({ error: 'ไม่พบแบบประเมินนี้' });

        const b = req.body || {};
        const title = str(b.title, MAX_TITLE) || form.title;
        const status = ['draft', 'open', 'closed'].indexOf(b.status) >= 0 ? b.status : form.status;

        let questions = parseQ(form);
        if (b.questions !== undefined) {
            try { questions = cleanQuestions(b.questions); }
            catch (e) { return res.status(400).json({ error: e.message }); }
        }

        /* เปิดได้ทีละชุด ไม่งั้นผู้ตอบจะเห็นสองชุดพร้อมกันแล้วไม่รู้ว่าควรตอบอันไหน
           ปิดชุดอื่นให้เองตอนเปิดชุดนี้ แทนที่จะตีกลับแล้วให้ไปไล่ปิดเอง */
        db.transaction(() => {
            if (status === 'open')
                db.prepare("UPDATE feedback_forms SET status = 'closed', updated_at = ? WHERE status = 'open' AND id <> ?")
                    .run(now(), id);
            db.prepare(`
                UPDATE feedback_forms
                SET title = ?, intro = ?, status = ?, opens_at = ?, closes_at = ?, questions = ?, updated_at = ?
                WHERE id = ?
            `).run(title, str(b.intro, 500), status,
                   str(b.opensAt, 10) || null, str(b.closesAt, 10) || null,
                   JSON.stringify(questions), now(), id);
        })();

        res.json({ ok: true });
    });

    r.delete('/forms/:id', requireAdmin, (req, res) => {
        const id = parseInt(req.params.id, 10);
        const form = db.prepare('SELECT id FROM feedback_forms WHERE id = ?').get(id);
        if (!form) return res.status(404).json({ error: 'ไม่พบแบบประเมินนี้' });

        // ลบคำตอบไปด้วย ไม่ปล่อยให้ค้างโดยไม่มีคำถามกำกับ อ่านย้อนหลังไม่ได้อยู่ดี
        db.transaction(() => {
            db.prepare('DELETE FROM feedback_responses WHERE form_id = ?').run(id);
            db.prepare('DELETE FROM feedback_submitted WHERE form_id = ?').run(id);
            db.prepare('DELETE FROM feedback_forms WHERE id = ?').run(id);
        })();

        res.json({ ok: true });
    });

    r.get('/forms/:id/summary', requireAdmin, (req, res) => {
        const id = parseInt(req.params.id, 10);
        const form = db.prepare('SELECT * FROM feedback_forms WHERE id = ?').get(id);
        if (!form) return res.status(404).json({ error: 'ไม่พบแบบประเมินนี้' });

        const rows = db.prepare('SELECT answers FROM feedback_responses WHERE form_id = ? ORDER BY id').all(id);
        const people = db.prepare('SELECT COUNT(*) n FROM feedback_submitted WHERE form_id = ?').get(id).n;
        const staff = db.prepare('SELECT COUNT(*) n FROM users').get().n;

        res.json({
            form: { id: form.id, title: form.title, status: form.status,
                    opensAt: form.opens_at, closesAt: form.closes_at },
            responses: rows.length,
            people: people,
            staff: staff,
            // สัดส่วนผู้ตอบจากผู้ใช้ทั้งระบบ ช่วยบอกว่าผลที่เห็นเป็นตัวแทนแค่ไหน
            rate: staff ? Math.round((people / staff) * 1000) / 10 : null,
            questions: summarise(parseQ(form), rows)
        });
    });

    r.get('/forms/:id/export', requireAdmin, (req, res) => {
        const id = parseInt(req.params.id, 10);
        const form = db.prepare('SELECT * FROM feedback_forms WHERE id = ?').get(id);
        if (!form) return res.status(404).json({ error: 'ไม่พบแบบประเมินนี้' });

        const questions = parseQ(form).filter(q => NO_ANSWER.indexOf(q.kind) < 0);
        const rows = db.prepare('SELECT answers, submitted_at FROM feedback_responses WHERE form_id = ? ORDER BY id').all(id);

        const head = ['ลำดับ', 'ส่งเมื่อ'].concat(questions.map(q => q.title));
        const lines = [head.map(csvCell).join(',')];

        rows.forEach((row, i) => {
            let a = {};
            try { a = JSON.parse(row.answers || '{}'); } catch (_) {}
            const cells = [i + 1, row.submitted_at].concat(questions.map(q => {
                const v = a[q.id];
                if (v == null) return '';
                if (Array.isArray(v)) return v.join(' · ');
                if (q.kind === 'yesno') return v === 'yes' ? 'ใช่' : 'ไม่ใช่';
                return v;
            }));
            lines.push(cells.map(csvCell).join(','));
        });

        // BOM นำหน้า ไม่งั้น Excel บนวินโดวส์เปิดไฟล์ภาษาไทยออกมาเป็นขยะ
        res.set('Content-Type', 'text/csv; charset=utf-8');
        res.set('Content-Disposition', 'attachment; filename="feedback-' + id + '.csv"');
        res.send('﻿' + lines.join('\n'));
    });

    return r;
};

module.exports.cleanQuestions = cleanQuestions;
module.exports.cleanAnswers = cleanAnswers;
module.exports.summarise = summarise;
module.exports.KINDS = KINDS;
