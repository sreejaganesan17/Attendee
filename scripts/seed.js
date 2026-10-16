// Usage: npm run seed   (safe to re-run; it rebuilds users + attendance)
const bcrypt = require('bcryptjs');
const db = require('../db');

const first = ['Aarav','Priya','Karthik','Divya','Suresh','Meena','Ravi','Lakshmi','Arjun','Anita','Vikram','Sneha','Naveen','Pooja','Manoj','Kavya','Rahul','Deepa','Sanjay','Nisha','Harish','Revathi','Gokul','Swathi','Dinesh'];
const last  = ['Kumar','Raman','Subramanian','Iyer','Nair','Pillai','Reddy','Sharma','Gupta','Menon','Natarajan','Krishnan','Das','Patel','Chandran'];
const depts = {
  Engineering: ['Software Engineer','QA Analyst','DevOps Engineer'],
  Finance:     ['Accountant','Financial Analyst'],
  Sales:       ['Sales Executive','Account Manager'],
  Operations:  ['Operations Associate','Logistics Coordinator'],
  Support:     ['Support Specialist','Team Lead'],
  Marketing:   ['Content Strategist','Designer'],
};
const locations = ['Salem HQ','Chennai Branch','Coimbatore Branch','Bengaluru Branch'];

const WORKER_PASSWORD = 'Welcome@123';  // demo only: change before any real use
const HR_PASSWORD     = 'HrAdmin@123';

const rows = [];
const deptNames = Object.keys(depts);
for (let i = 1; i <= 72; i++) {
  const dept = deptNames[i % deptNames.length];
  const titles = depts[dept];
  rows.push({
    username: `emp${String(i).padStart(3, '0')}`,
    password: WORKER_PASSWORD,
    name: `${first[i % first.length]} ${last[(i * 7) % last.length]}`,
    role: 'worker', department: dept,
    job_title: titles[i % titles.length],
    location: locations[i % locations.length],
  });
}
['hr001:Meera Venkatesh','hr002:Arun Prakash','hr003:Farah Sheikh'].forEach(s => {
  const [username, name] = s.split(':');
  rows.push({ username, password: HR_PASSWORD, name, role: 'hr',
              department: 'Human Resources', job_title: 'HR Manager', location: 'Salem HQ' });
});

const insert = db.prepare(`INSERT INTO users
  (username, password_hash, name, role, department, job_title, location)
  VALUES (@username, @password_hash, @name, @role, @department, @job_title, @location)`);

db.transaction(() => {
  db.exec('DELETE FROM attendance; DELETE FROM users;');
  for (const r of rows) {
    const { password, ...rest } = r;
    insert.run({ ...rest, password_hash: bcrypt.hashSync(password, 10) });
  }
})();

console.log(`Seeded ${rows.length} users (72 workers, 3 HR).`);
console.log('Workers: emp001..emp072 / ' + WORKER_PASSWORD);
console.log('HR:      hr001..hr003   / ' + HR_PASSWORD);
