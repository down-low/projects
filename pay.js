/* Pay estimate (More → Pay estimate): the 2026-27 uniformed pay sheet, years of service from the hire date, the premiums
 * the person checks, and what an hour and a 24-hour shift of overtime pay. window.PayViews(api) -> {render, ...}; `api`
 * comes from app.js. PayViews.estimate(code, yos, prem) is the math alone.
 * - Hire date: the one saved on My page; otherwise a guess from the server (hireDateGuess: the usual hire date of the
 *   person's academy class), shown as a guess. The person can type their own and save it as their hire date.
 * - Classification defaults from rank (Firefighter: H-2 by year of service, 7th year and up at the top step);
 *   anyone can pick another. Premiums are a % of base; longevity follows years of service.
 * - Overtime (the user's rule, Oct 2026): 1.5 x the 97.40-hour hourly rate with the person's premiums.
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
    // % of base. retire: counts toward retirement. group: only one of the group at a time.
    premiums: [
      { key: "emt5", label: "EMT on an Engine, Truck or Rescue Squad", pct: 5, retire: false, group: "emt" },
      { key: "emt8", label: "EMT assigned to an ambulance", pct: 8, retire: false, group: "emt" },
      { key: "ao", label: "Apparatus Operator (pump, aerial, tiller, Rescue Squad, BOE, Service Squad or Airport driver)", pct: 5, retire: false },
      { key: "boat", label: "Rescue Boat Operator (stacks with Apparatus Operator)", pct: 5, retire: false },
      { key: "medic", label: "Paramedic license (H-3 Level III appointed to H-2)", pct: 5, retire: true },
      { key: "holiday", label: "Holiday premium (on for suppression)", pct: 9.09, retire: true },
    ],
    // Training and education premium: the person picks one of these (or none). Not counted for retirement.
    training: { pcts: [7, 8, 9], retire: false },
    // Classifications that get the holiday premium unless the person unticks it.
    holidayDefault: ["H-2", "H-20", "H-30", "H-40", "H-110", "H-120"],
    // Years of service -> longevity % of base (cumulative: 2% at 21, 4% at 23, 6% at 26).
    longevity: [{ yos: 21, pct: 2 }, { yos: 23, pct: 4 }, { yos: 26, pct: 6 }],
    otTimes: 1.5, otShiftHours: 24,
    // Not shown for now. Vacation hours a year by years of service (only the tier we have).
    vacation: [{ yos: 20, hrs: 240 }],
    // Intermittent Daily Vacation: 12-hour watches that can be taken during the year, by hours accrued.
    idv: { 120: "2 or 4 watches, in 24-hour blocks", 180: "2, 4 or 5 watches (with 5, four in 24-hour blocks; the last 12 hours can pair with 12 hours of time coming)",
      240: "2, 4, 6 or 8 watches, in 24-hour blocks" },
  };
  var RANK_DEFAULT = { "Battalion Chief": "H-40", "Rescue Captain": "H-33", Captain: "H-30", Lieutenant: "H-20", ISS: "H-10",
    Pilot: "H-120", "Marine Engineer": "H-110", Firefighter: "H-2", "FF/Paramedic": "H-2" };

  function yearsOf(hire, today) {
    if (!hire) return null;
    var h = new Date(hire + "T00:00:00"), t = today;
    if (isNaN(h)) return null;
    var y = t.getFullYear() - h.getFullYear();
    if (t.getMonth() < h.getMonth() || (t.getMonth() === h.getMonth() && t.getDate() < h.getDate())) y--;
    return Math.max(0, y);
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
    if (key === "holiday" && prem.holiday == null) return PAY.holidayDefault.indexOf(code) !== -1;
    return !!prem[key];
  }
  // The whole estimate for a classification, years of service and premiums ({key: true, train: 7|8|9}).
  function estimate(code, yos, prem) {
    prem = prem || {};
    var r = rateFor(code, yos);
    if (!r) return null;
    var base = r[2], rows = [], total = base, retire = base;
    function add(label, pct, counts) {
      var amt = base * pct / 100;
      rows.push({ label: label, pct: pct, amount: amt });
      total += amt;
      if (counts) retire += amt;
    }
    PAY.premiums.forEach(function (x) { if (premOn(prem, x.key, code)) add(x.label.replace(/ \(.*/, ""), x.pct, x.retire); });
    if (PAY.training.pcts.indexOf(Number(prem.train)) !== -1) add("Training and education", Number(prem.train), PAY.training.retire);
    var lp = longevityPct(yos);
    if (lp) add("Longevity (" + yos + " years)", lp, false);
    var hourly = r[3] * total / base, otHourly = hourly * PAY.otTimes;
    return { rate: r, base: base, rows: rows, total: total, biweekly: total / 26, retire: retire, hourly: hourly,
      otHourly: otHourly, otShift: otHourly * PAY.otShiftHours };
  }

  root.PayViews = function (api) {
    var $ = api.$, esc = api.esc;
    var ui = { code: null, prem: null, hire: null, guess: null, asked: false };
    function load(k) { try { return JSON.parse(localStorage.getItem("tour-schedule:pay:" + k)); } catch (e) { return null; } }
    function keep(k, v) { try { localStorage.setItem("tour-schedule:pay:" + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
    function money(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
    function cents(n) { return "$" + n.toFixed(2); }
    function savedHire() { var me = api.backend().me(); return (me.profile && me.profile.hireDate) || null; }

    function render() {
      var out = $("pay-detail");
      if (!out) return;
      var p = api.person();
      if (ui.code == null) {
        ui.code = load("code") || (p && RANK_DEFAULT[p.rank]) || "H-2";
        ui.prem = load("prem") || (p && p.rank === "FF/Paramedic" ? { medic: true } : {});
      }
      if (savedHire()) ui.hire = savedHire();
      out.innerHTML = '<div class="card pay"><h3>Pay estimate</h3><div id="pay-body"></div></div>' +
        '<div class="card pay"><h3>Overtime</h3><div id="pay-ot"></div></div>';
      draw();
      var b = api.backend();
      if (!ui.hire && !ui.guess && !ui.asked && b.hireDateGuess) {
        ui.asked = true;
        b.hireDateGuess().then(function (g) { if (g && !ui.hire) { ui.guess = g; if ($("pay-body")) draw(); } });
      }
    }
    function draw() {
      var hire = ui.hire || ui.guess, yos = yearsOf(hire, api.today()), code = ui.code, e = estimate(code, yos, ui.prem);
      var opts = [["H-2", "Firefighter (H-2, step by years of service)"]].concat(PAY.rates.filter(function (x) { return x[0].indexOf("H-2/") !== 0; })
        .map(function (x) { return [x[0], x[0].split("/")[0] + " " + x[1]]; }));
      var train = Number(ui.prem.train) || 0;
      $("pay-body").innerHTML =
        '<p class="hint">' + esc(PAY.title) + ". An estimate for planning, not a pay stub.</p>" +
        '<div class="row"><label>Hire date<input type="date" id="pay-hire" value="' + esc(hire || "") + '"></label>' +
        '<span class="hint" id="pay-hire-note">' + (ui.hire ? (yos != null ? yos + " years of service" : "") :
          ui.guess ? "Our guess from your academy class (" + yos + " years). Change it if it's wrong." : "Enter your hire date.") + "</span></div>" +
        (hire && hire !== savedHire() ? '<div class="row"><button type="button" class="btn small" id="pay-save">Save as my hire date</button><span class="msg" id="pay-msg" role="status"></span></div>' : "") +
        '<label>Classification<select id="pay-code">' + opts.map(function (o) {
          return '<option value="' + esc(o[0]) + '"' + (o[0] === code ? " selected" : "") + ">" + esc(o[1]) + "</option>";
        }).join("") + "</select></label>" +
        '<fieldset class="pay-prem"><legend>Premiums you get</legend>' + PAY.premiums.map(function (x) {
          return '<label class="chk"><input type="checkbox" data-prem="' + x.key + '"' + (premOn(ui.prem, x.key, code) ? " checked" : "") + "> " + esc(x.label) + " · " + x.pct + "%" +
            (x.retire ? "" : ' <span class="hint">not counted for retirement</span>') + "</label>";
        }).join("") +
        '<label>Training and education<select id="pay-train"><option value="0">None</option>' + PAY.training.pcts.map(function (n) {
          return '<option value="' + n + '"' + (train === n ? " selected" : "") + ">" + n + "%</option>";
        }).join("") + '</select> <span class="hint">not counted for retirement</span></label></fieldset>' +
        (e ? '<table class="pay-table"><tbody>' +
          "<tr><th>Base (" + esc(e.rate[0].replace("/", " step ")) + ")</th><td>" + money(e.base) + "</td></tr>" +
          e.rows.map(function (x) { return "<tr><td>+ " + esc(x.label) + " " + x.pct + "%</td><td>" + money(x.amount) + "</td></tr>"; }).join("") +
          '<tr class="pay-total"><th>Estimated yearly</th><td>' + money(e.total) + "</td></tr>" +
          "<tr><td>Every 2 weeks</td><td>" + money(e.biweekly) + "</td></tr>" +
          "<tr><td>Hourly (97.40-hour pay period)</td><td>" + cents(e.hourly) + "</td></tr>" +
          "<tr><td>Counts toward retirement</td><td>" + money(e.retire) + "</td></tr></tbody></table>" : "");
      $("pay-ot").innerHTML = e ? '<table class="pay-table"><tbody>' +
        "<tr><td>Overtime hourly (" + PAY.otTimes + " × " + cents(e.hourly) + ")</td><td>" + cents(e.otHourly) + "</td></tr>" +
        '<tr class="pay-total"><th>One ' + PAY.otShiftHours + "-hour overtime shift</th><td>" + money(e.otShift) + "</td></tr></tbody></table>" +
        '<p class="hint">Time and a half of your hourly rate with the premiums above. Totals from the Worked OT days on your calendar come later.</p>'
        : '<p class="hint">Pick a classification.</p>';
      $("pay-hire").onchange = function () { ui.hire = this.value || null; draw(); };
      $("pay-code").onchange = function () { ui.code = this.value; keep("code", ui.code); draw(); };
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
    return { render: render, PAY: PAY };
  };
  root.PayViews.PAY = PAY;
  root.PayViews.estimate = estimate;
  root.PayViews.yearsOf = yearsOf;
})(typeof window !== "undefined" ? window : globalThis);
