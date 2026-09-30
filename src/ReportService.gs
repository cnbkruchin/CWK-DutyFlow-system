/**
 * ReportService.gs — รายงาน
 *
 *  1) รายงานการปฏิบัติงานเวรประจำวัน
 *  2) สรุปครูอยู่/ไม่อยู่ แยกเป็นกลุ่ม ๆ
 *  3) รายงานประกอบอื่น ๆ (หลักฐานไม่ครบ, การเปลี่ยนเวร, ภาระงาน)
 */

var GROUP_DIMENSIONS = {
  DEPARTMENT: 'กลุ่มสาระการเรียนรู้',
  DUTY_POINT: 'จุดเวร',
  TIME_SLOT:  'ช่วงเวลา',
  WEEKDAY:    'วันในสัปดาห์',
  ROLE:       'บทบาทในระบบ'
};

function REPORT_groupOptions() {
  return Object.keys(GROUP_DIMENSIONS).map(function (k) {
    return { value: k, label: GROUP_DIMENSIONS[k] };
  });
}

/* ================================================================= */
/* ตัวสร้างข้อมูลกลาง                                                 */
/* ================================================================= */

/**
 * รวมตาราง + หลักฐาน + การอนุมัติ ของช่วงวันที่ ด้วยการอ่านตารางละครั้งเดียว
 * คืน array ของแถวระดับ "ที่นั่ง"
 */
function REPORT_buildRows_(from, to) {
  var a = toDateStr(from), b = toDateStr(to);
  if (!a || !b || b < a) throw new Error('ช่วงวันที่ไม่ถูกต้อง');
  if (diffDays(a, b) > 200) throw new Error('เลือกช่วงได้ไม่เกิน 200 วัน');

  var rows = dbReadAll('DAILY_SCHEDULE').filter(function (r) {
    var d = toDateStr(r.date);
    return d >= a && d <= b;
  });
  if (!rows.length) return [];

  var teachers = indexBy(dbReadAll('TEACHERS'), 'id');
  var points = indexBy(dbReadAll('DUTY_POINTS'), 'id');
  var slots = indexBy(dbReadAll('TIME_SLOTS'), 'id');

  var logs = dbReadAll('DUTY_LOGS').filter(function (l) {
    var d = toDateStr(l.date);
    return d >= a && d <= b;
  });
  var logsBySched = groupBy(logs, function (l) { return l.schedule_id; });

  var photoCount = {};
  dbReadAll('DUTY_PHOTOS').forEach(function (p) {
    var d = toDateStr(p.date);
    if (d >= a && d <= b) photoCount[p.schedule_id] = (photoCount[p.schedule_id] || 0) + 1;
  });

  var incCount = {};
  dbReadAll('INCIDENTS').forEach(function (x) {
    var d = toDateStr(x.date);
    if (d >= a && d <= b && x.schedule_id) {
      incCount[x.schedule_id] = (incCount[x.schedule_id] || 0) + 1;
    }
  });

  var swapBySched = {};
  dbReadAll('SWAP_REQUESTS').forEach(function (s) {
    var d = toDateStr(s.date);
    if (d < a || d > b) return;
    var st = str(s.approval_status);
    if (st !== 'APPROVED' && st !== 'APPLIED') return;
    var cur = swapBySched[s.schedule_id];
    if (!cur || str(s.approved_at) > str(cur.approved_at)) swapBySched[s.schedule_id] = s;
  });

  var graceMin = num(CFG_get('late_grace_minutes', 10), 10);
  var minPhotos = num(CFG_get('evidence_min_photos', 1), 1);
  var requirePhoto = CFG_bool('evidence_require_photo');
  var requireCheckout = CFG_bool('require_checkout');

  return rows.map(function (r) {
    var slot = slots[r.slot_id] || {};
    var point = points[r.point_id] || {};
    var my = logsBySched[r.id] || [];

    var checkIn = null, checkOut = null;
    my.forEach(function (l) {
      if (str(l.action) === 'CHECK_IN' && (!checkIn || str(l.ts) < str(checkIn.ts))) checkIn = l;
      if (str(l.action) === 'CHECK_OUT' && (!checkOut || str(l.ts) > str(checkOut.ts))) checkOut = l;
    });

    var photos = photoCount[r.id] || 0;
    var attend = 'ABSENT', lateMin = 0;
    if (str(r.status) === 'CANCELLED') {
      attend = 'CANCELLED';
    } else if (checkIn) {
      var startM = minutesOfDay(slot.start_time);
      var inM = minutesOfDay(hhmm(checkIn.ts));
      if (startM >= 0 && inM >= 0 && inM > startM + graceMin) {
        lateMin = inM - startM;
        attend = 'LATE';
      } else {
        attend = 'PRESENT';
      }
      if (str(checkIn.geo_status) === 'OUT_OF_RANGE') attend = 'PARTIAL';
      if (requireCheckout && !checkOut) attend = 'PARTIAL';
    }

    var evidence = 'NONE';
    if (checkIn) {
      var geoOk = ['IN_RANGE', 'NEAR', 'NOT_REQUIRED'].indexOf(str(checkIn.geo_status)) >= 0;
      var photoOk = !requirePhoto || photos >= minPhotos;
      evidence = (geoOk && photoOk) ? 'FULL' : 'PARTIAL';
    }

    var effT = teachers[r.effective_teacher_id] || {};
    var origT = teachers[r.original_teacher_id] || {};
    var swap = swapBySched[r.id] || null;

    return {
      id: r.id,
      date: toDateStr(r.date),
      weekday: num(r.weekday),
      slotId: r.slot_id,
      slotName: str(slot.name),
      slotSort: num(slot.sort_order, 99),
      startTime: str(slot.start_time),
      endTime: str(slot.end_time),
      pointId: r.point_id,
      pointName: str(point.name),
      pointSort: num(point.sort_order, 99),
      seatNo: num(r.seat_no),
      originalTeacherId: str(r.original_teacher_id),
      originalTeacherName: teacherFullName(origT),
      effectiveTeacherId: str(r.effective_teacher_id),
      effectiveTeacherName: teacherFullName(effT),
      department: str(effT.department),
      role: str(effT.role),
      changed: str(r.original_teacher_id) !== str(r.effective_teacher_id),
      status: str(r.status),
      source: str(r.source),
      attend: attend,
      lateMinutes: lateMin,
      checkInAt: checkIn ? hhmm(checkIn.ts) : '',
      checkOutAt: checkOut ? hhmm(checkOut.ts) : '',
      distanceM: checkIn ? num(checkIn.distance_m) : null,
      geoStatus: checkIn ? str(checkIn.geo_status) : '',
      photoCount: photos,
      incidentCount: incCount[r.id] || 0,
      evidence: evidence,
      swap: swap ? {
        type: str(swap.request_type),
        typeLabel: SWAP_typeLabel_(swap.request_type),
        reason: str(swap.reason),
        approverName: teacherFullName(teachers[swap.approver_id]),
        approverRole: str(swap.approver_role),
        approvalLevel: num(swap.approval_level),
        approvalLevelName: AUTH_approvalLevelName(swap.approval_level),
        approvedAt: str(swap.approved_at)
      } : null
    };
  });
}

/* ================================================================= */
/* 1) รายงานการปฏิบัติงานเวรประจำวัน                                  */
/* ================================================================= */

function REPORT_dailyPerformance(ctx, opts) {
  AUTH_requireReviewer(ctx);
  var o = opts || {};
  var d = toDateStr(o.date) || today();

  var rows = REPORT_buildRows_(d, d);
  if (o.pointId) rows = rows.filter(function (r) { return r.pointId === o.pointId; });
  if (o.slotId) rows = rows.filter(function (r) { return r.slotId === o.slotId; });
  if (o.onlyProblem) {
    rows = rows.filter(function (r) {
      return r.attend === 'ABSENT' || r.attend === 'LATE' ||
        r.attend === 'PARTIAL' || r.evidence !== 'FULL';
    });
  }

  rows = sortBy(rows, ['slotSort', 'pointSort', 'seatNo']);

  var dto = rows.map(function (r) {
    return {
      id: r.id,
      pointName: r.pointName, seatNo: r.seatNo,
      slotName: r.slotName, timeRange: r.startTime + '–' + r.endTime,
      originalTeacherName: r.originalTeacherName,
      effectiveTeacherName: r.effectiveTeacherName,
      department: r.department,
      changed: r.changed,
      attend: r.attend, attendLabel: SCHEDULE_attendLabel_(r.attend),
      lateMinutes: r.lateMinutes,
      checkInAt: r.checkInAt, checkOutAt: r.checkOutAt,
      distanceM: r.distanceM,
      geoStatus: r.geoStatus, geoLabel: GEO_STATUS[r.geoStatus] || '',
      photoCount: r.photoCount,
      incidentCount: r.incidentCount,
      evidence: r.evidence, evidenceLabel: SCHEDULE_evidenceLabel_(r.evidence),
      approval: r.swap
    };
  });

  return {
    date: d,
    dateThai: thaiDate(d, { weekday: true }),
    schoolName: CFG_str('school_name'),
    generatedAt: nowIso(),
    generatedBy: ctx.name,
    summary: REPORT_summarize_(rows),
    bySlot: REPORT_groupSummary_(rows, function (r) { return r.slotName || 'ไม่ระบุช่วงเวลา'; }),
    rows: dto,
    filters: {
      points: sortBy(dbFind('DUTY_POINTS', { status: 'ACTIVE' }), ['sort_order']).map(function (p) {
        return { id: p.id, name: str(p.name) };
      }),
      slots: sortBy(dbFind('TIME_SLOTS', { status: 'ACTIVE' }), ['sort_order']).map(function (s) {
        return { id: s.id, name: str(s.name) };
      })
    }
  };
}

function REPORT_summarize_(rows) {
  var s = {
    total: rows.length, present: 0, late: 0, partial: 0, absent: 0, cancelled: 0,
    changed: 0, evidenceFull: 0, evidencePartial: 0, evidenceNone: 0,
    photos: 0, incidents: 0
  };
  rows.forEach(function (r) {
    if (r.attend === 'PRESENT') s.present++;
    else if (r.attend === 'LATE') s.late++;
    else if (r.attend === 'PARTIAL') s.partial++;
    else if (r.attend === 'CANCELLED') s.cancelled++;
    else s.absent++;
    if (r.changed) s.changed++;
    if (r.evidence === 'FULL') s.evidenceFull++;
    else if (r.evidence === 'PARTIAL') s.evidencePartial++;
    else s.evidenceNone++;
    s.photos += r.photoCount;
    s.incidents += r.incidentCount;
  });
  var effective = s.total - s.cancelled;
  s.attendedCount = s.present + s.late + s.partial;
  s.attendRate = pct(s.attendedCount, effective);
  s.fullRate = pct(s.present, effective);
  s.evidenceRate = pct(s.evidenceFull, effective);
  return s;
}

function REPORT_groupSummary_(rows, keyFn) {
  var g = groupBy(rows, keyFn);
  return Object.keys(g).map(function (k) {
    var s = REPORT_summarize_(g[k]);
    s.group = k;
    return s;
  }).sort(function (a, b) { return a.group < b.group ? -1 : 1; });
}

/* ================================================================= */
/* 2) สรุปครูอยู่/ไม่อยู่ แยกเป็นกลุ่ม ๆ                                */
/* ================================================================= */

function REPORT_groupKeyFn_(dim) {
  if (dim === 'DUTY_POINT') return function (r) { return r.pointName || 'ไม่ระบุจุด'; };
  if (dim === 'TIME_SLOT') return function (r) { return r.slotName || 'ไม่ระบุช่วงเวลา'; };
  if (dim === 'WEEKDAY') return function (r) { return thaiWeekday(r.weekday) || 'ไม่ระบุวัน'; };
  if (dim === 'ROLE') return function (r) { return (ROLES[r.role] || {}).name || 'ครู'; };
  return function (r) { return r.department || 'ไม่ระบุกลุ่มสาระ'; };
}

/**
 * สรุปการอยู่เวรแยกตามมิติที่เลือก
 * ยอดรวมทุกกลุ่มต้องเท่ากับจำนวนเวรทั้งหมดในช่วง ไม่ว่าจะเลือกมิติใด
 */
function REPORT_attendanceByGroup(ctx, opts) {
  AUTH_requireReviewer(ctx);
  var o = opts || {};
  var from = toDateStr(o.from) || addDays(today(), -30);
  var to = toDateStr(o.to) || today();
  var dim = str(o.groupBy) || CFG_str('attendance_group_default') || 'DEPARTMENT';
  if (!GROUP_DIMENSIONS[dim]) dim = 'DEPARTMENT';

  var rows = REPORT_buildRows_(from, to);
  var keyFn = REPORT_groupKeyFn_(dim);
  var grouped = groupBy(rows, keyFn);

  var teachersByGroup = {};
  rows.forEach(function (r) {
    var k = keyFn(r);
    if (!teachersByGroup[k]) teachersByGroup[k] = {};
    if (r.effectiveTeacherId) teachersByGroup[k][r.effectiveTeacherId] = true;
  });

  var groups = Object.keys(grouped).map(function (k) {
    var s = REPORT_summarize_(grouped[k]);
    return {
      group: k,
      teacherCount: Object.keys(teachersByGroup[k] || {}).length,
      duties: s.total,
      present: s.present,
      late: s.late,
      partial: s.partial,
      absent: s.absent,
      cancelled: s.cancelled,
      changed: s.changed,
      evidenceFull: s.evidenceFull,
      attendRate: s.attendRate,
      fullRate: s.fullRate,
      evidenceRate: s.evidenceRate
    };
  });

  groups.sort(function (a, b) { return b.duties - a.duties || (a.group < b.group ? -1 : 1); });

  var overall = REPORT_summarize_(rows);
  return {
    from: from, to: to,
    fromThai: thaiDate(from), toThai: thaiDate(to),
    groupBy: dim,
    groupByLabel: GROUP_DIMENSIONS[dim],
    groupOptions: REPORT_groupOptions(),
    overall: overall,
    checksum: {
      groupsTotal: groups.reduce(function (a, g) { return a + g.duties; }, 0),
      rowsTotal: rows.length
    },
    groups: groups
  };
}

/** เจาะดูรายชื่อครูภายในกลุ่มหนึ่ง */
function REPORT_attendanceDrill(ctx, opts) {
  AUTH_requireReviewer(ctx);
  var o = opts || {};
  var from = toDateStr(o.from) || addDays(today(), -30);
  var to = toDateStr(o.to) || today();
  var dim = str(o.groupBy) || 'DEPARTMENT';
  if (!GROUP_DIMENSIONS[dim]) dim = 'DEPARTMENT';
  var target = str(o.group);

  var rows = REPORT_buildRows_(from, to);
  var keyFn = REPORT_groupKeyFn_(dim);
  if (target) rows = rows.filter(function (r) { return keyFn(r) === target; });

  var byTeacher = groupBy(rows, function (r) { return r.effectiveTeacherId; });
  var teachers = indexBy(dbReadAll('TEACHERS'), 'id');

  var out = Object.keys(byTeacher).map(function (tid) {
    var s = REPORT_summarize_(byTeacher[tid]);
    var t = teachers[tid] || {};
    return {
      teacherId: tid,
      name: teacherFullName(t) || '(ไม่พบข้อมูลครู)',
      department: str(t.department),
      duties: s.total,
      present: s.present,
      late: s.late,
      partial: s.partial,
      absent: s.absent,
      evidenceFull: s.evidenceFull,
      attendRate: s.attendRate,
      evidenceRate: s.evidenceRate
    };
  });

  return {
    from: from, to: to, groupBy: dim, groupByLabel: GROUP_DIMENSIONS[dim],
    group: target,
    overall: REPORT_summarize_(rows),
    rows: sortBy(out, ['attendRate', 'name'])
  };
}

/* ================================================================= */
/* 3) รายงานประกอบ                                                    */
/* ================================================================= */

/** เวรที่ไม่มีหลักฐาน หรือหลักฐานไม่ครบ */
function REPORT_evidenceGaps(ctx, opts) {
  AUTH_requireReviewer(ctx);
  var o = opts || {};
  var from = toDateStr(o.from) || addDays(today(), -14);
  var to = toDateStr(o.to) || today();

  var rows = REPORT_buildRows_(from, to).filter(function (r) {
    return r.status !== 'CANCELLED' && r.evidence !== 'FULL' && r.date <= today();
  });

  return {
    from: from, to: to,
    total: rows.length,
    rows: sortBy(rows, ['date', 'slotSort', 'pointSort']).map(function (r) {
      return {
        id: r.id, date: r.date, dateThai: thaiDate(r.date, { short: true, weekday: true }),
        pointName: r.pointName, slotName: r.slotName,
        teacherName: r.effectiveTeacherName, department: r.department,
        attend: r.attend, attendLabel: SCHEDULE_attendLabel_(r.attend),
        evidence: r.evidence, evidenceLabel: SCHEDULE_evidenceLabel_(r.evidence),
        checkInAt: r.checkInAt, photoCount: r.photoCount,
        geoStatus: r.geoStatus, geoLabel: GEO_STATUS[r.geoStatus] || ''
      };
    }).slice(0, num(o.limit, 500))
  };
}

/** บันทึกการเปลี่ยนเวรพร้อมสายการอนุมัติ */
function REPORT_swapLog(ctx, opts) {
  AUTH_requireReviewer(ctx);
  var o = opts || {};
  var from = toDateStr(o.from) || addDays(today(), -30);
  var to = toDateStr(o.to) || today();

  var rows = REPORT_buildRows_(from, to).filter(function (r) { return r.changed || r.swap; });

  var byLevel = { 1: 0, 2: 0, 3: 0, 0: 0 };
  rows.forEach(function (r) {
    var lv = r.swap ? num(r.swap.approvalLevel, 0) : 0;
    byLevel[lv] = (byLevel[lv] || 0) + 1;
  });

  return {
    from: from, to: to,
    total: rows.length,
    byLevel: [
      { level: 1, name: AUTH_approvalLevelName(1), count: byLevel[1] || 0 },
      { level: 2, name: AUTH_approvalLevelName(2), count: byLevel[2] || 0 },
      { level: 3, name: AUTH_approvalLevelName(3), count: byLevel[3] || 0 },
      { level: 0, name: 'ไม่พบการอนุมัติ', count: byLevel[0] || 0 }
    ],
    rows: sortBy(rows, ['-date']).map(function (r) {
      return {
        id: r.id, date: r.date, dateThai: thaiDate(r.date, { short: true, weekday: true }),
        pointName: r.pointName, slotName: r.slotName,
        originalTeacherName: r.originalTeacherName,
        effectiveTeacherName: r.effectiveTeacherName,
        attend: r.attend, attendLabel: SCHEDULE_attendLabel_(r.attend),
        type: r.swap ? r.swap.typeLabel : '(ไม่พบคำขอ)',
        reason: r.swap ? r.swap.reason : '',
        approverName: r.swap ? r.swap.approverName : '',
        approvalLevel: r.swap ? r.swap.approvalLevel : 0,
        approvalLevelName: r.swap ? r.swap.approvalLevelName : 'ไม่พบการอนุมัติ',
        approvedAt: r.swap ? r.swap.approvedAt : '',
        approved: !!(r.swap && r.swap.approvalLevel)
      };
    }).slice(0, num(o.limit, 500))
  };
}

/** สรุปรายจุดเวร */
function REPORT_pointSummary(ctx, opts) {
  AUTH_requireReviewer(ctx);
  var o = opts || {};
  var from = toDateStr(o.from) || addDays(today(), -30);
  var to = toDateStr(o.to) || today();
  var rows = REPORT_buildRows_(from, to);
  return {
    from: from, to: to,
    groups: REPORT_groupSummary_(rows, function (r) { return r.pointName || 'ไม่ระบุจุด'; })
  };
}

/** สรุปรายครู (ผู้บริหารดูภาพรวมทั้งโรงเรียน) */
function REPORT_teacherSummary(ctx, opts) {
  AUTH_requireReviewer(ctx);
  return REPORT_attendanceDrill(ctx, {
    from: (opts || {}).from, to: (opts || {}).to, groupBy: 'DEPARTMENT', group: ''
  });
}

/** ตัวเลขสรุปสำหรับแดชบอร์ดผู้บริหาร */
function REPORT_executiveOverview(ctx, opts) {
  AUTH_requireReviewer(ctx);
  var o = opts || {};
  var from = toDateStr(o.from) || addDays(today(), -30);
  var to = toDateStr(o.to) || today();
  var rows = REPORT_buildRows_(from, to);

  var byDate = groupBy(rows, function (r) { return r.date; });
  var trend = Object.keys(byDate).sort().map(function (d) {
    var s = REPORT_summarize_(byDate[d]);
    return { date: d, dateThai: thaiDate(d, { short: true }), attendRate: s.attendRate, total: s.total };
  });

  return {
    from: from, to: to,
    fromThai: thaiDate(from), toThai: thaiDate(to),
    schoolName: CFG_str('school_name'),
    overall: REPORT_summarize_(rows),
    byDepartment: REPORT_groupSummary_(rows, function (r) { return r.department || 'ไม่ระบุ'; }),
    byPoint: REPORT_groupSummary_(rows, function (r) { return r.pointName || 'ไม่ระบุ'; }),
    bySlot: REPORT_groupSummary_(rows, function (r) { return r.slotName || 'ไม่ระบุ'; }),
    trend: trend,
    incidents: INCIDENT_list(ctx, { from: from, to: to, limit: 20 })
  };
}

/* ================================================================= */
/* ส่งออก                                                            */
/* ================================================================= */

/** ส่งออกรายงานเป็นชีตใหม่ในสเปรดชีตเดียวกัน */
function REPORT_exportSheet(ctx, kind, opts) {
  AUTH_requireReviewer(ctx);
  var o = opts || {};
  var header, body, title;

  if (kind === 'DAILY') {
    var rep = REPORT_dailyPerformance(ctx, o);
    title = 'รายงานเวร ' + rep.date;
    header = ['จุดเวร', 'ที่นั่ง', 'ช่วงเวลา', 'เวลา', 'ครูตามตาราง', 'ครูที่ปฏิบัติจริง',
      'กลุ่มสาระ', 'สถานะ', 'สาย(นาที)', 'เข้า', 'ออก', 'ระยะห่าง(ม.)', 'ภาพ',
      'เหตุการณ์', 'หลักฐาน', 'ผู้อนุมัติ', 'ระดับผู้อนุมัติ'];
    body = rep.rows.map(function (r) {
      return [r.pointName, r.seatNo, r.slotName, r.timeRange, r.originalTeacherName,
        r.effectiveTeacherName, r.department, r.attendLabel, r.lateMinutes,
        r.checkInAt, r.checkOutAt, r.distanceM === null ? '' : r.distanceM,
        r.photoCount, r.incidentCount, r.evidenceLabel,
        r.approval ? r.approval.approverName : '',
        r.approval ? r.approval.approvalLevelName : ''];
    });
  } else if (kind === 'GROUP') {
    var g = REPORT_attendanceByGroup(ctx, o);
    title = 'สรุปแยกกลุ่ม ' + g.groupByLabel;
    header = [g.groupByLabel, 'จำนวนครู', 'เวรทั้งหมด', 'อยู่ครบ', 'สาย', 'อยู่ไม่ครบ',
      'ไม่อยู่', 'เปลี่ยนเวร', 'หลักฐานครบ', '% ปฏิบัติงาน', '% หลักฐานครบ'];
    body = g.groups.map(function (r) {
      return [r.group, r.teacherCount, r.duties, r.present, r.late, r.partial,
        r.absent, r.changed, r.evidenceFull, r.attendRate, r.evidenceRate];
    });
  } else if (kind === 'SWAP') {
    var s = REPORT_swapLog(ctx, o);
    title = 'บันทึกการเปลี่ยนเวร';
    header = ['วันที่', 'จุดเวร', 'ช่วงเวลา', 'ครูตามตาราง', 'ครูที่ปฏิบัติจริง',
      'ประเภท', 'เหตุผล', 'ผู้อนุมัติ', 'ระดับ', 'เวลาอนุมัติ'];
    body = s.rows.map(function (r) {
      return [r.dateThai, r.pointName, r.slotName, r.originalTeacherName,
        r.effectiveTeacherName, r.type, r.reason, r.approverName,
        r.approvalLevelName, r.approvedAt];
    });
  } else {
    throw new Error('ไม่รู้จักรายงานที่ต้องการส่งออก');
  }

  var ss = DB_ss();
  var name = truncate(title + ' ' + Utilities.formatDate(new Date(), TZ, 'ddMMyy-HHmm'), 90);
  var sh = ss.insertSheet(name);
  sh.getRange(1, 1).setValue(title + ' — ' + CFG_str('school_name'));
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  sh.getRange(2, 1).setValue('ออกรายงานเมื่อ ' + thaiDate(today()) + ' โดย ' + ctx.name);
  sh.getRange(4, 1, 1, header.length).setValues([header]).setFontWeight('bold')
    .setBackground(CFG_str('brand_primary') || '#7A1F2B').setFontColor('#FFFFFF');
  if (body.length) sh.getRange(5, 1, body.length, header.length).setValues(body);
  sh.setFrozenRows(4);
  sh.autoResizeColumns(1, header.length);

  AUDIT_log(ctx, 'REPORT_EXPORT', 'SHEET', name, null, { kind: kind, rows: body.length });

  return {
    sheetName: name,
    rows: body.length,
    url: ss.getUrl() + '#gid=' + sh.getSheetId()
  };
}
