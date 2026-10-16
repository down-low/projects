/* The 2027 Vacancy Awards (26 A-082): review and apply each award as a dated move.
 *
 * AwardPlan.plan(awards, ctx) works out every award (also used from Node to check the numbers):
 *   ctx: {data: roster positions, added: added people ({pos: "person:<id>", name, rank, company, emplId}),
 *         ids: EMPLOYEE_IDS.ids (position -> {id}), opts: {statuses, changes, covers, byPos}}
 *   Result rows: {award, person|null, candidates, date, status, notes[], ends: [cover], addRank}
 *   status: "ready" | "check" | "loaded" (already recorded) | "nomove" (already holds the seat, or a starred
 *   replacement works the seat on paper) .
 * A move is a cover from the effective date onward (as the 2027 transfer-list import): the awardee works the awarded
 * seat's tour and company, and their old seat shows them away. Open-ended covers elsewhere end the day before.
 * window.AwardViews(api) -> {render} draws the admin screen (editors).
 */
(function (root) {
  "use strict";
  var M = root.TourMath;
  var START = "2027-01-16"; // the 2027 vacancy-list year starts; moves take effect on the new tour's first day from here
  var TAG = "2027 award (26 A-082)"; // in every record the import writes, so they can be found and removed together
  var RANK_OF_CLASS = { 2: "Firefighter", 3: "FF/Paramedic", 10: "ISS", 20: "Lieutenant", 30: "Captain", 33: "Rescue Captain", 40: "Battalion Chief" };

  function iso(d) { return M.isoDate(d); }
  function fromIso(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = fromIso(s); return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); }
  // "Pereira,Joshua M" and the roster's "Pereira,J" both become "pereira,j".
  function nameKey(n) {
    var parts = String(n || "").split(",");
    return parts[0].trim().toLowerCase().replace(/\s+/g, " ") + "," + (parts[1] || "").trim().charAt(0).toLowerCase();
  }
  // First day on or after START that position p's tour works.
  function firstDay(p, changes) {
    for (var k = 0; k < 40; k++) {
      var s = addDays(START, k), d = fromIso(s);
      if (M.tourWorks(M.effectiveTour(p, d, changes), M.watchFor(d))) return s;
    }
    return START;
  }

  function plan(awards, ctx) {
    var people = ctx.data.filter(function (p) { return p.name; }).concat(ctx.added || []);
    var byId = {}, byName = {};
    Object.keys(ctx.ids || {}).forEach(function (pos) { var p = ctx.opts.byPos[pos]; if (p && p.name) byId[ctx.ids[pos].id] = p; });
    people.forEach(function (p) {
      if (p.emplId && !byId[p.emplId]) byId[p.emplId] = p;
      (byName[nameKey(p.name)] = byName[nameKey(p.name)] || []).push(p);
    });
    var covers = ctx.opts.covers || [], statuses = ctx.opts.statuses || [];
    // A position listed twice: the starred row is the person who works it.
    var starred = {};
    awards.forEach(function (a) { if (a.starred) starred[a.pos] = true; });
    var rows = awards.map(function (a) {
      var target = ctx.opts.byPos[a.pos];
      var row = { award: a, person: null, candidates: [], date: target ? firstDay(target, ctx.opts.changes) : START, status: "ready", notes: [], ends: [] };
      var cands = byName[nameKey(a.name)] || [];
      row.person = byId[a.emplId] || null;
      if (!row.person) {
        var here = cands.filter(function (p) { return a.from && (p.company === a.from || Organization.apparatus(p.title) === a.from); });
        if (here.length === 1) row.person = here[0];
        else if (cands.length === 1) row.person = cands[0];
        else if (cands.length > 1) { row.candidates = cands; row.status = "check"; row.notes.push(cands.length + " people named " + a.name.split(",")[0] + "; pick one"); }
      }
      if (!target) { row.status = "check"; row.notes.push("Position " + a.pos + " isn't on the vacancy list"); return row; }
      if (!a.starred && starred[a.pos]) {
        row.status = "nomove";
        row.notes.push("Awarded on paper; the starred replacement works the seat");
        return row;
      }
      if (!row.person && !row.candidates.length) {
        row.addRank = RANK_OF_CLASS[a.hclass] || target.rank;
        row.notes.push("Not on the roster; will be added as " + row.addRank);
        return row;
      }
      if (!row.person) return row;
      var key = row.person.pos;
      if (covers.some(function (c) { return c.coverKey === key && c.targetPos === a.pos && (!c.end || c.end >= START); })) {
        row.status = "loaded";
        return row;
      }
      // A 2027 move from the transfer list (10/15/2026, newer than the awards) to another seat wins.
      var later = covers.filter(function (c) { return c.coverKey === key && c.targetPos !== a.pos && c.start >= "2027-01-01"; })[0];
      if (later) {
        row.status = "check";
        row.locked = true;
        row.notes.push("Transfer list (newer) moves them to " + later.targetPos + " from " + later.start + "; award not applied. If the award is right, change it on their page");
        return row;
      }
      if (key === a.pos) {
        row.status = "nomove";
        row.notes.push("Already holds this seat");
      }
      // Covers elsewhere that would still run on the effective date end the day before.
      row.ends = covers.filter(function (c) {
        return c.coverKey === key && c.targetPos !== a.pos && c.start < row.date && (!c.end || c.end >= row.date) && !c.tradeId;
      });
      if (row.ends.length) {
        if (row.status === "nomove") row.status = "ready";
        row.notes.push("Ends " + row.ends.map(function (c) { return "cover on " + c.targetPos; }).join(", ") + " on " + addDays(row.date, -1));
      }
      if (row.status === "nomove") return row;
      var open = statuses.filter(function (s) { return s.pos === key && s.start < row.date && !s.end && !s.tradeId; })[0];
      if (open) { row.status = "check"; row.notes.push("Open-ended " + open.code + " since " + open.start + " stays on"); }
      return row;
    });
    // Second pass: someone else covering the awarded seat on the date, unless their own award move ends that cover.
    var ending = {};
    rows.forEach(function (r) { if (r.status === "ready" || r.status === "check") r.ends.forEach(function (c) { ending[c.id] = true; }); });
    rows.forEach(function (r) {
      if ((r.status !== "ready" && r.status !== "check") || !r.person || r.locked) return;
      var key = r.person.pos, pos = r.award.pos;
      var other = covers.filter(function (c) {
        return c.targetPos === pos && c.coverKey !== key && !ending[c.id] && (!c.end || c.end >= r.date) && c.start <= r.date;
      })[0];
      if (other) { r.status = "check"; r.notes.push("Seat also covered by " + (other.coverName || other.coverKey) + " from " + other.start); }
    });
    return rows;
  }

  root.AwardPlan = { plan: plan, START: START, TAG: TAG, nameKey: nameKey, firstDay: firstDay };
  if (typeof module !== "undefined" && module.exports) module.exports = root.AwardPlan;

  /* ---------- Admin screen ---------- */
  root.AwardViews = function (api) {
    var $ = api.$, esc = api.esc;
    var ui = { filter: "todo", picks: {}, dates: {}, include: {}, busy: false, msg: "" };

    function rowsNow() {
      var data = root.AWARDS_2027;
      if (!data) return null;
      var byPos = api.byPos(), recs = api.recs();
      var added = api.people().filter(function (p) { return p.added; });
      var rows = plan(data.awards, { data: api.data(), added: added, ids: (root.EMPLOYEE_IDS || {}).ids,
        opts: { statuses: recs.statuses, changes: recs.tourChanges, covers: recs.covers, byPos: byPos } });
      rows.forEach(function (r, i) {
        r.i = i;
        if (ui.picks[i] && byPos[ui.picks[i]]) {
          r.person = byPos[ui.picks[i]];
          r.notes = r.notes.filter(function (n) { return n.indexOf("pick one") === -1; });
          if (!r.notes.length) r.status = "ready";
        }
        if (ui.dates[i]) r.date = ui.dates[i];
        if (r.status === "check" && ui.include[i] && r.person && !r.locked) r.status = "ready";
      });
      return rows;
    }

    function render() {
      var out = $("awards-detail");
      var b = api.backend();
      if (!b || !b.canEdit()) { out.innerHTML = '<div class="empty">Only editors can apply the vacancy awards.</div>'; return; }
      var rows = rowsNow();
      if (!rows) { out.innerHTML = '<div class="empty">The awards list isn\'t in this build.</div>'; return; }
      var n = { ready: 0, check: 0, loaded: 0, nomove: 0 };
      rows.forEach(function (r) { n[r.status]++; });
      var shown = rows.filter(function (r) {
        return ui.filter === "all" || (ui.filter === "todo" ? r.status === "ready" || r.status === "check" : r.status === ui.filter);
      });
      var groups = {};
      shown.forEach(function (r) {
        var t = api.byPos()[r.award.pos], rank = t ? t.rank : "Other";
        (groups[rank] = groups[rank] || []).push(r);
      });
      var applied = api.recs().covers.filter(function (c) { return String(c.note || "").indexOf(TAG) === 0; }).length;
      out.innerHTML = '<div class="card awards-head"><h3>2027 vacancy awards</h3>' +
        '<p class="hint">' + esc(root.AWARDS_2027.source) + ", " + esc(root.AWARDS_2027.reportDate || "") + ". Each move starts on the first day of the new " +
        "seat's tour on or after Jan 16, 2027; the old spot ends the day before.</p>" +
        '<div class="aw-tiles">' + [["ready", "Ready"], ["check", "Check"], ["loaded", "Recorded"], ["nomove", "No move"]].map(function (x) {
          return '<button type="button" class="aw-tile' + (ui.filter === x[0] ? " on" : "") + '" data-aw-filter="' + x[0] + '"><b>' + n[x[0]] + "</b>" + x[1] + "</button>";
        }).join("") + "</div>" +
        '<div class="row aw-acts"><button class="btn primary" id="aw-apply"' + (n.ready && !ui.busy ? "" : " disabled") + ">Apply " + n.ready + " ready moves</button>" +
        '<button class="btn small" data-aw-filter="' + (ui.filter === "all" ? "todo" : "all") + '">' + (ui.filter === "all" ? "Show to do" : "Show all " + rows.length) + "</button>" +
        (applied ? '<button class="btn small" id="aw-undo"' + (ui.busy ? " disabled" : "") + ">Remove award moves</button>" : "") +
        '<span class="msg" id="aw-msg" role="status">' + esc(ui.msg) + "</span></div></div>" +
        (shown.length ? api.RANKS.concat(["Other"]).filter(function (k) { return groups[k]; }).map(function (k) {
          return '<details class="card fold aw-group" open><summary><h3>' + esc(k) + '</h3><span class="fold-sum">' + groups[k].length + "</span></summary>" +
            '<ul class="aw-list">' + groups[k].map(rowHtml).join("") + "</ul></details>";
        }).join("") : '<div class="empty">Nothing here.</div>');
      wire(rows);
    }

    function rowHtml(r) {
      var a = r.award, p = r.person, t = api.byPos()[a.pos];
      var from = p ? (p.added ? (p.company || "added") : p.title + " " + p.pos) : (a.from || "?") + " (not on the roster)";
      var pick = r.candidates.length && !p ? '<select data-aw-pick="' + r.i + '"><option value="">Pick the right person…</option>' + r.candidates.map(function (c) {
        return '<option value="' + esc(c.pos) + '">' + esc(c.name + " · " + c.title + (c.emplId ? " · " + c.emplId : "")) + "</option>";
      }).join("") + "</select>" : "";
      var editable = r.status === "ready" || r.status === "check";
      return '<li class="aw-' + r.status + '"><div class="aw-main"><div><b>' + esc(p ? p.name : a.name) + '</b> <span class="hint">' + esc(a.emplId) + "</span></div>" +
        '<div class="aw-move">' + esc(from) + " → " + esc(t ? t.title : a.pos) + ' <span class="hint">' + esc(a.pos) + (t ? " · T" + t.tour : "") + "</span></div>" +
        (r.notes.length ? '<div class="aw-notes">' + r.notes.map(esc).join(" · ") + "</div>" : "") + pick + "</div>" +
        '<div class="aw-side">' + (editable ? '<input type="date" data-aw-date="' + r.i + '" value="' + esc(r.date) + '" aria-label="Effective date">'
          : '<span class="hint">' + esc(r.date) + "</span>") +
        '<span class="tag aw-st">' + { ready: "Ready", check: "Check", loaded: "Recorded", nomove: "No move" }[r.status] + "</span>" +
        (r.status === "check" && p && !r.locked ? '<label class="chk"><input type="checkbox" data-aw-inc="' + r.i + '"' + (ui.include[r.i] ? " checked" : "") + "> Apply anyway</label>" : "") +
        "</div></li>";
    }

    function wire(rows) {
      var out = $("awards-detail");
      out.querySelectorAll("[data-aw-filter]").forEach(function (b) { b.onclick = function () { ui.filter = b.dataset.awFilter; render(); }; });
      out.querySelectorAll("[data-aw-pick]").forEach(function (s) { s.onchange = function () { ui.picks[s.dataset.awPick] = s.value; render(); }; });
      out.querySelectorAll("[data-aw-date]").forEach(function (s) { s.onchange = function () { if (s.value) { ui.dates[s.dataset.awDate] = s.value; render(); } }; });
      out.querySelectorAll("[data-aw-inc]").forEach(function (s) { s.onchange = function () { ui.include[s.dataset.awInc] = s.checked; render(); }; });
      if ($("aw-apply")) $("aw-apply").onclick = function () { apply(rows.filter(function (r) { return r.status === "ready"; })); };
      if ($("aw-undo")) $("aw-undo").onclick = function () {
        var b = this;
        if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Confirm: remove all award moves"; b.classList.add("danger"); return; }
        undo();
      };
    }

    // One write at a time, so the page database and the server see a steady stream; progress shows as it goes.
    function apply(ready) {
      var backend = api.backend(), done = 0;
      ui.busy = true;
      function say(t) { ui.msg = t; var m = $("aw-msg"); if (m) m.textContent = t; }
      var steps = ready.map(function (r) {
        return function () {
          var a = r.award, p = r.person;
          var who = p ? Promise.resolve(p.pos)
            : backend.addPerson({ name: shortName(a.name), rank: r.addRank, company: null, tour: null, emplId: a.emplId, note: a.name + " · " + TAG })
              .then(function (res) { return "person:" + res.id; });
          return who.then(function (key) {
            var ends = r.ends.reduce(function (q, c) { return q.then(function () { return backend.endCover(c.id, addDays(r.date, -1)); }); }, Promise.resolve());
            return ends.then(function () {
              // `ended` keeps the covers this move cut short, so Remove can put their end dates back.
              return backend.addCover({ coverKey: key, coverName: p ? p.name : shortName(a.name), targetPos: a.pos, start: r.date, end: null,
                note: TAG + " · ID " + a.emplId + (a.from ? " · from " + a.from : ""),
                ended: r.ends.map(function (c) { return { id: c.id, end: c.end || null }; }) });
            });
          }).then(function () { done++; say("Applied " + done + " of " + ready.length + "…"); });
        };
      });
      steps.reduce(function (q, f) { return q.then(f); }, Promise.resolve()).then(function () {
        ui.busy = false;
        say("Applied " + done + " moves.");
        api.renderAll(true);
      }, function (e) {
        ui.busy = false;
        say("Stopped after " + done + ": " + e.message + " Apply again to continue; recorded moves are skipped.");
        api.renderAll(true);
      });
    }
    function undo() {
      var backend = api.backend(), recs = api.recs(), n = 0;
      ui.busy = true;
      var covers = recs.covers.filter(function (c) { return String(c.note || "").indexOf(TAG) === 0; });
      var people = (recs.people || []).filter(function (x) { return String(x.note || "").indexOf(TAG) !== -1; });
      // Put back the end dates of covers the moves cut short (open-ended ones need the page database; the server keeps a date).
      var restore = [];
      covers.forEach(function (c) { (c.ended || []).forEach(function (e) { restore.push(e); }); });
      var steps = restore.filter(function (e) { return e.end || backend.mode === "db"; })
        .map(function (e) { return function () { return backend.endCover(e.id, e.end); }; })
        .concat(covers.map(function (c) { return function () { n++; return backend.remove("covers", c.id); }; }))
        .concat(people.map(function (x) { return function () { n++; return backend.remove("people", x.id); }; }));
      steps.reduce(function (q, f) { return q.then(f); }, Promise.resolve()).then(function () {
        ui.busy = false; ui.msg = "Removed " + n + " records."; api.renderAll(true);
      }, function (e) { ui.busy = false; ui.msg = e.message; api.renderAll(true); });
    }
    // "Pereira,Joshua M" -> "Pereira,J", the roster's style.
    function shortName(n) { var p = n.split(","); return p[0].trim() + (p[1] ? "," + p[1].trim().charAt(0) : ""); }

    return { render: render };
  };
})(typeof window !== "undefined" ? window : globalThis);
