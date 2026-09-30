/**
 * PointRotationService.gs — หมุน "จุด" ภายในเวรแต่ละวัน
 *
 * ต่างจาก RotationService.gs ซึ่งหมุน "วัน" (จันทร์→อังคาร→...) ต่อภาคเรียน
 * ไฟล์นี้หมุนครูไปมาระหว่างจุดเวร ภายในวันเดียวกัน ตามรอบที่ตั้งค่าไว้
 *
 * หลักการ
 *  - คำนวณด้วยสูตรตอนสร้างตารางรายวัน ไม่เก็บตารางซ้ำซ้อน
 *  - ที่นั่งที่ "ปักหมุด" จะถูกดึงออกจากวงหมุน แล้วคงอยู่ตำแหน่งเดิม
 *  - นับลำดับวันแบบข้ามวันหยุด เพื่อไม่ให้รอบหมุนเคลื่อนเมื่อมีวันหยุด
 */

var PR_MODES = {
  OFF:          'ไม่หมุนจุด',
  SEMESTER:     'หมุนครั้งเดียวต้นภาคเรียน',
  WEEKLY:       'หมุนจุดทุกสัปดาห์',
  EVERY_N_DAYS: 'หมุนจุดทุก N วันทำการ',
  DAILY:        'หมุนจุดทุกวัน'
};

function PR_modeOptions() {
  return Object.keys(PR_MODES).map(function (k) {
    return { value: k, label: PR_MODES[k] };
  });
}

function PR_mode_() {
  var m = str(CFG_get('point_rotation_mode', 'OFF')).toUpperCase();
  return PR_MODES[m] ? m : 'OFF';
}

/* ------------------------------------------------------------------ */
/* ลำดับวันทำการ                                                       */
/* ------------------------------------------------------------------ */

var PR_INDEX_CACHE = {};

/**
 * ลำดับวันทำการที่มีเวร นับจากวันเปิดภาคเรียน (วันแรก = 0)
 * ข้ามวันหยุด/วันปิดเรียน เพื่อให้รอบหมุนไม่เคลื่อน
 * คืน -1 ถ้าวันนั้นไม่ใช่วันมีเวร
 */
function PR_dutyDayIndex_(ds, semester, calMap) {
  var date = toDateStr(ds);
  if (!date || !semester) return -1;

  var key = semester.id + '|' + date;
  if (PR_INDEX_CACHE[key] !== undefined) return PR_INDEX_CACHE[key];

  var start = toDateStr(semester.start_date);
  var end = toDateStr(semester.end_date);
  if (!start || date < start) { PR_INDEX_CACHE[key] = -1; return -1; }
  if (end && date > end) { PR_INDEX_CACHE[key] = -1; return -1; }
  if (diffDays(start, date) > 400) { PR_INDEX_CACHE[key] = -1; return -1; }

  var map = calMap || CAL_map_(semester.id);
  var idx = -1;
  for (var d = start; d <= date; d = addDays(d, 1)) {
    if (CAL_isDutyDay(d, semester.id, map)) idx++;
    if (d === date) {
      var result = CAL_isDutyDay(d, semester.id, map) ? idx : -1;
      PR_INDEX_CACHE[key] = result;
      return result;
    }
  }
  PR_INDEX_CACHE[key] = -1;
  return -1;
}

/** วันจันทร์ของสัปดาห์ที่วันนั้นอยู่ */
function PR_mondayOf_(ds) {
  var w = weekdayOf(ds);
  if (!w) return '';
  return addDays(ds, -(w - 1));
}

/** สัปดาห์ที่เท่าไรของภาคเรียน (สัปดาห์แรก = 0) */
function PR_weekIndex_(ds, semester) {
  var startMon = PR_mondayOf_(toDateStr(semester.start_date));
  var thisMon = PR_mondayOf_(toDateStr(ds));
  if (!startMon || !thisMon) return 0;
  return Math.floor(diffDays(startMon, thisMon) / 7);
}

/**
 * offset สำหรับวันที่หนึ่ง ๆ ตามโหมดที่ตั้งค่าไว้
 * คืน 0 หากไม่ต้องหมุน
 */
function PR_offsetFor_(ds, semester, calMap) {
  var mode = PR_mode_();
  if (mode === 'OFF' || mode === 'SEMESTER') return 0;
  if (!semester) return 0;

  var step = Math.max(1, num(CFG_get('point_rotation_step', 1), 1));

  if (mode === 'WEEKLY') {
    return PR_weekIndex_(ds, semester) * step;
  }

  var dayIdx = PR_dutyDayIndex_(ds, semester, calMap);
  if (dayIdx < 0) return 0;

  if (mode === 'DAILY') return dayIdx * step;

  if (mode === 'EVERY_N_DAYS') {
    var n = Math.max(1, num(CFG_get('point_rotation_n_days', 5), 5));
    return Math.floor(dayIdx / n) * step;
  }

  return 0;
}

/* ------------------------------------------------------------------ */
/* หัวใจของการหมุน                                                     */
/* ------------------------------------------------------------------ */

/** ที่นั่งนี้เข้าร่วมวงหมุนจุดหรือไม่ */
function PR_participates_(seat, respectPin) {
  var scope = str(seat.rotation_scope) || 'BOTH';
  if (scope === 'LOCKED' || scope === 'NONE' || scope === 'DAY_ONLY') return false;
  if (respectPin) {
    var pin = str(seat.pin_mode) || 'NONE';
    if (pin === 'POINT' || pin === 'ALL') return false;
  }
  return true;
}

/**
 * หมุนครูระหว่างที่นั่งในกลุ่มเดียวกัน
 *
 * @param seats  array ของ { id, teacher_id, rotation_order, pin_mode, rotation_scope }
 *               ต้องเป็นที่นั่งในวันเดียวกัน ช่วงเวลาเดียวกัน กลุ่มหมุนเดียวกัน
 * @param offset จำนวนตำแหน่งที่เลื่อน
 * @param respectPin เคารพการปักหมุดหรือไม่
 * @return array ใหม่เรียงตาม seats เดิม แต่ละตัวมี teacher_id ที่หมุนแล้ว
 *         และ _rotated = true เมื่อครูเปลี่ยนตำแหน่ง
 */
function PR_applyToSeats_(seats, offset, respectPin) {
  var list = (seats || []).map(function (s) { return DB_clone_(s); });
  if (list.length < 2 || !offset) return list;

  // เรียงลำดับวงหมุนให้คงที่: rotation_order -> point_sort -> seat_no -> id
  var ordered = list.slice().sort(function (a, b) {
    var ao = num(a.rotation_order, 999), bo = num(b.rotation_order, 999);
    if (ao !== bo) return ao - bo;
    var ap = num(a._point_sort, 999), bp = num(b._point_sort, 999);
    if (ap !== bp) return ap - bp;
    var an = num(a.seat_no, 0), bn = num(b.seat_no, 0);
    if (an !== bn) return an - bn;
    return str(a.id) < str(b.id) ? -1 : 1;
  });

  var movable = ordered.filter(function (s) { return PR_participates_(s, respectPin); });
  if (movable.length < 2) return list;

  var teachers = movable.map(function (s) { return s.teacher_id; });
  var n = teachers.length;
  var shift = mod(num(offset, 0), n);
  if (!shift) return list;

  // ที่นั่งลำดับ i ได้ครูที่เคยอยู่ที่นั่งลำดับ (i - shift)
  for (var i = 0; i < n; i++) {
    var srcIdx = mod(i - shift, n);
    var newTeacher = teachers[srcIdx];
    if (movable[i].teacher_id !== newTeacher) movable[i]._rotated = true;
    movable[i].teacher_id = newTeacher;
  }

  return list;
}

/**
 * หมุนจุดสำหรับชุดที่นั่งของ "หนึ่งวัน" ทั้งวัน
 * แยกวงหมุนตาม slot_id + rotation_group
 *
 * @param seats  ที่นั่งทั้งหมดของวันนั้น (ต้องมี slot_id, rotation_group)
 * @param offset จำนวนตำแหน่งที่เลื่อน
 * @return array ใหม่ (ลำดับเดิม)
 */
function PR_applyToDay_(seats, offset, respectPin) {
  if (!offset) return (seats || []).map(function (s) { return DB_clone_(s); });

  var byRing = {};
  (seats || []).forEach(function (s, i) {
    var key = str(s.slot_id) + '|' + (str(s.rotation_group) || 'DEFAULT');
    if (!byRing[key]) byRing[key] = [];
    var c = DB_clone_(s);
    c._pos = i;
    byRing[key].push(c);
  });

  var out = new Array((seats || []).length);
  Object.keys(byRing).forEach(function (key) {
    PR_applyToSeats_(byRing[key], offset, respectPin).forEach(function (s) {
      out[s._pos] = s;
    });
  });

  return out.map(function (s) { delete s._pos; return s; });
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/** ตั้งค่าการหมุนจุดปัจจุบัน */
function PR_settings(ctx) {
  AUTH_requireReviewer(ctx);
  var canEdit = ctx.level >= ROLES.DUTY_ADMIN.level;
  return {
    canEdit: canEdit,
    mode: PR_mode_(),
    modeLabel: PR_MODES[PR_mode_()],
    modeOptions: PR_modeOptions(),
    nDays: num(CFG_get('point_rotation_n_days', 5), 5),
    step: num(CFG_get('point_rotation_step', 1), 1),
    respectPin: CFG_bool('point_rotation_respect_pin'),
    dayRotationEnabled: CFG_bool('day_rotation_enabled'),
    dayRotationShift: num(CFG_get('day_rotation_shift', 1), 1)
  };
}

function PR_saveSettings(ctx, data) {
  AUTH_requireAdmin(ctx);
  var d = data || {};
  var mode = str(d.mode).toUpperCase();
  if (!PR_MODES[mode]) throw new Error('โหมดการหมุนจุดไม่ถูกต้อง');

  var n = num(d.nDays, 5);
  if (mode === 'EVERY_N_DAYS' && (n < 1 || n > 60)) {
    throw new Error('จำนวนวันต้องอยู่ระหว่าง 1 ถึง 60');
  }
  var step = num(d.step, 1);
  if (step < 1 || step > 20) throw new Error('จำนวนตำแหน่งที่เลื่อนต้องอยู่ระหว่าง 1 ถึง 20');

  CFG_set(ctx, 'point_rotation_mode', mode);
  CFG_set(ctx, 'point_rotation_n_days', n);
  CFG_set(ctx, 'point_rotation_step', step);
  CFG_set(ctx, 'point_rotation_respect_pin', bool(d.respectPin));
  if (d.dayRotationEnabled !== undefined) {
    CFG_set(ctx, 'day_rotation_enabled', bool(d.dayRotationEnabled));
  }
  if (d.dayRotationShift !== undefined) {
    CFG_set(ctx, 'day_rotation_shift', num(d.dayRotationShift, 1));
  }

  AUDIT_log(ctx, 'POINT_ROTATION_SETTINGS', 'CONFIG', 'point_rotation', null, d);
  return PR_settings(ctx);
}

/**
 * พรีวิวผลการหมุนจุดล่วงหน้า N สัปดาห์ โดยไม่แตะข้อมูลจริง
 * ใช้ตอบคำถาม "ถ้าเปิดโหมดนี้ ครูจะไปอยู่จุดไหนบ้าง"
 */
function PR_preview(ctx, opts) {
  AUTH_requireReviewer(ctx);
  var o = opts || {};
  var semester = o.semesterId ? dbGetById('SEMESTERS', o.semesterId) : SEMESTER_active();
  if (!semester) throw new Error('ยังไม่ได้กำหนดภาคเรียนที่ใช้งาน');

  var weeks = Math.min(8, Math.max(1, num(o.weeks, 4)));
  var startDate = toDateStr(o.from) || today();
  if (startDate < toDateStr(semester.start_date)) startDate = toDateStr(semester.start_date);

  var calMap = CAL_map_(semester.id);
  var teachers = indexBy(dbReadAll('TEACHERS'), 'id');
  var points = indexBy(dbReadAll('DUTY_POINTS'), 'id');
  var slots = indexBy(dbReadAll('TIME_SLOTS'), 'id');
  var respectPin = CFG_bool('point_rotation_respect_pin');

  var assignments = dbFind('ASSIGNMENTS', { semester_id: semester.id, status: 'ACTIVE' });
  var byWeekday = groupBy(assignments, function (a) { return num(a.weekday); });

  var days = [];
  var cursor = startDate;
  var guard = 0;
  while (days.length < weeks * 5 && guard++ < weeks * 14) {
    if (CAL_isDutyDay(cursor, semester.id, calMap)) {
      var w = weekdayOf(cursor);
      var seats = (byWeekday[w] || []).map(function (a) {
        var p = points[a.point_id] || {};
        return {
          id: a.id, teacher_id: a.teacher_id, seat_no: num(a.seat_no),
          slot_id: a.slot_id, point_id: a.point_id,
          rotation_group: str(a.rotation_group) || str(p.rotation_group) || 'DEFAULT',
          rotation_order: num(a.rotation_order, 999),
          rotation_scope: str(a.rotation_scope) || 'BOTH',
          pin_mode: str(a.pin_mode) || 'NONE',
          _point_sort: num(p.sort_order, 999)
        };
      });

      var offset = PR_offsetFor_(cursor, semester, calMap);
      var rotated = PR_applyToDay_(seats, offset, respectPin);

      days.push({
        date: cursor,
        dateThai: thaiDate(cursor, { short: true, weekday: true }),
        weekday: w,
        weekdayName: thaiWeekday(w),
        offset: offset,
        dutyDayIndex: PR_dutyDayIndex_(cursor, semester, calMap),
        rows: rotated.map(function (s, i) {
          var before = seats[i];
          return {
            pointName: str((points[s.point_id] || {}).name),
            slotName: str((slots[s.slot_id] || {}).name),
            seatNo: s.seat_no,
            beforeName: teacherFullName(teachers[before.teacher_id]),
            afterName: teacherFullName(teachers[s.teacher_id]),
            changed: before.teacher_id !== s.teacher_id,
            pinned: !PR_participates_(s, respectPin)
          };
        })
      });
    }
    cursor = addDays(cursor, 1);
  }

  return {
    semester: SEMESTER_dto_(semester),
    mode: PR_mode_(),
    modeLabel: PR_MODES[PR_mode_()],
    respectPin: respectPin,
    weeks: weeks,
    days: days
  };
}
