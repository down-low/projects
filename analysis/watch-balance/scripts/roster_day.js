// Reproduces app.js dayRows() for a date range from positions.json + live records. Prints JSON counts, no names.
// node roster_day.js <repo> <dbdir> <from> <to>
const fs = require('fs'), path = require('path');
const [repo, db, from, to] = process.argv.slice(2);
const M = require(repo + '/schedule.js');
const load = (c) => fs.existsSync(path.join(db, c)) ? fs.readdirSync(path.join(db, c)).map((f) => ({ id: f.replace(/\.json$/, ''), ...JSON.parse(fs.readFileSync(path.join(db, c, f), 'utf8')) })) : [];
const recs = { statuses: load('statuses'), covers: load('covers'), tourChanges: load('tourChanges'), people: load('people') };
let data = require(repo + '/data/positions.json'); data = Array.isArray(data) ? data : (data.positions || Object.values(data));
const byPos = {}; data.forEach((p) => (byPos[p.pos] = p));
const added = recs.people.map((x) => ({ pos: 'person:' + x.id, name: x.name, rank: x.rank, title: x.rank, company: x.company || null, tour: x.tour || null, added: true }));
added.forEach((e) => (byPos[e.pos] = e));
const slots = data.concat(added.filter((e) => e.tour && e.company));
const opts = { statuses: recs.statuses, changes: recs.tourChanges, covers: recs.covers, byPos };
function ownerOn(p, d) {
  const mv = M.movesInto(p.pos, d, recs.covers);
  if (mv) return { key: mv.coverKey, name: (byPos[mv.coverKey] || {}).name || mv.coverName };
  const out = p.name ? M.movedTo(p.pos, d, recs.covers) : null;
  if (!p.name || (out && out.targetPos !== p.pos)) return { key: null, name: null };
  return { key: p.pos, name: p.name };
}
function dayRows(d) {
  const rows = [];
  slots.forEach((p) => {
    const s = M.shiftFor(p, d, opts); if (!s) return;
    const o = ownerOn(p, d);
    const covs = M.coversOn(p.pos, d, recs.covers);
    const away = o.key ? M.actingOn(o.key, d, recs.covers) : null;
    const status = o.key ? M.statusFor(o.key, d, recs.statuses) : null;
    const cov = covs.filter(M.takesSeat)[0] || ((status || away || !o.name) && covs[0]) || null;
    rows.push({ pos: p.pos, rank: p.rank, owner: true, name: o.name, status, off: !!(status || away || (cov && o.name)) });
    covs.forEach((c) => { const st = M.statusFor(c.coverKey, d, recs.statuses); rows.push({ pos: p.pos, rank: p.rank, owner: false, name: (byPos[c.coverKey] || {}).name || c.coverName, status: st, off: !!st }); });
  });
  return rows;
}
const RANKS = ['Lieutenant', 'Captain', 'Rescue Captain', 'Battalion Chief'];
const out = [];
for (let t = new Date(from + 'T12:00'); t <= new Date(to + 'T12:00'); t.setDate(t.getDate() + 1)) {
  const d = new Date(t), rows = dayRows(d), w = M.watchFor(d);
  for (const rank of RANKS) {
    const r = rows.filter((x) => x.rank === rank);
    const seats = new Set(r.map((x) => x.pos));
    const filled = new Set(r.filter((x) => x.name).map((x) => x.pos));
    const onDuty = r.filter((x) => x.name && !x.off).length;
    const leave = r.filter((x) => x.name && x.status).length;
    const named = r.filter((x) => x.name).length;
    out.push({ date: M.isoDate(d), watch: w, rank, seats: seats.size, scheduled: filled.size, vacant: seats.size - filled.size, named_rows: named, on_duty: onDuty, on_leave: leave });
  }
}
console.log(JSON.stringify(out));
