/**
 * Utils.gs — ฟังก์ชันช่วยเหลือกลางของ CWK DutyFlow
 * โรงเรียนจุนวิทยาคม อำเภอจุน จังหวัดพะเยา
 */

var TZ = 'Asia/Bangkok';

/** สร้าง UUID ใช้เป็น Primary Key (ห้ามใช้เลขแถว) */
function uuid() {
  return Utilities.getUuid();
}

/** เวลาปัจจุบันในรูปแบบ ISO ตามเขตเวลาไทย */
function nowIso() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss");
}

/** วันที่ปัจจุบัน yyyy-MM-dd */
function today() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

/** แปลงค่าเป็นตัวเลข ถ้าว่าง/ไม่ใช่ตัวเลขคืนค่า def */
function num(v, def) {
  if (def === undefined) def = 0;
  if (v === '' || v === null || v === undefined) return def;
  var n = Number(v);
  return isNaN(n) ? def : n;
}

/** แปลงค่าเป็นข้อความที่ตัดช่องว่างหัวท้าย */
function str(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** แปลงเป็น boolean แบบยืดหยุ่น (รองรับ TRUE/true/1/ใช่) */
function bool(v, def) {
  if (v === '' || v === null || v === undefined) return def === undefined ? false : def;
  if (typeof v === 'boolean') return v;
  var s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 'ใช่';
}

/** ลบอักขระควบคุมที่ทำให้ชีตเสียหาย */
function sanitizeText(v) {
  return str(v).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/** แปลง Date หรือข้อความเป็น yyyy-MM-dd */
function toDateStr(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  }
  var s = str(v);
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3]);
  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  return '';
}

function pad2(v) {
  var s = String(v);
  return s.length >= 2 ? s : '0' + s;
}

/** yyyy-MM-dd -> Date (เที่ยงวัน เพื่อเลี่ยงปัญหา DST/เขตเวลา) */
function dateFromStr(ds) {
  var p = str(ds).split('-');
  if (p.length !== 3) return null;
  var d = new Date(num(p[0]), num(p[1]) - 1, num(p[2]), 12, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

/** บวกวัน คืนค่าเป็น yyyy-MM-dd */
function addDays(ds, n) {
  var d = dateFromStr(ds);
  if (!d) return '';
  d.setDate(d.getDate() + n);
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

/** จำนวนวันระหว่างสองวันที่ (b - a) */
function diffDays(a, b) {
  var da = dateFromStr(a), db = dateFromStr(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

/** วันในสัปดาห์ 1=จันทร์ ... 7=อาทิตย์ */
function weekdayOf(ds) {
  var d = dateFromStr(ds);
  if (!d) return 0;
  var w = d.getDay(); // 0=อาทิตย์
  return w === 0 ? 7 : w;
}

var THAI_WEEKDAYS = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
var THAI_MONTHS = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
var THAI_MONTHS_SHORT = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** 2026-09-30 -> "30 กันยายน 2569" */
function thaiDate(ds, opts) {
  var d = dateFromStr(ds);
  if (!d) return '';
  var short = opts && opts.short;
  var withWeekday = opts && opts.weekday;
  var months = short ? THAI_MONTHS_SHORT : THAI_MONTHS;
  var out = d.getDate() + ' ' + months[d.getMonth() + 1] + ' ' + (d.getFullYear() + 543);
  if (withWeekday) out = 'วัน' + THAI_WEEKDAYS[weekdayOf(ds)] + 'ที่ ' + out;
  return out;
}

/** ชื่อวันภาษาไทยจากเลข 1-7 */
function thaiWeekday(w) {
  return THAI_WEEKDAYS[num(w, 0)] || '';
}

/** ปี พ.ศ. ของวันที่ */
function buddhistYear(ds) {
  var d = dateFromStr(ds);
  return d ? d.getFullYear() + 543 : 0;
}

/** HH:mm จาก ISO timestamp */
function hhmm(iso) {
  var s = str(iso);
  var m = s.match(/(\d{2}):(\d{2})/);
  return m ? m[1] + ':' + m[2] : '';
}

/** แปลง HH:mm เป็นจำนวนนาทีจากเที่ยงคืน */
function minutesOfDay(t) {
  var m = str(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return -1;
  return num(m[1]) * 60 + num(m[2]);
}

/** ระยะทางแบบ Haversine หน่วยเมตร */
function haversineMeters(lat1, lng1, lat2, lng2) {
  var R = 6371000;
  var toRad = function (x) { return x * Math.PI / 180; };
  var dLat = toRad(num(lat2) - num(lat1));
  var dLng = toRad(num(lng2) - num(lng1));
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(num(lat1))) * Math.cos(toRad(num(lat2))) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** อ่าน CSV/TSV เป็น array ของ array */
function parseCsv(text, delimiter) {
  var s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  var d = delimiter || (s.indexOf('\t') >= 0 && s.indexOf(',') < 0 ? '\t' : ',');
  var rows = [], row = [], field = '', inQuote = false;
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (inQuote) {
      if (c === '"') {
        if (s.charAt(i + 1) === '"') { field += '"'; i++; }
        else inQuote = false;
      } else field += c;
    } else if (c === '"') {
      inQuote = true;
    } else if (c === d) {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(function (r) { return r.join('').trim() !== ''; });
}

/** จัดกลุ่ม array ตาม key function */
function groupBy(arr, keyFn) {
  var out = {};
  (arr || []).forEach(function (item) {
    var k = keyFn(item);
    if (!out[k]) out[k] = [];
    out[k].push(item);
  });
  return out;
}

/** สร้าง map จาก array โดยใช้ field เป็น key */
function indexBy(arr, field) {
  var out = {};
  (arr || []).forEach(function (item) { out[item[field]] = item; });
  return out;
}

/** เรียงลำดับแบบคงที่ (stable) ด้วยชุด comparator */
function sortBy(arr, fields) {
  return (arr || []).slice().sort(function (a, b) {
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i], desc = false;
      if (f.charAt(0) === '-') { desc = true; f = f.substring(1); }
      var av = a[f], bv = b[f];
      if (av === bv) continue;
      var r = (av > bv) ? 1 : -1;
      return desc ? -r : r;
    }
    return 0;
  });
}

/** คืนค่าตัวเลข % แบบปัดทศนิยม 1 ตำแหน่ง */
function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/** ชื่อเต็มครู */
function teacherFullName(t) {
  if (!t) return '';
  return (str(t.prefix) + str(t.first_name) + ' ' + str(t.last_name)).trim();
}

/** หนีอักขระ HTML */
function escapeHtml(v) {
  return str(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** จำกัดความยาวข้อความ */
function truncate(v, n) {
  var s = str(v);
  return s.length > n ? s.substring(0, n - 1) + '…' : s;
}

/** ตรวจรูปแบบอีเมล */
function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(v));
}

/** คืน array ของตัวเลข 0..n-1 */
function range(n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push(i);
  return out;
}

/** modulo ที่ให้ผลลัพธ์เป็นบวกเสมอ */
function mod(a, b) {
  if (!b) return 0;
  return ((a % b) + b) % b;
}
