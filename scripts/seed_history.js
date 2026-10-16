// SYNTHETIC practice data: ~90 days of weekday attendance for every worker.
// Usage: npm run seed:history            (refuses if past records already exist)
//        npm run seed:history -- --force (replaces ALL past records, never today's)
const db = require('../db');
const { ymd } = require('../analytics');

const DAYS = 90;
const today = ymd(new Date());

const existing = db.prepare('SELECT COUNT(*) c FROM attendance WHERE date < ?').get(today).c;
if (existing > 0 && !process.argv.includes('--force')) {
  console.log(`Found ${existing} past attendance records. Nothing changed.`);
  console.log('Add --force to replace them with synthetic data (this deletes real history).');
  process.exit(0);
}

// Seeded random numbers so everyone gets the same dataset
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = mulberry32(2026);

const workers = db.prepare("SELECT id, department, location FROM users WHERE role='worker' ORDER BY id").all();
const hrId = db.prepare("SELECT id FROM users WHERE role='hr' ORDER BY id").get().id;

// Each worker gets their own tendencies. A few are chronic late/absent so the analysis has something to find.
const profile = new Map(workers.map((w, i) => {
  let late = 0.03 + rand() * 0.04, absent = 0.01 + rand() * 0.02;
  if (i % 11 === 5) late = 0.22;      // chronic late
  if (i % 17 === 9) absent = 0.09;    // frequent absence
  if (w.department === 'Support') late += 0.02;
  if (w.location === 'Chennai Branch') late += 0.03;
  return [w.id, { late, absent, leaveLeft: 0 }];
}));

const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const START = 9 * 60 + 30;                       // 09:30, same as the app's default late cutoff
const insert = db.prepare(`INSERT OR IGNORE INTO attendance
  (user_id, date, status, marked_by, check_in, check_out, late_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)`);
let n = 0;
db.transaction(() => {
  db.prepare('DELETE FROM attendance WHERE date < ?').run(today);
  for (let back = DAYS; back >= 1; back--) {
    const d = new Date(); d.setDate(d.getDate() - back);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;            // weekdays only
    const date = ymd(d);
    const monday = dow === 1, friday = dow === 5;
    for (const w of workers) {
      const p = profile.get(w.id);
      let status;
      if (p.leaveLeft > 0) { p.leaveLeft--; status = 'On Leave'; }
      else if (rand() < (friday ? 0.012 : 0.006)) { p.leaveLeft = Math.floor(rand() * 4); status = 'On Leave'; }
      else {
        const r = rand();
        const absent = p.absent * (monday ? 1.6 : friday ? 1.5 : 1);
        const late = p.late * (monday ? 1.3 : 1);
        status = r < absent ? 'Absent' : r < absent + late ? 'Late' : 'Present';
      }
      let cin = null, cout = null, lateMin = 0;
      if (status === 'Present') { const m = 530 + Math.floor(rand() * 60); cin = m; cout = Math.max(m + 420, 1050 + Math.floor(rand() * 60)); }
      if (status === 'Late')    { lateMin = 5 + Math.floor(rand() * rand() * 150); cin = START + lateMin; cout = cin + 480 + Math.floor(rand() * 45); }
      insert.run(w.id, date, status, hrId, cin == null ? null : hm(cin), cout == null ? null : hm(cout), lateMin); n++;
    }
  }
})();
console.log(`Inserted ${n} synthetic attendance records (last ${DAYS} days, weekdays only).`);
