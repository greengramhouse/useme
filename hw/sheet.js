/**
 * ต้นแบบ: คุยกับ Google Apps Script Web App (code.gs) จากหน้าเว็บนิ่ง
 *
 * ── ทำไมต้อง POST แบบ text/plain ──────────────────────────────────────────
 * Apps Script ตอบคำขอ preflight (OPTIONS) ของ CORS ไม่ได้ ถ้าเบราว์เซอร์ต้องยิง preflight
 * คำขอจะล้มทั้งหมด · วิธีเลี่ยงคือส่งเป็น "simple request":
 *   - method POST
 *   - body เป็นสตริง (เบราว์เซอร์ตั้ง Content-Type เป็น text/plain ให้เอง)
 *   - ห้ามใส่ header อะไรเพิ่มเลย — รวมถึง Authorization
 * token ของระบบเดิมจึงส่งไปใน body แทน แล้ว code.gs เอาไปตรวจกับ API เองอีกที
 *
 * Apps Script ตอบด้วยการ redirect ไป googleusercontent.com ซึ่ง fetch ตามไปให้อัตโนมัติ
 *
 * ── รูปแบบคำตอบ (กำหนดเองใน code.gs) ──────────────────────────────────────
 *   { ok: true, data }  หรือ  { ok: false, code, error }
 *   code "UNAUTHORIZED" = token หมดอายุ → หน้าเว็บพาไปล็อกอินใหม่
 */
(function () {
  "use strict";

  class SheetError extends Error {
    constructor(message, code) {
      super(message);
      this.name = "SheetError";
      this.code = code;
    }
  }

  /**
   * เรียก action ใน code.gs
   * @param {string} action  "config" | "records" | "save" | "summary"
   * @param {object} [payload]
   * @param {boolean} [withToken=true]  แนบ token ของระบบเดิมไปให้ code.gs ตรวจ
   */
  async function call(action, payload = {}, withToken = true) {
    const url = window.APP_CONFIG.GAS_URL;
    if (!url) {
      throw new SheetError("ยังไม่ได้ใส่ GAS_URL ใน config.js (ดู README ข้อ 2)", "NO_GAS_URL");
    }
    const body = { action, ...payload };
    if (withToken) body.token = window.Api.getToken();

    let res;
    try {
      res = await fetch(url, { method: "POST", body: JSON.stringify(body) });
    } catch {
      throw new SheetError("ติดต่อ Google Sheet ไม่ได้ — ตรวจอินเทอร์เน็ตแล้วลองใหม่", "NETWORK");
    }
    const json = await res.json().catch(() => null);
    if (!json) {
      // ได้ HTML กลับมา = ตั้ง Web App ผิด (ไม่ได้เลือก Who has access: Anyone)
      throw new SheetError("Google Sheet ตอบกลับผิดรูปแบบ — ตรวจการตั้งค่า Deploy ของ Apps Script", "BAD_RESPONSE");
    }
    if (!json.ok) {
      if (json.code === "UNAUTHORIZED") window.Api.clearToken();
      throw new SheetError(json.error || "บันทึกไม่สำเร็จ", json.code);
    }
    return json.data;
  }

  window.Sheet = { SheetError, call };
})();
