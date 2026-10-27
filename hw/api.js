/**
 * ต้นแบบ: ล็อกอินและดึงข้อมูลจาก API ระบบทะเบียนนักเรียน จากหน้าเว็บนิ่ง (HTML + JS ล้วน)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ไฟล์นี้ตั้งใจเขียนให้ "ยกไปใช้กับงานอื่นได้ทั้งไฟล์" — ไม่ผูกกับเรื่องน้ำหนักส่วนสูงเลย
 * งานใหม่ที่อยากใช้บัญชีเดิมของครู + รายชื่อนักเรียนชุดเดียวกับระบบ ให้คัดลอกไฟล์นี้ไป
 * แล้วเรียกฟังก์ชันใน `window.Api` ตามตัวอย่างท้ายไฟล์
 *
 * ── API ตอบกลับเป็นรูปแบบเดียวกันทุกเส้น ──────────────────────────────────
 *   สำเร็จ:  { success: true, data: ... }                    (บางเส้นมี meta สำหรับแบ่งหน้า)
 *   ผิดพลาด: { success: false, error: { code, message } }   (message เป็นภาษาไทยพร้อมแสดง)
 *   ยกเว้นเส้น /api/auth/* ซึ่งเป็นของ better-auth ตอบรูปแบบของมันเอง (ดู signIn)
 *
 * ── ทำไมใช้ Bearer token ไม่ใช้ cookie ───────────────────────────────────
 * หน้านี้อยู่คนละโดเมนกับ API (เช่น xxx.github.io กับ xxx.vercel.app) เบราว์เซอร์จึง
 * ไม่ส่ง cookie ข้ามไปให้ (SameSite) → ต้องเก็บ token เองแล้วแนบ header
 * `Authorization: Bearer <token>` ไปกับทุกคำขอแทน
 *
 * ── สิ่งที่ต้องตั้งฝั่ง API ก่อนใช้ ─────────────────────────────────────────
 * โดเมนของหน้านี้ต้องอยู่ใน env `CORS_ORIGINS` ของ API (คั่นด้วย comma) แล้ว redeploy
 * เช่น `https://thaingam-student.vercel.app,https://greengramhouse.github.io`
 * ไม่งั้นเบราว์เซอร์บล็อกคำขอ → ได้ข้อความ "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้"
 * (ใส่แค่ scheme + โดเมน ไม่มี path และไม่มี / ท้าย)
 *
 * ── token ─────────────────────────────────────────────────────────────────
 * - อายุ 7 วัน · กดออกจากระบบแล้วใช้ไม่ได้ทันที
 * - เก็บใน sessionStorage = ปิดแท็บแล้วหาย ต้องล็อกอินใหม่ (ปลอดภัยกว่า localStorage
 *   บนเครื่องที่ใช้ร่วมกันในห้องพักครู) อยากให้จำข้ามแท็บก็เปลี่ยนเป็น localStorage ได้
 * - token ใช้ได้ "ทุกอย่างที่บัญชีนั้นทำได้" ในระบบเดิม → ห้าม log ห้ามส่งไปที่อื่นนอกจาก
 *   API ของเราเองและ Apps Script ของโรงเรียน
 *
 * ── สิทธิ์ ────────────────────────────────────────────────────────────────
 * - TEACHER อ่าน (GET) ได้ทุกเส้นที่ใช้ในไฟล์นี้ · เขียนอะไรในระบบเดิมไม่ได้
 * - ADMIN ทำได้ทุกอย่าง
 * - บัญชีผู้ใช้ (user) กับข้อมูลครู (teacher) เป็นคนละตาราง ผูกกันด้วย teacher.userId
 *   ครูที่แอดมินยังไม่ได้ผูก จะล็อกอินได้แต่หา "ห้องของฉัน" ไม่เจอ (findMyTeacher คืน null)
 */
(function () {
  "use strict";

  const TOKEN_KEY = "thaingam.token";

  /** ข้อผิดพลาดจาก API — `status` 0 = ต่อเซิร์ฟเวอร์ไม่ได้เลย, 401 = token หมดอายุ/ไม่ถูกต้อง */
  class ApiError extends Error {
    constructor(message, status, code) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
    }
  }

  // ─── เก็บ token ─────────────────────────────────────────────────────────
  // ครอบ try/catch ทุกครั้ง: บางเบราว์เซอร์ (โหมดส่วนตัว/ปิด storage) โยน error ตอนเข้าถึง

  function getToken() {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  function setToken(token) {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* เก็บไม่ได้ก็ใช้ได้แค่จนกว่าจะรีเฟรช — ไม่ถึงกับพัง */
    }
  }

  function clearToken() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ไม่มีอะไรต้องทำ */
    }
  }

  // ─── ตัวยิงคำขอกลาง ─────────────────────────────────────────────────────

  /**
   * ยิงคำขอไป API แล้วคืน `{ json, headers }`
   *
   * - แนบ `Authorization: Bearer` ให้อัตโนมัติถ้ามี token (ปิดได้ด้วย `auth: false`)
   * - `credentials: "omit"` — ไม่ส่ง cookie เพราะเราใช้ token อย่างเดียว
   * - ได้ 401 → ล้าง token ทิ้งทันที ให้หน้าเว็บพาไปหน้าล็อกอิน
   *
   * @param {string} path   เช่น "/me" หรือ "/students?classroomId=xxx"
   * @param {{method?: string, body?: unknown, auth?: boolean}} [options]
   */
  async function request(path, options = {}) {
    const { method = "GET", body, auth = true } = options;
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = getToken();
    if (auth && token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(window.APP_CONFIG.API_URL + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "omit",
      });
    } catch {
      // fetch โยน TypeError เมื่อเน็ตหลุด หรือ "โดน CORS บล็อก" (แยกสองกรณีจาก JS ไม่ได้)
      throw new ApiError(
        "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจอินเทอร์เน็ต หรือแจ้งแอดมินให้เพิ่มโดเมนของหน้านี้ใน CORS_ORIGINS",
        0,
        "NETWORK",
      );
    }

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      if (res.status === 401) clearToken();
      // API ของเรา: { error: { code, message } } · better-auth: { code, message }
      const err = (json && (json.error || json)) || {};
      throw new ApiError(
        err.message || `เซิร์ฟเวอร์ตอบผิดพลาด (${res.status})`,
        res.status,
        err.code || "HTTP_" + res.status,
      );
    }
    return { json, headers: res.headers };
  }

  /** GET แล้วคืนเฉพาะ `data` — ใช้กับเส้นทั่วไปที่ไม่แบ่งหน้า */
  async function get(path) {
    const { json } = await request(path);
    return json.data;
  }

  /**
   * GET เส้นที่แบ่งหน้า แล้ววนจนได้ครบทุกหน้า
   *
   * API ให้หน้าละไม่เกิน 200 รายการ (`limit` สูงสุด) และตอบ `meta.totalPages` มาด้วย
   * โรงเรียนเล็กส่วนใหญ่จบในหน้าเดียว แต่อย่าเขียนโค้ดโดยสมมติแบบนั้น
   *
   * @param {string} path  ไม่ต้องใส่ ?page/&limit — ฟังก์ชันนี้เติมให้
   * @param {Record<string, string|number|undefined>} [params]
   */
  async function getAll(path, params = {}) {
    const all = [];
    for (let page = 1; ; page++) {
      const qs = new URLSearchParams({ page: String(page), limit: "200" });
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") qs.set(key, String(value));
      }
      const { json } = await request(`${path}?${qs}`);
      all.push(...json.data);
      if (!json.meta || page >= json.meta.totalPages) return all;
    }
  }

  // ─── ล็อกอิน / ออก ─────────────────────────────────────────────────────

  /**
   * ล็อกอินด้วยอีเมล + รหัสผ่านของระบบเดิม แล้วเก็บ token ไว้
   *
   * เส้นนี้เป็นของ better-auth: ตอบ `{ token, user }` ไม่ได้ห่อด้วย `{ success, data }`
   * และแนบ token แบบลงลายเซ็นมาใน header `set-auth-token` ด้วย (API เปิด expose header
   * นี้ให้แล้ว) — ใช้ตัวใน header ก่อน ถ้าอ่านไม่ได้ค่อยใช้ตัวใน body ซึ่ง API ก็รับเหมือนกัน
   *
   * @returns {Promise<{id: string, email: string, name: string, role: string}>} บัญชีที่ล็อกอิน
   */
  async function signIn(email, password) {
    try {
      const { json, headers } = await request("/api/auth/sign-in/email", {
        method: "POST",
        body: { email: email.trim(), password },
        auth: false,
      });
      const token = headers.get("set-auth-token") || json.token;
      if (!token) throw new ApiError("เซิร์ฟเวอร์ไม่ได้ส่ง token กลับมา", 500, "NO_TOKEN");
      setToken(token);
      return getMe();
    } catch (err) {
      // better-auth ตอบข้อความภาษาอังกฤษ — แปลกรณีที่เจอบ่อยให้ครูอ่านรู้เรื่อง
      if (err instanceof ApiError && (err.status === 401 || err.code === "INVALID_EMAIL_OR_PASSWORD")) {
        throw new ApiError("อีเมลหรือรหัสผ่านไม่ถูกต้อง", 401, err.code);
      }
      throw err;
    }
  }

  /** ออกจากระบบ — ทำให้ token ใช้ไม่ได้ฝั่งเซิร์ฟเวอร์ด้วย ไม่ใช่แค่ลบในเครื่อง */
  async function signOut() {
    try {
      // sign-out ต้องมี body เป็น JSON (ว่างก็ได้) ไม่งั้น API ตอบ 400
      await request("/api/auth/sign-out", { method: "POST", body: {} });
    } catch {
      /* token หมดอายุไปแล้วก็ถือว่าออกแล้ว */
    } finally {
      clearToken();
    }
  }

  // ─── ข้อมูลผู้ใช้และครู ─────────────────────────────────────────────────

  /**
   * บัญชีที่ล็อกอินอยู่ — ใช้เช็คด้วยว่า token ยังใช้ได้ไหม (401 = หมดอายุ)
   * @returns {Promise<{id: string, email: string, name: string, role: "ADMIN"|"TEACHER", image: string|null}>}
   */
  function getMe() {
    return get("/me");
  }

  /**
   * หา "ข้อมูลครู" ของบัญชีที่ล็อกอิน — ผูกกันด้วย `teacher.userId === user.id`
   *
   * API ไม่มีเส้น "ครูของฉัน" ตรงๆ จึงดึงรายชื่อครูทั้งหมด (โรงเรียนมีไม่กี่สิบคน) แล้วหาเอง
   * `isActive=all` เผื่อครูที่ถูกปิดใช้งานแต่ยังประจำชั้นอยู่
   *
   * @returns {Promise<object|null>} null = บัญชีนี้ยังไม่ได้ผูกกับข้อมูลครู (ให้แอดมินผูกที่หน้ารายละเอียดครู)
   */
  async function findMyTeacher(me) {
    const teachers = await getAll("/teachers", { isActive: "all" });
    return teachers.find((teacher) => teacher.userId === me.id) || null;
  }

  /** ปีการศึกษาปัจจุบันที่แอดมินตั้งไว้ในระบบ เช่น 2569 */
  async function getCurrentYear() {
    const year = await get("/academic-years/current");
    return year.year;
  }

  /**
   * ห้องเรียนทั้งหมดของปีนั้น — แต่ละห้องมี `id`, `name` ("ป.5/1"), `teachers` (ครูประจำชั้น)
   * เส้นนี้ไม่แบ่งหน้า ได้ครบในคำขอเดียว
   */
  function listClassrooms(academicYear) {
    return get(`/classrooms?academicYear=${encodeURIComponent(academicYear)}`);
  }

  /**
   * ห้องที่บัญชีนี้ "ดูแล"
   * - ADMIN → ทุกห้อง
   * - TEACHER → เฉพาะห้องที่ตัวเองเป็นครูประจำชั้น (ห้องหนึ่งมีครูประจำชั้นได้หลายคน)
   */
  function myClassrooms(me, teacher, classrooms) {
    if (me.role === "ADMIN") return classrooms;
    if (!teacher) return [];
    return classrooms.filter((room) => room.teachers.some((t) => t.id === teacher.id));
  }

  // ─── รายชื่อนักเรียน ────────────────────────────────────────────────────

  /**
   * นักเรียนในห้อง — เฉพาะสถานะ "กำลังศึกษา" (ค่าเริ่มต้นของ API)
   *
   * `sort=gender` = ชายก่อนหญิง แล้วเรียงเลขประจำตัว ตรงกับใบรายชื่อกระดาษที่ระบบเดิมพิมพ์
   * ลำดับในห้อง (เลขที่) จึงนับ 1…n ตามลำดับที่ได้มาได้เลย
   *
   * ฟิลด์ที่ใช้บ่อยของนักเรียนแต่ละคน:
   *   id · studentNumber (รหัสนักเรียน) · prefixTh · firstName · lastName · fullName
   *   gender ("MALE"|"FEMALE") · birthDate ("YYYY-MM-DD" ค.ศ.) · age
   *   enrollment.classroom.name ("ป.5/1")
   * ⚠️ ยังมีที่อยู่/เบอร์ผู้ปกครองติดมาด้วย และเลขบัตรแบบปิดเหลือ 3 ตัว — อย่าเก็บหรือส่งต่อ
   *    เกินที่งานต้องใช้ (ดู toRosterRow ใน app.js ที่คัดเฉพาะฟิลด์ที่ต้องใช้)
   */
  function listStudentsInClassroom(classroomId) {
    return getAll("/students", { classroomId, sort: "gender" });
  }

  /** นักเรียนทั้งโรงเรียนของปีนั้น (สถานะกำลังศึกษา) — ใช้นับยอดทุกห้องในแท็บติดตาม */
  function listAllStudents(academicYear) {
    return getAll("/students", { academicYear, sort: "gender" });
  }

  window.Api = {
    ApiError,
    getToken,
    clearToken,
    signIn,
    signOut,
    getMe,
    findMyTeacher,
    getCurrentYear,
    listClassrooms,
    myClassrooms,
    listStudentsInClassroom,
    listAllStudents,
  };

  /*
   * ── ตัวอย่างการใช้ในงานใหม่ ──────────────────────────────────────────────
   *
   *   const me = await Api.signIn("teacher@school.ac.th", "รหัสผ่าน");
   *   const year = await Api.getCurrentYear();
   *   const teacher = await Api.findMyTeacher(me);           // null = ยังไม่ผูก
   *   const rooms = Api.myClassrooms(me, teacher, await Api.listClassrooms(year));
   *   const students = await Api.listStudentsInClassroom(rooms[0].id);
   *
   *   // เปิดหน้าใหม่ภายหลัง (token ยังอยู่ใน sessionStorage):
   *   if (Api.getToken()) {
   *     try { const me = await Api.getMe(); ... }
   *     catch (e) { if (e.status === 401) แสดงหน้าล็อกอิน }
   *   }
   */
})();
