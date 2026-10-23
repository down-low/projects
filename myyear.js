/* "My year": this year so far on your own page (editors and admins see it on anyone's): shifts worked, leave by code,
 * holidays worked, overtime and shift trades, with owed shifts as a balance.
 * window.MyYearViews(api) -> {html(p)}. `api` comes from app.js.
 * Everything is counted from records the page already has (TourMath.dayFor, overtime marks, set trades); nothing is
 * stored. Days run from Jan 1 to today.
 */
(function (root) {
  "use strict";
  var M = root.TourMath;
  var LEAVE = ["VA", "S", "D", "WE", "TR"];

  root.MyYearViews = function (api) {
    var esc = api.esc;

    function canSee(p) {
      var b = api.backend();
      return !!p && !p.added && (api.myPos() === p.pos || !!(b && b.canEdit && b.canEdit()));
    }
    function n(x, one, many) { return x + " " + (x === 1 ? one : many); }
    function row(k, v) { return '<div class="kv"><span class="k">' + esc(k) + '</span><span class="v">' + v + "</span></div>"; }

    function html(p) {
      if (!canSee(p)) return "";
      var t = api.today(), y = t.getFullYear(), tIso = api.iso(t), pre = y + "-";
      var worked = 0, acting = 0, leave = {}, holidays = [];
      for (var d = new Date(y, 0, 1); d <= t; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        var s = api.day(p, d);
        if (!s) continue;
        if (s.status) { leave[s.status] = (leave[s.status] || 0) + 1; continue; }
        worked++;
        if (s.acting) acting++;
        var h = M.holidayFor(d);
        if (h && h.kind !== "observance") holidays.push(h.name);
      }
      var ot = api.overtime(p.pos), otDays = 0, otHrs = 0, otWant = 0;
      Object.keys(ot).forEach(function (k) {
        if (k.indexOf(pre) !== 0) return;
        if (ot[k].kind === "worked") { if (k <= tIso) { otDays++; otHrs += Number(ot[k].hours) || 24; } }
        else if (k >= tIso) otWant++;
      });
      var tr = api.trades(p.pos, y);

      var leaveText = LEAVE.filter(function (c) { return leave[c]; }).map(function (c) {
        return api.statusPill(c) + " " + leave[c];
      }).join(" &nbsp; ");
      var sum = worked + " shifts" + (otDays ? " · " + otDays + " OT" : "") + (tr.owe || tr.owed ? " · " + (tr.owe ? "owes " + tr.owe : "owed " + tr.owed) : "");
      return api.fold("year", '<details class="card fold" data-fold="year"', ">") +
        '<summary><h3>' + y + ' so far</h3><span class="fold-sum">' + esc(sum) + "</span></summary>" +
        '<div class="year-card">' +
        row("Shifts worked", worked + (acting ? ' <span class="hint">(' + acting + " acting or covering)</span>" : "")) +
        row("Shifts on leave", leaveText || '<span class="hint">None</span>') +
        row("Holidays worked", holidays.length ? n(holidays.length, "holiday", "holidays") + ' <span class="hint">' + esc(holidays.join(", ")) + "</span>" : '<span class="hint">None</span>') +
        row("Overtime", (otDays ? n(otDays, "day", "days") + ", " + otHrs + " hrs worked" : "None worked") +
          (otWant ? ' <span class="hint">· ' + n(otWant, "day", "days") + " wanted ahead</span>" : "")) +
        row("Shift trades", (tr.away || tr.forOthers ? n(tr.away, "shift", "shifts") + " traded away · worked " + n(tr.forOthers, "shift", "shifts") + " for others" : '<span class="hint">None</span>')) +
        row("Trade balance", tr.owe || tr.owed
          ? (tr.owe ? "Owes " + n(tr.owe, "shift", "shifts") : "") + (tr.owe && tr.owed ? " · " : "") + (tr.owed ? "Owed " + n(tr.owed, "shift", "shifts") : "")
          : "Even") +
        '<p class="hint">Counted from the schedule records, Jan 1 to today.</p></div></details>';
    }

    return { html: html };
  };
})(typeof window !== "undefined" ? window : globalThis);
