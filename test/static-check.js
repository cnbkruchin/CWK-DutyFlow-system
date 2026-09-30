/**
 * static-check.js — ตรวจหาการเรียกฟังก์ชันที่ไม่มีอยู่จริงในฝั่งเซิร์ฟเวอร์
 * รัน: node test/static-check.js
 */
const fs = require('fs');
const path = require('path');
const { SRC, gsFiles, loadAll } = require('./harness');

const G = loadAll({ _props: { SPREADSHEET_ID: 'x' } });
const defined = new Set(Object.keys(G));

/** ลบคอมเมนต์และสตริงออก โดยรักษาจำนวนบรรทัดไว้ */
function strip(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

/** ชื่อที่ดูเหมือนฟังก์ชันของโปรเจกต์นี้ */
const PROJECT_CALL = /\b([A-Z][A-Z0-9]+_[A-Za-z0-9_]+|db[A-Z][A-Za-z0-9_]*|CACHE_[A-Za-z0-9_]+|withLock|uuid|nowIso|today|toDateStr|dateFromStr|addDays|diffDays|weekdayOf|thaiDate|thaiWeekday|buddhistYear|hhmm|minutesOfDay|haversineMeters|parseCsv|groupBy|indexBy|sortBy|escapeHtml|truncate|isEmail|sanitizeText|teacherFullName|rotateWeekday|include|pad2|pct|mod|range|num|str|bool)\s*\(/g;

const problems = [];
let calls = 0;

gsFiles().forEach(file => {
  const raw = fs.readFileSync(path.join(SRC, file), 'utf8');
  const code = strip(raw);
  const lines = code.split('\n');

  lines.forEach((line, i) => {
    let m;
    PROJECT_CALL.lastIndex = 0;
    while ((m = PROJECT_CALL.exec(line)) !== null) {
      const name = m[1];
      calls++;
      // ข้ามการประกาศฟังก์ชันเอง
      if (new RegExp('function\\s+' + name + '\\s*\\(').test(line)) continue;
      if (!defined.has(name)) {
        problems.push(file + ':' + (i + 1) + ' เรียก ' + name + '() ซึ่งไม่มีอยู่จริง');
      }
    }
  });
});

/* ตรวจว่าทุก route ใน API_ROUTES_ ชี้ไปยังฟังก์ชันที่มีอยู่ */
const routes = G.API_ROUTES_();
Object.keys(routes).forEach(k => {
  if (typeof routes[k] !== 'function') problems.push('route ' + k + ' ไม่ใช่ฟังก์ชัน');
});

/* ตรวจว่าทุกตารางในสคีมามี sheet + columns */
G.DB_TABLES.forEach(t => {
  const d = G.DB_SCHEMA[t];
  if (!d.sheet) problems.push('ตาราง ' + t + ' ไม่มีชื่อชีต');
  if (!d.columns || !d.columns.length) problems.push('ตาราง ' + t + ' ไม่มีคอลัมน์');
});

console.log('ตรวจการเรียกฟังก์ชัน ' + calls + ' จุด · นิยามระดับบนสุด ' + defined.size + ' รายการ');
if (problems.length) {
  console.log('\nพบปัญหา ' + problems.length + ' รายการ:');
  problems.forEach(p => console.log('  ✗ ' + p));
  process.exit(1);
}
console.log('✓ ไม่พบการอ้างอิงที่ไม่มีอยู่จริง');
