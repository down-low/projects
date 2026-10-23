/* Overtime days on a person's calendar: Want OT (days they'd take) and Worked OT (hired, with hours and a note).
 * window.OvertimeViews(api) -> {canMark, marksFor, calClass, label, dayHtml, wireDay, summary}. `api` comes from app.js.
 * - Marked from the day drawer on your own Schedule page, on a day you aren't scheduled to work; admins mark anyone's.
 *   Want OT is for today on; Worked OT for any day.
 * - Everyone signed in sees the marks; the note only the member and admins (store.js writeOvertime: `overtime` and
 *   `overtimeNotes`). The calendar finds a person's marks by `pos`.
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
      return !!(b && b.setOvertime && p && b.canOvertimeFor && b.canOvertimeFor(p.pos));
    }
    function isAdmin() { var b = backend(); return !!(b && b.canEdit && b.canEdit()); }
    // Every mark for a seat, by date, with the record it's in (`doc`) and its note when this account may read it.
    function marksFor(pos) {
      var out = {}, notes = {};
      (api.recs().overtimeNotes || []).forEach(function (r) { notes[r.id] = r.notes || {}; });
      (api.recs().overtime || []).forEach(function (r) {
        if (r.pos !== pos) return;
        Object.keys(r.days || {}).forEach(function (k) {
          var m = r.days[k];
          if (m && m.kind) out[k] = { kind: m.kind, hours: m.hours, note: (notes[r.id] || {})[k] || null, doc: r.id };
        });
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
      var b = backend(), mine = api.myPos() === p.pos;
      var now = cur ? '<span class="ot-now">' + esc(label(cur)) + (cur.note ? " · " + esc(cur.note) : "") + "</span>" : "";
      // An admin's mark on your own seat (seat-<pos>) stays as they entered it.
      if (cur && mine && !isAdmin() && b.userId && cur.doc !== b.userId()) {
        return '<div class="day-leave day-ot" id="day-ot"><span class="k">Overtime</span>' + now + '<p class="hint">Entered by an admin; ask one to change it.</p></div>';
      }
      return '<div class="day-leave day-ot" id="day-ot"><span class="k">Overtime' + (mine ? "" : " · for " + esc(p.name)) + "</span>" + now +
        '<div class="seg" role="group" aria-label="Overtime">' +
        (past ? "" : '<button type="button" class="btn small' + (kind === "want" ? " primary" : "") + '" data-ot-kind="want" aria-pressed="' + (kind === "want") + '">Want OT</button>') +
        '<button type="button" class="btn small' + (kind === "worked" ? " primary" : "") + '" data-ot-kind="worked" aria-pressed="' + (kind === "worked") + '">Worked OT</button></div>' +
        '<label class="ot-hours"' + (kind === "worked" ? "" : " hidden") + '>Hours <input type="number" id="ot-hours" min="1" max="48" step="0.5" value="' +
        esc(String(cur && cur.hours || HOURS)) + '"></label>' +
        '<label class="ot-note">Note <input type="text" id="ot-note" maxlength="200" placeholder="Optional" value="' + esc(cur && cur.note || "") + '"></label>' +
        '<div class="row"><button type="button" class="btn small primary" id="ot-save">' + (cur ? "Save" : "Mark") + "</button>" +
        (cur ? '<button type="button" class="btn small" id="ot-remove">Remove</button>' : "") +
        '<span class="msg" id="ot-msg" role="status"></span></div>' +
        '<p class="hint">Everyone sees the mark; only ' + (mine ? "you" : esc(p.name)) + " and admins see the note.</p></div>";
    }
    function wireDay(p, dIso, done) {
      var box = $("day-ot");
      if (!box || !$("ot-save")) return;
      var cur = marksFor(p.pos)[dIso];
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
        backend().setOvertime(p.pos, p.name, dIso, mark, cur ? cur.doc : null).then(done, function (er) { api.say(msg, er.message, true); });
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
