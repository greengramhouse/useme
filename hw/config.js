/**
 * ค่าที่ต้องแก้ก่อนใช้งาน — ไฟล์เดียวที่ต้องแตะเมื่อย้ายไปวางที่อื่น
 *
 * ⚠️ ไฟล์นี้อยู่ในหน้าเว็บสาธารณะ ใครเปิดดูก็เห็น — ห้ามใส่รหัสผ่านหรือคีย์ลับ
 * (สองค่านี้เป็นที่อยู่สาธารณะอยู่แล้ว ไม่ใช่ความลับ)
 */
window.APP_CONFIG = {
  /**
   * API ของระบบทะเบียนนักเรียน (ไม่มี / ท้าย)
   * ตอนพัฒนาในเครื่องเปลี่ยนเป็น http://localhost:5000 ได้ — API ตอนพัฒนายอมรับ localhost ทุกพอร์ต
   */
  API_URL: "https://thaingam-api-bun.vercel.app",

  /**
   * URL ของ Apps Script Web App (ลงท้ายด้วย /exec) — ได้มาหลังกด Deploy ใน Apps Script
   * ดูขั้นตอนใน README.md ข้อ 2
   */
  GAS_URL: "https://script.google.com/macros/s/AKfycbxjtjHEz2dQlT1EyiTiEg3AM9QuaNxatIV0bQcFWHtpB9yhopnBEs4aBS_lnzmaqLUS/exec",
};
