/* Overtime days on your own calendar: Want OT (days you'd take) and Worked OT (hired, with hours and a note).
 * window.OvertimeViews(api) -> {canMark, marksFor, calClass, label, dayHtml, wireDay, summary}. `api` comes from app.js.
 * - Marked from the day drawer on your own Schedule page, on a day you aren't scheduled to work. Want OT is for today
 *   on; Worked OT for any day.
 * - Private: only the member and admins read it (page rules `overtime` / `overtime/{self}`, Firestore `overtime/{uid}`).
 *   One record per member, overtime/<user id> = {pos, name, days: {<date>: {kind: "want" | "worked", hours, note}}};
 *   the calendar finds a person's marks by `pos`, so admins see them on that person's page.
 * - Later: admins use Want OT days to fill shortages.
 */
(function (root) {
  "use strict";

  root.OvertimeViews = function (api) {
    var $ = api.$, esc = api.esc;
    var HOURS = 24;

    function backend() { return api.backend(); }
    function canMark(p) {
      var b = backend();
      return !!(b && b.setOvertime && (!b.canOvertime || b.canOvertime()) && p && api.myPos() === p.pos);
    }
    // Every mark for a seat, by date (one member's record, or several after a seat changed hands).
    function marksFor(pos) {
      var out = {};
      (api.recs().overtime || []).forEach(function (r) {
        if (r.pos !== pos) return;
        Object.keys(r.days || {}).forEach(function (k) { if (r.days[k] && r.days[k].kind) out[k] = r.days[k]; });
      });
      return out;
    }
    function calClass(marks, dIso) {
      var m = marks[dIso];
      return !m ? "" : m.kind === "worked" ? " ot-worked" : " ot-want";
    }
    function label(m) { return m.kind === "worked" ? "Worked OT · " + (m.hours || HOURS) + " hrs" : "Want OT"; }

    // The drawer section for one day: shown on your own page for a day off (or one already marked).
    function dayHtml(p, dIso, offDay) {
      var cur = marksFor(p.pos)[dIso];
      if (!canMark(p) || (!offDay && !cur)) return "";
      var past = dIso < api.iso(api.today()), kind = cur ? cur.kind : past ? "worked" : "want";
      return '<div class="day-leave day-ot" id="day-ot"><span class="k">Overtime</span>' +
        (cur ? '<span class="ot-now">' + esc(label(cur)) + (cur.note ? " · " + esc(cur.note) : "") + "</span>" : "") +
        '<div class="seg" role="group" aria-label="Overtime">' +
        (past ? "" : '<button type="button" class="btn small' + (kind === "want" ? " primary" : "") + '" data-ot-kind="want" aria-pressed="' + (kind === "want") + '">Want OT</button>') +
        '<button type="button" class="btn small' + (kind === "worked" ? " primary" : "") + '" data-ot-kind="worked" aria-pressed="' + (kind === "worked") + '">Worked OT</button></div>' +
        '<label class="ot-hours"' + (kind === "worked" ? "" : " hidden") + '>Hours <input type="number" id="ot-hours" min="1" max="48" step="0.5" value="' +
        esc(String(cur && cur.hours || HOURS)) + '"></label>' +
        '<label class="ot-note">Note <input type="text" id="ot-note" maxlength="200" placeholder="Optional" value="' + esc(cur && cur.note || "") + '"></label>' +
        '<div class="row"><button type="button" class="btn small primary" id="ot-save">' + (cur ? "Save" : "Mark") + "</button>" +
        (cur ? '<button type="button" class="btn small" id="ot-remove">Remove</button>' : "") +
        '<span class="msg" id="ot-msg" role="status"></span></div>' +
        '<p class="hint">Only you and admins see this.</p></div>';
    }
    function wireDay(p, dIso, done) {
      var box = $("day-ot");
      if (!box) return;
      var kind = (box.querySelector("[data-ot-kind].primary") || {}).dataset;
      kind = kind ? kind.otKind : "worked";
      box.querySelectorAll("[data-ot-kind]").forEach(function (b) {
        b.onclick = function () {
          kind = b.dataset.otKind;
          box.querySelectorAll("[data-ot-kind]").forEach(function (x) {
            var on = x === b;
            x.classList.toggle("primary", on);
            x.setAttribute("aria-pressed", on);
          });
          box.querySelector(".ot-hours").hidden = kind !== "worked";
        };
      });
      var msg = $("ot-msg");
      var save = function (mark) {
        api.say(msg, "Saving…");
        backend().setOvertime(dIso, mark).then(done, function (er) { api.say(msg, er.message, true); });
      };
      $("ot-save").onclick = function () {
        var note = $("ot-note").value.trim().slice(0, 200), mark = { kind: kind, note: note || null };
        if (kind === "worked") {
          var h = Number($("ot-hours").value);
          if (!(h > 0 && h <= 48)) return api.say(msg, "Hours from 1 to 48.", true);
          mark.hours = h;
        }
        save(mark);
      };
      if ($("ot-remove")) $("ot-remove").onclick = function () { save(null); };
    }

    // The month's totals under the calendar: "OT: 2 days, 48 hrs this month · 3 wanted".
    function summary(marks, month) {
      var pre = month.getFullYear() + "-" + ("0" + (month.getMonth() + 1)).slice(-2) + "-", days = 0, hrs = 0, want = 0;
      Object.keys(marks).forEach(function (k) {
        if (k.indexOf(pre) !== 0) return;
        if (marks[k].kind === "worked") { days++; hrs += Number(marks[k].hours) || HOURS; } else want++;
      });
      if (!days && !want) return "";
      var parts = [];
      if (days) parts.push(days + (days === 1 ? " day, " : " days, ") + hrs + " hrs this month");
      if (want) parts.push(want + " wanted");
      return '<p class="hint ot-sum">OT: ' + esc(parts.join(" · ")) + "</p>";
    }

    return { canMark: canMark, marksFor: marksFor, calClass: calClass, label: label, dayHtml: dayHtml, wireDay: wireDay, summary: summary };
  };
})(typeof window !== "undefined" ? window : globalThis);
