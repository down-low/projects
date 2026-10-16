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
  function isoDate(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }
  // Records are compared newest-first by createdAt so a later entry overrides an earlier one.
  function newer(a, b) { return String(b.createdAt || "").localeCompare(String(a.createdAt || "")); }

  // Tour on a date: the latest tour change effective on or before it, else the vacancy-list tour.
  function effectiveTour(p, d, changes) {
    var day = isoDate(d), best = null;
    if (changes) for (var i = 0; i < changes.length; i++) {
      var c = changes[i];
      if (c.pos !== p.pos || c.effective > day) continue;
      if (!best || c.effective > best.effective || (c.effective === best.effective && newer(c, best) < 0)) best = c;
    }
    return best ? best.tour : p.tour;
  }

  // Status code (VA, D, S) covering a date, or null. Open-ended when end is null. Newest record wins on overlap.
  function statusFor(pos, d, statuses) {
    var day = isoDate(d), best = null;
    if (statuses) for (var i = 0; i < statuses.length; i++) {
      var s = statuses[i];
      if (s.pos !== pos || s.start > day || (s.end && s.end < day)) continue;
      if (!best || newer(s, best) < 0) best = s;
    }
    return best ? best.code : null;
  }

  // Returns the shift a position works on a date, or null. Swing positions report the company they cover.
  // opts: {changes, statuses} records from the editor backend. A swing rotation only applies on the original tour.
  function shiftFor(p, d, opts) {
    opts = opts || {};
    var w = watchFor(d);
    var tour = effectiveTour(p, d, opts.changes);
    if (!tourWorks(tour, w)) return null;
    var s = null;
    if (p.swing && tour === p.tour) for (var i = 0; i < p.swing.length; i++) if (p.swing[i].watch === w) s = p.swing[i];
    return {
      watch: w, tour: tour, co: s ? s.co : p.company, role: s ? s.role : null, swing: !!s,
      status: statusFor(p.pos, d, opts.statuses),
    };
  }

  // Active record in `list` whose `field` equals `key` on date d (start..end inclusive, open end allowed).
  function activeOn(list, field, key, d) {
    var day = isoDate(d), best = null;
    if (list) for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r[field] !== key || r.start > day || (r.end && r.end < day)) continue;
      if (!best || newer(r, best) < 0) best = r;
    }
    return best;
  }
  // The cover assignment filling position `targetPos` on d, or null.
  function coverOn(targetPos, d, covers) { return activeOn(covers, "targetPos", targetPos, d); }
  // Every cover assignment on position targetPos on d (two people can share a seat's tour), newest first.
  function coversOn(targetPos, d, covers) {
    var day = isoDate(d), out = [];
    (covers || []).forEach(function (r) {
      if (r.targetPos === targetPos && r.start <= day && (!r.end || r.end >= day)) out.push(r);
    });
    return out.sort(newer);
  }
  // What the person `coverKey` (their position number, or "person:<id>") is covering on d, or null.
  function coveringOn(coverKey, d, covers) { return activeOn(covers, "coverKey", coverKey, d); }

  // A person's day. key: position number or "person:<id>"; p: their own position (null for added people).
  // While covering, they follow the covered position's schedule and company; otherwise their own.
  // opts: {changes, statuses, covers, byPos}. Result: shiftFor fields plus {acting: coverRecord|null}, or null.
  function dayFor(key, p, d, opts) {
    opts = opts || {};
    var c = coveringOn(key, d, opts.covers);
    if (c) {
      var target = opts.byPos && opts.byPos[c.targetPos];
      var s = target ? shiftFor(target, d, { changes: opts.changes }) : null;
      if (!s) return null;
      s.status = statusFor(key, d, opts.statuses);
      s.acting = c;
      return s;
    }
    if (!p) return null;
    var own = shiftFor(p, d, opts);
    if (own) own.acting = null;
    return own;
  }

  // Watches (1-31) that tours a and b both work. Tours 3 or 10 days apart share 6 of 9 ("6 of 9").
  function sharedWatches(a, b) {
    var out = [];
    for (var w = 1; w <= 31; w++) if (tourWorks(a, w) && tourWorks(b, w)) out.push(w);
    return out;
  }

  /* Holidays, worked out for any year. A fixed-date holiday that falls on a weekend is shown on the weekday
     it's observed (Saturday -> the Friday before, Sunday -> the Monday after), named "(observed)"; New Year's Day
     on a Saturday is observed Dec 31 of the year before. kind "observance" marks days that aren't city holidays
     (Halloween, Mother's Day); those never move. */
  function nthWeekday(y, m, dow, n) { // n-th (1-based) weekday dow (0 = Sun) of month m (0-based)
    var first = new Date(y, m, 1).getDay();
    return 1 + ((dow - first + 7) % 7) + 7 * (n - 1);
  }
  function lastWeekday(y, m, dow) {
    var last = new Date(y, m + 1, 0), d = last.getDate();
    return d - ((last.getDay() - dow + 7) % 7);
  }
  function dayKey(d) { return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  var holidayCache = {};
  function holidaysOf(y) { // holidays belonging to year y, keyed by the date they're shown on
    if (holidayCache[y]) return holidayCache[y];
    var thanks = nthWeekday(y, 10, 4, 4);
    var list = [ // [month, day, name, short, kind, fixed date?]
      [0, 1, "New Year's Day", "New Year", "holiday", true],
      [0, nthWeekday(y, 0, 1, 3), "Martin Luther King, Jr.'s Birthday", "MLK Day"],
      [1, nthWeekday(y, 1, 1, 3), "Presidents' Day", "Presidents"],
      [4, nthWeekday(y, 4, 0, 2), "Mother's Day", "Mother's Day", "observance"],
      [4, lastWeekday(y, 4, 1), "Memorial Day", "Memorial"],
      [5, 19, "Juneteenth", "Juneteenth", "holiday", true],
      [6, 4, "Independence Day", "July 4", "holiday", true],
      [8, nthWeekday(y, 8, 1, 1), "Labor Day", "Labor Day"],
      [9, nthWeekday(y, 9, 1, 2), "Indigenous Peoples Day and Italian American Heritage Day", "Indig./Ital."],
      [9, 31, "Halloween", "Halloween", "observance"],
      [10, 11, "Veterans Day", "Veterans", "holiday", true],
      [10, thanks, "Thanksgiving Day", "Thanksgiving"],
      [10, thanks + 1, "The Day After Thanksgiving", "Day after"],
      [11, 25, "Christmas Day", "Christmas", "holiday", true],
    ];
    var map = {};
    list.forEach(function (h) {
      var d = new Date(y, h[0], h[1]), name = h[2], dow = d.getDay();
      if (h[5] && (dow === 6 || dow === 0)) { d = new Date(y, h[0], h[1] + (dow === 6 ? -1 : 1)); name += " (observed)"; }
      map[dayKey(d)] = { name: name, short: h[3], kind: h[4] || "holiday" };
    });
    return (holidayCache[y] = map);
  }
  // {name, short, kind: "holiday" | "observance"} for date d, or null.
  function holidayFor(d) {
    var k = dayKey(d);
    return holidaysOf(d.getFullYear())[k] || holidaysOf(d.getFullYear() + 1)[k] || null;
  }

  var api = {
    sharedWatches: sharedWatches, holidayFor: holidayFor,
    watchFor: watchFor, tourWorks: tourWorks, toursOn: toursOn, shiftFor: shiftFor,
    effectiveTour: effectiveTour, statusFor: statusFor, isoDate: isoDate, TOUR_OFFSETS: TOUR_OFFSETS,
    coverOn: coverOn, coversOn: coversOn, coveringOn: coveringOn, dayFor: dayFor,
  };
  root.TourMath = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
