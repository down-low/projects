/* SFFD 31-day tour math.
 * Watch: one continuous 31-day cycle. 2026-01-01 is watch 16 (per the 2026/2027 Watch Calendars).
 * Tour k works watch w when (w - k) mod 31 is one of TOUR_OFFSETS (Tour 1 works watches 1,4,7,11,14,17,21,24,27).
 * A position's tour is the two digits before the trailing "M" of its position number (e.g. 29EOC31M -> Tour 31).
 */
(function (root) {
  var DAY = 864e5;
  var BASE = Date.UTC(2026, 0, 1) / DAY;
  var BASE_WATCH = 16;
  var TOUR_OFFSETS = [0, 3, 6, 10, 13, 16, 20, 23, 26];

  function mod(a, n) { return ((a % n) + n) % n; }
  function dayNumber(d) { return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY); }
  function watchFor(d) { return mod(dayNumber(d) - BASE + BASE_WATCH - 1, 31) + 1; }
  function tourWorks(tour, watch) { return TOUR_OFFSETS.indexOf(mod(watch - tour, 31)) !== -1; }
  function toursOn(watch) {
    var out = [];
    for (var t = 1; t <= 31; t++) if (tourWorks(t, watch)) out.push(t);
    return out;
  }
  // Returns the shift a position works on a date, or null. Swing positions report the company they cover.
  function shiftFor(p, d) {
    var w = watchFor(d);
    if (!tourWorks(p.tour, w)) return null;
    var s = null;
    if (p.swing) for (var i = 0; i < p.swing.length; i++) if (p.swing[i].watch === w) s = p.swing[i];
    return { watch: w, co: s ? s.co : p.company, role: s ? s.role : null, swing: !!s };
  }

  var api = { watchFor: watchFor, tourWorks: tourWorks, toursOn: toursOn, shiftFor: shiftFor, TOUR_OFFSETS: TOUR_OFFSETS };
  root.TourMath = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
