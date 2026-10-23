// Greedy tour-to-tour position moves that even out seats per watch, per rank. Counts only.
// node watch_moves.js <repo> <watch_staffing.json> <maxMoves>
const fs = require('fs');
const [repo, file, maxMoves] = process.argv.slice(2);
const M = require(repo + '/schedule.js');
const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
let P = require(repo + '/data/positions.json'); P = Array.isArray(P) ? P : (P.positions || Object.values(P));
const sd = (a) => { const m = a.reduce((x, y) => x + y) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
const out = [];
for (const rank of ['Captain', 'Lieutenant', 'Battalion Chief', 'Rescue Captain']) {
  const seat = {}; rows.filter((r) => r.rank === rank).forEach((r) => (seat[r.watch] = r.seats));
  const per = {}; for (let t = 1; t <= 31; t++) per[t] = 0;
  P.filter((p) => p.rank === rank && p.tour).forEach((p) => per[+p.tour]++);
  // positions the app adds (added people with a tour) are already in seat counts; per-tour counts only gate which tours can give
  let cur = []; for (let w = 1; w <= 31; w++) cur.push(seat[w]);
  const positions = Math.round(cur.reduce((a, b) => a + b) / 9);
  out.push({ rank, step: 0, from_tour: '', to_tour: '', min: Math.min(...cur), max: Math.max(...cur), sd: +sd(cur).toFixed(2), positions, even: +(positions * 9 / 31).toFixed(1) });
  for (let k = 1; k <= Number(maxMoves); k++) {
    let best = null;
    for (let a = 1; a <= 31; a++) {
      if (!per[a]) continue;
      for (let b = 1; b <= 31; b++) {
        if (a === b) continue;
        const n = cur.slice();
        for (let w = 1; w <= 31; w++) { if (M.tourWorks(a, w)) n[w - 1]--; if (M.tourWorks(b, w)) n[w - 1]++; }
        const s = sd(n);
        if (!best || s < best.s) best = { a, b, s, n };
      }
    }
    if (!best || best.s >= out[out.length - 1].sd - 0.005) break;
    cur = best.n; per[best.a]--; per[best.b]++;
    out.push({ rank, step: k, from_tour: best.a, to_tour: best.b, min: Math.min(...cur), max: Math.max(...cur), sd: +best.s.toFixed(2), positions, even: +(positions * 9 / 31).toFixed(1) });
  }
}
console.log(JSON.stringify(out));
