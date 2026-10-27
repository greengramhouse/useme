/**
 * หน้าจอของฟอร์มน้ำหนัก–ส่วนสูง — ต่อ Api (ระบบทะเบียน), Sheet (Apps Script), Growth (เกณฑ์), GrowthChart (กราฟ)
 *
 * ลำดับตอนเปิดหน้า:
 *   มี token ใน sessionStorage? → boot()  :  แสดงหน้าล็อกอิน
 *   boot(): /me → ปีปัจจุบัน → ห้องทั้งหมด + ครูของฉัน → รอบจากชีต → เลือกห้องแรก → loadRoom()
 *   loadRoom(): รายชื่อจาก API + ค่าที่บันทึกไว้จากชีต → วาดตาราง
 */
(function () {
  "use strict";

  const { Api, Sheet, Growth, GrowthChart } = window;
  const $ = (id) => document.getElementById(id);

  /** ช่วงค่าที่รับ — ต้องตรงกับ LIMITS ใน code.gs */
  const LIMITS = { weight: [5, 150], height: [50, 220] };

  const state = {
    me: null,
    teacher: null,
    year: null,
    round: null,
    sheetReady: false,
    classrooms: [],
    myRooms: [],
    roomId: null,
    /** แถวในห้องที่เปิดอยู่ — ดู toRosterRow() */
    roster: [],
    /** ค่าที่ยังไม่บันทึก: studentId → { weight, height } (สตริงตามที่พิมพ์) */
    edits: new Map(),
    allStudents: null,
  };

  // ─── เครื่องมือ ───────────────────────────────────────────────────────

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function show(id, visible = true) {
    $(id).hidden = !visible;
  }

  function showView(name) {
    for (const v of ["loading", "login", "app"]) show("view-" + v, v === name);
  }

  let toastTimer;
  function toast(text) {
    const el = $("toast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 3000);
  }

  /** แถบแจ้งเตือนใต้หัวเว็บ — tone: "warn" | "error" */
  function banner(html, tone = "warn") {
    const el = $("banner");
    if (!html) {
      el.hidden = true;
      return;
    }
    const cls = tone === "error" ? "bg-red-50 border-red-200 text-red-800" : "bg-amber-50 border-amber-200 text-amber-800";
    el.innerHTML = `<div class="rounded-lg border px-4 py-3 text-sm ${cls}">${html}</div>`;
    el.hidden = false;
  }

  /** token หมดอายุ (401 จาก API หรือ UNAUTHORIZED จาก Apps Script) → กลับหน้าล็อกอิน */
  function isAuthError(err) {
    return err && (err.status === 401 || err.code === "UNAUTHORIZED");
  }

  function handleError(err) {
    if (isAuthError(err)) {
      Api.clearToken();
      state.edits.clear();
      showLogin("การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่");
      return;
    }
    console.error(err);
    toast(err.message || "เกิดข้อผิดพลาด");
  }

  /** "2026-10-27" → "27 ต.ค. 2569" */
  function thaiDate(iso) {
    if (!iso) return "";
    const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
    return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
  }

  // ─── ล็อกอิน ──────────────────────────────────────────────────────────

  function showLogin(message) {
    showView("login");
    $("login-error").textContent = message || "";
    show("login-error", Boolean(message));
  }

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    button.textContent = "กำลังเข้าสู่ระบบ…";
    show("login-error", false);
    try {
      await Api.signIn(form.elements.email.value, form.elements.password.value);
      form.elements.password.value = "";
      await boot();
    } catch (err) {
      showLogin(err.message);
    } finally {
      button.disabled = false;
      button.textContent = "เข้าสู่ระบบ";
    }
  });

  $("btn-logout").addEventListener("click", async () => {
    if (state.edits.size && !confirm("ยังมีค่าที่ไม่ได้บันทึก ออกจากระบบเลยไหม?")) return;
    state.edits.clear();
    await Api.signOut();
    showLogin();
  });

  // ─── เริ่มต้น ─────────────────────────────────────────────────────────

  async function boot() {
    showView("loading");
    try {
      state.me = await Api.getMe();
      state.year = await Api.getCurrentYear();
      const [classrooms, teacher] = await Promise.all([Api.listClassrooms(state.year), Api.findMyTeacher(state.me)]);
      state.classrooms = classrooms;
      state.teacher = teacher;
      state.myRooms = Api.myClassrooms(state.me, teacher, classrooms);
      state.allStudents = null;
    } catch (err) {
      if (isAuthError(err)) return showLogin();
      return showLogin(err.message);
    }

    // รอบมาจากชีต — ถ้ายังไม่ได้ตั้ง Apps Script ยังดูรายชื่อ/ประเมินได้ แต่บันทึกไม่ได้
    try {
      const config = await Sheet.call("config", {}, false);
      state.round = config.round;
      state.sheetReady = true;
      banner(null);
    } catch (err) {
      state.sheetReady = false;
      banner(`เชื่อมต่อ Google Sheet ไม่ได้: ${esc(err.message)} — ดูรายชื่อและผลประเมินได้ แต่ยังบันทึกไม่ได้`, "error");
    }

    $("hdr-year").textContent = state.year;
    $("hdr-round").textContent = state.round || "–";
    $("hdr-name").textContent = state.me.name;
    $("hdr-role").textContent =
      state.me.role === "ADMIN" ? "ผู้ดูแลระบบ (กรอกได้ทุกห้อง)" : state.teacher ? "ครูประจำชั้น" : "ครู";
    showView("app");
    selectTab("entry");
    renderRoomPicker();
  }

  // ─── แท็บ ─────────────────────────────────────────────────────────────

  function selectTab(name) {
    document.querySelectorAll(".tab").forEach((btn) => {
      const active = btn.dataset.tab === name;
      btn.className =
        "tab px-4 py-2 text-sm border-b-2 " +
        (active ? "border-emerald-600 text-emerald-700 font-medium" : "border-transparent text-slate-500 hover:text-slate-700");
      btn.setAttribute("aria-selected", String(active));
    });
    show("tab-entry", name === "entry");
    show("tab-progress", name === "progress");
    updateSaveBar();
    if (name === "progress") loadProgress();
  }

  document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => selectTab(btn.dataset.tab)));

  // ─── เลือกห้อง ────────────────────────────────────────────────────────

  function renderRoomPicker() {
    if (!state.myRooms.length) {
      show("entry-main", false);
      show("entry-empty", true);
      $("entry-empty").innerHTML =
        state.me.role !== "ADMIN" && !state.teacher
          ? `บัญชี <b>${esc(state.me.email)}</b> ยังไม่ได้ผูกกับข้อมูลครูในระบบทะเบียน<br />
             <span class="text-sm text-slate-500">ขอให้แอดมินผูกบัญชีที่หน้ารายละเอียดครู แล้วเข้าสู่ระบบใหม่ — ระหว่างนี้ดูแท็บ "ติดตามการส่ง" ได้</span>`
          : `ไม่พบห้องที่คุณเป็นครูประจำชั้นในปีการศึกษา ${esc(state.year)}`;
      return;
    }
    show("entry-empty", false);
    show("entry-main", true);
    const select = $("room-select");
    select.innerHTML = state.myRooms.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("");
    select.disabled = state.myRooms.length === 1;
    select.value = state.myRooms[0].id;
    loadRoom(select.value);
  }

  $("room-select").addEventListener("change", (e) => {
    if (state.edits.size && !confirm("ยังมีค่าที่ไม่ได้บันทึก เปลี่ยนห้องแล้วค่าที่แก้จะหาย ดำเนินการต่อไหม?")) {
      e.target.value = state.roomId;
      return;
    }
    loadRoom(e.target.value);
  });

  // ─── รายชื่อ + ค่าที่บันทึกไว้ ───────────────────────────────────────────

  /**
   * แปลงนักเรียนจาก API เป็นแถวของตาราง — คัดเฉพาะฟิลด์ที่ต้องใช้
   * (API ส่งที่อยู่/เบอร์ผู้ปกครองมาด้วย แต่หน้านี้ไม่ต้องใช้ จึงไม่เก็บไว้ใน state)
   */
  function toRosterRow(student, index, saved) {
    return {
      id: student.id,
      no: index + 1,
      studentNumber: student.studentNumber,
      prefixTh: student.prefixTh,
      firstName: student.firstName,
      lastName: student.lastName,
      fullName: student.fullName,
      gender: student.gender,
      birthDate: student.birthDate,
      saved: saved || null, // { weight, height, measuredAt, updatedAt, updatedBy } | null
    };
  }

  async function loadRoom(roomId) {
    state.roomId = roomId;
    state.edits.clear();
    state.roster = [];
    $("roster-body").innerHTML = "";
    show("roster-loading", true);
    renderStats();
    updateSaveBar();
    try {
      const [students, records] = await Promise.all([
        Api.listStudentsInClassroom(roomId),
        state.sheetReady ? Sheet.call("records", { classroomId: roomId }) : Promise.resolve({ records: {} }),
      ]);
      if (roomId !== state.roomId) return; // ผู้ใช้เปลี่ยนห้องระหว่างรอ
      state.roster = students.map((s, i) => toRosterRow(s, i, records.records[s.id]));
      renderRoster();
    } catch (err) {
      handleError(err);
    } finally {
      show("roster-loading", false);
    }
  }

  // ─── ค่าปัจจุบันของแถว (ที่บันทึกไว้ หรือที่กำลังแก้) ───────────────────────

  /** แปลงข้อความในช่องเป็นตัวเลข · ว่าง = null · ไม่ใช่ตัวเลข = NaN */
  function parse(text) {
    const t = String(text ?? "").trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  }

  function current(row) {
    const edit = state.edits.get(row.id);
    const weight = edit ? parse(edit.weight) : row.saved ? row.saved.weight : null;
    const height = edit ? parse(edit.height) : row.saved ? row.saved.height : null;
    // อายุคิด ณ วันที่วัด: แก้ค่าวันนี้ = วันนี้ · ค่าเดิม = วันที่บันทึกไว้
    const measuredAt = edit ? Growth.today() : (row.saved && row.saved.measuredAt) || Growth.today();
    return { weight, height, measuredAt };
  }

  function invalid(field, value) {
    if (value === null) return null;
    const [min, max] = LIMITS[field];
    if (Number.isNaN(value)) return "ต้องเป็นตัวเลข";
    if (value < min || value > max) return `ต้องอยู่ระหว่าง ${min}–${max}`;
    return null;
  }

  function evaluate(row) {
    const cur = current(row);
    const errors = { weight: invalid("weight", cur.weight), height: invalid("height", cur.height) };
    const ok = !errors.weight && !errors.height;
    const result = Growth.assess({
      gender: row.gender,
      birthDate: row.birthDate,
      weight: ok ? cur.weight : null,
      height: ok ? cur.height : null,
      measuredAt: cur.measuredAt,
    });
    const complete = ok && cur.weight !== null && cur.height !== null;
    return { ...cur, errors, result, complete };
  }

  // ─── วาดตาราง ─────────────────────────────────────────────────────────

  const HEIGHT_BADGE = ["bg-red-100 text-red-800", "bg-amber-100 text-amber-800", "bg-emerald-100 text-emerald-800", "bg-sky-100 text-sky-800", "bg-sky-200 text-sky-900"];
  const WEIGHT_BADGE = ["bg-amber-200 text-amber-900", "bg-amber-100 text-amber-800", "bg-emerald-100 text-emerald-800", "bg-orange-100 text-orange-800", "bg-orange-200 text-orange-900", "bg-red-200 text-red-900"];

  function badge(r, palette) {
    if (!r) return `<span class="text-slate-400">–</span>`;
    return `<span class="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${palette[r.level]}">${esc(r.label)}</span>`;
  }

  /** ช่องผลประเมิน 3 ช่อง — อัปเดตแยกจากช่องกรอก ไม่ให้เคอร์เซอร์หลุดตอนพิมพ์ */
  function derivedCells(row, ev) {
    const outside = ev.complete && (!ev.result.height || !ev.result.weight);
    return {
      bmi: ev.result.bmi ?? `<span class="text-slate-400">–</span>`,
      h: ev.complete && !ev.result.height ? `<span class="text-xs text-slate-400">นอกตาราง</span>` : badge(ev.result.height, HEIGHT_BADGE),
      w: ev.complete && !ev.result.weight ? `<span class="text-xs text-slate-400">นอกตาราง</span>` : badge(ev.result.weight, WEIGHT_BADGE),
      outside,
    };
  }

  function inputCell(row, field, value, error) {
    const ring = error ? "border-red-400 bg-red-50 focus:ring-red-400" : "border-slate-300 focus:ring-emerald-500";
    return `<input type="number" inputmode="decimal" step="0.1" data-id="${esc(row.id)}" data-field="${field}"
      value="${value === null || Number.isNaN(value) ? "" : esc(value)}" title="${esc(error || "")}"
      class="w-20 rounded-md border px-2 py-1 text-right focus:outline-none focus:ring-2 ${ring}" />`;
  }

  function rowHtml(row) {
    const ev = evaluate(row);
    const edit = state.edits.get(row.id);
    const d = derivedCells(row, ev);
    const hidden = $("filter-missing").checked && ev.complete && !edit;
    const marker = !ev.complete ? "border-l-4 border-l-amber-300" : edit ? "border-l-4 border-l-sky-400" : "border-l-4 border-l-transparent";
    return `<tr data-row="${esc(row.id)}" class="border-t border-slate-100 ${marker}" ${hidden ? "hidden" : ""}>
      <td class="px-3 py-1.5 text-center text-slate-500">${row.no}</td>
      <td class="px-3 py-1.5 tabular-nums">${esc(row.studentNumber)}</td>
      <td class="px-3 py-1.5 whitespace-nowrap">${esc(row.prefixTh)}${esc(row.firstName)}</td>
      <td class="px-3 py-1.5 whitespace-nowrap">${esc(row.lastName)}</td>
      <td class="px-3 py-1.5 text-center">${inputCell(row, "weight", edit ? edit.weight : ev.weight, ev.errors.weight)}</td>
      <td class="px-3 py-1.5 text-center">${inputCell(row, "height", edit ? edit.height : ev.height, ev.errors.height)}</td>
      <td class="px-3 py-1.5 text-center tabular-nums" data-cell="bmi">${d.bmi}</td>
      <td class="px-3 py-1.5" data-cell="h">${d.h}</td>
      <td class="px-3 py-1.5" data-cell="w">${d.w}</td>
      <td class="px-3 py-1.5 text-center">
        <button data-chart="${esc(row.id)}" class="rounded-md px-2 py-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-30" ${ev.complete ? "" : "disabled"} aria-label="ดูกราฟ">📈</button>
      </td>
    </tr>`;
  }

  function renderRoster() {
    $("roster-body").innerHTML = state.roster.length
      ? state.roster.map(rowHtml).join("")
      : `<tr><td colspan="10" class="p-6 text-center text-slate-500">ไม่มีนักเรียนสถานะกำลังศึกษาในห้องนี้</td></tr>`;
    renderStats();
    updateSaveBar();
  }

  /** อัปเดตเฉพาะแถวเดียวหลังพิมพ์ (ไม่วาดช่องกรอกใหม่) */
  function refreshRow(row) {
    const tr = document.querySelector(`tr[data-row="${CSS.escape(row.id)}"]`);
    if (!tr) return;
    const ev = evaluate(row);
    const d = derivedCells(row, ev);
    tr.querySelector('[data-cell="bmi"]').innerHTML = d.bmi;
    tr.querySelector('[data-cell="h"]').innerHTML = d.h;
    tr.querySelector('[data-cell="w"]').innerHTML = d.w;
    tr.querySelector("[data-chart]").disabled = !ev.complete;
    for (const field of ["weight", "height"]) {
      const input = tr.querySelector(`input[data-field="${field}"]`);
      const error = ev.errors[field];
      input.title = error || "";
      input.classList.toggle("border-red-400", Boolean(error));
      input.classList.toggle("bg-red-50", Boolean(error));
      input.classList.toggle("border-slate-300", !error);
    }
    tr.classList.remove("border-l-amber-300", "border-l-sky-400", "border-l-transparent");
    tr.classList.add(state.edits.has(row.id) ? "border-l-sky-400" : ev.complete ? "border-l-transparent" : "border-l-amber-300");
    renderStats();
    updateSaveBar();
  }

  function renderStats() {
    const total = state.roster.length;
    const done = state.roster.filter((r) => evaluate(r).complete).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const good = state.roster.filter((r) => evaluate(r).result.goodShape).length;
    $("room-stats").innerHTML = total
      ? `<div class="text-sm text-slate-600">กรอกแล้ว <b class="text-slate-800">${done}</b> / ${total} คน (${pct}%)
           · สูงดีสมส่วน <b class="text-slate-800">${good}</b> คน</div>
         <div class="mt-1 h-2 rounded-full bg-slate-200 overflow-hidden"><div class="h-full bg-emerald-500" style="width:${pct}%"></div></div>`
      : "";
  }

  // ─── พิมพ์ค่า ─────────────────────────────────────────────────────────

  $("roster-body").addEventListener("input", (e) => {
    const input = e.target.closest("input[data-field]");
    if (!input) return;
    const row = state.roster.find((r) => r.id === input.dataset.id);
    const tr = input.closest("tr");
    const weight = tr.querySelector('input[data-field="weight"]').value;
    const height = tr.querySelector('input[data-field="height"]').value;
    const savedW = row.saved && row.saved.weight !== null ? String(row.saved.weight) : "";
    const savedH = row.saved && row.saved.height !== null ? String(row.saved.height) : "";
    // พิมพ์กลับเป็นค่าเดิม = ไม่นับว่าแก้
    if (parse(weight) === parse(savedW) && parse(height) === parse(savedH)) state.edits.delete(row.id);
    else state.edits.set(row.id, { weight, height });
    refreshRow(row);
  });

  /** Enter = ลงไปช่องเดียวกันของแถวถัดไปที่มองเห็น (ครูกรอกไล่ตามใบชั่งน้ำหนัก) */
  $("roster-body").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const input = e.target.closest("input[data-field]");
    if (!input) return;
    e.preventDefault();
    const inputs = [...document.querySelectorAll(`#roster-body tr:not([hidden]) input[data-field="${input.dataset.field}"]`)];
    const next = inputs[inputs.indexOf(input) + 1];
    if (next) {
      next.focus();
      next.select();
    } else input.blur();
  });

  $("filter-missing").addEventListener("change", renderRoster);

  // ─── บันทึก ───────────────────────────────────────────────────────────

  function updateSaveBar() {
    const n = state.edits.size;
    const onEntry = !$("tab-entry").hidden;
    show("save-bar", n > 0 && onEntry);
    if (!n) return;
    const bad = state.roster.filter((r) => state.edits.has(r.id)).some((r) => {
      const ev = evaluate(r);
      return ev.errors.weight || ev.errors.height;
    });
    $("save-info").textContent = bad
      ? `แก้ไข ${n} คน · มีช่องที่ค่าไม่ถูกต้อง (กรอบสีแดง)`
      : `แก้ไข ${n} คน ยังไม่ได้บันทึก`;
    $("btn-save").disabled = bad || !state.sheetReady;
    $("btn-save").textContent = `บันทึก ${n} คน`;
  }

  $("btn-discard").addEventListener("click", () => {
    state.edits.clear();
    renderRoster();
  });

  $("btn-save").addEventListener("click", async () => {
    const button = $("btn-save");
    const rows = state.roster
      .filter((r) => state.edits.has(r.id))
      .map((r) => {
        const ev = evaluate(r);
        // ส่งผลประเมินไปเก็บด้วย ให้แอดมินกรอง/นับในชีตได้เลย (หน้าเว็บคำนวณใหม่ทุกครั้งที่เปิด ไม่ได้อ่านค่านี้กลับ)
        return {
          studentId: r.id,
          weight: ev.weight,
          height: ev.height,
          measuredAt: ev.measuredAt,
          ageMonths: ev.result.ageMonths,
          bmi: ev.result.bmi,
          heightStatus: ev.result.height ? ev.result.height.label : "",
          weightStatus: ev.result.weight ? ev.result.weight.label : "",
        };
      });
    button.disabled = true;
    button.textContent = "กำลังบันทึก…";
    try {
      await Sheet.call("save", { classroomId: state.roomId, rows });
      for (const r of rows) {
        const row = state.roster.find((x) => x.id === r.studentId);
        row.saved = { weight: r.weight, height: r.height, measuredAt: r.measuredAt, updatedAt: new Date().toISOString(), updatedBy: state.me.name };
      }
      state.edits.clear();
      state.allStudents = null; // ให้แท็บติดตามโหลดใหม่
      renderRoster();
      toast(`บันทึกแล้ว ${rows.length} คน`);
    } catch (err) {
      handleError(err);
      updateSaveBar();
    }
  });

  window.addEventListener("beforeunload", (e) => {
    if (state.edits.size) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // ─── กล่องกราฟรายคน ────────────────────────────────────────────────────

  $("roster-body").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-chart]");
    if (!btn) return;
    const row = state.roster.find((r) => r.id === btn.dataset.chart);
    openChart(row);
  });

  function openChart(row) {
    const ev = evaluate(row);
    const r = ev.result;
    const room = state.classrooms.find((c) => c.id === state.roomId);
    $("chart-title").textContent = `${row.fullName}`;
    $("chart-sub").textContent =
      `${room ? room.name : ""} · ${row.gender === "FEMALE" ? "หญิง" : "ชาย"} · อายุ ${Growth.formatAge(r.ageMonths)} ` +
      `(ณ ${thaiDate(ev.measuredAt)})`;
    const young = r.ageMonths !== null && r.ageMonths < 72;
    const shape =
      r.goodShape === null
        ? ""
        : r.goodShape
          ? `<span class="rounded-full bg-emerald-600 text-white px-3 py-1 text-sm">✓ สูงดีสมส่วน</span>`
          : `<span class="rounded-full bg-slate-200 text-slate-700 px-3 py-1 text-sm">ยังไม่สูงดีสมส่วน</span>`;
    $("chart-body").innerHTML = `
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div>น้ำหนัก <b>${ev.weight}</b> กก.</div>
        <div>ส่วนสูง <b>${ev.height}</b> ซม.</div>
        <div>BMI <b>${r.bmi ?? "–"}</b></div>
        ${shape}
      </div>
      <div class="grid gap-5 md:grid-cols-2">
        <section>
          <h4 class="font-medium mb-1">ส่วนสูงตามเกณฑ์อายุ · ${badge(r.height, HEIGHT_BADGE)}</h4>
          ${GrowthChart.heightChart({ gender: row.gender, ageMonths: r.ageMonths, height: ev.height })}
        </section>
        <section>
          <h4 class="font-medium mb-1">น้ำหนักตามเกณฑ์ส่วนสูง · ${badge(r.weight, WEIGHT_BADGE)}</h4>
          ${GrowthChart.weightChart({ gender: row.gender, ageMonths: r.ageMonths, height: ev.height, weight: ev.weight })}
        </section>
      </div>
      <p class="text-xs text-slate-500">
        ${young ? "อายุต่ำกว่า 6 ปี — ใช้มาตรฐานการเจริญเติบโตของ WHO (ที่กรมอนามัยใช้กับเด็ก 0–5 ปี)" : "เกณฑ์อ้างอิงการเจริญเติบโตของเด็กอายุ 6–19 ปี สำนักโภชนาการ กรมอนามัย พ.ศ. 2564"}
        · สูงดีสมส่วน = ส่วนสูงระดับสูงตามเกณฑ์ขึ้นไป และน้ำหนักระดับสมส่วน
      </p>`;
    $("chart-dialog").showModal();
  }

  // ปิดได้ด้วยปุ่ม ✕ หรือ Esc เท่านั้น — คลิกนอกกล่องไม่ปิด (กันปิดพลาดตอนเลื่อนบนมือถือ)
  $("chart-close").addEventListener("click", () => $("chart-dialog").close());

  // ─── แท็บติดตามการส่ง ──────────────────────────────────────────────────

  async function loadProgress(force = false) {
    if (!state.sheetReady) {
      $("progress-body").innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-500">ต้องเชื่อม Google Sheet ก่อนจึงจะดูความคืบหน้าได้</td></tr>`;
      return;
    }
    show("progress-loading", true);
    $("progress-body").innerHTML = "";
    $("progress-total").innerHTML = "";
    try {
      if (force || !state.allStudents) state.allStudents = await Api.listAllStudents(state.year);
      const summary = await Sheet.call("summary");
      renderProgress(new Set(summary.done));
    } catch (err) {
      handleError(err);
    } finally {
      show("progress-loading", false);
    }
  }

  $("btn-refresh-progress").addEventListener("click", () => loadProgress(true));

  function renderProgress(doneIds) {
    // นับต่อห้องจากรายชื่อ "กำลังศึกษา" ตอนนี้ — คนที่ย้ายออกแล้วไม่ถูกนับ แม้จะมีแถวในชีต
    const perRoom = new Map();
    for (const s of state.allStudents) {
      const id = s.enrollment.classroom.id;
      const p = perRoom.get(id) || { total: 0, done: 0 };
      p.total += 1;
      if (doneIds.has(s.id)) p.done += 1;
      perRoom.set(id, p);
    }

    let total = 0;
    let done = 0;
    const rows = state.classrooms
      .filter((room) => perRoom.has(room.id))
      .map((room) => {
        const p = perRoom.get(room.id);
        total += p.total;
        done += p.done;
        const pct = Math.round((p.done / p.total) * 100);
        const status =
          p.done === p.total
            ? `<span class="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-xs">✅ ครบแล้ว</span>`
            : p.done > 0
              ? `<span class="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs">🟡 ยังไม่ครบ</span>`
              : `<span class="rounded-full bg-red-100 text-red-800 px-2 py-0.5 text-xs">🔴 ยังไม่ส่ง</span>`;
        const teachers = room.teachers.length
          ? room.teachers.map((t) => esc(t.fullName)).join("<br />")
          : `<span class="text-slate-400">ยังไม่กำหนด</span>`;
        return `<tr class="border-t border-slate-100">
          <td class="px-3 py-2 font-medium whitespace-nowrap">${esc(room.name)}</td>
          <td class="px-3 py-2">${teachers}</td>
          <td class="px-3 py-2 text-center tabular-nums whitespace-nowrap">${p.done} / ${p.total}</td>
          <td class="px-3 py-2">
            <div class="flex items-center gap-2">
              <div class="flex-1 h-2 rounded-full bg-slate-200 overflow-hidden"><div class="h-full ${pct === 100 ? "bg-emerald-500" : "bg-amber-400"}" style="width:${pct}%"></div></div>
              <span class="tabular-nums w-10 text-right">${pct}%</span>
            </div>
          </td>
          <td class="px-3 py-2 whitespace-nowrap">${status}</td>
        </tr>`;
      });

    const pct = total ? Math.round((done / total) * 100) : 0;
    const roomsDone = [...perRoom.values()].filter((p) => p.done === p.total).length;
    const roomsNone = [...perRoom.values()].filter((p) => p.done === 0).length;
    $("progress-total").innerHTML = `
      <div class="grid gap-3 sm:grid-cols-3">
        <div class="bg-white rounded-xl border border-slate-200 p-4">
          <div class="text-sm text-slate-500">ทั้งโรงเรียน</div>
          <div class="text-2xl font-semibold">${pct}%</div>
          <div class="text-sm text-slate-500">${done} / ${total} คน</div>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 p-4">
          <div class="text-sm text-slate-500">ห้องที่ส่งครบ</div>
          <div class="text-2xl font-semibold text-emerald-700">${roomsDone}</div>
          <div class="text-sm text-slate-500">จาก ${perRoom.size} ห้อง</div>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 p-4">
          <div class="text-sm text-slate-500">ห้องที่ยังไม่ส่งเลย</div>
          <div class="text-2xl font-semibold text-red-700">${roomsNone}</div>
          <div class="text-sm text-slate-500">รอบ ${esc(state.round)}</div>
        </div>
      </div>`;
    $("progress-body").innerHTML =
      rows.join("") || `<tr><td colspan="5" class="p-6 text-center text-slate-500">ยังไม่มีห้องเรียนในปีการศึกษานี้</td></tr>`;
  }

  // ─── เปิดหน้า ─────────────────────────────────────────────────────────

  if (Api.getToken()) boot();
  else showLogin();
})();
