// Analytics queries for the HR dashboard.
// Definitions (leave days are excluded from attendance/absence rates):
//   attendance rate = (Present + Late) / (Present + Late + Absent)
//   late rate       = Late / (Present + Late)
//   absence rate    = Absent / (Present + Late + Absent)
const db = require('./db');

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const withRates = r => {
  const present = r.present || 0, late = r.late || 0, absent = r.absent || 0, leave = r.leave_days || 0;
  const worked = present + late, expected = worked + absent;
  return { ...r, present, late, absent, leave_days: leave,
    attendanceRate: expected ? worked / expected : null,
    lateRate: worked ? late / worked : null,
    absenceRate: expected ? absent / expected : null,
    avgLateMinutes: late ? Math.round((r.late_minutes_total || 0) / late) : null };
};

const COUNTS = `SUM(a.status = 'Present') AS present, SUM(a.status = 'Late') AS late,
                SUM(a.status = 'Absent') AS absent, SUM(a.status = 'On Leave') AS leave_days,
                COALESCE(SUM(a.late_minutes), 0) AS late_minutes_total`;
const FROM = `FROM attendance a JOIN users u ON u.id = a.user_id
              WHERE u.role = 'worker' AND a.date BETWEEN @start AND @finish`;

function getAnalytics(days = 90) {
  const end = new Date(), begin = new Date();
  begin.setDate(end.getDate() - days + 1);
  const p = { start: ymd(begin), finish: ymd(end) };

  const totals = withRates(db.prepare(`SELECT COUNT(*) AS records, ${COUNTS} ${FROM}`).get(p));
  const group = col => db.prepare(`SELECT ${col} AS label, ${COUNTS} ${FROM} GROUP BY ${col} ORDER BY label`)
    .all(p).map(withRates);

  return {
    range: p, days, totals,
    daily: db.prepare(`SELECT a.date, ${COUNTS} ${FROM} GROUP BY a.date ORDER BY a.date`).all(p).map(withRates),
    weekday: db.prepare(`SELECT CAST(strftime('%w', a.date) AS INTEGER) AS dow, ${COUNTS} ${FROM} GROUP BY dow ORDER BY dow`)
      .all(p).map(r => ({ ...withRates(r), label: DAY_NAMES[r.dow] })),
    department: group('u.department'),
    location: group('u.location'),
    watchlist: db.prepare(`SELECT u.name, u.username, u.department, u.location, ${COUNTS} ${FROM}
        GROUP BY u.id ORDER BY (SUM(a.status = 'Late') + SUM(a.status = 'Absent')) DESC, u.name LIMIT 10`)
      .all(p).map(withRates),
  };
}

module.exports = { getAnalytics, ymd };
