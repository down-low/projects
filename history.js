/* Change history (admins, admin site only; a stub in the employee app): every add, edit and delete to a schedule record,
 * with who did it, when, and the version before and after (changeLog, written only by the log<Collection> triggers;
 * firebase/functions/changelog.js). Filter by date, record type, editor and person; Restore puts back the version a
 * change replaced or deleted (function restoreChange, itself logged as a restore). Contact fields are never logged.
 * window.HistoryViews(api) -> {render}. `api` comes from app.js.
 */
(function (root) {
  "use strict";
  var TYPES = { statuses: "Leave / status", tourChanges: "Tour change", covers: "Cover / move", people: "Added person",
    staffing: "Required staffing", assignments: "Move log", rosterOverrides: "Roster override", trades: "Trade",
    tradeReplies: "Trade answer", overtime: "Overtime marks", profiles: "Profile" };
  var ACTION = { add: "Added", edit: "Edited", "delete": "Deleted", restore: "Restored" };
  var HIDE = ["createdAt", "createdBy", "updatedAt", "updatedBy", "restoredAt", "restoredBy", "restoredFrom"];

  root.HistoryViews = function (api) {
    var $ = api.$, esc = api.esc;
    var ui = { from: null, to: null, type: "", editor: "", person: "", rows: null, loading: false, msg: "", err: false, open: {} };

    function backend() { return api.backend(); }
    function dayIso(d) { return api.iso(d); }
    // Local calendar days to UTC instants: [from 00:00, the day after `to` 00:00).
    function bounds() {
      var a = api.fromIso(ui.from), b = api.addDays(api.fromIso(ui.to), 1);
      return [a.toISOString(), b.toISOString()];
    }
    function load() {
      ui.loading = true; ui.rows = null; render();
      var b = bounds();
      backend().changeLog(b[0], b[1]).then(function (rows) {
        ui.rows = rows; ui.loading = false; render();
      }, function (e) { ui.loading = false; ui.rows = []; ui.msg = e.message; ui.err = true; render(); });
    }
    function who(key) {
      var p = api.byPos()[key];
      return p ? (p.name || "vacant") + " · " + (p.company || p.title || key) : key;
    }
    function editorName(r) { return r.actorName || (r.actor === "system" ? "The app (automatic)" : r.actor === "unknown" ? "Unknown" : "Account " + String(r.actor).slice(0, 6)); }
    function when(isoStr) {
      var d = new Date(isoStr);
      return isNaN(d) ? esc(isoStr) : esc(api.shortDate(d) + " " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    }
    function val(v) {
      if (v == null || v === "") return "—";
      var s = typeof v === "object" ? JSON.stringify(v) : String(v);
      return s.length > 90 ? s.slice(0, 87) + "…" : s;
    }
    // The fields that changed (an edit), or the record's fields (an add or delete), without bookkeeping.
    function fields(r) {
      var b = r.before || {}, a = r.after || {}, keys = {};
      Object.keys(b).concat(Object.keys(a)).forEach(function (k) { if (HIDE.indexOf(k) === -1) keys[k] = 1; });
      return Object.keys(keys).sort().filter(function (k) {
        return !(r.before && r.after) || JSON.stringify(b[k]) !== JSON.stringify(a[k]);
      }).map(function (k) {
        if (r.before && r.after) return "<li><b>" + esc(k) + "</b>: " + esc(val(b[k])) + " → " + esc(val(a[k])) + "</li>";
        return "<li><b>" + esc(k) + "</b>: " + esc(val((r.after || r.before)[k])) + "</li>";
      }).join("");
    }
    function matches(r) {
      if (ui.type && r.collection !== ui.type) return false;
      if (ui.editor && r.actor !== ui.editor) return false;
      if (ui.person) {
        var q = ui.person.toLowerCase();
        var hit = (r.subjects || []).concat([r.docId]).some(function (k) { return (k + " " + who(k)).toLowerCase().indexOf(q) !== -1; });
        if (!hit) return false;
      }
      return true;
    }
    function rowHtml(r) {
      var about = (r.subjects || []).slice(0, 4).map(function (k) { return esc(who(k)); }).join("<br>") || esc(r.docId);
      var open = !!ui.open[r.id];
      return "<tr><td>" + when(r.at) + "</td><td>" + esc(editorName(r)) + "</td><td>" + esc(ACTION[r.action] || r.action) + " · " +
        esc(TYPES[r.collection] || r.collection) + "</td><td>" + about + "</td><td>" +
        '<details class="hist-fields"' + (open ? " open" : "") + ' data-hid="' + esc(r.id) + '"><summary>' +
        (r.before && r.after ? "What changed" : "The record") + '</summary><ul class="hist">' + (fields(r) || "<li>No visible fields</li>") + "</ul></details>" +
        "</td><td>" + (r.before ? '<button class="btn small" data-restore="' + esc(r.id) + '" title="Put back the version from before this change">Restore</button>' : "") +
        "</td></tr>";
    }
    function render() {
      var box = $("history-detail");
      if (!ui.from) { ui.to = dayIso(api.today()); ui.from = dayIso(api.addDays(api.today(), -6)); }
      if (ui.rows == null && !ui.loading && backend() && backend().changeLog) { load(); return; }
      var rows = ui.rows || [], shown = rows.filter(matches);
      var editors = {};
      rows.forEach(function (r) { editors[r.actor] = editorName(r); });
      var typeOpts = '<option value="">All record types</option>' + Object.keys(TYPES).map(function (k) {
        return '<option value="' + k + '"' + (ui.type === k ? " selected" : "") + ">" + esc(TYPES[k]) + "</option>";
      }).join("");
      var edOpts = '<option value="">Everyone</option>' + Object.keys(editors).sort(function (a, b) { return editors[a].localeCompare(editors[b]); }).map(function (k) {
        return '<option value="' + esc(k) + '"' + (ui.editor === k ? " selected" : "") + ">" + esc(editors[k]) + "</option>";
      }).join("");
      box.innerHTML =
        '<div class="card"><h2>Change history</h2>' +
        '<p class="hint">Every add, edit and delete to a schedule record: who did it, when, and the version before and after. ' +
        "Restore puts back the version from before a change (that is logged too). Admins only; nobody can change the history. " +
        "Cell numbers and contact details are never kept here.</p>" +
        '<div class="row hist-filters"><label>From <input type="date" id="hist-from" value="' + esc(ui.from) + '"></label>' +
        '<label>To <input type="date" id="hist-to" value="' + esc(ui.to) + '"></label>' +
        '<select id="hist-type" aria-label="Record type">' + typeOpts + "</select>" +
        '<select id="hist-editor" aria-label="Changed by">' + edOpts + "</select>" +
        '<input type="search" id="hist-person" placeholder="Person or company" value="' + esc(ui.person) + '" aria-label="Person or company"></div>' +
        (ui.msg ? '<p class="' + (ui.err ? "err" : "ok") + '">' + esc(ui.msg) + "</p>" : "") +
        (rows.length >= 1000 ? '<p class="hint">Showing the latest 1,000 changes in these dates; pick fewer days to see the rest.</p>' : "") +
        "</div>" +
        (ui.loading ? '<p class="empty">Loading…</p>' : !shown.length ? '<p class="empty">No changes match.</p>' :
          '<div class="card"><p class="hint">' + shown.length + " change" + (shown.length === 1 ? "" : "s") + '</p><div class="table-wrap"><table class="list hist-t"><thead><tr>' +
          "<th>When</th><th>Changed by</th><th>What</th><th>About</th><th>Details</th><th></th></tr></thead><tbody>" +
          shown.map(rowHtml).join("") + "</tbody></table></div></div>");
      $("hist-from").onchange = function () { if (this.value) { ui.from = this.value; if (ui.to < ui.from) ui.to = ui.from; load(); } };
      $("hist-to").onchange = function () { if (this.value) { ui.to = this.value; if (ui.to < ui.from) ui.from = ui.to; load(); } };
      $("hist-type").onchange = function () { ui.type = this.value; render(); };
      $("hist-editor").onchange = function () { ui.editor = this.value; render(); };
      $("hist-person").oninput = function () {
        ui.person = this.value.trim();
        var pos = this.selectionStart;
        render();
        var el = $("hist-person"); el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) { /* not a text field */ }
      };
      box.querySelectorAll("details[data-hid]").forEach(function (d) { d.ontoggle = function () { ui.open[d.dataset.hid] = d.open; }; });
      box.querySelectorAll("[data-restore]").forEach(function (b) {
        b.onclick = function () {
          var r = rows.filter(function (x) { return x.id === b.dataset.restore; })[0];
          if (!r) return;
          var what = (TYPES[r.collection] || r.collection).toLowerCase();
          if (!root.confirm("Put back the " + what + " record as it was before this change (" + (ACTION[r.action] || r.action).toLowerCase() +
            " by " + editorName(r) + ")? It replaces the record as it is now.")) return;
          b.disabled = true;
          backend().restoreChange(r.id).then(function () {
            ui.msg = "Restored. The restore shows in the history in a moment."; ui.err = false;
            setTimeout(load, 2500); render();
          }, function (e) { ui.msg = e.message; ui.err = true; render(); });
        };
      });
    }
    return { render: render };
  };
})(typeof window !== "undefined" ? window : globalThis);
