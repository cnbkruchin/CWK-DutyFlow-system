/**
 * IncidentService.gs — บันทึกเหตุการณ์ระหว่างอยู่เวร
 */

var INCIDENT_CATEGORIES = {
  STUDENT:   'นักเรียน',
  SAFETY:    'ความปลอดภัย',
  FACILITY:  'อาคารสถานที่',
  TRAFFIC:   'จราจร/การเดินทาง',
  OUTSIDER:  'บุคคลภายนอก',
  OTHER:     'อื่น ๆ'
};

var INCIDENT_SEVERITY = {
  LOW:      'เล็กน้อย',
  MEDIUM:   'ปานกลาง',
  HIGH:     'รุนแรง',
  CRITICAL: 'ฉุกเฉิน'
};

var INCIDENT_STATUS = {
  OPEN:     'รอดำเนินการ',
  HANDLING: 'กำลังดำเนินการ',
  CLOSED:   'ปิดเรื่องแล้ว'
};

function INCIDENT_options() {
  return {
    categories: Object.keys(INCIDENT_CATEGORIES).map(function (k) {
      return { value: k, label: INCIDENT_CATEGORIES[k] };
    }),
    severities: Object.keys(INCIDENT_SEVERITY).map(function (k) {
      return { value: k, label: INCIDENT_SEVERITY[k] };
    }),
    statuses: Object.keys(INCIDENT_STATUS).map(function (k) {
      return { value: k, label: INCIDENT_STATUS[k] };
    })
  };
}

function INCIDENT_create(ctx, payload) {
  AUTH_require(ctx);
  var p = payload || {};

  var title = sanitizeText(p.title);
  if (title.length < 5) throw new Error('กรุณาระบุหัวข้ออย่างน้อย 5 ตัวอักษร');
  var detail = sanitizeText(p.detail);
  if (detail.length < 10) throw new Error('กรุณาอธิบายรายละเอียดอย่างน้อย 10 ตัวอักษร');
  if (!INCIDENT_CATEGORIES[str(p.category)]) throw new Error('กรุณาเลือกประเภทเหตุการณ์');
  if (!INCIDENT_SEVERITY[str(p.severity)]) throw new Error('กรุณาเลือกระดับความรุนแรง');

  var sch = null, pointId = str(p.pointId), date = toDateStr(p.date) || today();
  if (str(p.scheduleId)) {
    sch = dbGetById('DAILY_SCHEDULE', str(p.scheduleId));
    if (!sch) throw new Error('ไม่พบรายการเวรที่อ้างถึง');
    if (sch.effective_teacher_id !== ctx.teacherId && !AUTH_canSeeOthers(ctx)) {
      throw new Error('บันทึกเหตุการณ์ได้เฉพาะเวรของตนเอง');
    }
    pointId = sch.point_id;
    date = toDateStr(sch.date);
  }
  if (!pointId) throw new Error('กรุณาเลือกจุดเวร');

  var photoId = '', photoUrl = '';
  if (p.photo && p.photo.data && sch) {
    try {
      var saved = DRIVE_savePhoto_(ctx, sch, '', p.photo);
      photoId = saved.file_id;
      photoUrl = saved.file_url;
    } catch (e) { /* ภาพล้มเหลวไม่ควรบล็อกการรายงาน */ }
  }

  var created = dbInsert('INCIDENTS', {
    schedule_id: sch ? sch.id : '',
    date: date,
    point_id: pointId,
    reporter_id: ctx.teacherId,
    category: str(p.category),
    severity: str(p.severity),
    title: title,
    detail: detail,
    photo_file_id: photoId,
    photo_url: photoUrl,
    status: 'OPEN'
  });

  AUDIT_log(ctx, 'INCIDENT_CREATE', 'INCIDENTS', created.id, null,
    { title: title, severity: p.severity, date: date });
  NOTIFY_incident(created.id);
  CACHE_remove('today:' + date);

  return { id: created.id };
}

function INCIDENT_list(ctx, opts) {
  AUTH_require(ctx);
  var o = opts || {};
  var canAll = AUTH_canSeeOthers(ctx);

  var rows = dbReadAll('INCIDENTS');
  if (!canAll) rows = rows.filter(function (r) { return r.reporter_id === ctx.teacherId; });
  if (o.from) rows = rows.filter(function (r) { return toDateStr(r.date) >= toDateStr(o.from); });
  if (o.to) rows = rows.filter(function (r) { return toDateStr(r.date) <= toDateStr(o.to); });
  if (o.status) rows = rows.filter(function (r) { return str(r.status) === o.status; });
  if (o.severity) rows = rows.filter(function (r) { return str(r.severity) === o.severity; });
  if (o.category) rows = rows.filter(function (r) { return str(r.category) === o.category; });
  if (o.pointId) rows = rows.filter(function (r) { return r.point_id === o.pointId; });

  var teachers = indexBy(dbReadAll('TEACHERS'), 'id');
  var points = indexBy(dbReadAll('DUTY_POINTS'), 'id');

  var dto = rows.map(function (r) {
    return {
      id: r.id,
      date: toDateStr(r.date),
      dateThai: thaiDate(toDateStr(r.date), { short: true, weekday: true }),
      pointName: str((points[r.point_id] || {}).name),
      reporterName: teacherFullName(teachers[r.reporter_id]),
      category: str(r.category), categoryLabel: INCIDENT_CATEGORIES[str(r.category)] || '',
      severity: str(r.severity), severityLabel: INCIDENT_SEVERITY[str(r.severity)] || '',
      title: str(r.title), detail: str(r.detail),
      photoUrl: str(r.photo_url),
      status: str(r.status), statusLabel: INCIDENT_STATUS[str(r.status)] || str(r.status),
      handledByName: teacherFullName(teachers[r.handled_by]),
      handledAt: str(r.handled_at), handleNote: str(r.handle_note),
      canHandle: canAll
    };
  });

  dto.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  return {
    total: dto.length,
    open: dto.filter(function (r) { return r.status === 'OPEN'; }).length,
    rows: dto.slice(0, num(o.limit, 200)),
    options: INCIDENT_options()
  };
}

function INCIDENT_handle(ctx, id, status, note) {
  AUTH_requireReviewer(ctx);
  var row = dbGetById('INCIDENTS', id);
  if (!row) throw new Error('ไม่พบเหตุการณ์นี้');
  var s = str(status);
  if (!INCIDENT_STATUS[s]) throw new Error('สถานะไม่ถูกต้อง');
  var n = sanitizeText(note);
  if (s === 'CLOSED' && n.length < 5) {
    throw new Error('กรุณาระบุผลการดำเนินการอย่างน้อย 5 ตัวอักษร');
  }

  var patch = {
    status: s,
    handled_by: ctx.teacherId,
    handled_at: nowIso(),
    handle_note: n
  };
  dbUpdate('INCIDENTS', id, patch);
  AUDIT_log(ctx, 'INCIDENT_HANDLE', 'INCIDENTS', id, { status: row.status }, patch);
  return { id: id, status: s };
}

/** จำนวนเหตุการณ์ที่ยังไม่ปิด (ใช้แสดงป้ายบนเมนู) */
function INCIDENT_openCount(ctx) {
  if (!AUTH_canSeeOthers(ctx)) return 0;
  return dbReadAll('INCIDENTS').filter(function (r) {
    return str(r.status) !== 'CLOSED';
  }).length;
}
