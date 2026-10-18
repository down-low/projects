/* Corrections: members tell admins what's wrong; admins apply it with the usual edit forms.
 * window.CorrectionViews(api) -> {link, open, openVerify, render, prefill, saved, count, afterClaim, summary, apply}. `api` comes from app.js.
 * - "Something wrong?" on any person page opens a short form: wrong seat, leave / working elsewhere, covering / acting /
 *   shadowing, tour, Employee ID, cell number (own page only) or other. It writes a correction; nothing changes until an
 *   admin applies it.
 * - "Verify my info" (after "This is me", and on your own page) lists what the tool has for you, each with Correct / Fix.
 * - Admins see open corrections on the Corrections view. Apply opens the person's page with the matching edit form filled
 *   in; saving it marks the correction applied. Corrections are only readable by admins (page rule `read: admin`).
 */
(function (root) {
  "use strict";
  var M = root.TourMath;

  root.CorrectionViews = function (api) {
    var $ = api.$, esc = api.esc;
    var KINDS = [
      ["seat", "Wrong seat or not working here"],
      ["status", "On leave or working elsewhere"],
      ["cover", "Covering, acting or shadowing"],
      ["tour", "Wrong tour"],
      ["id", "Wrong Employee ID"],
      ["cell", "My cell number"],
      ["other", "Something else"],
    ];
    var ui = { about: null, kind: "seat", sent: {}, verify: false, show: "open", applying: null };

    function backend() { return api.backend(); }
    function byPos() { return api.byPos(); }
    function myKey() { var b = backend(); return b && b.myKey ? b.myKey() : null; }
    function canSuggest() { var b = backend(); return !!(b && b.canSuggest && b.canSuggest()); }
    function isAdmin() { var b = backend(); return !!(b && b.canEdit && b.canEdit()); }
    function list() { return (api.recs().corrections || []).slice().sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }); }
    function nameOf(key) { var p = byPos()[key]; return p ? p.name : key; }
    function seatText(pos) { var p = byPos()[pos]; return p ? (p.name ? p.name + " · " : "") + p.title + " " + (p.added ? "" : pos) : pos; }
    function count() { return list().filter(function (c) { return c.state === "open"; }).length; }
    function todayIso() { return api.iso(api.today()); }

    // ---------- "Something wrong?" link (person page) ----------
    function link(p) {
      if (!canSuggest() || !p) return "";
      var mine = myKey() === p.pos;
      return '<div class="kv fix-kv"><span class="v">' +
        (mine ? '<button type="button" class="btn small" data-verify>Verify my info</button> ' : "") +
        '<button type="button" class="linkish fix-link" data-fix="' + esc(p.pos) + '">Something wrong?</button>' +
        (ui.sent[p.pos] ? ' <span class="hint">Sent, thanks. An admin will review it.</span>' : "") + "</span></div>";
    }
    function wireLinks(scope) {
      (scope || document).querySelectorAll("[data-fix]").forEach(function (b) { b.onclick = function () { open(b.dataset.fix); }; });
      (scope || document).querySelectorAll("[data-verify]").forEach(function (b) { b.onclick = function () { openVerify(); }; });
    }

    // ---------- The form ----------
    function open(key, kind) {
      ui.about = key;
      ui.kind = kind || (myKey() === key ? "seat" : "status");
      ui.verify = false;
      draw();
      $("fix-sheet").hidden = false;
      var f = $("fix-body").querySelector("select, input, textarea");
      if (f) f.focus();
    }
    function close() { $("fix-sheet").hidden = true; ui.verify = false; }
    function kindOptions() {
      var mine = myKey() === ui.about;
      return KINDS.filter(function (k) { return k[0] !== "cell" || mine; }).map(function (k) {
        return '<option value="' + k[0] + '"' + (k[0] === ui.kind ? " selected" : "") + ">" + esc(k[1]) + "</option>";
      }).join("");
    }
    function fieldsHtml(kind) {
      var t = todayIso(), p = byPos()[ui.about] || {};
      var seat = '<label>Where are they?<input type="text" id="fx-seat" list="slot-dl" placeholder="Name, company or position number" autocomplete="off"></label>';
      if (kind === "seat") return seat + '<label>Since (if you know)<input type="date" id="fx-start"></label>';
      if (kind === "status") {
        return '<div class="row"><label>What<select id="fx-code"><option value="D">D · Disability</option><option value="WE">WE · Working elsewhere</option>' +
          '<option value="VA">VA · Vacation</option><option value="S">S · Sick</option></select></label>' +
          '<label>From<input type="date" id="fx-start" value="' + t + '"></label><label>To (optional)<input type="date" id="fx-end"></label></div>';
      }
      if (kind === "cover") {
        return seat.replace("Where are they?", "Which seat?") +
          '<div class="row"><label>Type<select id="fx-ckind"><option value="cover">Covering</option><option value="acting">Acting</option>' +
          '<option value="shadow">Shadowing (LWLP)</option><option value="extra">Also in this seat</option></select></label>' +
          '<label>From<input type="date" id="fx-start" value="' + t + '"></label></div>';
      }
      if (kind === "tour") {
        var cur = api.tourOn(p, api.today());
        return '<div class="row"><label>Right tour<select id="fx-tour">' + Array.apply(null, Array(31)).map(function (_, i) {
          return '<option value="' + (i + 1) + '"' + (i + 1 === cur ? " selected" : "") + ">Tour " + (i + 1) + "</option>";
        }).join("") + '</select></label><label>Since (if you know)<input type="date" id="fx-start"></label></div>';
      }
      if (kind === "id") return '<label>Right Employee ID<input type="text" id="fx-id" maxlength="6" placeholder="e.g. LE1234" autocomplete="off"></label>';
      if (kind === "cell") return '<label>Your cell number<input type="tel" id="fx-cell" maxlength="20" placeholder="(415) 555-0100"></label>' +
        '<p class="hint">Only admins see it. It is used to reach you about trades.</p>';
      return "";
    }
    function draw() {
      var p = byPos()[ui.about] || { name: ui.about };
      $("fix-title").textContent = ui.verify ? "Verify my info" : "Something wrong?";
      if (ui.verify) return drawVerify();
      $("fix-body").innerHTML = '<p><b>' + esc(p.name) + "</b>" + (p.title ? ' <span class="hint">' + esc(p.title) + "</span>" : "") + "</p>" +
        '<form class="edit fix-form" id="fx-form" novalidate><label>What\'s wrong?<select id="fx-kind">' + kindOptions() + "</select></label>" +
        fieldsHtml(ui.kind) +
        '<label>Note' + (ui.kind === "other" ? "" : " (optional)") + '<input type="text" id="fx-note" maxlength="500" placeholder="Anything that helps an admin check it"></label>' +
        '<div class="row"><button class="btn primary" type="submit">Send</button><span class="msg" id="fx-msg" role="status"></span></div>' +
        '<p class="hint">Nothing changes until an admin checks it.</p></form>';
      $("fx-kind").onchange = function () { ui.kind = this.value; draw(); };
      $("fx-form").onsubmit = function (e) { e.preventDefault(); send(); };
    }
    function val(id) { var el = $(id); return el ? el.value.trim() : ""; }
    function send() {
      var msg = $("fx-msg"), d = {}, k = ui.kind;
      if (k === "seat" || k === "cover") {
        d.seat = api.slotFromInput(val("fx-seat"));
        if (!d.seat) return api.say(msg, "Pick the seat from the list.", true);
      }
      if (k === "status") { d.code = val("fx-code"); d.end = val("fx-end") || null; }
      if (k === "cover") d.coverKind = val("fx-ckind");
      if (k === "tour") d.tour = +val("fx-tour");
      if (k === "id") {
        d.emplId = val("fx-id").toUpperCase();
        if (!/^[A-Z]{2}\d{4}$/.test(d.emplId)) return api.say(msg, "An Employee ID is two letters and four numbers.", true);
      }
      if (k === "cell") {
        d.cell = val("fx-cell");
        if (d.cell.replace(/\D/g, "").length < 10) return api.say(msg, "Enter a 10-digit number.", true);
      }
      if ($("fx-start")) d.start = val("fx-start") || null;
      var note = val("fx-note");
      if (k === "other" && !note) return api.say(msg, "Say what's wrong in the note.", true);
      api.say(msg, "Sending…");
      backend().suggest({ aboutKey: ui.about, kind: k, details: d, note: note || null }).then(function () {
        ui.sent[ui.about] = true;
        if (ui.back) { ui.verify = true; ui.back = false; drawVerify(); return; }
        close();
        api.renderAll();
      }, function (er) { api.say(msg, er.message, true); });
    }

    // ---------- Verify my info ----------
    function openVerify(forKey) {
      var key = forKey || myKey();
      if (!key) return;
      ui.about = key;
      ui.verify = true;
      $("fix-title").textContent = "Verify my info";
      drawVerify();
      $("fix-sheet").hidden = false;
    }
    function drawVerify() {
      var p = byPos()[ui.about];
      if (!p) return close();
      var t = api.today(), s = api.day(p, t), st = api.statusFor(p.pos, t);
      var cover = (api.recs().covers || []).filter(function (c) { return c.coverKey === p.pos && c.start <= todayIso() && (!c.end || c.end >= todayIso()) && !M.isMove(c); })[0];
      var rows = [
        ["Name", p.name, "other"],
        ["Employee ID", p.emplId || "Not on file", "id"],
        ["Rank", p.rank, "other"],
        ["Seat", p.added ? "Added, not on the vacancy list" : p.title + " · " + p.pos, "seat"],
        ["Tour", api.tourOn(p, t) ? "Tour " + api.tourOn(p, t) : "None", "tour"],
        ["Right now", cover ? api.kindWord(cover) + " " + seatText(cover.targetPos) : "In my own seat", "cover"],
        ["Leave", st ? st + " · " + (api.STATUS_LABEL[st] || st) : "None", "status"],
        ["Cell number", "Admins only. Add or update it here", "cell"],
      ];
      var m = backend().myMember ? backend().myMember() : null;
      $("fix-body").innerHTML = '<p class="hint">This is what the schedule has for you. Tap <b>Fix</b> on anything that\'s wrong; an admin checks it before it changes.</p>' +
        '<ul class="tlist verify">' + rows.map(function (r) {
          return '<li><div><span class="hint">' + esc(r[0]) + "</span><div>" + esc(r[1]) + '</div></div><button class="btn small" type="button" data-vfix="' + r[2] + '">Fix</button></li>';
        }).join("") + "</ul>" +
        (s && s.acting ? "" : "") +
        '<div class="row"><button class="btn primary" type="button" id="vf-done">Looks right</button><span class="msg" id="vf-msg" role="status"></span></div>' +
        (m && m.verifiedAt ? '<p class="hint">Last checked ' + esc(api.shortDate(new Date(m.verifiedAt))) + ".</p>" : "");
      $("fix-body").querySelectorAll("[data-vfix]").forEach(function (b) {
        b.onclick = function () { ui.verify = false; ui.back = true; ui.kind = b.dataset.vfix; draw(); };
      });
      $("vf-done").onclick = function () {
        api.say($("vf-msg"), "Saving…");
        backend().setVerified().then(function () { close(); api.renderAll(); }, function (er) { api.say($("vf-msg"), er.message, true); });
      };
    }
    // After "This is me": a station or tour that differs from the roster becomes a correction, then Verify opens.
    function afterClaim(p, station, tour) {
      var t = api.today(), off = station !== api.home(p) || tour !== api.tourOn(p, t);
      var done = off && backend().suggest
        ? backend().suggest({ aboutKey: p.pos, kind: "seat", details: { station: station, tour: tour },
          note: 'From "This is me": says ' + station + ", Tour " + tour + "; roster has " + api.home(p) + ", Tour " + (api.tourOn(p, t) || "none") })
          .catch(function () {})
        : Promise.resolve();
      return done.then(function () { openVerify(p.pos); });
    }

    // ---------- Admin list ----------
    function summary(c) {
      var d = c.details || {};
      if (c.kind === "seat") return d.seat ? "Is in " + seatText(d.seat) + (d.start ? " since " + api.shortDate(api.fromIso(d.start)) : "")
        : "Says " + (d.station || "?") + ", Tour " + (d.tour || "?");
      if (c.kind === "status") return d.code + " · " + (api.STATUS_LABEL[d.code] || "") + " from " + (d.start ? api.shortDate(api.fromIso(d.start)) : "?") +
        (d.end ? " to " + api.shortDate(api.fromIso(d.end)) : "");
      if (c.kind === "cover") return (api.KIND[d.coverKind] || api.KIND.cover)[0] + " " + seatText(d.seat) + (d.start ? " from " + api.shortDate(api.fromIso(d.start)) : "");
      if (c.kind === "tour") return "Tour " + d.tour + (d.start ? " since " + api.shortDate(api.fromIso(d.start)) : "");
      if (c.kind === "id") return "Employee ID " + d.emplId;
      if (c.kind === "cell") return "Cell number (hidden until you apply it)";
      return "See note";
    }
    function render() {
      var el = $("fixes-detail");
      if (!isAdmin()) { el.innerHTML = '<div class="empty">Only admins see corrections.</div>'; return; }
      var all = list(), shown = all.filter(function (c) {
        return ui.show === "all" ? true : ui.show === "open" ? c.state === "open" : c.state !== "open";
      });
      var members = api.recs().members || [];
      var verified = members.filter(function (m) { return m.verifiedAt; }).length;
      el.innerHTML = '<div class="card"><h2 class="view-title">Corrections</h2>' +
        '<p class="hint">Sent by members from "Something wrong?" and "Verify my info". Apply opens the person\'s page with the edit form filled in; saving marks it applied.</p>' +
        '<p>' + count() + " open · " + verified + " of " + members.length + " claimed accounts verified</p>" +
        '<div class="seg" role="group" aria-label="Show">' + [["open", "Open"], ["done", "Done"], ["all", "All"]].map(function (s) {
          return '<button class="btn small' + (ui.show === s[0] ? " primary" : "") + '" type="button" data-fshow="' + s[0] + '">' + s[1] + "</button>";
        }).join("") + "</div>" +
        (shown.length ? '<ul class="tlist fixes">' + shown.map(function (c) {
          var who = byPos()[c.aboutKey];
          return '<li><div><b>' + (who ? '<button class="linkish" data-pos="' + esc(c.aboutKey) + '">' + esc(who.name) + "</button>" : esc(c.aboutKey)) + "</b> " +
            '<span class="hint">' + esc(who ? who.title : "") + "</span>" +
            "<div>" + esc(summary(c)) + "</div>" + (c.note ? '<div class="hint">“' + esc(c.note) + "”</div>" : "") +
            '<div class="hint">From ' + esc(c.byName || (c.byKey ? nameOf(c.byKey) : "a member")) + " · " + esc(api.shortDate(new Date(c.createdAt))) +
            (c.state !== "open" ? " · " + esc(c.state) + (c.reason ? ": " + esc(c.reason) : "") : "") + "</div></div>" +
            (c.state === "open" ? '<div class="acts"><button class="btn small primary" data-fapply="' + esc(c.id) + '">Apply</button>' +
              '<button class="btn small" data-fdismiss="' + esc(c.id) + '">Dismiss</button></div>' : "") + "</li>";
        }).join("") + "</ul>" : '<p class="hint">Nothing here.</p>') + '<span class="msg" id="fl-msg" role="status"></span></div>';
      el.querySelectorAll("[data-fshow]").forEach(function (b) { b.onclick = function () { ui.show = b.dataset.fshow; render(); }; });
      el.querySelectorAll("[data-pos]").forEach(function (b) { b.onclick = function () { api.choosePerson(b.dataset.pos); }; });
      el.querySelectorAll("[data-fdismiss]").forEach(function (b) {
        b.onclick = function () {
          if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Confirm dismiss"; return; }
          backend().handleCorrection(b.dataset.fdismiss, "dismissed").then(render, function (er) { api.say($("fl-msg"), er.message, true); });
        };
      });
      el.querySelectorAll("[data-fapply]").forEach(function (b) { b.onclick = function () { apply(b.dataset.fapply); }; });
    }
    function apply(id) {
      var c = list().filter(function (x) { return x.id === id; })[0];
      if (!c) return;
      if (c.kind === "cell" && backend().setCell) {
        return backend().setCell(c.aboutKey, c.details.cell).then(function () { return backend().handleCorrection(c.id, "applied"); })
          .then(render, function (er) { api.say($("fl-msg"), er.message, true); });
      }
      ui.applying = c;
      api.choosePerson(c.aboutKey);
    }
    // Called after the person page renders: fill in the edit form for the correction being applied.
    function prefill(p) {
      var c = ui.applying;
      var bar = $("fix-applying");
      if (!c || c.aboutKey !== p.pos) { if (bar) bar.hidden = true; return; }
      var d = c.details || {};
      bar.hidden = false;
      bar.innerHTML = "<b>Applying a correction:</b> " + esc(summary(c)) + (c.note ? " · “" + esc(c.note) + "”" : "") +
        ' <button class="btn small" type="button" id="fa-done">Mark applied</button> <button class="btn small" type="button" id="fa-cancel">Cancel</button>';
      $("fa-done").onclick = function () { finish(); };
      $("fa-cancel").onclick = function () { ui.applying = null; bar.hidden = true; };
      var fold = document.querySelector('#person-detail [data-fold="edit"]');
      if (fold) fold.open = true;
      function set(id, v) { var el = $(id); if (el && v != null && v !== "") { el.value = v; el.dispatchEvent(new Event("change")); } }
      if (c.kind === "status") {
        set("fs-code", d.code); set("fs-start", d.start);
        if (d.end) { if ($("fs-open")) $("fs-open").checked = false; set("fs-end", d.end); }
        else if ($("fs-open")) { $("fs-open").checked = true; $("fs-open").dispatchEvent(new Event("change")); }
        focusForm("f-status");
      } else if (c.kind === "cover" || (c.kind === "seat" && d.seat)) {
        set("fc-target", d.seat); set("fc-kind", d.coverKind || ""); set("fc-start", d.start || todayIso());
        focusForm("f-cover");
      } else if (c.kind === "tour" || (c.kind === "seat" && d.tour)) {
        set("ft-tour", d.tour); set("ft-eff", d.start || todayIso());
        focusForm("f-tour");
      }
    }
    function focusForm(id) { var f = $(id); if (f) f.scrollIntoView({ block: "center" }); }
    function finish() {
      var c = ui.applying;
      if (!c) return Promise.resolve();
      ui.applying = null;
      if ($("fix-applying")) $("fix-applying").hidden = true;
      return backend().handleCorrection(c.id, "applied").catch(function () {});
    }
    // An edit form on the person page saved: the correction being applied is done.
    function saved() { if (ui.applying) finish(); }

    function wire() {
      $("fix-sheet").addEventListener("click", function (e) { if (e.target.closest("[data-close]")) close(); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("fix-sheet").hidden) close(); });
    }

    return { link: link, wireLinks: wireLinks, open: open, openVerify: openVerify, render: render, prefill: prefill, saved: saved,
      count: count, afterClaim: afterClaim, wire: wire, canSuggest: canSuggest, summary: summary, apply: apply };
  };
})(typeof window !== "undefined" ? window : globalThis);
