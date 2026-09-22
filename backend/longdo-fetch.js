/* เรียกบริการแผนที่ Longdo แบบทนการสะดุด
 *
 * ของเดิมเรียก fetch เปล่าๆ ไม่มีกำหนดเวลา ถ้า Longdo ค้าง คำขอจะค้างยาว
 * จนกว่า nginx จะตัดที่ 30 วินาที ผู้ใช้เห็นวงหมุนนิ่งๆ แล้วได้ HTTP 504
 * ตามด้วย 502 รัวๆ ตอนลากหมุด และ catch เดิมกลืน error ทิ้งโดยไม่บันทึกอะไรเลย
 * พอเกิดขึ้นจริงจึงไล่หาสาเหตุย้อนหลังไม่ได้ ต้องนั่งเดาว่าพังชั้นไหน
 * (เจอจริง 22 ก.ย. 2569)
 *
 * แยกเป็นไฟล์ของตัวเองเพื่อให้ชุดทดสอบเรียกของจริงตัวเดียวกับที่ระบบใช้
 * ไม่ใช่คัดลอกโค้ดไปไว้อีกที่แล้วเพี้ยนจากกันภายหลัง
 */

const LONGDO_TIMEOUT_MS = 8000;   // ตัดเร็วกว่า nginx (30 วินาที) เพื่อให้ลองซ้ำได้ทัน
const LONGDO_ATTEMPTS   = 2;      // สะดุดครั้งเดียวไม่ควรถึงมือผู้ใช้
const LONGDO_GAP_MS     = 400;

/**
 * ยิงไปยัง Longdo แล้วคืนค่า JSON
 * ลองใหม่อีกครั้งเมื่อไม่สำเร็จ และบันทึกสาเหตุจริงทุกครั้ง
 * ถ้าไม่สำเร็จทั้งสองครั้ง จะโยน error ของครั้งสุดท้ายออกมา
 *
 * @param {string} url      ปลายทางเต็มรวมกุญแจแล้ว
 * @param {string} label    ชื่อเรียกงานนี้ สำหรับใส่ใน log
 * @param {object} [deps]   ใส่ fetch/log ของตัวเองได้ เอาไว้ให้ชุดทดสอบใช้
 */
async function longdoFetch(url, label, deps) {
  const doFetch = (deps && deps.fetch) || fetch;
  const warn    = (deps && deps.warn)  || console.warn;
  const timeout = (deps && deps.timeoutMs) || LONGDO_TIMEOUT_MS;
  const tries   = (deps && deps.attempts) || LONGDO_ATTEMPTS;
  const gap     = (deps && deps.gapMs != null) ? deps.gapMs : LONGDO_GAP_MS;

  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const r = await doFetch(url, { signal: AbortSignal.timeout(timeout) });
      if (!r.ok) throw new Error('ตอบกลับ HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      last = e;
      warn('[longdo] ' + label + ' ครั้งที่ ' + attempt + ' ไม่สำเร็จ: ' + (e && e.message));
      if (attempt < tries) await new Promise(r => setTimeout(r, gap));
    }
  }
  throw last;
}

/** จริงเมื่อ error นั้นเกิดจากหมดเวลา ไม่ใช่ปลายทางตอบว่าผิดพลาด */
const isTimeout = e => !!e && (e.name === 'TimeoutError' || e.name === 'AbortError');

module.exports = { longdoFetch, isTimeout, LONGDO_TIMEOUT_MS, LONGDO_ATTEMPTS };
