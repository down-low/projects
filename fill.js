/* Fill open spots (back office, editors and admins; never in the employee app): for a date or a range, the apparatus
 * working below required staffing, each seat left without its person, and who could fill it.
 *
 * Rules (the user's calls, Oct 23, 2026):
 * - An open spot is an apparatus under its required staffing (the Staffing dashboard's Open count); its seats left
 *   without their person (vacant, on leave and not covered, away) say which rank and role is needed.
 * - Who can fill one: people who marked **Want OT** that day, in the seat's rank group (TourMath.RANK_GROUPS), off that
 *   day with no status (TourMath.eligibleTakers), and holding the seat's qualification when it needs one.
 * - Qualifications: only Rescue Squad (RS), Hazmat (HT) and Fire boat (FB) seats need one. Proof is a fir-db1 license
 *   or cert in the person's profile (admin-only) whose name is listed for that role in data/seat-qualifications.json.
 *   A role with no names listed yet shows "Qualification not set" and nobody is left out for it.
 * - Order: fewest Worked OT hours this calendar year (the overtime marks), then name.
 * View only for now; recording the cover comes next.
 *
 * FillMath (pure, also used from Node by firebase/functions/fill.test.js):
 *   seatRole(slot) -> "RS" | "HT" | "FB" | null
 *   qualified(role, licenses, rules, isoDate) -> true | false | null (null: no license names set for the role)
 *   otHours(overtime, year) -> {pos: hours}; wantOt(overtime, isoDate) -> {pos: true}
 *   candidates(d, slot, ctx) -> [{p, hours, before, after, qual}]
 *     ctx: {people, opts (dayFor opts), want, hours, rules, profiles ({pos: {licenses}} or null), today (ISO)}
 * window.FillViews(api) -> {render} draws the screen.
 */
(function (root) {
  "use strict";
  var M = root.TourMath || (typeof require !== "undefined" ? require("./schedule.js") : null);
  var ROLE_NAME = { RS: "Rescue Squad", HT: "Hazmat", FB: "Fire boat" };
  var MAX_DAYS = 31, SHOW = 10; // days in a range; people listed per seat before "N more"

  function seatRole(slot) {
    var co = String((slot && slot.company) || ""), title = String((slot && slot.title) || "");
    if (/^RS\d/.test(co) || /\bRS\d/.test(title)) return "RS";
    if (/^HT\d/.test(co) || /\bHT\d/.test(title)) return "HT";
    if (/^FB\d/.test(co) || /\bFB\d/.test(title) || /Fire Boats?$/i.test(title)) return "FB";
    return null;
  }
  function norm(s) { return String(s || "").trim().toLowerCase().replace(/\s+/g, " "); }
  function qualified(role, licenses, rules, isoDate) {
    var names = ((rules || {})[role] || []).map(norm);
    if (!names.length) return null;
    return (licenses || []).some(function (x) {
      return x && names.indexOf(norm(x.name)) >= 0 && (!x.expires || String(x.expires).slice(0, 10) >= isoDate);
    });
  }
  // Worked OT hours per person in a calendar year, from the `overtime` records ({pos, days: {iso: {kind, hours}}}).
  function otHours(overtime, year) {
    var out = {}, pre = String(year) + "-";
    (overtime || []).forEach(function (r) {
      Object.keys(r.days || {}).forEach(function (k) {
        var m = r.days[k];
        if (m && m.kind === "worked" && k.indexOf(pre) === 0) out[r.pos] = (out[r.pos] || 0) + (+m.hours || 24);
      });
    });
    return out;
  }
  // Who marked Want OT on one day.
  function wantOt(overtime, isoDate) {
    var out = {};
    (overtime || []).forEach(function (r) { var m = (r.days || {})[isoDate]; if (m && m.kind === "want") out[r.pos] = true; });
    return out;
  }
  function candidates(d, slot, ctx) {
    var role = seatRole(slot), wanting = (ctx.people || []).filter(function (p) { return ctx.want[p.pos]; });
    var el = M.eligibleTakers(d, { pos: slot.pos, rank: slot.rank }, { people: wanting, opts: ctx.opts });
    var out = [];
    el.forEach(function (x) {
      var qual = null;
      if (role) {
        var pf = ctx.profiles ? ctx.profiles[x.p.pos] : null;
        qual = qualified(role, pf ? pf.licenses : [], ctx.rules, ctx.today);
        if (qual === false) return;
      }
      out.push({ p: x.p, hours: ctx.hours[x.p.pos] || 0, before: x.before, after: x.after, qual: qual });
    });
    return out.sort(function (a, b) { return a.hours - b.hours || String(a.p.name).localeCompare(String(b.p.name)); });
  }

  var FillMath = { seatRole: seatRole, qualified: qualified, otHours: otHours, wantOt: wantOt, candidates: candidates, ROLE_NAME: ROLE_NAME };
  root.FillMath = FillMath;
  if (typeof module !== "undefined" && module.exports) module.exports = FillMath;
  if (typeof document === "undefined") return;

  root.FillViews = function (api) {
    var $ = api.$, esc = api.esc, Org = root.Organization;
    var ui = { from: null, to: null, bt: "", rank: "", msg: "" };

    function battalions() {
      var out = [];
      Org.DIVISIONS.forEach(function (dv) { if (!dv.hidden) dv.battalions.forEach(function (bt) { out.push(bt); }); });
      return out;
    }
    function btOf(co) { var w = Org.locate(co); return w ? w.battalion : null; }
    function days() {
      var a = api.fromIso(ui.from), b = api.fromIso(ui.to || ui.from), out = [];
      for (var d = a; d <= b && out.length < MAX_DAYS; d = api.addDays(d, 1)) out.push(d);
      return out;
    }
    // One day: the short apparatus (in report order) with their open seats and who could fill each.
    function dayPlan(d, base) {
      var isoD = api.iso(d), want = wantOt(api.recs().overtime, isoD);
      var ctx = Object.assign({}, base, { want: want, opts: api.opts() });
      return api.summarize(d).filter(function (r) {
        if (!(r.open > 0)) return false;
        var bt = btOf(r.co);
        return !ui.bt || (bt && bt.id === ui.bt);
      }).sort(function (a, b) { return Org.order(a.co) - Org.order(b.co); }).map(function (r) {
        var seen = {}, seats = [];
        (r.openSeats || []).forEach(function (x) {
          if (seen[x.slot.pos] || (ui.rank && x.slot.rank !== ui.rank)) return;
          seen[x.slot.pos] = 1;
          seats.push({ slot: x.slot, row: x.row, role: seatRole(x.slot), takers: candidates(d, x.slot, ctx) });
        });
        return { r: r, seats: seats };
      }).filter(function (a) { return a.seats.length; });
    }
    function why(row) {
      if (row.acting) return esc(row.name) + " (covering) · " + esc(api.STATUS_LABEL[row.status] || "off");
      if (!row.name) return "Vacant seat";
      if (row.status) return esc(row.name) + " · " + esc(api.STATUS_LABEL[row.status]) + " · not covered";
      if (row.away) return esc(row.name) + " · away";
      return esc(row.name) + " · off";
    }
    function takerHtml(t) {
      var flags = [];
      if (t.before) flags.push("works the day before");
      if (t.after) flags.push("works the day after");
      return "<li><span>" + esc(t.p.name) + ' <span class="hint">' + esc(t.p.rank || "") + " · " + esc(api.home(t.p) || "") + "</span>" +
        (flags.length ? ' <span class="tag">' + flags.join(", ") + "</span>" : "") + '</span><span class="num">' + t.hours + " OT hrs</span></li>";
    }
    function seatHtml(s, notLoaded) {
      var q = "";
      if (s.role) {
        var set = ((api.qualRules() || {})[s.role] || []).length;
        q = ' <span class="tag">' + esc(ROLE_NAME[s.role]) + (set ? "" : ": qualification not set") + "</span>";
      }
      return '<tr><td>' + esc(s.slot.title) + ' <span class="hint">' + esc(s.slot.pos) + "</span>" + q + "</td><td>" + why(s.row) + "</td><td>" +
        (s.takers.length ? '<ul class="hist fill-takers">' + s.takers.slice(0, SHOW).map(takerHtml).join("") + "</ul>" +
          (s.takers.length > SHOW ? '<details class="fill-more"><summary>' + (s.takers.length - SHOW) + ' more</summary><ul class="hist fill-takers">' +
            s.takers.slice(SHOW).map(takerHtml).join("") + "</ul></details>" : "")
          : '<span class="hint">Nobody who can take it marked Want OT.</span>') +
        (s.role && notLoaded ? '<p class="hint">Licenses aren\'t loaded yet, so qualifications can\'t be checked.</p>' : "") + "</td></tr>";
    }
    function render() {
      var box = $("fill-detail");
      if (!ui.from) ui.from = api.iso(api.today());
      if (!ui.to || ui.to < ui.from) ui.to = ui.from;
      if (!api.profiles()) api.loadProfiles();
      var year = +ui.from.slice(0, 4);
      var base = { people: api.people(), hours: otHours(api.recs().overtime, year), rules: api.qualRules() || {},
        profiles: api.profiles(), today: ui.from };
      var notLoaded = !api.profiles();
      var list = days(), shown = 0;
      var body = list.map(function (d) {
        var plan = dayPlan(d, base);
        shown += plan.length;
        if (!plan.length) return "";
        return '<div class="card"><h3>' + esc(api.longDate(d)) + "</h3>" + plan.map(function (a) {
          return '<h4 class="fill-co">' + esc(a.r.co) + ' <span class="hint">' + a.r.working + " working · " + a.r.required + " required · short " + a.r.open + "</span></h4>" +
            '<div class="table-wrap"><table class="list fill-t"><thead><tr><th>Seat</th><th>Why open</th><th>Want OT, fewest hours first</th></tr></thead><tbody>' +
            a.seats.map(function (s) { return seatHtml(s, notLoaded); }).join("") + "</tbody></table></div>";
        }).join("") + "</div>";
      }).join("");
      var rankOpts = '<option value="">All ranks</option>' + api.RANKS.map(function (r) {
        return '<option value="' + esc(r) + '"' + (ui.rank === r ? " selected" : "") + ">" + esc(r) + "</option>";
      }).join("");
      var btOpts = '<option value="">All battalions</option>' + battalions().map(function (bt) {
        return '<option value="' + esc(bt.id) + '"' + (ui.bt === bt.id ? " selected" : "") + ">" + esc(bt.name || bt.id) + "</option>";
      }).join("");
      box.innerHTML =
        '<div class="card"><h2>Fill open spots</h2>' +
        '<p class="hint">Apparatus under required staffing, the seats left without their person, and who marked Want OT that day ' +
        "in the seat's rank group, off and with no leave, fewest Worked OT hours this year first. Rescue Squad, Hazmat and Fire boat seats " +
        "also need a license on file. View only: record a cover from the person's page.</p>" +
        '<div class="row fill-filters"><label>From <input type="date" id="fill-from" value="' + esc(ui.from) + '"></label>' +
        '<label>To <input type="date" id="fill-to" value="' + esc(ui.to) + '"></label>' +
        '<select id="fill-bt" aria-label="Battalion">' + btOpts + "</select>" +
        '<select id="fill-rank" aria-label="Rank">' + rankOpts + "</select></div>" +
        (list.length >= MAX_DAYS && api.iso(list[list.length - 1]) < ui.to ? '<p class="hint">Showing the first ' + MAX_DAYS + " days.</p>" : "") +
        "</div>" + (shown ? body : '<p class="empty">No open spots on ' + (list.length > 1 ? "these days" : "this day") + ".</p>");
      $("fill-from").onchange = function () { ui.from = this.value || ui.from; render(); };
      $("fill-to").onchange = function () { ui.to = this.value || ui.to; render(); };
      $("fill-bt").onchange = function () { ui.bt = this.value; render(); };
      $("fill-rank").onchange = function () { ui.rank = this.value; render(); };
    }
    return { render: render };
  };
})(typeof window !== "undefined" ? window : globalThis);
