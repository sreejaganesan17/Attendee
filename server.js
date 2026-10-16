const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');
const { getAnalytics } = require('./analytics');

const app = express();
const STATUSES = ['Present', 'Absent', 'On Leave', 'Late'];
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const LATE_AFTER = process.env.LATE_AFTER || '09:30'; // HH:MM, 24-hour; marking after this = Late
const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const nowHM = () => new Date().toTimeString().slice(0, 5);
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, server local time

app.use(express.json());
app.use(session({
  name: 'attendee.sid',
  secret: process.env.SESSION_SECRET || 'dev-only-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', // requires HTTPS (+ app.set('trust proxy', 1) behind a proxy)
    maxAge: 1000 * 60 * 60 * 8,
  },
}));

// ---------- guards ----------
const requireAuth = (req, res, next) =>
  req.session.user ? next() : res.status(401).json({ error: 'Please sign in.' });
const requireRole = role => (req, res, next) =>
  req.session.user?.role === role ? next() : res.status(403).json({ error: 'Not allowed.' });
const pageGuard = role => (req, res, next) =>
  req.session.user?.role === role ? next() : res.redirect('/');

// ---------- auth ----------
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

app.post('/api/login', loginLimiter, (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim().toLowerCase());
  // compare against a dummy hash when user is missing so timing doesn't reveal valid usernames
  const hash = u?.password_hash || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
  if (!bcrypt.compareSync(String(password), hash) || !u)
    return res.status(401).json({ error: 'Wrong username or password.' });

  req.session.regenerate(err => {            // prevents session fixation
    if (err) return res.status(500).json({ error: 'Could not start session.' });
    req.session.user = { id: u.id, role: u.role, name: u.name };
    res.json({ role: u.role, redirect: u.role === 'hr' ? '/hr' : '/worker' });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => { res.clearCookie('attendee.sid'); res.json({ ok: true }); });
});

// ---------- worker ----------
app.get('/api/worker/today', requireAuth, requireRole('worker'), (req, res) => {
  const u = db.prepare('SELECT name, department, job_title, location FROM users WHERE id = ?').get(req.session.user.id);
  const rec = db.prepare('SELECT status, check_in, check_out, late_minutes FROM attendance WHERE user_id = ? AND date = ?')
    .get(req.session.user.id, today());
  res.json({ ...u, date: today(), late_after: LATE_AFTER, status: rec?.status || 'Not marked yet',
    check_in: rec?.check_in || null, check_out: rec?.check_out || null, late_minutes: rec?.late_minutes || 0 });
});

// Check in (once per day). Late = after LATE_AFTER; late_minutes = how long after.
app.post('/api/worker/checkin', requireAuth, requireRole('worker'), (req, res) => {
  const id = req.session.user.id, date = today();
  const existing = db.prepare('SELECT status FROM attendance WHERE user_id = ? AND date = ?').get(id, date);
  if (existing) return res.status(409).json({ error: `Already marked as ${existing.status} today.` });
  const inTime = nowHM();
  const lateMin = Math.max(0, toMin(inTime) - toMin(LATE_AFTER));
  const status = lateMin > 0 ? 'Late' : 'Present';
  db.prepare('INSERT INTO attendance (user_id, date, status, marked_by, check_in, late_minutes) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, date, status, id, inTime, lateMin);
  res.json({ status, check_in: inTime, late_minutes: lateMin });
});

// Check out (once per day, after checking in)
app.post('/api/worker/checkout', requireAuth, requireRole('worker'), (req, res) => {
  const id = req.session.user.id, date = today();
  const rec = db.prepare('SELECT check_in, check_out FROM attendance WHERE user_id = ? AND date = ?').get(id, date);
  if (!rec?.check_in) return res.status(409).json({ error: 'Check in first.' });
  if (rec.check_out) return res.status(409).json({ error: `Already checked out at ${rec.check_out}.` });
  const outTime = nowHM();
  db.prepare('UPDATE attendance SET check_out = ? WHERE user_id = ? AND date = ?').run(outTime, id, date);
  res.json({ check_out: outTime });
});

// ---------- HR ----------
const hr = [requireAuth, requireRole('hr')];

app.get('/api/hr/departments', hr, (req, res) => {
  res.json(db.prepare("SELECT DISTINCT department FROM users WHERE role='worker' ORDER BY 1").all().map(r => r.department));
});

// Search/filter employees, each with their status on the chosen date
app.get('/api/hr/employees', hr, (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : today();
  const q = `%${(req.query.q || '').trim()}%`;
  const dept = req.query.department || '';
  const status = req.query.status || '';
  const rows = db.prepare(`
    SELECT u.id, u.username, u.name, u.department, u.job_title, u.location,
           COALESCE(a.status, 'Not marked') AS status,
           a.check_in, a.check_out, COALESCE(a.late_minutes, 0) AS late_minutes
    FROM users u
    LEFT JOIN attendance a ON a.user_id = u.id AND a.date = @date
    WHERE u.role = 'worker'
      AND (u.name LIKE @q OR u.username LIKE @q)
      AND (@dept = '' OR u.department = @dept)
      AND (@status = '' OR COALESCE(a.status, 'Not marked') = @status)
    ORDER BY u.name`).all({ date, q, dept, status });
  res.json({ date, employees: rows });
});

// Daily totals for the selected date (company-wide, ignores search filters)
app.get('/api/hr/summary', hr, (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : today();
  const total = db.prepare("SELECT COUNT(*) c FROM users WHERE role='worker'").get().c;
  const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
  db.prepare('SELECT status, COUNT(*) c FROM attendance WHERE date = ? GROUP BY status').all(date)
    .forEach(r => (counts[r.status] = r.c));
  const marked = Object.values(counts).reduce((a, b) => a + b, 0);
  res.json({ date, total, ...counts, 'Not marked': total - marked });
});

// Monthly totals per employee, e.g. ?month=2026-10
app.get('/api/hr/totals', hr, (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : today().slice(0, 7);
  res.json(db.prepare(`
    SELECT u.name, u.department,
      SUM(a.status='Present') AS present, SUM(a.status='Late') AS late,
      SUM(a.status='Absent')  AS absent,  SUM(a.status='On Leave') AS on_leave
    FROM users u LEFT JOIN attendance a ON a.user_id = u.id AND substr(a.date,1,7) = ?
    WHERE u.role='worker' GROUP BY u.id ORDER BY u.name`).all(month));
});

// ---------- analytics + export ----------
app.get('/api/hr/analytics', hr, (req, res) => {
  const days = [30, 60, 90, 180].includes(Number(req.query.days)) ? Number(req.query.days) : 90;
  res.json(getAnalytics(days));
});

app.get('/api/hr/export.csv', hr, (req, res) => {
  const esc = v => { v = String(v ?? ''); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const rows = db.prepare(`
    SELECT u.username, u.name, u.department, u.job_title, u.location, a.date, a.check_in, a.check_out, a.late_minutes,
           CASE WHEN a.check_in IS NOT NULL AND a.check_out IS NOT NULL THEN ROUND((strftime('%s', '2000-01-01 ' || a.check_out) - strftime('%s', '2000-01-01 ' || a.check_in)) / 3600.0, 2) END AS hours_worked,
           CASE CAST(strftime('%w', a.date) AS INTEGER) WHEN 0 THEN 'Sunday' WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday'
             WHEN 3 THEN 'Wednesday' WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday' ELSE 'Saturday' END AS weekday,
           a.status
    FROM attendance a JOIN users u ON u.id = a.user_id
    WHERE u.role = 'worker' ORDER BY a.date, u.username`).all();
  const cols = ['username', 'name', 'department', 'job_title', 'location', 'date', 'weekday', 'status', 'check_in', 'check_out', 'late_minutes', 'hours_worked'];
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="attendance_${today()}.csv"`);
  res.send(csv);
});

// ---------- pages ----------
const view = f => (req, res) => res.sendFile(path.join(__dirname, 'views', f));
app.get('/', (req, res) =>
  req.session.user ? res.redirect(req.session.user.role === 'hr' ? '/hr' : '/worker')
                   : res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/worker', pageGuard('worker'), view('worker.html'));
app.get('/hr', pageGuard('hr'), view('hr.html'));
app.get('/hr/analytics', pageGuard('hr'), view('analytics.html'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Attendee running at http://localhost:${PORT}`));
