/**
 * คำนวณ BMI และประเมินภาวะโภชนาการตามเกณฑ์อ้างอิงการเจริญเติบโต
 *
 * ใช้ 2 ดัชนีตามที่กรมอนามัยใช้กับเด็กวัยเรียน (ไม่ใช้ BMI ตัดสิน):
 *   1. ส่วนสูงตามเกณฑ์อายุ   → เตี้ย · ค่อนข้างเตี้ย · สูงตามเกณฑ์ · ค่อนข้างสูง · สูง
 *   2. น้ำหนักตามเกณฑ์ส่วนสูง → ผอม · ค่อนข้างผอม · สมส่วน · ท้วม · เริ่มอ้วน · อ้วน
 * แล้วสรุป "สูงดีสมส่วน" = ส่วนสูงระดับสูงตามเกณฑ์ขึ้นไป และ น้ำหนักระดับสมส่วน (คนเดียวกัน)
 *
 * แหล่งเกณฑ์ (รายละเอียดใน growth-data.js):
 *   อายุ 6 ปีขึ้นไป → ตารางกรมอนามัย 2564 (เปิดตารางตรงๆ เหมือนครูเปิดคู่มือ)
 *   อายุต่ำกว่า 6 ปี → ค่า LMS ของ WHO แล้วคำนวณ z-score ตัดที่ ±1.5, ±2, +3 SD
 *
 * ทุกฟังก์ชันคืน null เมื่อประเมินไม่ได้ (ยังกรอกไม่ครบ / อยู่นอกช่วงตาราง) — ไม่เดาค่า
 */
(function () {
  "use strict";

  const D = window.GROWTH_DATA;

  const HEIGHT_LEVELS = ["เตี้ย", "ค่อนข้างเตี้ย", "สูงตามเกณฑ์", "ค่อนข้างสูง", "สูง"];
  const WEIGHT_LEVELS = ["ผอม", "ค่อนข้างผอม", "สมส่วน", "ท้วม", "เริ่มอ้วน", "อ้วน"];
  /** ระดับ "ปกติ" ของแต่ละดัชนี — ใช้ตัดสินสูงดีสมส่วน */
  const HEIGHT_OK_FROM = 2;
  const WEIGHT_OK = 2;

  /** จุดตัด z-score ของ WHO ให้ตรงกับคอลัมน์ของตารางกรมอนามัย */
  const HEIGHT_Z_CUTS = [-2, -1.5, 1.5, 2];
  const WEIGHT_Z_CUTS = [-2, -1.5, 1.5, 2, 3];

  /** อายุที่เริ่มใช้ตารางกรมอนามัย (6 ปี 0 เดือน) */
  const DOH_FROM_MONTHS = 72;

  // ─── อายุ ───────────────────────────────────────────────────────────────

  /**
   * อายุเป็น "เดือนเต็ม" ณ วันที่วัด — นับแบบคนไทยนับอายุ ยังไม่ถึงวันเกิดของเดือนนั้นก็ยังไม่ครบเดือน
   * @param {string} birthDate  "YYYY-MM-DD" (ค.ศ.)
   * @param {string} onDate     "YYYY-MM-DD" วันที่ชั่ง/วัด
   */
  function ageInMonths(birthDate, onDate) {
    if (!birthDate || !onDate) return null;
    const [by, bm, bd] = birthDate.split("-").map(Number);
    const [y, m, d] = onDate.split("-").map(Number);
    let months = (y - by) * 12 + (m - bm);
    if (d < bd) months -= 1;
    return months >= 0 ? months : null;
  }

  /** 125 เดือน → "10 ปี 5 เดือน" */
  function formatAge(months) {
    if (months === null || months === undefined) return "–";
    const years = Math.floor(months / 12);
    const rest = months % 12;
    return rest ? `${years} ปี ${rest} เดือน` : `${years} ปี`;
  }

  /** วันนี้ตามเวลาเครื่องในรูป "YYYY-MM-DD" (ไม่ใช้ toISOString เพราะเป็นเวลา UTC จะเพี้ยนช่วงเช้ามืด) */
  function today() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  // ─── BMI ────────────────────────────────────────────────────────────────

  /** BMI = น้ำหนัก (กก.) ÷ ส่วนสูง (ม.)² ปัด 1 ตำแหน่ง */
  function bmi(weight, height) {
    if (!(weight > 0) || !(height > 0)) return null;
    const meters = height / 100;
    return Math.round((weight / (meters * meters)) * 10) / 10;
  }

  // ─── เครื่องมือคำนวณ ─────────────────────────────────────────────────────

  /** ระดับจากค่าสูงสุดของแต่ละช่องในตาราง: ≤cuts[0] → 0, ≤cuts[1] → 1, … เกินทุกช่อง → cuts.length */
  function levelFromCuts(value, cuts) {
    const v = Math.round(value * 10) / 10; // ตารางมีทศนิยม 1 ตำแหน่ง เทียบที่ความละเอียดเดียวกัน
    for (let i = 0; i < cuts.length; i++) if (v <= cuts[i]) return i;
    return cuts.length;
  }

  /** z-score จาก LMS (สูตรของ WHO) */
  function zFromLms(value, [L, M, S]) {
    return L === 0 ? Math.log(value / M) / S : (Math.pow(value / M, L) - 1) / (L * S);
  }

  /** ค่าจริง ณ z ที่กำหนด — ใช้วาดเส้นในกราฟ */
  function valueAtZ(z, [L, M, S]) {
    return L === 0 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L);
  }

  /** ระดับจาก z: ต่ำกว่า cuts[0] → 0 … สูงกว่า cuts สุดท้าย → cuts.length (ขอบเท่ากับตาราง: ตรงจุดตัดพอดีนับเป็นช่องล่าง) */
  function levelFromZ(z, cuts) {
    for (let i = 0; i < cuts.length; i++) if (z <= cuts[i]) return i;
    return cuts.length;
  }

  const sexKey = (gender) => (gender === "FEMALE" ? "girl" : "boy");

  /** ผลประเมินหนึ่งดัชนี — source บอกว่าใช้ตารางไหน ("DOH" กรมอนามัย / "WHO") */
  const heightResult = (level, source) => ({ level, label: HEIGHT_LEVELS[level], source });
  const weightResult = (level, source) => ({ level, label: WEIGHT_LEVELS[level], source });

  // ─── ส่วนสูงตามเกณฑ์อายุ ─────────────────────────────────────────────────

  /**
   * "จุดตัด" ส่วนสูง ณ อายุนั้น [เตี้ย, ค่อนข้างเตี้ย, สูงตามเกณฑ์, ค่อนข้างสูง] (ซม.)
   * คืน null ถ้าอายุอยู่นอกตาราง (ต่ำกว่า 24 เดือน หรือเกิน 19 ปี)
   */
  function heightCutsAt(gender, months) {
    const k = sexKey(gender);
    if (months >= DOH_FROM_MONTHS) {
      const t = D.dohHeightForAge;
      return t[k][months - t.from] || null;
    }
    const lms = D.whoHeightForAge[k][months];
    if (!lms || months < 24) return null;
    return HEIGHT_Z_CUTS.map((z) => Math.round(valueAtZ(z, lms) * 10) / 10);
  }

  function heightForAge(gender, months, height) {
    if (months === null || !(height > 0)) return null;
    if (months >= DOH_FROM_MONTHS) {
      const cuts = heightCutsAt(gender, months);
      return cuts ? heightResult(levelFromCuts(height, cuts), "DOH") : null;
    }
    const lms = D.whoHeightForAge[sexKey(gender)][months];
    if (!lms || months < 24) return null;
    return heightResult(levelFromZ(zFromLms(height, lms), HEIGHT_Z_CUTS), "WHO");
  }

  // ─── น้ำหนักตามเกณฑ์ส่วนสูง ──────────────────────────────────────────────

  /**
   * แถวของตารางน้ำหนักตามส่วนสูงที่ใช้กับเด็กคนนี้
   *
   * ตารางกรมอนามัยเป็นราย 1 ซม. → ปัดส่วนสูงเป็นจำนวนเต็มก่อน (เหมือนครูเปิดตารางในคู่มือ)
   * ตาราง WHO เป็นราย 0.5 ซม. → ปัดไปค่าที่ใกล้ที่สุดทีละ 0.5
   */
  function weightCutsAt(gender, months, height) {
    const k = sexKey(gender);
    if (months >= DOH_FROM_MONTHS) {
      const t = D.dohWeightForHeight;
      return t[k][Math.round(height) - t.from] || null;
    }
    const t = D.whoWeightForHeight;
    const lms = t[k][Math.round((height - t.from) / t.step)];
    if (!lms || height < t.from - t.step / 2) return null;
    return WEIGHT_Z_CUTS.map((z) => Math.round(valueAtZ(z, lms) * 10) / 10);
  }

  function weightForHeight(gender, months, height, weight) {
    if (months === null || !(height > 0) || !(weight > 0)) return null;
    if (months >= DOH_FROM_MONTHS) {
      const cuts = weightCutsAt(gender, months, height);
      return cuts ? weightResult(levelFromCuts(weight, cuts), "DOH") : null;
    }
    const t = D.whoWeightForHeight;
    const lms = t[sexKey(gender)][Math.round((height - t.from) / t.step)];
    if (!lms || height < t.from - t.step / 2) return null;
    return weightResult(levelFromZ(zFromLms(weight, lms), WEIGHT_Z_CUTS), "WHO");
  }

  // ─── สรุปรายคน ──────────────────────────────────────────────────────────

  /**
   * ประเมินนักเรียน 1 คน
   * @param {{gender: string, birthDate: string, weight: number|null, height: number|null, measuredAt: string}} input
   */
  function assess({ gender, birthDate, weight, height, measuredAt }) {
    const months = ageInMonths(birthDate, measuredAt);
    const h = heightForAge(gender, months, height);
    const w = weightForHeight(gender, months, height, weight);
    return {
      ageMonths: months,
      bmi: bmi(weight, height),
      height: h,
      weight: w,
      goodShape: h && w ? h.level >= HEIGHT_OK_FROM && w.level === WEIGHT_OK : null,
    };
  }

  /**
   * ข้อมูลเส้นสำหรับวาดกราฟ — คืน { xs, cuts: [[...ค่าตัดแต่ละเส้น] ต่อ x] }
   * ใช้แหล่งเดียวกับการประเมิน กราฟกับผลในตารางจึงตรงกันเสมอ
   */
  function heightChartData(gender, months) {
    const young = months !== null && months < DOH_FROM_MONTHS;
    const [from, to] = young ? [24, DOH_FROM_MONTHS - 1] : [DOH_FROM_MONTHS, 228];
    const xs = [];
    const cuts = [];
    for (let m = from; m <= to; m++) {
      const c = heightCutsAt(gender, m);
      if (c) {
        xs.push(m);
        cuts.push(c);
      }
    }
    return { xs, cuts, young };
  }

  function weightChartData(gender, months) {
    const young = months !== null && months < DOH_FROM_MONTHS;
    const xs = [];
    const cuts = [];
    if (young) {
      const t = D.whoWeightForHeight;
      t[sexKey(gender)].forEach((lms, i) => {
        xs.push(t.from + i * t.step);
        cuts.push(WEIGHT_Z_CUTS.map((z) => valueAtZ(z, lms)));
      });
    } else {
      const t = D.dohWeightForHeight;
      t[sexKey(gender)].forEach((row, i) => {
        if (row) {
          xs.push(t.from + i);
          cuts.push(row);
        }
      });
    }
    return { xs, cuts, young };
  }

  window.Growth = {
    HEIGHT_LEVELS,
    WEIGHT_LEVELS,
    ageInMonths,
    formatAge,
    today,
    bmi,
    heightForAge,
    weightForHeight,
    assess,
    heightChartData,
    weightChartData,
  };
})();
