/**
 * Config.gs — ค่าตั้งค่าระบบ
 *
 * ค่าที่อ่อนไหว (Spreadsheet ID, Drive Folder ID) เก็บใน Script Properties เท่านั้น
 * ห้ามส่งไปฝั่ง Client เด็ดขาด
 */

var CFG_MEM = null;

/** ค่าเริ่มต้นทั้งหมด — ใช้เมื่อยังไม่มีในชีต CONFIG */
var CFG_DEFAULTS = {

  // โรงเรียน
  school_name:            { v: 'โรงเรียนจุนวิทยาคม', g: 'โรงเรียน', l: 'ชื่อโรงเรียน', t: 'text' },
  school_short:           { v: 'จุนวิทยาคม', g: 'โรงเรียน', l: 'ชื่อย่อ', t: 'text' },
  school_address:         { v: 'อำเภอจุน จังหวัดพะเยา', g: 'โรงเรียน', l: 'ที่ตั้ง', t: 'text' },
  school_domain:          { v: '', g: 'โรงเรียน', l: 'โดเมนอีเมลโรงเรียน (เว้นว่าง = ไม่จำกัด)', t: 'text' },
  school_logo_url:        { v: '', g: 'โรงเรียน', l: 'URL โลโก้', t: 'text' },
  director_name:          { v: '', g: 'โรงเรียน', l: 'ชื่อผู้อำนวยการ', t: 'text' },

  // การเช็คอิน / หลักฐาน
  checkin_open_before_min:  { v: 30, g: 'การเช็คอิน', l: 'เปิดให้เช็คอินก่อนเวลาเริ่ม (นาที)', t: 'number' },
  checkin_close_after_min:  { v: 60, g: 'การเช็คอิน', l: 'ปิดการเช็คอินหลังเวลาสิ้นสุด (นาที)', t: 'number' },
  late_grace_minutes:       { v: 10, g: 'การเช็คอิน', l: 'ผ่อนผันสายได้ (นาที)', t: 'number' },
  default_radius_m:         { v: 80, g: 'การเช็คอิน', l: 'รัศมีเริ่มต้นของจุดเวร (เมตร)', t: 'number' },
  gps_required:             { v: true, g: 'การเช็คอิน', l: 'บังคับเปิด GPS', t: 'bool' },
  gps_max_accuracy_m:       { v: 100, g: 'การเช็คอิน', l: 'ความคลาดเคลื่อน GPS ที่ยอมรับ (เมตร)', t: 'number' },
  evidence_require_photo:   { v: true, g: 'การเช็คอิน', l: 'บังคับแนบภาพหลักฐาน', t: 'bool' },
  evidence_min_photos:      { v: 1, g: 'การเช็คอิน', l: 'จำนวนภาพขั้นต่ำ', t: 'number' },
  require_checkout:         { v: false, g: 'การเช็คอิน', l: 'บังคับเช็คเอาต์', t: 'bool' },

  // การหมุนเวร
  day_rotation_enabled:       { v: true, g: 'การหมุนเวร', l: 'เปิดการหมุนวัน (จ→อ→พ→พฤ→ศ→จ)', t: 'bool' },
  day_rotation_shift:         { v: 1, g: 'การหมุนเวร', l: 'จำนวนวันที่เลื่อนต่อภาคเรียน', t: 'number' },
  point_rotation_mode:        { v: 'WEEKLY', g: 'การหมุนเวร', l: 'โหมดหมุนจุดภายในวัน', t: 'enum:OFF,SEMESTER,WEEKLY,EVERY_N_DAYS,DAILY' },
  point_rotation_n_days:      { v: 5, g: 'การหมุนเวร', l: 'หมุนจุดทุก ๆ กี่วันทำการ (เฉพาะโหมด EVERY_N_DAYS)', t: 'number' },
  point_rotation_step:        { v: 1, g: 'การหมุนเวร', l: 'เลื่อนครั้งละกี่ตำแหน่ง', t: 'number' },
  point_rotation_respect_pin: { v: true, g: 'การหมุนเวร', l: 'เคารพการปักหมุดจุดเฉพาะบุคคล', t: 'bool' },

  // การจัดเวร / อนุมัติ
  daily_adjust_backdays:    { v: 1, g: 'การจัดเวร', l: 'หัวหน้าเวรปรับย้อนหลังได้กี่วัน', t: 'number' },
  swap_need_approval:       { v: true, g: 'การจัดเวร', l: 'การเปลี่ยนเวรต้องได้รับอนุมัติ', t: 'bool' },
  swap_min_level:           { v: 1, g: 'การจัดเวร', l: 'ระดับผู้อนุมัติขั้นต่ำ (1=หัวหน้าเวร 2=หัวหน้างาน 3=ผู้บริหาร)', t: 'number' },
  schedule_generate_ahead:  { v: 30, g: 'การจัดเวร', l: 'สร้างตารางล่วงหน้ากี่วัน', t: 'number' },

  // รายงาน
  attendance_group_default: { v: 'DEPARTMENT', g: 'รายงาน', l: 'มิติการจัดกลุ่มเริ่มต้น', t: 'enum:DEPARTMENT,DUTY_POINT,TIME_SLOT,WEEKDAY,ROLE' },
  report_footer:            { v: 'ระบบบริหารเวรประจำวัน CWK DutyFlow', g: 'รายงาน', l: 'ข้อความท้ายรายงาน', t: 'text' },

  // การแจ้งเตือน
  notify_enabled:           { v: false, g: 'การแจ้งเตือน', l: 'เปิดการแจ้งเตือนทางอีเมล', t: 'bool' },
  notify_reminder_hour:     { v: 6, g: 'การแจ้งเตือน', l: 'ส่งเตือนเวรตอนกี่โมง', t: 'number' },
  notify_absent_summary:    { v: true, g: 'การแจ้งเตือน', l: 'สรุปผู้ไม่มาอยู่เวรให้หัวหน้างาน', t: 'bool' },

  // การแสดงผล
  brand_primary:            { v: '#7A1F2B', g: 'การแสดงผล', l: 'สีหลัก', t: 'text' },
  brand_dark:               { v: '#4B1018', g: 'การแสดงผล', l: 'สีเข้ม', t: 'text' },
  brand_accent:             { v: '#D4AF37', g: 'การแสดงผล', l: 'สีเน้น', t: 'text' },
  system_status:            { v: 'ACTIVE', g: 'การแสดงผล', l: 'สถานะระบบ', t: 'enum:ACTIVE,MAINTENANCE' },
  maintenance_message:      { v: '', g: 'การแสดงผล', l: 'ข้อความแจ้งปิดปรับปรุง', t: 'text' }
};

/** อ่านค่าตั้งค่าทั้งหมดเป็น map */
function CFG_all() {
  if (CFG_MEM) return CFG_MEM;
  var map = {};
  Object.keys(CFG_DEFAULTS).forEach(function (k) { map[k] = CFG_DEFAULTS[k].v; });
  try {
    dbReadAll('CONFIG').forEach(function (row) {
      var k = str(row.key);
      if (!k) return;
      map[k] = CFG_castValue_(row.value, row.value_type || (CFG_DEFAULTS[k] && CFG_DEFAULTS[k].t));
    });
  } catch (e) {
    // ยังไม่ได้ติดตั้ง — ใช้ค่าเริ่มต้น
  }
  CFG_MEM = map;
  return map;
}

function CFG_castValue_(v, type) {
  var t = str(type);
  if (t === 'number') return num(v, 0);
  if (t === 'bool') return bool(v, false);
  return str(v);
}

/** อ่านค่าเดียว */
function CFG_get(key, def) {
  var all = CFG_all();
  var v = all[key];
  return (v === undefined || v === '') ? (def !== undefined ? def : v) : v;
}

function CFG_num(key) { return num(CFG_get(key), 0); }
function CFG_bool(key) { return bool(CFG_get(key), false); }
function CFG_str(key) { return str(CFG_get(key)); }

function CFG_schoolDomain() { return str(CFG_get('school_domain', '')).replace(/^@/, ''); }

/** บันทึกค่าตั้งค่า (เฉพาะผู้ดูแล) */
function CFG_set(ctx, key, value) {
  AUTH_requireRole(ctx, ['SYS_ADMIN', 'DUTY_ADMIN']);
  if (!CFG_DEFAULTS[key]) throw new Error('ไม่รู้จักค่าตั้งค่า: ' + key);
  var def = CFG_DEFAULTS[key];

  if (str(def.t).indexOf('enum:') === 0) {
    var allowed = def.t.substring(5).split(',');
    if (allowed.indexOf(str(value)) < 0) {
      throw new Error('ค่า "' + value + '" ไม่อยู่ในตัวเลือกที่กำหนด (' + allowed.join(', ') + ')');
    }
  }

  var before = CFG_get(key);
  var existing = dbGetBy('CONFIG', { key: key });
  var payload = {
    key: key,
    value: (def.t === 'bool') ? (bool(value) ? 'TRUE' : 'FALSE') : str(value),
    value_type: def.t,
    group_name: def.g,
    label: def.l,
    updated_at: nowIso(),
    updated_by: ctx.email
  };

  if (existing) dbUpdate('CONFIG', existing.id, payload);
  else dbInsert('CONFIG', payload);

  CFG_MEM = null;
  CACHE_remove('cfg:all');
  DB_invalidate('CONFIG');
  AUDIT_log(ctx, 'CONFIG_SET', 'CONFIG', key, { value: before }, { value: value });
  return { key: key, value: CFG_get(key) };
}

/** รายการค่าตั้งค่าทั้งหมด จัดกลุ่มพร้อม metadata (สำหรับหน้าตั้งค่า) */
function CFG_list(ctx) {
  AUTH_requireRole(ctx, ['SYS_ADMIN', 'DUTY_ADMIN']);
  var all = CFG_all();
  var groups = {};
  Object.keys(CFG_DEFAULTS).forEach(function (k) {
    var d = CFG_DEFAULTS[k];
    if (!groups[d.g]) groups[d.g] = [];
    groups[d.g].push({
      key: k, label: d.l, type: d.t, value: all[k], defaultValue: d.v,
      options: str(d.t).indexOf('enum:') === 0 ? d.t.substring(5).split(',') : null
    });
  });
  return Object.keys(groups).map(function (g) {
    return { group: g, items: groups[g] };
  });
}

/** ข้อมูลแบรนด์ที่ปลอดภัยสำหรับฝั่ง Client */
function CFG_brand() {
  return {
    schoolName: CFG_str('school_name'),
    schoolShort: CFG_str('school_short'),
    logoUrl: CFG_str('school_logo_url'),
    primary: CFG_str('brand_primary') || '#7A1F2B',
    dark: CFG_str('brand_dark') || '#4B1018',
    accent: CFG_str('brand_accent') || '#D4AF37',
    systemStatus: CFG_str('system_status') || 'ACTIVE',
    maintenanceMessage: CFG_str('maintenance_message')
  };
}

/* ---------------- Script Properties (ค่าอ่อนไหว) ---------------- */

function PROP_get(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

function PROP_set(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value));
}

function PROP_photoFolderId() { return PROP_get('PHOTO_FOLDER_ID'); }
function PROP_reportFolderId() { return PROP_get('REPORT_FOLDER_ID'); }
function PROP_bootstrapAdmin() { return str(PROP_get('BOOTSTRAP_ADMIN_EMAIL')).toLowerCase(); }
