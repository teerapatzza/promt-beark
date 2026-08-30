/**
 * Unified Validation Rule Engine
 * ใช้ร่วมกัน Frontend และ Backend
 * คืน array of errors: [{ field, level: 'error'|'warning', message }]
 */

const TAXI_MAX_PER_TRIP = 300; // ค่าปริยายสุดท้าย ใช้เมื่อไม่มีทั้งค่าหมวดหมู่และค่ากลาง

// ช่องระยะทางเป็นแบบอ่านอย่างเดียว ระบบคำนวณจากหมุดบนแผนที่
// ถ้าค้นหาปลายทางไม่เจอ ระยะทางจะค้างที่ 0 แล้วบันทึกไม่ผ่าน
// ผู้ใช้จะงงมากถ้าไม่บอกทางออก เพราะพิมพ์ใส่ช่องเองก็ไม่ได้
const DIST_HINT =
    '\n\n📍 ระยะทางมาจากหมุดบนแผนที่ กรอกในช่องเองไม่ได้' +
    '\n💡 ถ้าค้นหาปลายทางไม่เจอ ให้เลือกอย่างใดอย่างหนึ่ง:' +
    '\n   • ลากหมุดปลายทางบนแผนที่เอง แล้วระบบจะคำนวณให้' +
    '\n   • หรือติ๊ก "กรอกระยะทางเอง" แล้วใส่ตัวเลขพร้อมเหตุผล';

/**
 * Validate expense data
 * @param {Object} expense - expense object { requestedBy, description, inputMetadata, attachments, amount, ... }
 * @param {Object} category - budget category object with attachmentRules
 * @returns {Array} errors - array of { field, level, message }
 */
function validateExpense(expense, category, globalTaxiMax) {
    const errors = [];
    const meta = expense.inputMetadata || {};
    const templates = meta._pdfTemplates || [];
    const TRAVEL_TEMPLATE_IDS = ['REPORT', 'TRANSPORT_RECEIPT'];
    const hasTravel = templates.some(t => TRAVEL_TEMPLATE_IDS.includes(t));
    const hasGeneral = templates.includes('GENERAL_RECEIPT');

    // Basic validations
    if (!expense.requestedBy || !expense.requestedBy.trim()) {
        errors.push({
            field: 'requestedBy',
            level: 'error',
            message: '❌ กรุณาระบุชื่อผู้ขอเบิก'
        });
    }

    if (!category) {
        errors.push({
            field: 'category',
            level: 'error',
            message: '❌ ไม่พบหมวดงบประมาณ'
        });
        return errors; // ไม่สามารถตรวจสอบต่อได้ถ้าไม่มี category
    }

    // Travel-specific validations
    if (hasTravel && meta._travel) {
        const travel = meta._travel;
        const costs = meta._costs || {};

        // 1. Validate travel dates
        // ช่องวัน-เวลาอยู่ในแบบ REPORT (FM-SAM-001-04) เท่านั้น
        // ถ้าหมวดนั้นติ๊กแค่ TRANSPORT_RECEIPT ฟอร์มจะไม่มีช่องนี้ให้กรอกเลย
        // บังคับตรงนี้จะทำให้ผู้ใช้บันทึกไม่ได้ และหาช่องที่ต้องแก้ไม่เจอด้วย
        const needDates = templates.includes('REPORT');

        if (needDates && !travel.startDate) {
            errors.push({
                field: 'dateStart',
                level: 'error',
                message: '❌ กรุณาระบุวันที่ออกเดินทาง'
            });
        }

        if (needDates && !travel.endDate) {
            errors.push({
                field: 'dateEnd',
                level: 'error',
                message: '❌ กรุณาระบุวันที่กลับถึง'
            });
        }

        // 2. Validate date range (end >= start)
        if (travel.startDate && travel.endDate) {
            const startDateTime = new Date(travel.startDate + ' ' + (travel.startTime || '00:00'));
            const endDateTime = new Date(travel.endDate + ' ' + (travel.endTime || '23:59'));

            if (endDateTime < startDateTime) {
                errors.push({
                    field: 'dateEnd',
                    level: 'error',
                    message: `❌ วันเวลากลับถึงต้องไม่ก่อนวันเวลาออกเดินทาง!\n\n` +
                        `📅 วันที่ออกเดินทาง: ${travel.startDate} เวลา ${travel.startTime}\n` +
                        `📅 วันที่กลับถึง: ${travel.endDate} เวลา ${travel.endTime}\n\n` +
                        `💡 กรุณาแก้ไข:\n` +
                        `• เปลี่ยนวันที่กลับให้เป็นวันเดียวกันหรือหลังจากวันออกเดินทาง\n` +
                        `• หรือตรวจสอบเวลาให้ถูกต้อง (กรณีเดินทางภายในวันเดียว)`
                });
            }
        }

        // 3. Validate taxi entries
        // วงเงิน Taxi ต้องมาจากที่แอดมินตั้งไว้ ไม่ใช่ค่าคงที่ในโค้ด
        // ลำดับ: ค่าของหมวดหมู่ -> ค่ากลางของระบบ -> ค่าปริยาย
        // ติ๊ก "ไม่จำกัด" ในหน้าแอดมินจะเก็บเป็น null/0 ซึ่งแปลว่าไม่ต้องตรวจ
        const taxiCap = (function () {
            const fromCat = category && category.taxiMaxPerTrip;
            if (fromCat === null || fromCat === 0 || fromCat === '') return Infinity;   // ไม่จำกัด
            const n = parseFloat(fromCat);
            if (isFinite(n) && n > 0) return n;
            const g = parseFloat(globalTaxiMax);
            return (isFinite(g) && g > 0) ? g : TAXI_MAX_PER_TRIP;
        })();
        const capText = taxiCap === Infinity ? 'ไม่จำกัด' : taxiCap.toLocaleString();

        const taxiEntries = costs.taxiEntries || [];
        const travelStartDate = travel.startDate ? new Date(travel.startDate) : null;
        const travelEndDate = travel.endDate ? new Date(travel.endDate) : null;

        taxiEntries.forEach((entry, index) => {
            if (!entry.date) {
                errors.push({
                    field: `taxiEntry${index}`,
                    level: 'error',
                    message: '❌ กรุณาระบุวันที่ในทุกรายการ Taxi'
                });
                return;
            }

            // Validate taxi date is within travel period
            if (travelStartDate && travelEndDate) {
                const taxiDate = new Date(entry.date);
                if (taxiDate < travelStartDate || taxiDate > travelEndDate) {
                    errors.push({
                        field: `taxiEntry${index}`,
                        level: 'error',
                        message: `❌ วันที่ Taxi ไม่อยู่ในช่วงการเดินทาง!\n\n` +
                            `🚕 Taxi วันที่: ${entry.date} (${entry.direction})\n` +
                            `📅 ช่วงเดินทาง: ${travel.startDate} ถึง ${travel.endDate}\n\n` +
                            `💡 กรุณาแก้ไข:\n` +
                            `• เปลี่ยนวันที่ Taxi ให้อยู่ระหว่าง ${travel.startDate} - ${travel.endDate}\n` +
                            `• หรือลบรายการ Taxi นี้ออก`
                    });
                }
            }

            // Validate taxi amount limits
            if (entry.direction === 'ไป-กลับ') {
                if ((entry.amountOut || 0) > taxiCap) {
                    errors.push({
                        field: `taxiEntry${index}`,
                        level: 'error',
                        message: `❌ ยอดค่า Taxi เกินวงเงินที่อนุมัติ!\n\n` +
                            `🚕 Taxi วันที่ ${entry.date} (ขาไป)\n` +
                            `💰 ยอดที่กรอก: ${entry.amountOut} บาท\n` +
                            `📊 วงเงินสูงสุด: ${capText} บาท/เที่ยว\n\n` +
                            `💡 กรุณาลดยอดเงินให้ไม่เกิน ${capText} บาท`
                    });
                }
                if ((entry.amountRet || 0) > taxiCap) {
                    errors.push({
                        field: `taxiEntry${index}`,
                        level: 'error',
                        message: `❌ ยอดค่า Taxi เกินวงเงินที่อนุมัติ! (ขากลับ)\n` +
                            `💰 ${entry.amountRet} บาท > ${capText} บาท`
                    });
                }
            } else {
                if ((entry.amount || 0) > taxiCap) {
                    errors.push({
                        field: `taxiEntry${index}`,
                        level: 'error',
                        message: `❌ ยอดค่า Taxi เกินวงเงินที่อนุมัติ!\n` +
                            `💰 ${entry.amount} บาท > ${capText} บาท`
                    });
                }
            }
        });

        // 4. Validate hotel fields (must fill both rate AND nights)
        const hotel = costs.hotel || {};
        const hotelRate = parseFloat(hotel.rate) || 0;
        const hotelNights = parseFloat(hotel.nights) || 0;

        if (hotelRate > 0 && hotelNights === 0) {
            errors.push({
                field: 'hotelNights',
                level: 'error',
                message: `❌ กรอกข้อมูลที่พักไม่ครบ!\n\n` +
                    `🏨 อัตราค่าที่พัก: ${hotelRate} บาท/คืน\n` +
                    `🌙 จำนวนคืน: ไม่ได้กรอก\n\n` +
                    `💡 กรุณากรอกจำนวนคืนที่พัก`
            });
        }

        if (hotelNights > 0 && hotelRate === 0) {
            errors.push({
                field: 'hotelRate',
                level: 'error',
                message: `❌ กรอกข้อมูลที่พักไม่ครบ!\n\n` +
                    `🌙 จำนวนคืน: ${hotelNights} คืน\n` +
                    `🏨 อัตราค่าที่พัก: ไม่ได้กรอก\n\n` +
                    `💡 กรุณากรอกอัตราค่าที่พัก (บาท/คืน)`
            });
        }

        // 5. Validate expense amounts require receipts
        const airAmount = parseFloat(costs.airAmount) || 0;
        const tollAmount = parseFloat(costs.tollAmount) || 0;
        const totalHotelCost = hotelRate * hotelNights;
        const hasExpensesRequiringReceipt = totalHotelCost > 0 || airAmount > 0 || tollAmount > 0;

        if (hasExpensesRequiringReceipt) {
            const hasAttachments = expense.attachments &&
                expense.attachments.images &&
                expense.attachments.images.length > 0;

            if (!hasAttachments) {
                const expenseList = [];
                if (totalHotelCost > 0) expenseList.push(`ค่าที่พัก ${totalHotelCost.toLocaleString()} บาท`);
                if (airAmount > 0) expenseList.push(`ค่าตั๋วเครื่องบิน ${airAmount.toLocaleString()} บาท`);
                if (tollAmount > 0) expenseList.push(`ค่าทางด่วน ${tollAmount.toLocaleString()} บาท`);

                errors.push({
                    field: 'attachments',
                    level: 'error',
                    message: `❌ ยังไม่ได้แนบใบเสร็จ!\n\n` +
                        `💰 ค่าใช้จ่ายที่ต้องมีใบเสร็จ:\n` +
                        expenseList.map(e => `• ${e}`).join('\n') + '\n\n' +
                        `📎 กรุณาแนบใบเสร็จ`
                });
            }
        }

        // 6. Validate carType matches distance (only if not using taxi)
        const usingTaxi = taxiEntries.length > 0;
        if (!usingTaxi) {
            const distOut = parseFloat(travel.distOut) || 0;
            const distRet = parseFloat(travel.distRet) || 0;
            const carType = meta._carType || 'ไม่ระบุ';

            if (carType === 'ขาไป' && distOut === 0) {
                errors.push({
                    field: 'distOutbound',
                    level: 'error',
                    message: `❌ ระยะทางไม่สอดคล้องกับประเภทรถ!\n` +
                        `🚘 ประเภทรถ: ขาไป แต่ระยะทางขาไป: 0 กม.\n` +
                        `💡 กรุณากรอกระยะทางขาไป` + DIST_HINT
                });
            }

            if (carType === 'ขากลับ' && distRet === 0) {
                errors.push({
                    field: 'distReturn',
                    level: 'error',
                    message: `❌ ระยะทางไม่สอดคล้องกับประเภทรถ!\n` +
                        `🚘 ประเภทรถ: ขากลับ แต่ระยะทางขากลับ: 0 กม.\n` +
                        `💡 กรุณากรอกระยะทางขากลับ` + DIST_HINT
                });
            }

            if (carType === 'ไป-กลับ' && (distOut === 0 || distRet === 0)) {
                const missing = distOut === 0 ? 'ขาไป' : 'ขากลับ';
                errors.push({
                    field: distOut === 0 ? 'distOutbound' : 'distReturn',
                    level: 'error',
                    message: `❌ ระยะทางไม่ครบสำหรับ 'ไป-กลับ'!\n` +
                        `🚘 ประเภทรถ: ไป-กลับ แต่ระยะทาง${missing}: 0 กม.\n` +
                        `💡 กรุณากรอกระยะทาง${missing}` + DIST_HINT
                });
            }

            if (carType !== 'ไม่ระบุ' && distOut === 0 && distRet === 0) {
                errors.push({
                    field: 'distance',
                    level: 'error',
                    message: '❌ กรุณากรอกระยะทาง (ขาไป หรือ ขากลับ) สำหรับการเดินทางด้วยรถยนต์' +
                        DIST_HINT
                });
            }
        }
    }

    // General receipt validations
    if (hasGeneral && meta._generalReceiptItems) {
        if (meta._generalReceiptItems.length === 0) {
            errors.push({
                field: 'generalReceiptItems',
                level: 'error',
                message: '❌ กรุณาเพิ่มรายการค่าใช้จ่ายในตาราง FM-SAM-003-06 อย่างน้อย 1 รายการ'
            });
        }
    }

    // Amount validation
    const finalAmount = parseFloat(expense.amount) || 0;
    if (finalAmount <= 0) {
        errors.push({
            field: 'amount',
            level: 'error',
            message: '❌ ยอดเบิกต้องมากกว่า 0 บาท'
        });
    }

    return errors;
}

// Export for both Node.js (backend) and browser (frontend)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validateExpense, TAXI_MAX_PER_TRIP };
}
