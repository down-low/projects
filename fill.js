/* Fill open spots (back office, editors and admins; never in the employee app): for a date or a range, the apparatus
 * working below required staffing, each seat left without its person, and who could fill it.
 *
 * Rules (the user's calls, Oct 23, 2026):
 * - An open spot is an apparatus under its required staffing (the Staffing dashboard's Open count); its seats left
 *   without their person (vacant, on leave and not covered, away) say which rank and role is needed.
 * - Only two kinds of people can fill one, both in the seat's rank group (TourMath.RANK_GROUPS) and qualified:
 *   1. **Extra bodies**, listed first (no overtime): anyone working that day on an apparatus above its required
 *      staffing. Moving one leaves it at or above required; its surplus caps how many can go.
 *   2. **Want OT**: people who marked Want OT that day, off with no status (TourMath.eligibleTakers), fewest Worked OT
 *      hours this calendar year first (the overtime marks).
 * - Qualifications: the specialty places in 25 A-084 Attachment B (minimum to apply), from data/seat-qualifications.json:
 *   each place matches companies, stations or seat titles and lists, per rank class (officer: Lt and Capt; ff:
 *   Firefighter and FF/Paramedic; or `all`), groups of certs: every group is needed, any one cert in a group will do.
 *   `certs` maps each cert to the fir-db1 license names (profiles, admin-only) that count, unexpired. A cert with no
 *   names yet is "not set" and leaves nobody out. A seat matched by several places needs all of them.
 * View only for now; recording the cover comes next.
 *
 * FillMath (pure, also used from Node by firebase/functions/fill.test.js):
 *   placesFor(slot, co, rules) -> [place]; reqsFor(place, rank) -> [[cert]] or null
 *   qualified(slot, co, licenses, rules, isoDate) -> {ok, missing: [cert], notSet: [cert], places: [name]}
 *   otHours(overtime, year) -> {pos: hours}; wantOt(overtime, isoDate) -> {pos: true}
 *   extras(summary) -> [{p, co, surplus}] (people working on apparatus above required)
 *   candidates(d, slot, co, ctx) -> {extras: [{p, co, surplus, qual}], ot: [{p, hours, before, after, qual}]}
 *     ctx: {people, opts (dayFor opts), want, hours, extras, rules, profiles ({pos: {licenses}} or null), today (ISO),
 *           battalionOf (co -> id, optional)}
 * window.FillViews(api) -> {render} draws the screen.
 */
(function (root) {
  "use strict";
  var M = root.TourMath || (typeof require !== "undefined" ? require("./schedule.js") : null);
  var Org = root.Organization || (typeof require !== "undefined" ? require("./organization.js") : null);
  var OFFICER = ["Lieutenant", "Captain"], FF = ["Firefighter", "FF/Paramedic"];
  var MAX_DAYS = 31, SHOW = 10; // days in a range; people listed per seat before "N more"

  function placesFor(slot, co, rules) {
    var c = (slot && slot.company) || co || "", title = String((slot && slot.title) || ""), st = c && Org ? Org.station(c) : null;
    return ((rules || {}).places || []).filter(function (pl) {
      return (pl.companies || []).indexOf(c) !== -1 || (st != null && (pl.stations || []).indexOf(st) !== -1) ||
        (pl.titles ? new RegExp(pl.titles, "i").test(title) : false);
    });
  }
  function reqsFor(place, rank) {
    if (place.all) return place.all;
    if (OFFICER.indexOf(rank) !== -1) return place.officer || null;
    if (FF.indexOf(rank) !== -1) return place.ff || null;
    return null;
  }
  function norm(s) { return String(s || "").trim().toLowerCase().replace(/\s+/g, " "); }
  function qualified(slot, co, licenses, rules, isoDate) {
    var out = { ok: true, missing: [], notSet: [], places: [] }, certs = (rules || {}).certs || {};
    var held = (licenses || []).filter(function (x) { return x && (!x.expires || String(x.expires).slice(0, 10) >= isoDate); })
      .map(function (x) { return norm(x.name); });
    placesFor(slot, co, rules).forEach(function (pl) {
      var groups = reqsFor(pl, slot && slot.rank);
      if (!groups) return;
      out.places.push(pl.name);
      groups.forEach(function (g) {
        var set = g.filter(function (k) { return (certs[k] || []).length; });
        if (!set.length) { g.forEach(function (k) { if (out.notSet.indexOf(k) === -1) out.notSet.push(k); }); return; }
        var has = set.some(function (k) { return certs[k].some(function (n) { return held.indexOf(norm(n)) !== -1; }); });
        if (!has) out.missing.push(g.join(" or "));
      });
    });
    out.ok = !out.missing.length;
    return out;
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
  // People working on an apparatus above its required staffing (summary: the dashboard's summarize(d) rows).
  function extras(summary) {
    var out = [];
    (summary || []).forEach(function (r) {
      if (!(r.total > 0)) return;
      (r.people || []).forEach(function (x) { if (x.who && x.who.pos) out.push({ p: x.who, co: r.co, surplus: r.total }); });
    });
    return out;
  }
  function qualFor(slot, co, p, ctx) {
    if (!ctx.profiles) return { ok: true, missing: [], notSet: [], places: [], unknown: true };
    var pf = ctx.profiles[p.pos];
    return qualified(slot, co, pf ? pf.licenses : [], ctx.rules, ctx.today);
  }
  function candidates(d, slot, co, ctx) {
    var group = M.rankGroup(slot.rank), bt = ctx.battalionOf || function () { return null; }, home = bt(co);
    var ex = (ctx.extras || []).filter(function (x) {
      return x.co !== co && x.p.pos !== slot.pos && M.rankGroup(x.p.rank) === group;
    }).map(function (x) { return Object.assign({}, x, { qual: qualFor(slot, co, x.p, ctx) }); })
      .filter(function (x) { return x.qual.ok; })
      .sort(function (a, b) {
        var sa = bt(a.co) === home ? 0 : 1, sb = bt(b.co) === home ? 0 : 1;
        return sa - sb || String(a.p.name).localeCompare(String(b.p.name));
      });
    var wanting = (ctx.people || []).filter(function (p) { return ctx.want[p.pos]; });
    var ot = M.eligibleTakers(d, { pos: slot.pos, rank: slot.rank }, { people: wanting, opts: ctx.opts }).map(function (x) {
      return { p: x.p, hours: ctx.hours[x.p.pos] || 0, before: x.before, after: x.after, qual: qualFor(slot, co, x.p, ctx) };
    }).filter(function (x) { return x.qual.ok; })
      .sort(function (a, b) { return a.hours - b.hours || String(a.p.name).localeCompare(String(b.p.name)); });
    return { extras: ex, ot: ot };
  }

  var FillMath = { placesFor: placesFor, reqsFor: reqsFor, qualified: qualified, otHours: otHours, wantOt: wantOt, extras: extras,
    candidates: candidates };
  root.FillMath = FillMath;
  if (typeof module !== "undefined" && module.exports) module.exports = FillMath;
  if (typeof document === "undefined") return;

  root.FillViews = function (api) {
    var $ = api.$, esc = api.esc;
    var ui = { from: null, to: null, bt: "", rank: "", show: "both" };
    var SHOW_LABEL = { both: "Extras and OT", extras: "Extra bodies only", ot: "Want OT only" };

    function battalions() {
      var out = [];
      Org.DIVISIONS.forEach(function (dv) { if (!dv.hidden) dv.battalions.forEach(function (bt) { out.push(bt); }); });
      return out;
    }
    function btOf(co) { var w = Org.locate(co); return w ? w.battalion : null; }
    function btId(co) { var b = btOf(co); return b ? b.id : null; }
    function days() {
      var a = api.fromIso(ui.from), b = api.fromIso(ui.to || ui.from), out = [];
      for (var d = a; d <= b && out.length < MAX_DAYS; d = api.addDays(d, 1)) out.push(d);
      return out;
    }
    // One day: the short apparatus (in report order) with their open seats and who could fill each.
    function dayPlan(d, base) {
      var isoD = api.iso(d), summary = api.summarize(d);
      var ctx = Object.assign({}, base, { want: wantOt(api.recs().overtime, isoD), opts: api.opts(), extras: extras(summary), battalionOf: btId });
      var plan = summary.filter(function (r) {
        if (!(r.open > 0)) return false;
        return !ui.bt || btId(r.co) === ui.bt;
      }).sort(function (a, b) { return Org.order(a.co) - Org.order(b.co); }).map(function (r) {
        var seen = {}, seats = [];
        (r.openSeats || []).forEach(function (x) {
          if (seen[x.slot.pos] || (ui.rank && x.slot.rank !== ui.rank)) return;
          seen[x.slot.pos] = 1;
          seats.push({ slot: x.slot, row: x.row, co: r.co, need: qualified(x.slot, r.co, [], base.rules, base.today), takers: candidates(d, x.slot, r.co, ctx) });
        });
        return { r: r, seats: seats };
      }).filter(function (a) { return a.seats.length; });
      // How many open seats list each extra body, to say that each can fill only one.
      var listed = {};
      plan.forEach(function (a) { a.seats.forEach(function (s) { s.takers.extras.forEach(function (x) { listed[x.p.pos] = (listed[x.p.pos] || 0) + 1; }); }); });
      return { plan: plan, listed: listed };
    }
    function why(row) {
      if (row.acting) return esc(row.name) + " (covering) · " + esc(api.STATUS_LABEL[row.status] || "off");
      if (!row.name) return "Vacant seat";
      if (row.status) return esc(row.name) + " · " + esc(api.STATUS_LABEL[row.status]) + " · not covered";
      if (row.away) return esc(row.name) + " · away";
      return esc(row.name) + " · off";
    }
    function person(p) { return esc(p.name) + ' <span class="hint">' + esc(p.rank || "") + "</span>"; }
    function extraHtml(x, listed) {
      var bt = btOf(x.co);
      return "<li><span>" + person(x.p) + ' <span class="tag">Extra · ' + esc(x.co) + " +" + x.surplus + (bt ? " · " + esc(bt.name || bt.id) : "") + "</span>" +
        (listed[x.p.pos] > 1 ? ' <span class="hint">also listed for ' + (listed[x.p.pos] - 1) + " other seat" + (listed[x.p.pos] > 2 ? "s" : "") + "</span>" : "") +
        '</span><span class="num">no OT</span></li>';
    }
    function otHtml(t) {
      var flags = [];
      if (t.before) flags.push("works the day before");
      if (t.after) flags.push("works the day after");
      return "<li><span>" + person(t.p) + ' <span class="hint">· ' + esc(api.home(t.p) || "") + "</span>" +
        (flags.length ? ' <span class="tag">' + flags.join(", ") + "</span>" : "") + '</span><span class="num">' + t.hours + " OT hrs</span></li>";
    }
    function list(items, html, empty) {
      if (!items.length) return '<span class="hint">' + empty + "</span>";
      return '<ul class="hist fill-takers">' + items.slice(0, SHOW).map(html).join("") + "</ul>" +
        (items.length > SHOW ? '<details class="fill-more"><summary>' + (items.length - SHOW) + ' more</summary><ul class="hist fill-takers">' +
          items.slice(SHOW).map(html).join("") + "</ul></details>" : "");
    }
    function seatHtml(s, listed, notLoaded) {
      var q = s.need.places.length ? ' <span class="tag">' + esc(s.need.places.join(" + ")) + "</span>" +
        (s.need.notSet.length ? ' <span class="hint">not set yet: ' + esc(s.need.notSet.join(", ")) + "</span>" : "") : "";
      var cells = "";
      if (ui.show !== "ot") cells += "<td>" + list(s.takers.extras, function (x) { return extraHtml(x, listed); }, "No extra body of this rank group.") + "</td>";
      if (ui.show !== "extras") cells += "<td>" + list(s.takers.ot, otHtml, "Nobody who can take it marked Want OT.") + "</td>";
      return "<tr><td>" + esc(s.slot.title) + ' <span class="hint">' + esc(s.slot.pos) + "</span>" + q +
        (s.need.places.length && notLoaded ? '<p class="hint">Licenses aren\'t loaded yet, so qualifications aren\'t checked.</p>' : "") +
        "</td><td>" + why(s.row) + "</td>" + cells + "</tr>";
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
      var days_ = days(), shown = 0;
      var head = "<th>Seat</th><th>Why open</th>" + (ui.show !== "ot" ? "<th>Extra bodies (no OT)</th>" : "") +
        (ui.show !== "extras" ? "<th>Want OT, fewest hours first</th>" : "");
      var body = days_.map(function (d) {
        var dp = dayPlan(d, base);
        shown += dp.plan.length;
        if (!dp.plan.length) return "";
        var multi = Object.keys(dp.listed).some(function (k) { return dp.listed[k] > 1; });
        return '<div class="card"><h3>' + esc(api.longDate(d)) + "</h3>" +
          (multi && ui.show !== "ot" ? '<p class="hint">Some extra bodies are listed for more than one seat: each can fill only one, and an apparatus can give up only its surplus (+N).</p>' : "") +
          dp.plan.map(function (a) {
            return '<h4 class="fill-co">' + esc(a.r.co) + ' <span class="hint">' + a.r.working + " working · " + a.r.required + " required · short " + a.r.open + "</span></h4>" +
              '<div class="table-wrap"><table class="list fill-t"><thead><tr>' + head + "</tr></thead><tbody>" +
              a.seats.map(function (s) { return seatHtml(s, dp.listed, notLoaded); }).join("") + "</tbody></table></div>";
          }).join("") + "</div>";
      }).join("");
      var opts = function (pairs, cur) {
        return pairs.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (cur === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("");
      };
      box.innerHTML =
        '<div class="card"><h2>Fill open spots</h2>' +
        '<p class="hint">Apparatus under required staffing and the seats left without their person. Who can fill one, in the seat\'s rank group: ' +
        "first <b>extra bodies</b> working that day on an apparatus above its required staffing (no overtime), then people who marked " +
        "<b>Want OT</b>, off and with no leave, fewest Worked OT hours this year first. Specialty seats (Haz-Mat, Rescue Squads, Surf Rescue, " +
        "Stations 16, 35 and 51) also need the certs in Attachment B. View only: record a cover from the person's page.</p>" +
        '<div class="row fill-filters"><label>From <input type="date" id="fill-from" value="' + esc(ui.from) + '"></label>' +
        '<label>To <input type="date" id="fill-to" value="' + esc(ui.to) + '"></label>' +
        '<select id="fill-bt" aria-label="Battalion">' + opts([["", "All battalions"]].concat(battalions().map(function (b) { return [b.id, b.name || b.id]; })), ui.bt) + "</select>" +
        '<select id="fill-rank" aria-label="Rank">' + opts([["", "All ranks"]].concat(api.RANKS.map(function (r) { return [r, r]; })), ui.rank) + "</select>" +
        '<select id="fill-show" aria-label="Who to list">' + opts(Object.keys(SHOW_LABEL).map(function (k) { return [k, SHOW_LABEL[k]]; }), ui.show) + "</select></div>" +
        (days_.length >= MAX_DAYS && api.iso(days_[days_.length - 1]) < ui.to ? '<p class="hint">Showing the first ' + MAX_DAYS + " days.</p>" : "") +
        "</div>" + (shown ? body : '<p class="empty">No open spots on ' + (days_.length > 1 ? "these days" : "this day") + ".</p>");
      $("fill-from").onchange = function () { ui.from = this.value || ui.from; render(); };
      $("fill-to").onchange = function () { ui.to = this.value || ui.to; render(); };
      $("fill-bt").onchange = function () { ui.bt = this.value; render(); };
      $("fill-rank").onchange = function () { ui.rank = this.value; render(); };
      $("fill-show").onchange = function () { ui.show = this.value; render(); };
    }
    return { render: render };
  };
})(typeof window !== "undefined" ? window : globalThis);
