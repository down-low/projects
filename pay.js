/* Pay estimate (More → Pay estimate): the 2026-27 uniformed pay sheet, years of service from the hire date, the premiums
 * the person checks, and what an hour and a 24-hour shift of overtime pay. window.PayViews(api) -> {render, ...}; `api`
 * comes from app.js. PayViews.estimate(code, yos, prem) is the math alone.
 * - Hire date: the one saved on My page; otherwise a guess from the server (hireDateGuess: the usual hire date of the
 *   person's academy class), shown as a guess. The person can type their own and save it as their hire date.
 * - Classification defaults from rank (Firefighter: H-2 by year of service, 7th year and up at the top step);
 *   anyone can pick another. Premiums are a % of base; longevity follows years of service.
 * - Overtime (the user's rules, Oct 2026): the 97.40-hour hourly with the person's premiums except Holiday, at straight
 *   time until 106 hours worked in the pay period and 1.5x past that (PAY.otAfter). The pay period's total counts your
 *   own Worked OT marks (overtime.js) from the period's start through today against your scheduled shifts.
 * - Vacation and IDV stay in PAY but aren't shown for now (the user's call, Oct 2026).
 * An estimate for planning, not a pay stub.
 */
(function (root) {
  "use strict";

  var PAY = {
    title: "2026–27 uniformed pay (07/01/26 – 01/01/27)",
    // [code, name, yearly, hourly at 97.40 hrs biweekly (shift workers), hourly at 80 hrs]
    rates: [
      ["H-40", "Battalion Chief", 246844, 97.4743, 118.675],
      ["H-41", "Battalion Chief, Administration", 271544, 107.2279, 130.55],
      ["H-43", "Section Chief, EMS", 246844, 97.4743, 118.675],
      ["H-39", "Captain, Div. of Training", 246818, 97.4641, 118.6625],
      ["H-33", "Fire/Paramedic Captain", 205608, 81.191, 98.85],
      ["H-32", "Captain, Div. of FP & I", 232232, 91.7043, 111.65],
      ["H-31", "Captain, Administration", 226174, 89.3121, 108.755],
      ["H-30", "Captain", 205608, 81.191, 98.85],
      ["H-29", "Lieutenant, Training", 205582, 81.1807, 98.8375],
      ["H-28", "Lieutenant, Div. of Training", 205582, 81.1807, 98.8375],
      ["H-24", "Lieutenant, BFI", 203294, 80.2772, 97.7375],
      ["H-23", "Lieutenant, EMS", 180128, 71.1294, 86.6],
      ["H-22", "Lieutenant, BFP", 203294, 80.2772, 97.7375],
      ["H-21", "Lieutenant, Administration", 198120, 78.2341, 95.25],
      ["H-20", "Lieutenant", 180128, 71.1294, 86.6],
      ["H-18", "Coord. of Community Service", 180102, 71.1191, 86.5875],
      ["H-16", "Tech Training Specialist", 180102, 71.1191, 86.5875],
      ["H-10", "Incident Support Specialist", 168818, 66.6632, 81.1625],
      ["H-9", "Community Paramedic", 163514, 64.5688, 78.6125],
      ["H-6", "Investigator, BFI", 185796, 73.3676, 89.325],
      ["H-4", "Inspector, BFP", 185796, 73.3676, 89.325],
      ["H-120", "Pilot, Fireboat", 205608, 81.191, 98.85],
      ["H-110", "Marine Engineer of Fireboat", 205608, 81.191, 98.85],
      ["H-2/1", "Firefighter, 1st year", 100464, 39.6715, 48.3],
      ["H-2/2", "Firefighter, 2nd year", 105378, 41.6119, 50.6625],
      ["H-2/3", "Firefighter, 3rd year", 110760, 43.7372, 53.25],
      ["H-2/4", "Firefighter, 4th year", 122772, 48.4805, 59.025],
      ["H-2/5", "Firefighter, 5th year", 140634, 55.5339, 67.6125],
      ["H-2/6", "Firefighter, 6th year", 147420, 58.2136, 70.875],
      ["H-2/7", "Firefighter, 7th year and up", 154960, 61.191, 74.5],
      ["H-3/1", "H3-L1 EMT, step 1", 92014, 36.3347, 44.2375],
      ["H-3/2", "H3-L1 EMT, step 2", 96590, 38.1417, 46.4375],
      ["H-3/3", "H3-L1 EMT, step 3", 106340, 41.9918, 51.125],
      ["H-3/4", "H3-L1 EMT, step 4", 117026, 46.2115, 56.2625],
      ["H-3/5", "H3-L2 Paramedic, step 5", 122616, 48.4189, 58.95],
      ["H-3/6", "H3-L2 Paramedic, step 6", 128700, 50.8214, 61.875],
      ["H-3/7", "H3-L2 Paramedic, step 7", 141544, 55.8932, 68.05],
      ["H-3/8", "H3-L2 Paramedic, step 8", 155714, 61.4887, 74.8625],
      ["H-3/9", "H3-L3 Firefighter/Paramedic, step 9", 162448, 64.1478, 78.1],
      ["H-3/10", "H3-L3 Firefighter/Paramedic, step 10", 170586, 67.3614, 82.0125],
      ["H-3/11", "H3-L3 Firefighter/Paramedic, step 11", 179140, 70.7392, 86.125],
    ],
    // % of base. retire: counts toward retirement (kept in the data; not shown for now). ot: false, left out of the
    // overtime rate. group: only one of the group at a time.
    // only: the classifications that can get it (the user: EMT, AO and Rescue Boat are H-2 only). hidden: not offered for now.
    premiums: [
      { key: "emt5", label: "EMT on an Engine, Truck or Rescue Squad", pct: 5, retire: false, group: "emt", only: ["H-2"] },
      { key: "emt8", label: "EMT assigned to an ambulance", pct: 8, retire: false, group: "emt", hidden: true },
      { key: "ao", label: "Apparatus Operator (pump, aerial, tiller, Rescue Squad, BOE, Service Squad or Airport driver)", pct: 5, retire: false, only: ["H-2"] },
      { key: "boat", label: "Rescue Boat Operator (stacks with Apparatus Operator)", pct: 5, retire: false, only: ["H-2"] },
      { key: "medic", label: "Paramedic license (H-3 Level III appointed to H-2)", pct: 5, retire: true, hidden: true },
      { key: "holiday", label: "Holiday premium", pct: 9.09, retire: true, ot: false },
    ],
    // Training and education premium: the person picks one of these (or none). Not counted for retirement.
    training: { pcts: [7, 8, 9], retire: false },
    // Classifications that get the holiday premium unless the person unticks it.
    holidayDefault: ["H-2", "H-20", "H-30", "H-40", "H-110", "H-120"],
    // Classifications not offered for now (the user, Oct 2026; more to follow). Someone whose own one is hidden gets no card.
    // Only 97.40-hour (24-hour shift) employees for now.
    hidden: ["H-40", "H-41", "H-43", "H-32", "H-24", "H-23", "H-16", "H-9", "H-6", "H-4", "H-120", "H-110", "H-21", "H-31", "H-39",
      "H-18", "H-22", "H-28", "H-29",
      // H-3 Level 1 (EMT) and Level 2 (Paramedic): EMS, Station 49, a different department.
      "H-3/1", "H-3/2", "H-3/3", "H-3/4", "H-3/5", "H-3/6", "H-3/7", "H-3/8"],
    // Years of service -> longevity % of base (cumulative: 2% at 21, 4% at 23, 6% at 26).
    longevity: [{ yos: 21, pct: 2 }, { yos: 23, pct: 4 }, { yos: 26, pct: 6 }],
    otTimes: 1.5, otShiftHours: 24,
    // The department's rule (the user, Oct 2026): overtime is straight time until 106 hours worked in the pay period,
    // then 1.5x. Shifts on VA, S or D don't count; a shift someone works for you (TR) does. The 24-hour row assumes a
    // usual 4-shift period (96 hours: 10 hours straight, 14 at 1.5x).
    otAfter: 106, typicalRegular: 96,
    // Pay periods: 14 days, Saturday to Friday, from 9/12/26 – 9/25/26 (both ways).
    payPeriod: { anchor: "2026-09-12", days: 14 },
    // Not shown for now. Vacation hours a year by years of service (only the tier we have).
    vacation: [{ yos: 20, hrs: 240 }],
    // Intermittent Daily Vacation: 12-hour watches that can be taken during the year, by hours accrued.
    idv: { 120: "2 or 4 watches, in 24-hour blocks", 180: "2, 4 or 5 watches (with 5, four in 24-hour blocks; the last 12 hours can pair with 12 hours of time coming)",
      240: "2, 4, 6 or 8 watches, in 24-hour blocks" },
  };
  var RANK_DEFAULT = { "Battalion Chief": "H-40", "Rescue Captain": "H-33", Captain: "H-30", Lieutenant: "H-20", ISS: "H-10",
    Pilot: "H-120", "Marine Engineer": "H-110", Firefighter: "H-2", "FF/Paramedic": "H-2" };

  // The person's own classification: from their rank in the records (admin roster edits included), else their seat's
  // hclass ("H20" -> "H-20").
  function defaultCode(p) {
    if (!p) return "H-2";
    if (RANK_DEFAULT[p.rank]) return RANK_DEFAULT[p.rank];
    var h = p.hclass ? "H-" + String(p.hclass).replace(/^H-?/i, "") : null;
    return h && (h === "H-2" || PAY.rates.some(function (r) { return r[0] === h; })) ? h : "H-2";
  }
  // Whether someone gets the card: their own classification isn't hidden.
  function shows(p) { return offered(defaultCode(p)); }
  function offered(code) { return PAY.hidden.indexOf(code) === -1 && PAY.hidden.indexOf(code.split("/")[0]) === -1; }
  // A step ("H-2/3") counts as its classification ("H-2") for premiums.
  function base(code) { return String(code).split("/")[0]; }
  function premOffered(x, code) { return !x.hidden && (!x.only || x.only.indexOf(base(code)) !== -1); }

  function yearsOf(hire, today) {
    if (!hire) return null;
    var h = new Date(hire + "T00:00:00"), t = today;
    if (isNaN(h)) return null;
    var y = t.getFullYear() - h.getFullYear();
    if (t.getMonth() < h.getMonth() || (t.getMonth() === h.getMonth() && t.getDate() < h.getDate())) y--;
    return Math.max(0, y);
  }
  // The pay period a day falls in, as {start, end} ISO dates.
  function payPeriodOf(d) {
    var a = PAY.payPeriod.anchor.split("-").map(Number), day = 864e5, n = PAY.payPeriod.days;
    var off = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(a[0], a[1] - 1, a[2])) / day);
    var start = Date.UTC(a[0], a[1] - 1, a[2]) + Math.floor(off / n) * n * day;
    function iso(t) { return new Date(t).toISOString().slice(0, 10); }
    return { start: iso(start), end: iso(start + (n - 1) * day) };
  }
  // Worked OT marks ({iso: {kind, hours}}, as overtime.js marksFor) from `start` through `last`: days and hours (24 when blank).
  function otWorked(marks, start, last) {
    var days = 0, hours = 0;
    Object.keys(marks || {}).forEach(function (k) {
      var m = marks[k];
      if (!m || m.kind !== "worked" || k < start || k > last) return;
      days++;
      hours += Number(m.hours) || PAY.otShiftHours;
    });
    return { days: days, hours: hours };
  }
  // Regular hours toward the 106: 24 for each scheduled day (TourMath.dayFor results) worked, traded (TR) or WE.
  function regularHours(days) {
    var n = 0;
    (days || []).forEach(function (s) { if (s && (!s.status || s.status === "TR" || s.status === "WE")) n += PAY.otShiftHours; });
    return n;
  }
  // Overtime hours split at the 106: straight time up to it, 1.5x past it.
  function otPay(e, regular, hours) {
    var straight = Math.min(hours, Math.max(0, PAY.otAfter - regular)), over = hours - straight;
    return { straight: straight, overtime: over, amount: straight * e.straightHourly + over * e.otHourly };
  }
  function rateFor(code, yos) {
    if (code === "H-2") code = "H-2/" + Math.min(7, (yos || 0) + 1);
    return PAY.rates.filter(function (r) { return r[0] === code; })[0] || null;
  }
  function longevityPct(yos) {
    var hit = 0;
    PAY.longevity.forEach(function (x) { if (yos != null && yos >= x.yos) hit = x.pct; });
    return hit;
  }
  // Holiday premium is on for suppression classifications until the person unticks it.
  function premOn(prem, key, code) {
    if (key === "holiday" && prem.holiday == null) return PAY.holidayDefault.indexOf(base(code)) !== -1;
    return !!prem[key];
  }
  // The whole estimate for a classification, years of service and premiums ({key: true, train: 7|8|9}).
  function estimate(code, yos, prem) {
    prem = prem || {};
    var r = rateFor(code, yos);
    if (!r) return null;
    var base = r[2], rows = [], total = base, retire = base, otTotal = base;
    function add(label, pct, counts, ot) {
      var amt = base * pct / 100;
      rows.push({ label: label, pct: pct, amount: amt });
      total += amt;
      if (counts) retire += amt;
      if (ot !== false) otTotal += amt;
    }
    PAY.premiums.forEach(function (x) { if (premOffered(x, code) && premOn(prem, x.key, code)) add(x.label.replace(/ \(.*/, ""), x.pct, x.retire, x.ot); });
    if (PAY.training.pcts.indexOf(Number(prem.train)) !== -1) add("Training and education", Number(prem.train), PAY.training.retire);
    var lp = longevityPct(yos);
    if (lp) add("Longevity (" + yos + " years)", lp, false);
    var hourly = r[3] * total / base, straightHourly = r[3] * otTotal / base;
    var e = { rate: r, base: base, rows: rows, total: total, biweekly: total / 26, retire: retire, hourly: hourly,
      straightHourly: straightHourly, otHourly: straightHourly * PAY.otTimes };
    e.otShift = otPay(e, PAY.typicalRegular, PAY.otShiftHours).amount;
    return e;
  }

  root.PayViews = function (api) {
    var $ = api.$, esc = api.esc;
    var ui = { code: null, prem: null, hire: null, guess: null, asked: false };
    function load(k) { try { return JSON.parse(localStorage.getItem("tour-schedule:pay:" + k)); } catch (e) { return null; } }
    function keep(k, v) { try { localStorage.setItem("tour-schedule:pay:" + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
    function md(iso) { var x = iso.split("-"); return Number(x[1]) + "/" + Number(x[2]); }
    function otRow(e) {
      if (!api.overtime || !api.myPos()) return "";
      var t = api.today(), pp = payPeriodOf(t), last = t.getFullYear() + "-" + ("0" + (t.getMonth() + 1)).slice(-2) + "-" + ("0" + t.getDate()).slice(-2);
      var w = otWorked(api.overtime(api.myPos()), pp.start, last < pp.end ? last : pp.end);
      if (!w.days) return "<tr><td>Overtime this pay period (" + md(pp.start) + " – " + md(pp.end) + "): None marked</td><td></td></tr>";
      // Regular hours over the whole period: the rest of it is already on the schedule.
      var p = api.person(), days = [];
      if (p && api.day) for (var d = new Date(pp.start + "T00:00:00"), end = new Date(pp.end + "T00:00:00"); d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days.push(api.day(p, d));
      var x = otPay(e, regularHours(days), w.hours);
      return "<tr><td>Overtime this pay period (" + md(pp.start) + " – " + md(pp.end) + "): " + w.days + (w.days === 1 ? " day, " : " days, ") + w.hours + " hrs · " +
        x.straight + " straight, " + x.overtime + " at 1.5×</td><td>" + money(x.amount) + "</td></tr>";
    }
    function money(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
    function cents(n) { return "$" + n.toFixed(2); }
    function savedHire() { var me = api.backend().me(); return (me.profile && me.profile.hireDate) || null; }

    function render() {
      var out = $("pay-detail");
      if (!out) return;
      var p = api.person();
      if (ui.code == null) {
        var saved = load("code");
        ui.code = saved && offered(saved) ? saved : defaultCode(p);
        ui.prem = load("prem") || {};
      }
      if (savedHire()) ui.hire = savedHire();
      out.innerHTML = '<details class="card fold pay" id="pay-card" open><summary><h3>Pay estimate</h3><span class="fold-sum" id="pay-sum"></span></summary>' +
        '<div id="pay-body"></div></details>';
      draw();
      var b = api.backend();
      if (!ui.hire && !ui.guess && !ui.asked && b.hireDateGuess) {
        ui.asked = true;
        b.hireDateGuess().then(function (g) { if (g && !ui.hire) { ui.guess = g; if ($("pay-body")) draw(); } });
      }
    }
    function draw() {
      var hire = ui.hire || ui.guess, yos = yearsOf(hire, api.today()), code = ui.code, e = estimate(code, yos, ui.prem);
      /* H-2: "H-2" follows years of service. With a hire date the menu shows that as their own step ("your step"); any
         other step can be picked (steps go up on the appointment anniversary, but people may remember the date wrong). */
      var mine = yos != null ? Math.min(7, yos + 1) : null, shown = code === "H-2" && mine ? "H-2/" + mine : code;
      var opts = (mine ? [] : [["H-2", "Firefighter (H-2, step by years of service)"]]).concat(PAY.rates.filter(function (x) { return offered(x[0]); })
        .map(function (x) {
          var n = x[0].indexOf("H-2/") === 0 ? Number(x[0].split("/")[1]) : null;
          return [x[0], n ? "H-2 step " + n + " · " + x[1].replace("Firefighter, ", "") + (n === mine ? " (your step)" : "") : base(x[0]) + " " + x[1]];
        }));
      var train = Number(ui.prem.train) || 0;
      $("pay-body").innerHTML =
        '<p class="hint">' + esc(PAY.title) + ". An estimate for planning, not a pay stub.</p>" +
        '<div class="pay-field"><label for="pay-hire">Hire date</label><input type="date" id="pay-hire" value="' + esc(hire || "") + '">' +
        '<span class="hint" id="pay-hire-note">' + (ui.hire ? (yos != null ? yos + " years of service" : "") :
          ui.guess ? "Our guess from your academy class (" + yos + " years). Change it if it's wrong." : "Enter your hire date.") + "</span>" +
        (hire && hire !== savedHire() ? '<div class="row"><button type="button" class="btn small" id="pay-save">Save as my hire date</button><span class="msg" id="pay-msg" role="status"></span></div>' : "") +
        "</div>" +
        '<div class="pay-field"><label for="pay-code">Classification</label><select id="pay-code">' + opts.map(function (o) {
          return '<option value="' + esc(o[0]) + '"' + (o[0] === shown ? " selected" : "") + ">" + esc(o[1]) + "</option>";
        }).join("") + "</select></div>" +
        '<fieldset class="pay-prem"><legend>Premiums you get</legend>' + PAY.premiums.filter(function (x) { return premOffered(x, code); }).map(function (x) {
          return '<label class="chk"><input type="checkbox" data-prem="' + x.key + '"' + (premOn(ui.prem, x.key, code) ? " checked" : "") + "> " + esc(x.label) + " · " + x.pct + "%</label>";
        }).join("") +
        '<label class="chk">Training and education <select id="pay-train"><option value="0">None</option>' + PAY.training.pcts.map(function (n) {
          return '<option value="' + n + '"' + (train === n ? " selected" : "") + ">" + n + "%</option>";
        }).join("") + '</select></label></fieldset>' +
        (e ? '<table class="pay-table"><tbody>' +
          "<tr><th>Base (" + esc(e.rate[0].replace("/", " step ")) + ")</th><td>" + money(e.base) + "</td></tr>" +
          e.rows.map(function (x) { return "<tr><td>+ " + esc(x.label) + " " + x.pct + "%</td><td>" + money(x.amount) + "</td></tr>"; }).join("") +
          '<tr class="pay-total"><th>Estimated yearly</th><td>' + money(e.total) + "</td></tr>" +
          "<tr><td>Every 2 weeks</td><td>" + money(e.biweekly) + "</td></tr>" +
          "<tr><td>Hourly (97.40-hour pay period)</td><td>" + cents(e.hourly) + "</td></tr>" +
          "<tr><td>Overtime straight time (to " + PAY.otAfter + " hrs)</td><td>" + cents(e.straightHourly) + "</td></tr>" +
          "<tr><td>Overtime hourly (1.5× past " + PAY.otAfter + " hrs)</td><td>" + cents(e.otHourly) + "</td></tr>" +
          "<tr><td>" + PAY.otShiftHours + "-hour overtime shift (4-shift pay period)</td><td>" + money(e.otShift) + "</td></tr>" + otRow(e) + "</tbody></table>" : "");
      $("pay-sum").textContent = e ? money(e.total) + " a year" : "";
      $("pay-hire").onchange = function () { ui.hire = this.value || null; draw(); };
      // Picking your own step goes back to "by years of service", so it moves up with the next anniversary.
      $("pay-code").onchange = function () { ui.code = mine && this.value === "H-2/" + mine ? "H-2" : this.value; keep("code", ui.code); draw(); };
      $("pay-train").onchange = function () { ui.prem.train = Number(this.value) || 0; keep("prem", ui.prem); draw(); };
      $("pay-body").querySelectorAll("[data-prem]").forEach(function (c) {
        c.onchange = function () {
          ui.prem[c.dataset.prem] = c.checked;
          if (c.checked && c.dataset.prem === "emt5") ui.prem.emt8 = false;
          if (c.checked && c.dataset.prem === "emt8") ui.prem.emt5 = false;
          keep("prem", ui.prem);
          draw();
        };
      });
      if ($("pay-save")) $("pay-save").onclick = function () {
        var b = api.backend(), me = b.me(), d = hire;
        if (!d) return;
        api.say($("pay-msg"), "Saving…");
        b.setProfile(me.pos, { hireDate: d }).then(function () { ui.hire = d; api.say($("pay-msg"), "Saved."); draw(); },
          function (er) { api.say($("pay-msg"), er.message, true); });
      };
    }
    return { render: render, shows: shows, PAY: PAY };
  };
  root.PayViews.PAY = PAY;
  root.PayViews.estimate = estimate;
  root.PayViews.yearsOf = yearsOf;
  root.PayViews.payPeriodOf = payPeriodOf;
  root.PayViews.otWorked = otWorked;
  root.PayViews.otPay = otPay;
  root.PayViews.regularHours = regularHours;
  root.PayViews.defaultCode = defaultCode;
  root.PayViews.shows = shows;
})(typeof window !== "undefined" ? window : globalThis);
