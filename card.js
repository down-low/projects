/* Employee card: one back-office screen where an admin finds a person and edits their whole record.
 * window.CardViews(api) -> {render, open(key)}. `api` comes from app.js. Admins only (page Editors, server admins); members
 * and viewers never see it, and the person page they use is unchanged.
 * Sections: identity (name, rank, Employee ID), own seat and moves, current assignment, leave, tour changes, cell number
 * (staff list), "This is me" claim, corrections, and one history timeline with edit and delete for every record.
 * The status, cover and tour forms are the person page's (app.js statusForm / coverForm / tourForm), with other id prefixes.
 */
(function (root) {
  "use strict";
  var M = root.TourMath;

  root.CardViews = function (api) {
    var $ = api.$, esc = api.esc;
    /* key: the person shown; edit: "section|kind|id" of the record whose edit form is open; undo: a removed claim
       ({key, member} on the shared page, {key, accountId} on the server). */
    var ui = { key: null, q: "", edit: null, undo: null, users: null, usersLoading: false };

    function backend() { return api.backend(); }
    function byPos() { return api.byPos(); }
    function recs() { return api.recs(); }
    function todayIso() { return api.iso(api.today()); }
    function serverMode() { return backend() && backend().mode === "server"; }
    function nameOf(key) { var p = byPos()[key]; return p ? p.name || "Vacant" : key; }
    function when(isoStr) { return isoStr ? api.shortDate(api.fromIso(String(isoStr).slice(0, 10))) : ""; }
    function btn(label, attrs, cls) { return '<button type="button" class="btn small' + (cls ? " " + cls : "") + '" ' + attrs + ">" + label + "</button>"; }
    function msgEl(id) { return '<span class="msg" id="' + id + '" role="status"></span>'; }

    function open(key) {
      ui.key = key;
      ui.edit = null;
      var p = byPos()[key];
      ui.q = p ? p.name || "" : "";
      api.show();
    }

    /* ---------- Records touching one person ---------- */
    function covers(key) { return (recs().covers || []).filter(function (c) { return c.coverKey === key || c.targetPos === key; }); }
    function statuses(key) { return (recs().statuses || []).filter(function (s) { return s.pos === key; }); }
    function tourChanges(key) { return (recs().tourChanges || []).filter(function (c) { return c.pos === key; }); }
    function claims(key) { return (recs().members || []).filter(function (m) { return m.key === key; }); }
    function fixes(key) { return (recs().corrections || []).filter(function (c) { return c.aboutKey === key || c.byKey === key; }); }
    function byStartDesc(a, b) { return String(b.start || b.effective).localeCompare(String(a.start || a.effective)); }
    function live(r) { return !r.end || r.end >= todayIso(); }

    function statusLine(s) {
      return api.statusPill(s.code) + " <b>" + esc(api.STATUS_LABEL[s.code] || s.code) + "</b> " + esc(when(s.start)) +
        (s.end ? (s.end !== s.start ? " – " + esc(when(s.end)) : "") : " onward");
    }
    function coverLine(c, key) {
      if (c.coverKey === key) return "<b>" + esc(api.kindWord(c)) + " " + esc(api.slotLabel(c.targetPos)) + "</b> " +
        (M.isMove(c) ? "" : '<span class="tag">' + esc(api.KIND[kindKey(c)][0]) + "</span> ") + esc(api.rangeText(c));
      return "<b>" + esc(c.coverName || nameOf(c.coverKey)) + " · " + esc(api.kindWord(c).toLowerCase()) + "</b> in this seat " + esc(api.rangeText(c));
    }
    function kindKey(c) {
      var who = byPos()[c.coverKey], seat = byPos()[c.targetPos];
      return M.coverKind(c, who && who.rank, seat && seat.rank);
    }
    function tourLine(c) { return '<span class="st st-T">T</span> <b>Tour ' + esc(c.tour) + "</b> from " + esc(when(c.effective)); }

    // One list row for a schedule record, with Edit / End today / Delete, and its edit form underneath when open.
    function recRow(section, kind, r, html, p) {
      var editKey = section + "|" + kind + "|" + r.id, trade = !!r.tradeId;
      var acts = trade ? '<span class="hint">From a shift trade; change it on the Trades tab</span>' :
        btn("Edit", 'data-cedit="' + esc(editKey) + '"') +
        (kind === "covers" && !r.end && r.start <= todayIso() ? btn("End today", 'data-cend="' + esc(r.id) + '"') : "") +
        btn("Delete", 'data-cdel="' + esc(kind) + '" data-id="' + esc(r.id) + '"');
      var form = ui.edit === editKey ? editForm(kind, r, p) : "";
      return "<li><div>" + html + (r.note ? '<div class="hint">' + esc(r.note) + "</div>" : "") + "</div>" +
        '<div class="acts">' + acts + "</div>" + (form ? '<div class="card-editform">' + form + "</div>" : "") + "</li>";
    }
    // The edit form for one record; a cover is edited as the person covering (they may not be the person shown).
    function editForm(kind, r, p) {
      if (kind === "statuses") return api.statusForm(p, r, "kh");
      if (kind === "tourChanges") return api.tourForm(p, r, "kh");
      if (kind === "covers") return api.coverForm(coverer(r), r, "kh", { move: true });
      return "";
    }
    function coverer(c) { return byPos()[c.coverKey] || { pos: c.coverKey, name: c.coverName || c.coverKey }; }
    function list(rows, empty) { return rows.length ? '<ul class="hist card-list">' + rows.join("") + "</ul>" : '<p class="hint">' + empty + "</p>"; }
    function section(id, title, sum, body, openDefault) {
      var open = ui.folds && id in ui.folds ? ui.folds[id] : openDefault !== false;
      return '<details class="card fold card-sec" data-cfold="' + id + '"' + (open ? " open" : "") + "><summary><h3>" + esc(title) + "</h3>" +
        '<span class="fold-sum">' + sum + "</span></summary>" + body + "</details>";
    }

    /* ---------- Render ---------- */
    function render() {
      var el = $("card-detail");
      if (!el) return;
      var b = backend();
      if (!b || !b.update || !b.canAdmin()) { el.innerHTML = '<div class="empty">Only admins can open employee cards.</div>'; return; }
      var p = ui.key ? byPos()[ui.key] : null;
      el.innerHTML = '<form class="card edit card-search" id="card-search" novalidate role="search"><h2 class="view-title">Employee cards</h2>' +
        '<p class="hint">Admins only. Find anyone and edit their whole record in one place. Members never see this screen.</p>' +
        '<label>Find a person<input type="search" id="card-q" placeholder="Name, Employee ID, company or position number" autocomplete="off" value="' + esc(ui.q) + '"></label>' +
        '<ul class="card-hits" id="card-hits"></ul></form>' +
        (p ? cardHtml(p) : '<div class="empty">Search for someone above, or tap <b>Employee card</b> on their Schedule page.</div>');
      drawHits(false);
      $("card-q").oninput = function () { ui.q = this.value; drawHits(true); };
      $("card-search").onsubmit = function (e) {
        e.preventDefault();
        var first = $("card-hits").querySelector("[data-ckey]");
        if (first) pick(first.dataset.ckey);
      };
      $("card-hits").onclick = function (e) { var h = e.target.closest("[data-ckey]"); if (h) pick(h.dataset.ckey); };
      if (p) wire(p);
    }
    function pick(key) { ui.key = key; ui.edit = null; ui.q = nameOf(key); render(); }
    function drawHits(typing) {
      var ul = $("card-hits"), q = ui.q.trim();
      var cur = ui.key && byPos()[ui.key];
      if (!q || (!typing && cur && q === cur.name)) { ul.innerHTML = ""; return; }
      var match = api.makeMatcher(q);
      var hits = api.people().filter(function (p) {
        return match({ name: p.name, title: p.title, co: p.company, tour: api.tourOn(p, api.today()), pos: p.pos, id: p.emplId });
      }).slice(0, 12);
      ul.innerHTML = hits.length ? hits.map(function (p) {
        return '<li><button type="button" class="linkish" data-ckey="' + esc(p.pos) + '">' + esc(p.name) + '</button> <span class="hint">' + esc(p.title) +
          (p.emplId ? " · " + esc(p.emplId) : "") + "</span></li>";
      }).join("") : '<li class="hint">Nobody matches.</li>';
    }

    function cardHtml(p) {
      var t = api.today(), tIso = todayIso(), key = p.pos;
      var s = api.day(p, t), st = api.statusFor(key, t), tour = api.tourOn(p, t);
      var cv = covers(key).sort(byStartDesc);
      var moves = cv.filter(function (c) { return c.coverKey === key && M.isMove(c); });
      var mine = cv.filter(function (c) { return c.coverKey === key && !M.isMove(c); });
      var inSeat = cv.filter(function (c) { return c.targetPos === key && c.coverKey !== key; });
      var sts = statuses(key).sort(byStartDesc), tcs = tourChanges(key).sort(byStartDesc);
      var nowLine = st ? api.statusPill(st) + " " + esc(api.STATUS_LABEL[st]) : s ? (s.acting ? esc(api.kindWord(s.acting)) + " at " : "Working at ") + esc(s.co || api.home(p)) : "Off today";

      var head = '<div class="card card-head"><div><h2>' + esc(p.name) + "</h2>" +
        '<div class="hint">' + esc(p.title) + (p.added ? "" : " · " + esc(key)) + (tour ? " · Tour " + tour : "") + (p.emplId ? " · " + esc(p.emplId) : "") + "</div>" +
        "<div>Today: " + nowLine + "</div></div>" +
        '<div class="acts">' + btn("Schedule page", 'data-cgo="' + esc(key) + '"') + "</div></div>";

      // 1. Identity
      var o0 = p.added ? null : api.orig(key), ov = p.added ? null : api.overrideFor(key);
      var staleOv = !p.added && !ov && (recs().rosterOverrides || []).some(function (x) { return x.id === key; });
      var idBody = '<form class="edit" id="ci-form" novalidate>' +
        '<div class="row"><label>Name<input type="text" id="ci-name" maxlength="80" value="' + esc(p.name) + '"></label>' +
        "<label>Rank<select id=\"ci-rank\">" + api.RANKS.map(function (r) { return "<option" + (r === p.rank ? " selected" : "") + ">" + esc(r) + "</option>"; }).join("") + "</select></label>" +
        '<label>Employee ID<input type="text" id="ci-id" maxlength="6" placeholder="e.g. LE1234" autocomplete="off" value="' + esc(p.emplId || "") + '"></label></div>' +
        (p.added ? '<div class="row"><label>Apparatus<input type="text" id="ci-co" maxlength="6" placeholder="e.g. E10, or blank" value="' + esc(p.company || "") + '"></label>' +
          '<label>Tour<select id="ci-tour"><option value="">No tour</option>' + api.tourOptions(p.tour || 0) + "</select></label></div>" +
          '<p class="hint">Added person, not on the vacancy list. Give both an apparatus and a tour, or neither.</p>'
          : '<p class="hint">Vacancy list: ' + esc(o0.name) + " · " + esc(o0.rank) + " · ID " + esc(o0.emplId || "not on file") +
            ". Changing the rank moves this seat to that rank on Projection and Staffing and changes who can trade with it. " +
            "Leave the ID blank to use the file's.</p>") +
        (staleOv ? '<p class="hint err">An older override for this seat no longer applies: the vacancy list has someone new here.</p>' : "") +
        '<div class="row"><button class="btn primary" type="submit">Save identity</button>' +
        (ov || staleOv ? " " + btn("Reset to vacancy list", 'id="ci-reset"') : "") + msgEl("ci-msg") + "</div></form>";

      // 2. Own seat and moves
      var own = moves.filter(function (c) { return c.start <= tIso && live(c); })[0];
      var seatBody = "<p>" + (own ? "Owns <b>" + esc(api.slotLabel(own.targetPos)) + "</b> since " + esc(when(own.start))
        : p.added ? (p.company ? "Added at " + esc(p.company) + (p.tour ? ", Tour " + p.tour : "") : "No own seat") : "Owns <b>" + esc(p.title) + " " + esc(key) + "</b> (vacancy list)") + "</p>" +
        list(moves.map(function (c) { return recRow("seat", "covers", c, coverLine(c, key), p); }), "No moves recorded.") +
        api.coverForm(p, null, "km", { moveOnly: true });

      // 3. Current assignment
      var cur = mine.filter(live);
      var asgBody = list(cur.map(function (c) { return recRow("asg", "covers", c, coverLine(c, key), p); }), "In their own seat. No current or upcoming cover.") +
        (inSeat.filter(live).length ? '<h4 class="sub-h">Others in this seat</h4>' + list(inSeat.filter(live).map(function (c) { return recRow("asg", "covers", c, coverLine(c, key), p); }), "") : "") +
        api.coverForm(p, null, "kc", { move: false });

      // 4. Leave and statuses (current and upcoming; older ones are in History)
      var curSt = sts.filter(live);
      var leaveBody = list(curSt.map(function (x) { return recRow("leave", "statuses", x, statusLine(x), p); }), "No current or upcoming leave.") +
        api.statusForm(p, null, "ks");

      // 5. Tour changes
      var tourBody = p.added ? '<p class="hint">An added person\'s tour is under Identity.</p>' :
        "<p>Tour " + esc(tour) + " today.</p>" + list(tcs.map(function (c) { return recRow("tour", "tourChanges", c, tourLine(c), p); }), "No tour changes.") +
        api.tourForm(p, null, "kt");

      // 6. Cell number (staff list, admins only)
      var c = api.contacts()[key] || {};
      var cellBody = '<form class="edit" id="cc-form" novalidate><p class="hint">From the staff list. Only admins ever receive it; it is never in the view-only link or the repository.</p>' +
        (c.phoneMobile && !c.staffList ? '<p>Their own contact: ' + esc(c.phoneMobile) + (c.shared ? " (shared)" : " (not shared)") + "</p>" : "") +
        '<div class="row"><label>Cell<input type="tel" id="cc-cell" maxlength="25" placeholder="(415) 555-0100" value="' + esc(c.staffList ? c.phoneMobile : "") + '"></label></div>' +
        '<div class="row"><button class="btn primary" type="submit">Save cell</button>' + (c.staffList ? " " + btn("Clear", 'id="cc-clear"') : "") + msgEl("cc-msg") + "</div></form>";

      // 7. "This is me" claim
      var claimBody = claimHtml(key);

      // 8. Corrections
      var fx = fixes(key).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
      var F = api.fix();
      var fixBody = list(fx.map(function (x) {
        var about = x.aboutKey === key ? "" : "About " + esc(nameOf(x.aboutKey)) + ": ";
        return "<li><div>" + about + esc(F.summary(x)) + (x.note ? '<div class="hint">“' + esc(x.note) + "”</div>" : "") +
          '<div class="hint">' + (x.byKey === key ? "Sent by them" : "From " + esc(x.byName || (x.byKey ? nameOf(x.byKey) : "a member"))) + " · " + esc(when(x.createdAt)) +
          " · " + esc(x.state) + (x.reason ? ": " + esc(x.reason) : "") + "</div></div>" +
          '<div class="acts">' + (x.state === "open" ? btn("Apply", 'data-cfix="apply" data-id="' + esc(x.id) + '"', "primary") + btn("Dismiss", 'data-cfix="dismissed" data-id="' + esc(x.id) + '"')
            : btn("Reopen", 'data-cfix="open" data-id="' + esc(x.id) + '"')) + btn("Delete", 'data-cfix="delete" data-id="' + esc(x.id) + '"') + "</div></li>";
      }), "No corrections about or from them.") + msgEl("cf-msg");

      // 9. History: every record touching the person
      var hist = historyItems(p);
      var histBody = list(hist.map(function (h) { return h.row; }), "Nothing recorded.");

      var nCur = cur.length;
      return head +
        section("id", "Identity", esc(p.rank) + (p.emplId ? " · " + esc(p.emplId) : " · no ID") + (ov ? " · edited" : ""), idBody) +
        section("seat", "Own seat and moves", moves.length ? moves.length + (moves.length === 1 ? " move" : " moves") : "No moves", seatBody, !api.isPhone()) +
        section("asg", "Current assignment", nCur ? esc(api.kindWord(cur[0])) + " " + esc((byPos()[cur[0].targetPos] || {}).company || cur[0].targetPos) : "Own seat", asgBody, !api.isPhone()) +
        section("leave", "Leave and statuses", curSt.length ? curSt.map(function (x) { return esc(x.code); }).join(" · ") : "None", leaveBody, !api.isPhone()) +
        section("tour", "Tour changes", p.added ? "—" : "Tour " + esc(tour) + (tcs.length ? " · " + tcs.length + " change" + (tcs.length === 1 ? "" : "s") : ""), tourBody, !api.isPhone()) +
        section("cell", "Cell number", c.staffList ? "On file" : "None", cellBody, !api.isPhone()) +
        section("claim", "“This is me” claim", claimSum(key), claimBody, !api.isPhone()) +
        section("fixes", "Corrections", fx.filter(function (x) { return x.state === "open"; }).length + " open of " + fx.length, fixBody, !api.isPhone()) +
        section("hist", "History", hist.length + (hist.length === 1 ? " record" : " records"), histBody, !api.isPhone());
    }

    // The claim: on the shared page a `members` record; on the server the account linked to the position.
    function claimSum(key) {
      if (serverMode()) { var u = linkedUsers(key); return u ? (u.length ? "Linked" : "Not linked") : "…"; }
      return claims(key).length ? "Claimed" : "Not claimed";
    }
    function linkedUsers(key) {
      if (!ui.users) {
        if (!ui.usersLoading) {
          ui.usersLoading = true;
          backend().adminUsers().then(function (us) { ui.users = us; ui.usersLoading = false; render(); }, function () { ui.users = []; ui.usersLoading = false; });
        }
        return null;
      }
      return ui.users.filter(function (u) { return u.pos === key; });
    }
    function claimHtml(key) {
      var undo = ui.undo && ui.undo.key === key ? '<p>Claim removed. ' + btn("Undo", 'id="cl-undo"', "primary") + "</p>" : "";
      if (serverMode()) {
        var us = linkedUsers(key);
        if (!us) return '<p class="hint">Loading accounts…</p>';
        return undo + list(us.map(function (u) {
          return "<li><div><b>" + esc(u.name || u.googleEmail) + '</b> <span class="hint">' + esc(u.googleEmail) + " · " + esc(u.role) + " · " + esc(u.status) + "</span></div>" +
            '<div class="acts">' + btn("Unlink", 'data-cunlink="' + esc(u.id) + '"') + "</div></li>";
        }), "No account is linked to this person. Link one on the Admin page.") + msgEl("cl-msg");
      }
      return undo + list(claims(key).map(function (m) {
        return "<li><div>Claimed " + esc(when(m.claimedAt)) +
          (m.confirmedStation || m.confirmedTour ? " · says " + esc(m.confirmedStation || "?") + ", Tour " + esc(m.confirmedTour || "?") : "") +
          (m.emplId ? " · typed ID " + esc(m.emplId) : "") + (m.verifiedAt ? " · verified " + esc(when(m.verifiedAt)) : " · not verified") + "</div>" +
          '<div class="acts">' + btn("Remove claim", 'data-cunclaim="' + esc(m.id) + '"') + "</div></li>";
      }), "Nobody has said “This is me” for this person.") + msgEl("cl-msg");
    }

    function historyItems(p) {
      var key = p.pos, out = [];
      statuses(key).forEach(function (x) { out.push({ at: x.start, row: recRow("hist", "statuses", x, statusLine(x), p) }); });
      tourChanges(key).forEach(function (x) { out.push({ at: x.effective, row: recRow("hist", "tourChanges", x, tourLine(x), p) }); });
      covers(key).forEach(function (x) { out.push({ at: x.start, row: recRow("hist", "covers", x, '<span class="st st-A">' + (x.coverKey === key ? (M.isMove(x) ? "MV" : "AC") : "CV") + "</span> " + coverLine(x, key), p) }); });
      claims(key).forEach(function (m) {
        out.push({ at: m.claimedAt, row: "<li><div><b>Said “This is me”</b> " + esc(when(m.claimedAt)) + "</div>" +
          '<div class="acts">' + btn("Remove claim", 'data-cunclaim="' + esc(m.id) + '"') + "</div></li>" });
      });
      fixes(key).forEach(function (x) {
        out.push({ at: x.createdAt, row: "<li><div><b>Correction</b> " + esc(api.fix().summary(x)) + ' <span class="hint">' + esc(when(x.createdAt)) + " · " + esc(x.state) + "</span></div>" +
          '<div class="acts">' + btn("Delete", 'data-cfix="delete" data-id="' + esc(x.id) + '"') + "</div></li>" });
      });
      var ov = !p.added && (recs().rosterOverrides || []).filter(function (o) { return o.id === key; })[0];
      if (ov) {
        out.push({ at: ov.updatedAt, row: "<li><div><b>Identity edited</b> " + esc([ov.name, ov.rank, ov.emplId].filter(Boolean).join(" · ")) +
          ' <span class="hint">' + esc(when(ov.updatedAt)) + "</span></div>" + '<div class="acts">' + btn("Reset", 'data-creset="1"') + "</div></li>" });
      }
      if (p.added) {
        var rec = (recs().people || []).filter(function (x) { return "person:" + x.id === key; })[0];
        if (rec) out.push({ at: rec.createdAt, row: "<li><div><b>Added to the roster</b> " + esc(when(rec.createdAt)) + (rec.note ? '<div class="hint">' + esc(rec.note) + "</div>" : "") + "</div>" +
          '<div class="acts">' + btn("Remove this person", 'data-cdel="people" data-id="' + esc(rec.id) + '"') + "</div></li>" });
      }
      return out.sort(function (a, b) { return String(b.at || "").localeCompare(String(a.at || "")); });
    }

    /* ---------- Wiring ---------- */
    function confirmTap(b, label) {
      if (b.dataset.confirm === "1") return true;
      b.dataset.confirm = "1";
      b.textContent = label;
      b.classList.add("danger");
      return false;
    }
    function fail(b) { return function (e) { b.disabled = false; b.textContent = e.message; }; }
    function rerender() { api.renderAll(true); }

    function wire(p) {
      var el = $("card-detail"), b = backend(), key = p.pos;
      el.querySelectorAll("details[data-cfold]").forEach(function (d) {
        d.addEventListener("toggle", function () { ui.folds = ui.folds || {}; ui.folds[d.dataset.cfold] = d.open; });
      });
      el.querySelectorAll("[data-cgo]").forEach(function (x) { x.onclick = function () { api.choosePerson(x.dataset.cgo); }; });
      el.querySelectorAll("[data-cedit]").forEach(function (x) {
        x.onclick = function () { ui.edit = ui.edit === x.dataset.cedit ? null : x.dataset.cedit; render(); };
      });
      el.querySelectorAll("[data-cend]").forEach(function (x) {
        x.onclick = function () { x.disabled = true; b.endCover(x.dataset.cend, todayIso()).then(rerender, fail(x)); };
      });
      el.querySelectorAll("[data-cdel]").forEach(function (x) {
        x.onclick = function () {
          if (!confirmTap(x, "Confirm delete")) return;
          x.disabled = true;
          var kind = x.dataset.cdel;
          b.remove(kind, x.dataset.id).then(function () {
            if (kind === "people") { ui.key = null; ui.q = ""; }
            ui.edit = null;
            rerender();
          }, fail(x));
        };
      });
      // Forms: add (km = move, kc = cover, ks = status, kt = tour) and the one open edit form (kh).
      api.wireForms(p, "km", null);
      api.wireForms(p, "kc", null);
      api.wireForms(p, "ks", null);
      api.wireForms(p, "kt", null);
      if (ui.edit) {
        var parts = ui.edit.split("|"), kind = parts[1], id = parts[2];
        var rec = (recs()[kind] || []).filter(function (r) { return r.id === id; })[0];
        if (rec) api.wireForms(kind === "covers" ? coverer(rec) : p, "kh", rec, function () { ui.edit = null; }, function () { ui.edit = null; render(); });
      }
      wireIdentity(p);
      wireCell(key);
      wireClaim(key);
      wireFixes();
    }

    function wireIdentity(p) {
      var f = $("ci-form"), b = backend(), key = p.pos;
      if (!f) return;
      if ($("ci-reset")) $("ci-reset").onclick = function () {
        api.say($("ci-msg"), "Saving…");
        b.setOverride(key, null).then(rerender, function (e) { api.say($("ci-msg"), e.message, true); });
      };
      f.onsubmit = function (e) {
        e.preventDefault();
        var msg = $("ci-msg"), name = $("ci-name").value.trim(), rank = $("ci-rank").value, empl = $("ci-id").value.trim().toUpperCase();
        if (name.length < 2) return api.say(msg, "Enter the name, e.g. Lester,D.", true);
        if (empl && !api.ID_RE.test(empl)) return api.say(msg, "Employee ID is two letters and four digits, e.g. LE1234.", true);
        var other = empl && (api.byId()[empl] || []).filter(function (o) { return o.pos !== key; })[0];
        if (other) return api.say(msg, "Employee ID " + empl + " is already on " + other.name + " (" + other.title + ").", true);
        api.say(msg, "Saving…");
        var done = function () { rerender(); api.say($("ci-msg"), "Saved."); }, err = function (er) { api.say($("ci-msg"), er.message, true); };
        if (p.added) {
          var co = $("ci-co").value.trim().toUpperCase(), tour = $("ci-tour").value;
          if (co && !api.companyOk(co)) return api.say(msg, "Apparatus must be a company on the roster, like E10.", true);
          if (!co !== !tour) return api.say(msg, "Pick both an apparatus and a tour, or neither.", true);
          return b.update("people", key.slice(7), { name: name, rank: rank, emplId: empl || null, company: co || null, tour: tour ? +tour : null }).then(done, err);
        }
        // Roster seat: keep only what differs from the files, tied to the holder it was made for.
        var o0 = api.orig(key);
        var o = { name: name !== o0.name ? name : null, rank: rank !== o0.rank ? rank : null, emplId: empl && empl !== o0.emplId ? empl : null, forName: o0.name };
        b.setOverride(key, o.name || o.rank || o.emplId ? o : null).then(done, err);
      };
    }

    function wireCell(key) {
      var f = $("cc-form"), b = backend();
      if (!f) return;
      f.onsubmit = function (e) {
        e.preventDefault();
        var cell = $("cc-cell").value.trim(), msg = $("cc-msg");
        if (cell.replace(/\D/g, "").length < 10) return api.say(msg, "Enter a 10-digit number.", true);
        api.say(msg, "Saving…");
        b.setCell(key, cell).then(function () { rerender(); api.say($("cc-msg"), "Saved."); }, function (er) { api.say($("cc-msg"), er.message, true); });
      };
      if ($("cc-clear")) $("cc-clear").onclick = function () {
        if (!confirmTap(this, "Confirm clear")) return;
        b.setCell(key, null).then(rerender, fail(this));
      };
    }

    function wireClaim(key) {
      var el = $("card-detail"), b = backend();
      el.querySelectorAll("[data-cunclaim]").forEach(function (x) {
        x.onclick = function () {
          if (!confirmTap(x, "Confirm remove")) return;
          var m = claims(key).filter(function (c) { return c.id === x.dataset.cunclaim; })[0];
          x.disabled = true;
          b.unclaim(x.dataset.cunclaim).then(function () { ui.undo = m ? { key: key, member: m } : null; rerender(); }, fail(x));
        };
      });
      el.querySelectorAll("[data-cunlink]").forEach(function (x) {
        x.onclick = function () {
          if (!confirmTap(x, "Confirm unlink")) return;
          x.disabled = true;
          var id = x.dataset.cunlink;
          b.adminAction(id, { action: "unlink" }).then(function () { ui.undo = { key: key, accountId: id }; ui.users = null; rerender(); }, fail(x));
        };
      });
      if ($("cl-undo")) $("cl-undo").onclick = function () {
        var u = ui.undo, x = this;
        x.disabled = true;
        var p2 = u.accountId ? b.adminAction(u.accountId, { action: "link", pos: key }) : b.restoreMember(u.member);
        p2.then(function () { ui.undo = null; ui.users = null; rerender(); }, fail(x));
      };
    }

    function wireFixes() {
      var el = $("card-detail"), b = backend();
      el.querySelectorAll("[data-cfix]").forEach(function (x) {
        x.onclick = function () {
          var act = x.dataset.cfix, id = x.dataset.id;
          if (act === "apply") return api.fix().apply(id);
          if (act === "delete" && !confirmTap(x, "Confirm delete")) return;
          x.disabled = true;
          (act === "delete" ? b.deleteCorrection(id) : b.handleCorrection(id, act)).then(rerender, fail(x));
        };
      });
      el.querySelectorAll("[data-creset]").forEach(function (x) {
        x.onclick = function () {
          if (!confirmTap(x, "Confirm reset")) return;
          b.setOverride(ui.key, null).then(rerender, fail(x));
        };
      });
    }

    return { render: render, open: open };
  };
})(typeof window !== "undefined" ? window : globalThis);
