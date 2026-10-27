/**
 * Apps Script หลังบ้านของฟอร์มน้ำหนัก–ส่วนสูง — คัดลอกทั้งไฟล์ไปวางใน Apps Script ของ Google Sheet
 * (เปิดชีต ▸ ส่วนขยาย ▸ Apps Script) วิธีติดตั้งทีละขั้นอยู่ใน README.md
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * หลักความปลอดภัย: "ไม่เชื่อหน้าเว็บ"
 * ═══════════════════════════════════════════════════════════════════════════
 * Web App นี้เปิดให้ "Anyone" เรียกได้ (จำเป็น ไม่งั้นหน้าเว็บเรียกไม่ได้) ใครก็ยิงคำขอมาได้
 * จึงห้ามเชื่อว่า "หน้าเว็บบอกว่าฉันเป็นครูห้อง ป.5/1" — ทุกคำขอต้องแนบ token ของระบบทะเบียน
 * แล้วไฟล์นี้เอา token ไปถาม API เองว่า:
 *   1. token ใช้ได้จริงไหม และเป็นบัญชีใคร                    → GET /me
 *   2. บัญชีนี้เป็นครูประจำชั้นห้องที่ขอจริงไหม (ADMIN ผ่านทุกห้อง)  → GET /teachers + /classrooms/:id
 *   3. นักเรียนที่จะบันทึกอยู่ในห้องนั้นจริงไหม                    → GET /students?classroomId=
 * ผลจำไว้ใน CacheService 10 นาที ไม่ต้องถาม API ทุกครั้งที่กดบันทึก
 *
 * ข้อดีของวิธีนี้: Apps Script ไม่ต้องเก็บรหัสผ่านหรือบัญชีกลางของระบบทะเบียนเลย
 * ทุกอย่างทำในนามของครูที่ล็อกอินอยู่ ด้วยสิทธิ์ที่ครูคนนั้นมีจริง
 *
 * ⚠️ token มีอำนาจเท่าบัญชีของครูในระบบทะเบียน → ห้าม Logger.log(token)
 *    และ cache ใช้ "แฮชของ token" เป็นกุญแจ ไม่ใช่ token ตรงๆ
 * ⚠️ แก้ไฟล์นี้แล้วต้อง Deploy ▸ Manage deployments ▸ ✏️ ▸ Version: New version ทุกครั้ง
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * การคุยกับหน้าเว็บ
 * ═══════════════════════════════════════════════════════════════════════════
 * หน้าเว็บส่ง POST แบบ text/plain (ดูเหตุผลใน sheet.js) body เป็น JSON:
 *   { action: "config" }                                  → { round }
 *   { action: "records", token, classroomId }            → ค่าที่บันทึกไว้ของห้องนั้นในรอบนี้
 *   { action: "save",    token, classroomId, rows: [...] } → บันทึก/แก้ไข
 *   { action: "summary", token }                          → studentId ที่กรอกครบแล้วในรอบนี้
 * ตอบ { ok: true, data } หรือ { ok: false, code, error }
 */

// ─── ตั้งค่า ─────────────────────────────────────────────────────────────

/** API ของระบบทะเบียนนักเรียน (ไม่มี / ท้าย) — ต้องตรงกับ API_URL ใน config.js */
const API_URL = 'https://thaingam-api-bun.vercel.app';

/** จำผลตรวจ token/สิทธิ์ห้องไว้กี่วินาที — ครูที่ถูกถอดจากห้อง จะหมดสิทธิ์ภายในเวลานี้ */
const CACHE_SECONDS = 600;

const SHEET_SETTINGS = 'Settings';
const SHEET_RECORDS = 'Records';

/** คอลัมน์ของชีต Records — เปลี่ยนลำดับได้ แต่ต้องเปลี่ยนที่นี่ที่เดียว */
const RECORD_HEADERS = [
  'round', 'studentId', 'classroomId', 'room', 'studentNumber', 'fullName', 'gender',
  'ageMonths', 'weight', 'height', 'bmi', 'heightStatus', 'weightStatus',
  'measuredAt', 'updatedAt', 'updatedBy',
];

/** ช่วงค่าที่ยอมรับ — ตรงกับ app.js (ตรวจซ้ำที่นี่เพราะไม่เชื่อหน้าเว็บ) */
const LIMITS = { weight: [5, 150], height: [50, 220] };

// ─── จุดเข้า ─────────────────────────────────────────────────────────────

/** เปิด URL ของ Web App ในเบราว์เซอร์ตรงๆ จะเห็นข้อความนี้ — ใช้เช็คว่า Deploy สำเร็จ */
function doGet() {
  return json_({ ok: true, data: { service: 'weight-height-form', round: getRound_() } });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (req.action) {
      case 'config':
        return json_({ ok: true, data: { round: getRound_() } });
      case 'records':
        return json_({ ok: true, data: actionRecords_(req) });
      case 'save':
        return json_({ ok: true, data: actionSave_(req) });
      case 'summary':
        return json_({ ok: true, data: actionSummary_(req) });
      default:
        throw appError_('BAD_REQUEST', 'ไม่รู้จักคำสั่ง ' + req.action);
    }
  } catch (err) {
    if (err.code) return json_({ ok: false, code: err.code, error: err.message });
    console.error(err); // ดูได้ที่ Apps Script ▸ Executions
    return json_({ ok: false, code: 'SERVER_ERROR', error: 'เกิดข้อผิดพลาดใน Apps Script: ' + err.message });
  }
}

/**
 * รันครั้งแรกจากหน้าแก้โค้ด (เลือก setup แล้วกด ▶ Run) — สร้างชีตและขอสิทธิ์ที่ต้องใช้
 * (สิทธิ์แก้ชีต + สิทธิ์ต่ออินเทอร์เน็ตไปหา API)
 */
function setup() {
  ensureSheets_();
  UrlFetchApp.fetch(API_URL + '/health', { muteHttpExceptions: true });
  console.log('พร้อมใช้งาน · รอบปัจจุบัน = ' + getRound_());
}

// ─── action ──────────────────────────────────────────────────────────────

function actionRecords_(req) {
  const me = verifyCaller_(req.token);
  const room = classroomAccess_(req.token, me, req.classroomId);
  const ids = {};
  room.students.forEach(function (s) { ids[s.id] = true; });

  const round = getRound_();
  const out = {};
  readRecords_().rows.forEach(function (r) {
    if (r.round === round && ids[r.studentId]) {
      out[r.studentId] = {
        weight: toNumberOrNull_(r.weight),
        height: toNumberOrNull_(r.height),
        measuredAt: r.measuredAt || null,
        updatedAt: r.updatedAt || null,
        updatedBy: r.updatedBy || null,
      };
    }
  });
  return { round: round, records: out };
}

function actionSave_(req) {
  const me = verifyCaller_(req.token);
  const room = classroomAccess_(req.token, me, req.classroomId);
  const students = {};
  room.students.forEach(function (s) { students[s.id] = s; });

  const rows = Array.isArray(req.rows) ? req.rows : [];
  if (!rows.length) throw appError_('BAD_REQUEST', 'ไม่มีข้อมูลให้บันทึก');

  // ตรวจทุกแถวก่อนเขียนแถวแรก — ผิดแถวเดียวไม่บันทึกเลยทั้งชุด
  const clean = rows.map(function (row) {
    const student = students[row.studentId];
    if (!student) throw appError_('FORBIDDEN', 'มีนักเรียนที่ไม่ได้อยู่ในห้อง ' + room.name);
    return {
      student: student,
      weight: checkRange_(row.weight, LIMITS.weight, 'น้ำหนัก', student),
      height: checkRange_(row.height, LIMITS.height, 'ส่วนสูง', student),
      measuredAt: /^\d{4}-\d{2}-\d{2}$/.test(row.measuredAt || '') ? row.measuredAt : '',
      ageMonths: toNumberOrNull_(row.ageMonths),
      bmi: toNumberOrNull_(row.bmi),
      heightStatus: String(row.heightStatus || '').slice(0, 30),
      weightStatus: String(row.weightStatus || '').slice(0, 30),
    };
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000); // คนอื่นกำลังบันทึกอยู่ → รอสูงสุด 20 วินาที
  try {
    const round = getRound_();
    const sheet = ensureSheets_().records;
    const table = readRecords_();
    const values = table.values; // แถวข้อมูลทั้งหมด (ไม่รวมหัวตาราง) แก้ในหน่วยความจำแล้วเขียนทีเดียว
    const index = {};
    table.rows.forEach(function (r, i) { index[r.round + '|' + r.studentId] = i; });

    const now = new Date();
    const by = me.name || me.email;
    const appended = [];
    clean.forEach(function (c) {
      const line = RECORD_HEADERS.map(function (h) {
        switch (h) {
          case 'round': return round;
          case 'studentId': return c.student.id;
          case 'classroomId': return req.classroomId;
          case 'room': return room.name;
          case 'studentNumber': return c.student.studentNumber;
          case 'fullName': return c.student.fullName;
          case 'gender': return c.student.gender === 'FEMALE' ? 'หญิง' : 'ชาย';
          case 'ageMonths': return c.ageMonths === null ? '' : c.ageMonths;
          case 'weight': return c.weight === null ? '' : c.weight;
          case 'height': return c.height === null ? '' : c.height;
          case 'bmi': return c.bmi === null ? '' : c.bmi;
          case 'heightStatus': return c.heightStatus;
          case 'weightStatus': return c.weightStatus;
          case 'measuredAt': return c.measuredAt;
          case 'updatedAt': return now;
          case 'updatedBy': return by;
          default: return '';
        }
      });
      const at = index[round + '|' + c.student.id];
      if (at !== undefined) values[at] = line;
      else if (c.weight !== null || c.height !== null) appended.push(line); // แถวใหม่ที่ว่างทั้งคู่ไม่ต้องเขียน
    });

    if (values.length) sheet.getRange(2, 1, values.length, RECORD_HEADERS.length).setValues(values);
    if (appended.length) {
      sheet.getRange(values.length + 2, 1, appended.length, RECORD_HEADERS.length).setValues(appended);
    }
    return { saved: clean.length, round: round };
  } finally {
    lock.releaseLock();
  }
}

/** studentId ที่กรอกครบ (มีทั้งน้ำหนักและส่วนสูง) ในรอบนี้ — หน้าเว็บเอาไปนับต่อห้องเอง */
function actionSummary_(req) {
  verifyCaller_(req.token);
  const round = getRound_();
  const done = [];
  readRecords_().rows.forEach(function (r) {
    if (r.round === round && r.weight !== '' && r.height !== '') done.push(r.studentId);
  });
  return { round: round, done: done };
}

// ─── ต้นแบบ: ตรวจ token ของระบบทะเบียน ────────────────────────────────────

/**
 * ตรวจว่า token ใช้ได้ และคืนบัญชีเจ้าของ token `{ id, email, name, role }`
 * โยน UNAUTHORIZED ถ้าไม่มี token / หมดอายุ — หน้าเว็บจะพาไปล็อกอินใหม่
 */
function verifyCaller_(token) {
  if (!token) throw appError_('UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ');
  const cache = CacheService.getScriptCache();
  const key = 'me:' + hash_(token);
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const me = apiGet_(token, '/me').data;
  cache.put(key, JSON.stringify(me), CACHE_SECONDS);
  return me;
}

/**
 * ตรวจว่าบัญชีนี้เข้าถึงห้องนี้ได้ แล้วคืน `{ name, students: [...] }`
 * - ADMIN → ทุกห้อง
 * - TEACHER → ต้องเป็นครูประจำชั้นของห้องนั้น (หาครูจาก teacher.userId === user.id)
 */
function classroomAccess_(token, me, classroomId) {
  if (!classroomId) throw appError_('BAD_REQUEST', 'ไม่ได้ระบุห้องเรียน');
  const cache = CacheService.getScriptCache();
  const key = 'room:' + hash_(token + '|' + classroomId);
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const classroom = apiGet_(token, '/classrooms/' + encodeURIComponent(classroomId)).data;

  if (me.role !== 'ADMIN') {
    const teachers = apiGetAll_(token, '/teachers', { isActive: 'all' });
    const mine = teachers.filter(function (t) { return t.userId === me.id; })[0];
    if (!mine) throw appError_('FORBIDDEN', 'บัญชีนี้ยังไม่ได้ผูกกับข้อมูลครู — ติดต่อแอดมิน');
    const isHomeroom = classroom.teachers.some(function (t) { return t.id === mine.id; });
    if (!isHomeroom) throw appError_('FORBIDDEN', 'คุณไม่ได้เป็นครูประจำชั้นห้อง ' + classroom.name);
  }

  // เฉพาะนักเรียนที่กำลังศึกษา (ค่าเริ่มต้นของ API) · เก็บแค่ฟิลด์ที่ต้องใช้ ไม่เก็บที่อยู่/เบอร์โทร
  const students = apiGetAll_(token, '/students', { classroomId: classroomId }).map(function (s) {
    return { id: s.id, studentNumber: s.studentNumber, fullName: s.fullName, gender: s.gender };
  });
  const result = { name: classroom.name, students: students };
  cache.put(key, JSON.stringify(result), CACHE_SECONDS);
  return result;
}

/**
 * GET ไปที่ API ในนามของเจ้าของ token
 *
 * UrlFetchApp ไม่ส่ง header Origin จึงไม่ติด CORS เหมือนในเบราว์เซอร์
 * `muteHttpExceptions` = ได้ 4xx/5xx แล้วไม่โยน error ทันที ให้เราอ่านข้อความภาษาไทยของ API ก่อน
 */
function apiGet_(token, path) {
  const res = UrlFetchApp.fetch(API_URL + path, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  });
  const status = res.getResponseCode();
  let body = null;
  try { body = JSON.parse(res.getContentText()); } catch (e) { /* ไม่ใช่ JSON */ }

  if (status === 401) throw appError_('UNAUTHORIZED', 'การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  if (status === 403) throw appError_('FORBIDDEN', (body && body.error && body.error.message) || 'ไม่มีสิทธิ์');
  if (status === 404) throw appError_('NOT_FOUND', (body && body.error && body.error.message) || 'ไม่พบข้อมูล');
  if (status >= 400 || !body) {
    throw appError_('API_ERROR', 'ระบบทะเบียนตอบผิดพลาด (' + status + ')');
  }
  return body;
}

/** GET เส้นที่แบ่งหน้า (หน้าละไม่เกิน 200) แล้ววนจนครบ */
function apiGetAll_(token, path, params) {
  const all = [];
  for (let page = 1; ; page++) {
    const qs = ['page=' + page, 'limit=200'];
    Object.keys(params || {}).forEach(function (k) {
      qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    });
    const body = apiGet_(token, path + '?' + qs.join('&'));
    Array.prototype.push.apply(all, body.data);
    if (!body.meta || page >= body.meta.totalPages) return all;
  }
}

// ─── ชีต ─────────────────────────────────────────────────────────────────

/** สร้างชีตที่ยังไม่มี — ตั้งรูปแบบ "ข้อความธรรมดา" ทั้งชีต ไม่ให้ Sheets แปลง 2/2569 เป็นวันที่ */
function ensureSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let settings = ss.getSheetByName(SHEET_SETTINGS);
  if (!settings) {
    settings = ss.insertSheet(SHEET_SETTINGS);
    settings.getRange('A:B').setNumberFormat('@');
    settings.getRange(1, 1, 2, 2).setValues([['key', 'value'], ['round', defaultRound_()]]);
    settings.getRange(1, 3).setValue('← แก้ช่อง B2 เมื่อขึ้นรอบใหม่ เช่น 2/2569 (ฟอร์มจะว่างใหม่ ข้อมูลรอบเก่ายังอยู่)');
    settings.setFrozenRows(1);
  }

  let records = ss.getSheetByName(SHEET_RECORDS);
  if (!records) {
    records = ss.insertSheet(SHEET_RECORDS);
    records.getRange(1, 1, 1, RECORD_HEADERS.length).setValues([RECORD_HEADERS]).setFontWeight('bold');
    records.getRange('A:H').setNumberFormat('@');
    records.getRange('L:N').setNumberFormat('@');
    records.setFrozenRows(1);
  }
  return { settings: settings, records: records };
}

/** อ่านชีต Records ทั้งหมด → { values: แถวดิบ, rows: แถวเป็น object ตามหัวตาราง } */
function readRecords_() {
  const sheet = ensureSheets_().records;
  const last = sheet.getLastRow();
  if (last < 2) return { values: [], rows: [] };
  const values = sheet.getRange(2, 1, last - 1, RECORD_HEADERS.length).getValues();
  const rows = values.map(function (v) {
    const o = {};
    RECORD_HEADERS.forEach(function (h, i) { o[h] = typeof v[i] === 'string' ? v[i].trim() : v[i]; });
    o.round = String(o.round);
    o.studentId = String(o.studentId);
    if (o.updatedAt instanceof Date) o.updatedAt = o.updatedAt.toISOString();
    return o;
  });
  return { values: values, rows: rows };
}

/** รอบปัจจุบันจากชีต Settings (อ่านแบบข้อความที่แสดง กันกรณีถูกแปลงเป็นวันที่) */
function getRound_() {
  const sheet = ensureSheets_().settings;
  const values = sheet.getDataRange().getDisplayValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === 'round' && values[i][1]) return String(values[i][1]).trim();
  }
  return defaultRound_();
}

/** ภาคเรียนตามปฏิทินโรงเรียนไทย: พ.ค.–ต.ค. = ภาค 1 · พ.ย.–เม.ย. = ภาค 2 */
function defaultRound_() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const be = now.getFullYear() + 543;
  if (month >= 5 && month <= 10) return '1/' + be;
  return '2/' + (month >= 11 ? be : be - 1);
}

// ─── เครื่องมือ ───────────────────────────────────────────────────────────

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function appError_(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function hash_(text) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8),
  );
}

function toNumberOrNull_(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

/** ว่าง = null (ยังไม่กรอก) · มีค่าต้องอยู่ในช่วง · ปัดทศนิยม 1 ตำแหน่ง */
function checkRange_(v, range, label, student) {
  const n = toNumberOrNull_(v);
  if (n === null) return null;
  if (n < range[0] || n > range[1]) {
    throw appError_('BAD_REQUEST', label + 'ของ ' + student.fullName + ' ต้องอยู่ระหว่าง ' + range[0] + '–' + range[1]);
  }
  return Math.round(n * 10) / 10;
}
