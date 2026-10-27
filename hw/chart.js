/**
 * กราฟเทียบเกณฑ์รายคน — วาดเป็น SVG เอง ไม่ใช้ไลบรารี
 *
 * ทุกกราฟคือ "แถบสี" ระหว่างเส้นจุดตัดของตาราง (ข้อมูลชุดเดียวกับที่ใช้ประเมินใน growth.js
 * กราฟกับป้ายผลในตารางจึงตรงกันเสมอ) แล้วปักจุดของนักเรียนลงไป
 */
(function () {
  "use strict";

  /** สีแถบตามระดับ เรียงตาม Growth.HEIGHT_LEVELS / WEIGHT_LEVELS */
  const HEIGHT_COLORS = ["#fecaca", "#fef3c7", "#d1fae5", "#dbeafe", "#bfdbfe"];
  const WEIGHT_COLORS = ["#fde68a", "#fef3c7", "#d1fae5", "#fed7aa", "#fdba74", "#fca5a5"];

  const W = 560;
  const H = 340;
  const PAD = { left: 46, right: 14, top: 14, bottom: 40 };

  const fmt = (n) => (Math.round(n * 10) / 10).toString();

  /** ช่วงตัวเลขขอบกราฟที่ปัดให้สวย */
  function niceRange(min, max, step) {
    return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
  }

  /**
   * วาดกราฟแถบสี
   * @param {object} o
   * @param {number[]} o.xs        ค่าแกน x ของแต่ละแถวตาราง
   * @param {number[][]} o.cuts    จุดตัดของแต่ละแถว (จำนวนเท่ากันทุกแถว)
   * @param {string[]} o.colors    สีแถบ (มากกว่าจำนวนจุดตัด 1)
   * @param {number} o.yStep       ระยะเส้นตารางแกน y
   * @param {number} o.xStep       ระยะเส้นตารางแกน x
   * @param {(x:number)=>string} o.xTick   ข้อความใต้แกน x
   * @param {string} o.xLabel
   * @param {string} o.yLabel
   * @param {{x:number, y:number}|null} o.point  จุดของนักเรียน
   */
  function bandChart(o) {
    const lastCut = o.cuts[0].length - 1;
    let [yMin, yMax] = niceRange(
      Math.min(...o.cuts.map((c) => c[0])) * 0.92,
      Math.max(...o.cuts.map((c) => c[lastCut])) * 1.05,
      o.yStep,
    );
    const xMin = o.xs[0];
    const xMax = o.xs[o.xs.length - 1];

    // จุดที่อยู่นอกกรอบ: ขยายแกน y ให้เห็น (แกน x ขยายไม่ได้ เพราะเกินช่วงตาราง)
    if (o.point) {
      if (o.point.y < yMin) yMin = Math.floor(o.point.y / o.yStep) * o.yStep;
      if (o.point.y > yMax) yMax = Math.ceil(o.point.y / o.yStep) * o.yStep;
    }

    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const sx = (x) => PAD.left + ((x - xMin) / (xMax - xMin)) * plotW;
    const sy = (y) => PAD.top + plotH - ((Math.min(Math.max(y, yMin), yMax) - yMin) / (yMax - yMin)) * plotH;

    const parts = [];

    // แถบสี: แถบ i อยู่ระหว่างจุดตัด i-1 (หรือขอบล่าง) กับจุดตัด i (หรือขอบบน)
    for (let band = 0; band <= o.cuts[0].length; band++) {
      const upper = o.xs.map((x, i) => [sx(x), sy(band === o.cuts[0].length ? yMax : o.cuts[i][band])]);
      const lower = o.xs.map((x, i) => [sx(x), sy(band === 0 ? yMin : o.cuts[i][band - 1])]).reverse();
      const pts = upper.concat(lower).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
      parts.push(`<polygon points="${pts}" fill="${o.colors[band]}" />`);
    }

    // เส้นตาราง + ตัวเลขแกน
    for (let y = yMin; y <= yMax + 1e-9; y += o.yStep) {
      parts.push(`<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${sy(y)}" y2="${sy(y)}" stroke="#0f172a" stroke-opacity=".08" />`);
      parts.push(`<text x="${PAD.left - 6}" y="${sy(y) + 4}" text-anchor="end" class="tick">${fmt(y)}</text>`);
    }
    const firstX = Math.ceil(xMin / o.xStep) * o.xStep;
    for (let x = firstX; x <= xMax + 1e-9; x += o.xStep) {
      parts.push(`<line x1="${sx(x)}" x2="${sx(x)}" y1="${PAD.top}" y2="${H - PAD.bottom}" stroke="#0f172a" stroke-opacity=".08" />`);
      parts.push(`<text x="${sx(x)}" y="${H - PAD.bottom + 16}" text-anchor="middle" class="tick">${o.xTick(x)}</text>`);
    }

    // เส้นจุดตัด
    for (let c = 0; c <= lastCut; c++) {
      const d = o.xs.map((x, i) => `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(o.cuts[i][c]).toFixed(1)}`).join("");
      parts.push(`<path d="${d}" fill="none" stroke="#475569" stroke-opacity=".45" stroke-width="1" />`);
    }

    // ชื่อแกน
    parts.push(`<text x="${PAD.left + plotW / 2}" y="${H - 6}" text-anchor="middle" class="axis">${o.xLabel}</text>`);
    parts.push(
      `<text transform="translate(12 ${PAD.top + plotH / 2}) rotate(-90)" text-anchor="middle" class="axis">${o.yLabel}</text>`,
    );

    // จุดของนักเรียน
    if (o.point && o.point.x >= xMin && o.point.x <= xMax) {
      const px = sx(o.point.x);
      const py = sy(o.point.y);
      parts.push(`<line x1="${px}" x2="${px}" y1="${PAD.top}" y2="${H - PAD.bottom}" stroke="#0f766e" stroke-dasharray="3 3" />`);
      parts.push(`<circle cx="${px}" cy="${py}" r="6" fill="#0f766e" stroke="#fff" stroke-width="2" />`);
    }

    return (
      `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" role="img">` +
      `<style>.tick{font-size:11px;fill:#475569}.axis{font-size:12px;fill:#334155}</style>` +
      parts.join("") +
      `</svg>`
    );
  }

  function legend(labels, colors) {
    return (
      `<div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600 mt-2">` +
      labels
        .map(
          (label, i) =>
            `<span class="inline-flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm border border-slate-300" style="background:${colors[i]}"></span>${label}</span>`,
        )
        .join("") +
      `</div>`
    );
  }

  /** ข้อความใต้กราฟเมื่อจุดของนักเรียนอยู่นอกช่วงตาราง */
  const outOfRange = (text) => `<p class="text-xs text-amber-700 mt-1">${text}</p>`;

  /**
   * กราฟส่วนสูงตามเกณฑ์อายุ
   * @param {{gender: string, ageMonths: number|null, height: number|null}} s
   */
  function heightChart(s) {
    const data = window.Growth.heightChartData(s.gender, s.ageMonths);
    const point = s.ageMonths !== null && s.height ? { x: s.ageMonths, y: s.height } : null;
    const inRange = point && point.x >= data.xs[0] && point.x <= data.xs[data.xs.length - 1];
    return (
      bandChart({
        ...data,
        colors: HEIGHT_COLORS,
        yStep: 10,
        xStep: 12,
        xTick: (m) => String(m / 12),
        xLabel: "อายุ (ปี)",
        yLabel: "ส่วนสูง (ซม.)",
        point,
      }) +
      legend(window.Growth.HEIGHT_LEVELS, HEIGHT_COLORS) +
      (point && !inRange ? outOfRange("อายุอยู่นอกช่วงของตาราง จึงปักจุดไม่ได้") : "")
    );
  }

  /** กราฟน้ำหนักตามเกณฑ์ส่วนสูง */
  function weightChart(s) {
    const data = window.Growth.weightChartData(s.gender, s.ageMonths);
    const point = s.height && s.weight ? { x: s.height, y: s.weight } : null;
    const inRange = point && point.x >= data.xs[0] - 0.5 && point.x <= data.xs[data.xs.length - 1] + 0.5;
    return (
      bandChart({
        ...data,
        colors: WEIGHT_COLORS,
        yStep: data.young ? 5 : 10,
        xStep: 10,
        xTick: (x) => String(x),
        xLabel: "ส่วนสูง (ซม.)",
        yLabel: "น้ำหนัก (กก.)",
        point,
      }) +
      legend(window.Growth.WEIGHT_LEVELS, WEIGHT_COLORS) +
      (point && !inRange ? outOfRange("ส่วนสูงอยู่นอกช่วงของตาราง จึงประเมินและปักจุดไม่ได้") : "")
    );
  }

  window.GrowthChart = { heightChart, weightChart, HEIGHT_COLORS, WEIGHT_COLORS };
})();
