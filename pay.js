/* Pay estimate on My page: the 2026-27 uniformed pay sheet, years of service from the hire date, and the premiums the
 * person checks. window.PayViews(api) -> {html(me, person), wire(me, person)}. `api` comes from admin.js (My page).
 * - Hire date: the one saved on My page; otherwise a guess from the server (hireDateGuess: the usual hire date of the
 *   person's academy class), shown as a guess. The person can type their own and save it as their hire date.
 * - Classification defaults from rank (Firefighter: H-2 by year of service, 7th year and up at the top step);
 *   anyone can pick another. Premiums are a % of base; longevity and vacation follow years of service.
 * - Only what the sheet and the user's notes give is filled in; tiers we don't know yet say so (PAY.unknown).
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
    // % of base. retire: counts toward retirement.
    premiums: [
      { key: "emt5", label: "EMT on an Engine, Truck or Rescue Squad", pct: 5, retire: false, group: "emt" },
      { key: "emt8", label: "EMT assigned to an ambulance", pct: 8, retire: false, group: "emt" },
      { key: "ao", label: "Apparatus Operator (pump, aerial, tiller, Rescue Squad, BOE, Service Squad or Airport driver)", pct: 5, retire: false },
      { key: "boat", label: "Rescue Boat Operator (stacks with Apparatus Operator)", pct: 5, retire: false },
      { key: "medic", label: "Paramedic license (H-3 Level III appointed to H-2)", pct: 5, retire: true },
    ],
    // Years of service -> extra %, and vacation hours a year. Only the tiers we have are listed.
    longevity: [{ yos: 21, pct: 2 }],
    vacation: [{ yos: 20, hrs: 240 }],
    unknown: "Longevity below 21 years and vacation below 20 years aren't entered yet.",
    // Intermittent Daily Vacation: 12-hour watches that can be taken during the year, by hours accrued.
    idv: { 120: "2 or 4 watches, in 24-hour blocks", 180: "2, 4 or 5 watches (with 5, four in 24-hour blocks; the last 12 hours can pair with 12 hours of time coming)",
      240: "2, 4, 6 or 8 watches, in 24-hour blocks" },
  };
  var RANK_DEFAULT = { "Battalion Chief": "H-40", "Rescue Captain": "H-33", Captain: "H-30", Lieutenant: "H-20", ISS: "H-10",
    Pilot: "H-120", "Marine Engineer": "H-110", Firefighter: "H-2", "FF/Paramedic": "H-2" };

  root.PayViews = function (api) {
    var $ = api.$, esc = api.esc;
    var ui = { code: null, prem: null, hire: null, guess: null, guessFrom: null, vac: null };
    function load(k) { try { return JSON.parse(localStorage.getItem("tour-schedule:pay:" + k)); } catch (e) { return null; } }
    function keep(k, v) { try { localStorage.setItem("tour-schedule:pay:" + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }

    function yearsOf(hire) {
      if (!hire) return null;
      var h = new Date(hire + "T00:00:00"), t = api.today();
      if (isNaN(h)) return null;
      var y = t.getFullYear() - h.getFullYear();
      if (t.getMonth() < h.getMonth() || (t.getMonth() === h.getMonth() && t.getDate() < h.getDate())) y--;
      return Math.max(0, y);
    }
    function rateFor(code, yos) {
      if (code === "H-2") code = "H-2/" + Math.min(7, (yos || 0) + 1);
      return PAY.rates.filter(function (r) { return r[0] === code; })[0] || null;
    }
    function tier(list, yos, field) {
      var hit = null;
      list.forEach(function (x) { if (yos != null && yos >= x.yos) hit = x[field]; });
      return hit;
    }
    function money(n) { return "$" + Math.round(n).toLocaleString("en-US"); }

    function html(me, p) {
      if (ui.code == null) {
        ui.code = load("code") || (p && RANK_DEFAULT[p.rank]) || "H-2";
        ui.prem = load("prem") || (p && p.rank === "FF/Paramedic" ? { medic: true } : {});
        ui.vac = load("vac");
      }
      if (me.profile && me.profile.hireDate) ui.hire = me.profile.hireDate;
      return '<details class="card fold pay" id="pay-card"><summary><h3>Pay estimate</h3><span class="fold-sum" id="pay-sum"></span></summary>' +
        '<div id="pay-body"></div></details>';
    }
    function draw() {
      var hire = ui.hire || ui.guess, yos = yearsOf(hire), code = ui.code, r = rateFor(code, yos);
      var opts = [["H-2", "Firefighter (H-2, step by years of service)"]].concat(PAY.rates.filter(function (x) { return x[0].indexOf("H-2/") !== 0; })
        .map(function (x) { return [x[0], x[0].split("/")[0] + " " + x[1]]; }));
      var base = r ? r[2] : 0, longPct = tier(PAY.longevity, yos, "pct") || 0, rows = [], total = base, retire = base;
      PAY.premiums.forEach(function (x) {
        if (!ui.prem[x.key]) return;
        var amt = base * x.pct / 100;
        rows.push([x.label.replace(/ \(.*/, "") + " " + x.pct + "%", amt]);
        total += amt;
        if (x.retire) retire += amt;
      });
      if (longPct) { var la = base * longPct / 100; rows.push(["Longevity (" + yos + " years) " + longPct + "%", la]); total += la; }
      var pct = base ? (total / base - 1) * 100 : 0;
      var vac = tier(PAY.vacation, yos, "hrs") || ui.vac;
      $("pay-sum").textContent = r ? money(total) + " a year" : "";
      $("pay-body").innerHTML =
        '<p class="hint">' + esc(PAY.title) + ". An estimate for planning, not a pay stub.</p>" +
        '<div class="row"><label>Hire date<input type="date" id="pay-hire" value="' + esc(hire || "") + '"></label>' +
        '<span class="hint" id="pay-hire-note">' + (ui.hire ? (yos != null ? yos + " years of service" : "") :
          ui.guess ? "Our guess from your academy class (" + yos + " years). Change it if it's wrong." : "Enter your hire date.") + "</span></div>" +
        (hire && hire !== ((api.backend().me().profile || {}).hireDate || null) ? '<div class="row"><button type="button" class="btn small" id="pay-save">Save as my hire date</button><span class="msg" id="pay-msg" role="status"></span></div>' : "") +
        '<label>Classification<select id="pay-code">' + opts.map(function (o) {
          return '<option value="' + esc(o[0]) + '"' + (o[0] === code ? " selected" : "") + ">" + esc(o[1]) + "</option>";
        }).join("") + "</select></label>" +
        '<fieldset class="pay-prem"><legend>Premiums you get</legend>' + PAY.premiums.map(function (x) {
          return '<label class="chk"><input type="checkbox" data-prem="' + x.key + '"' + (ui.prem[x.key] ? " checked" : "") + "> " + esc(x.label) + " · " + x.pct + "%" +
            (x.retire ? "" : ' <span class="hint">not counted for retirement</span>') + "</label>";
        }).join("") + "</fieldset>" +
        (r ? '<table class="pay-table"><tbody>' +
          "<tr><th>Base (" + esc(r[0].replace("/", " step ")) + ")</th><td>" + money(base) + "</td></tr>" +
          rows.map(function (x) { return "<tr><td>+ " + esc(x[0]) + "</td><td>" + money(x[1]) + "</td></tr>"; }).join("") +
          '<tr class="pay-total"><th>Estimated yearly</th><td>' + money(total) + "</td></tr>" +
          "<tr><td>Every 2 weeks</td><td>" + money(total / 26) + "</td></tr>" +
          "<tr><td>Hourly (97.40-hour pay period)</td><td>$" + (r[3] * (1 + pct / 100)).toFixed(2) + "</td></tr>" +
          "<tr><td>Counts toward retirement</td><td>" + money(retire) + "</td></tr></tbody></table>" : "") +
        '<div class="pay-vac"><b>Vacation</b> ' + (tier(PAY.vacation, yos, "hrs") ? vac + " hours a year (" + yos + " years of service)" :
          '<select id="pay-vac"><option value="">Your yearly hours…</option>' + [120, 180, 240].map(function (h) {
            return '<option value="' + h + '"' + (Number(ui.vac) === h ? " selected" : "") + ">" + h + " hours</option>";
          }).join("") + "</select>") +
        (PAY.idv[vac] ? '<p class="hint">Intermittent Daily Vacation with ' + vac + " hours: " + esc(PAY.idv[vac]) +
          ". Requests by November 15 are awarded by seniority in rank (decided by December 15); after that, in the order received.</p>" : "") + "</div>" +
        '<p class="hint">' + esc(PAY.unknown) + "</p>";
      $("pay-hire").onchange = function () { ui.hire = this.value || null; draw(); };
      $("pay-code").onchange = function () { ui.code = this.value; keep("code", ui.code); draw(); };
      $("pay-body").querySelectorAll("[data-prem]").forEach(function (c) {
        c.onchange = function () {
          ui.prem[c.dataset.prem] = c.checked;
          if (c.checked && c.dataset.prem === "emt5") ui.prem.emt8 = false;
          if (c.checked && c.dataset.prem === "emt8") ui.prem.emt5 = false;
          keep("prem", ui.prem);
          draw();
        };
      });
      if ($("pay-vac")) $("pay-vac").onchange = function () { ui.vac = this.value ? Number(this.value) : null; keep("vac", ui.vac); draw(); };
      if ($("pay-save")) $("pay-save").onclick = function () {
        var b = api.backend(), me = b.me(), d = hire;
        if (!d) return;
        api.say($("pay-msg"), "Saving…");
        b.setProfile(me.pos, { hireDate: d }).then(function () { ui.hire = d; api.say($("pay-msg"), "Saved."); draw(); },
          function (er) { api.say($("pay-msg"), er.message, true); });
      };
    }
    function wire(me) {
      if (!$("pay-card")) return;
      draw();
      var b = api.backend();
      if (!ui.hire && !ui.guess && b.hireDateGuess) b.hireDateGuess().then(function (g) {
        if (g && !ui.hire) { ui.guess = g; if ($("pay-body")) draw(); }
      });
    }
    return { html: html, wire: wire, PAY: PAY, rateFor: rateFor, yearsOf: yearsOf };
  };
})(typeof window !== "undefined" ? window : globalThis);
