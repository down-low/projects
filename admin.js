/* Account views for the server (Google sign-in) mode: the sign-in / claim screen, My page and Admin.
 * window.AccountViews(api) -> {renderGate, renderMe, renderAdmin}. `api` is supplied by app.js.
 */
(function (root) {
  "use strict";

  var AUTH_ERRORS = {
    cancelled: "Sign-in was cancelled.",
    state: "Sign-in expired or was started in another tab. Try again.",
    google: "Google sign-in could not be completed. Try again.",
    domain: "That Google account isn't from an allowed domain. Sign in with your department account.",
    disabled: "This account has been disabled. Contact an admin.",
    not_configured: "Google sign-in isn't set up on this server yet. An admin needs to add the Google settings.",
  };
  var ROLE_LABEL = { member: "Member", editor: "Editor", admin: "Admin" };
  var POS_RE = /([0-9]{1,2}[A-Z]{2,4}[0-9]{2,3}M)\s*\)?\s*$/;

  root.AccountViews = function (api) {
    var $ = api.$, esc = api.esc;
    var roster = null, claimPick = null, adminFilter = "", adminUsersCache = [];

    /* ---------- Sign-in and claim screen ---------- */
    function renderGate() {
      var me = api.backend().me();
      var el = $("gate");
      api.gate(true);
      var err = null;
      try { err = new URLSearchParams(location.search).get("auth_error"); } catch (e) { /* old browser */ }
      var errHtml = err ? '<p class="msg err" role="alert">' + esc(AUTH_ERRORS[err] || "Sign-in failed. Try again.") + "</p>" : "";

      if (!me.signedIn) {
        var how = me.google
          ? '<a class="btn primary big" href="auth/login">Sign in with Google</a>'
          : '<p class="hint">' + esc(AUTH_ERRORS.not_configured) + "</p>";
        var dev = me.devLogin
          ? '<form class="dev-login" action="auth/dev" method="get"><label for="dev-email">Developer sign-in (test mode)</label>' +
            '<div class="row"><input type="email" id="dev-email" name="email" required placeholder="name@example.org">' +
            '<button class="btn" type="submit">Sign in</button></div></form>'
          : "";
        el.innerHTML = '<div class="card gate-card"><h2>Sign in</h2><p>The tour schedule is for department members. ' +
          "Sign in with your Google account to see who's working, your own tour, and to share contact info for shift swaps.</p>" +
          errHtml + how + dev + "</div>";
        return;
      }

      // Signed in but pending approval
      var req = me.claimRequest;
      var waiting = req
        ? '<div class="claim-wait"><p><b>Waiting for approval.</b> You asked to be added as <b>' + esc(req.name) + "</b> · " + esc(req.rank) +
          " · " + esc(req.company) + " · Tour " + esc(req.tour) + ". An admin will review it; you'll get access as soon as it's approved.</p>" +
          '<button class="btn small" id="claim-change">Change my request</button></div>'
        : me.claimPos
        ? '<div class="claim-wait"><p><b>Waiting for approval.</b> You asked to be linked to <b>' + esc(me.claimName || me.claimPos) +
          "</b> (" + esc(me.claimPos) + "). An admin will review it; you'll get access as soon as it's approved.</p>" +
          '<button class="btn small" id="claim-change">Change my request</button></div>'
        : "";
      el.innerHTML = '<div class="card gate-card"><h2>Claim your record</h2>' +
        '<p class="hint">Signed in as ' + esc(me.googleEmail) + ' · <button class="linkish" id="gate-out">Sign out</button></p>' +
        errHtml + waiting +
        '<form class="edit claim-form" id="claim-form"' + (me.claimPos ? " hidden" : "") + ' novalidate>' +
        "<p>Find yourself on the roster so the schedule knows which position is yours. An admin approves each request.</p>" +
        '<label for="claim-q">Your name or position number</label>' +
        '<input type="search" id="claim-q" autocomplete="off" placeholder="Start typing your last name">' +
        '<ul class="pick" id="claim-list"></ul>' +
        '<p id="claim-chosen" class="claim-chosen" hidden></p>' +
        '<label for="claim-note">Note for the admin (optional)</label><input type="text" id="claim-note" maxlength="300" placeholder="e.g. Captain E33, Tour 12">' +
        '<div class="row"><button class="btn primary" type="submit">Send request</button><span class="msg" id="claim-msg" role="status"></span></div>' +
        '<p><button class="linkish" type="button" id="not-listed">I\'m not on the list</button></p>' +
        "</form>" +
        '<form class="edit claim-form" id="req-form" hidden novalidate>' +
        "<p>Tell us where you work. An admin checks it and adds you to the schedule.</p>" +
        '<div class="row"><label>Your name<input type="text" id="rq-name" maxlength="80" placeholder="Last,First initial (e.g. Smith,J)"></label>' +
        '<label>Rank<select id="rq-rank">' + api.RANKS.map(function (r) { return "<option>" + esc(r) + "</option>"; }).join("") + "</select></label></div>" +
        '<div class="row"><label>Apparatus<input type="text" id="rq-company" maxlength="6" placeholder="e.g. E10"></label>' +
        '<label>Tour<select id="rq-tour"><option value="">Pick your tour</option>' +
        Array.apply(null, Array(31)).map(function (_, i) { return '<option value="' + (i + 1) + '">Tour ' + (i + 1) + "</option>"; }).join("") + "</select></label></div>" +
        '<label>Employee ID (optional)<input type="text" id="rq-id" maxlength="6" placeholder="e.g. LE1234" autocapitalize="characters"></label>' +
        '<label>Note for the admin (optional)<input type="text" id="rq-note" maxlength="300" placeholder="e.g. new hire, academy class 125"></label>' +
        '<div class="row"><button class="btn primary" type="submit">Send request</button><span class="msg" id="rq-msg" role="status"></span>' +
        '<button class="linkish" type="button" id="back-to-list">Back to the roster search</button></div></form></div>';

      $("gate-out").onclick = function () { api.backend().signOut(); };
      if ($("claim-change")) $("claim-change").onclick = function () {
        this.parentNode.hidden = true;
        if (req) {
          $("req-form").hidden = false;
          $("rq-name").value = req.name; $("rq-rank").value = req.rank; $("rq-company").value = req.company; $("rq-tour").value = req.tour; $("rq-note").value = req.note || "";
          $("rq-id").value = req.emplId || "";
        } else $("claim-form").hidden = false;
      };
      $("not-listed").onclick = function () { $("claim-form").hidden = true; $("req-form").hidden = false; $("rq-name").focus(); };
      $("back-to-list").onclick = function () { $("req-form").hidden = true; $("claim-form").hidden = false; };
      $("req-form").onsubmit = function (e) {
        e.preventDefault();
        var msg = $("rq-msg"), name = $("rq-name").value.trim(), co = $("rq-company").value.trim().toUpperCase(), tour = $("rq-tour").value;
        if (name.length < 2) return api.say(msg, "Enter your name, e.g. Smith,J.", true);
        if (!/^[A-Z]{1,3}\d{1,2}$/.test(co)) return api.say(msg, "Enter your apparatus as a company code, like E10 or T01.", true);
        if (!tour) return api.say(msg, "Pick your tour.", true);
        var empl = $("rq-id").value.trim().toUpperCase();
        if (empl && !/^[A-Z]{2}\d{4}$/.test(empl)) return api.say(msg, "Employee ID is two letters and four digits, e.g. LE1234.", true);
        api.say(msg, "Sending…");
        api.backend().claimRequest({ name: name, rank: $("rq-rank").value, company: co, tour: +tour, emplId: empl || null, note: $("rq-note").value.trim() })
          .then(renderGate, function (er) { api.say($("rq-msg"), er.message, true); });
      };
      var listEl = $("claim-list");
      function showMatches() {
        var q = $("claim-q").value.trim().toLowerCase();
        if (!roster || q.length < 2) { listEl.innerHTML = ""; return; }
        var hits = roster.filter(function (r) {
          return r.name.toLowerCase().indexOf(q) !== -1 || r.pos.toLowerCase().indexOf(q) !== -1;
        }).slice(0, 12);
        listEl.innerHTML = hits.length ? hits.map(function (r) {
          return '<li><button type="button" class="pick-btn" data-pos="' + esc(r.pos) + '"><b>' + esc(r.name) + "</b> " +
            '<span class="hint">' + esc(r.title) + " · " + esc(r.pos) + "</span></button></li>";
        }).join("") : '<li class="hint">No unclaimed roster entry matches. Check the spelling or ask an admin.</li>';
      }
      $("claim-q").oninput = showMatches;
      listEl.onclick = function (e) {
        var b = e.target.closest("button[data-pos]");
        if (!b) return;
        claimPick = b.dataset.pos;
        var r = roster.filter(function (x) { return x.pos === claimPick; })[0];
        $("claim-chosen").hidden = false;
        $("claim-chosen").innerHTML = "Selected: <b>" + esc(r.name) + "</b> · " + esc(r.title) + " · " + esc(r.pos);
        listEl.innerHTML = "";
      };
      $("claim-form").onsubmit = function (e) {
        e.preventDefault();
        if (!claimPick) return api.say($("claim-msg"), "Pick your name from the list first.", true);
        api.say($("claim-msg"), "Sending…");
        api.backend().claim(claimPick, $("claim-note").value.trim()).then(renderGate, function (er) { api.say($("claim-msg"), er.message, true); });
      };
      if (!roster) api.backend().rosterNames().then(function (r) {
        roster = r.sort(function (a, b) { return a.name.localeCompare(b.name); });
        showMatches();
      }, function (er) { api.say($("claim-msg"), er.message, true); });
    }

    /* ---------- My page ---------- */
    function renderMe() {
      var b = api.backend(), me = b.me(), out = $("me-detail");
      var p = me.pos ? api.byPos()[me.pos] : null;
      var t = api.today();
      var html = '<div class="person me">';

      html += '<div class="card ident"><h2>' + esc(p ? p.name : me.name) + "</h2>" +
        kv("Signed in as", me.googleEmail) + kv("Access", ROLE_LABEL[me.role] || me.role);
      if (p) {
        var tourNow = api.tourOn(p, t);
        var up = api.recs().tourChanges.filter(function (c) { return c.pos === p.pos && c.effective > api.iso(t); })
          .sort(function (a, c) { return a.effective.localeCompare(c.effective); })[0];
        var st = api.statusFor(p.pos, t);
        html += kv("Position", p.added ? p.title : p.title + " · " + p.pos) +
          '<div class="kv"><span class="k">Tour</span><span class="v big">' + tourNow + "</span></div>" +
          (up ? kv("Tour change", "→ " + up.tour + " from " + api.shortDate(api.fromIso(up.effective))) : "") +
          (st ? '<div class="kv"><span class="k">Today</span><span class="v">' + api.statusPill(st) + " " + esc(api.STATUS_LABEL[st]) + "</span></div>" : "") +
          '<div class="kv"><span class="k">&nbsp;</span><button class="btn small" id="me-cal">Open my calendar</button></div>';
      }
      html += "</div>";

      if (p) {
        var next = [], d = t;
        for (var k = 0; k < 120 && next.length < 9; k++, d = api.addDays(d, 1)) {
          var s = api.shift(p, d);
          if (s) next.push({ d: d, s: s, k: k });
        }
        html += '<div class="card"><h3>My next shifts</h3><ol class="shifts">' + next.map(function (n) {
          return '<li><span class="when">' + esc(api.shortDate(n.d)) + '</span><span class="rel">' +
            (n.k === 0 ? "Today" : n.k === 1 ? "Tomorrow" : "in " + n.k + " days") + " · W" + n.s.watch + '</span><span class="where">' +
            (n.s.status ? api.statusPill(n.s.status) : esc(n.s.co || p.company || p.title) + (n.s.role ? " " + esc(n.s.role) : "")) + "</span></li>";
        }).join("") + "</ol>";
        var leave = api.recs().statuses.filter(function (x) { return x.pos === p.pos && (!x.end || x.end >= api.iso(t)); })
          .sort(function (a, c) { return a.start.localeCompare(c.start); });
        html += '<h3 class="sub-h">Leave on record</h3>' + (leave.length ? '<ul class="hist">' + leave.map(function (x) {
          return "<li><div>" + api.statusPill(x.code) + " <b>" + esc(api.STATUS_LABEL[x.code]) + "</b> " + esc(api.shortDate(api.fromIso(x.start))) +
            (x.end ? (x.end !== x.start ? " – " + esc(api.shortDate(api.fromIso(x.end))) : "") : " onward") + "</div></li>";
        }).join("") + "</ul>" : '<p class="hint">No current or upcoming leave.</p>') + "</div>";
      } else {
        html += '<div class="card"><h3>Roster link</h3><p class="hint">Your account isn\'t linked to a roster position, so there\'s no tour to show. ' +
          "Ask an admin to link it if you work a tour.</p></div>";
      }

      html += '<form class="card edit contact" id="me-contact" novalidate><h3>Contact info</h3>' +
        '<label>Contact email<input type="email" id="mc-email" maxlength="254" value="' + esc(me.contactEmail || "") + '" placeholder="' + esc(me.googleEmail) + '"></label>' +
        '<p class="hint">Where people should reach you. Your Google sign-in stays ' + esc(me.googleEmail) + ".</p>" +
        '<div class="row"><label>Mobile phone<input type="tel" id="mc-mobile" maxlength="40" value="' + esc(me.phoneMobile || "") + '" placeholder="(415) 555-0100"></label>' +
        '<label>Other phone<input type="tel" id="mc-other" maxlength="40" value="' + esc(me.phoneOther || "") + '" placeholder="Optional"></label></div>' +
        '<label class="chk share"><input type="checkbox" id="mc-share"' + (me.shareContact ? " checked" : "") + '> Share my contact info for shift swaps</label>' +
        '<p class="hint">When this is on, anyone signed in to the schedule sees your contact email and phone numbers on your schedule page. ' +
        "When it's off, only admins can see them.</p>" +
        '<div class="row"><button class="btn primary" type="submit">Save contact info</button><span class="msg" id="mc-msg" role="status"></span></div></form>';
      if (me.pos) {
        var pf = me.profile || {};
        html += '<form class="card edit dates" id="me-dates" novalidate><h3>Birth and hire dates</h3>' +
          '<p class="hint">Private. Only you and admins can see these. The dashboard shows department averages (age and years of service), never yours.</p>' +
          '<div class="row"><label>Birth date<input type="date" id="md-birth" value="' + esc(pf.birthDate || "") + '"></label>' +
          '<label>Hire date<input type="date" id="md-hire" value="' + esc(pf.hireDate || "") + '"></label></div>' +
          '<div class="row"><button class="btn primary" type="submit">Save dates</button><span class="msg" id="md-msg" role="status"></span></div></form>';
      }
      html += "</div>";
      out.innerHTML = html;

      if ($("me-cal")) $("me-cal").onclick = function () { api.choosePerson(me.pos); };
      if ($("me-dates")) $("me-dates").onsubmit = function (e) {
        e.preventDefault();
        var bd = $("md-birth").value, hd = $("md-hire").value;
        if (bd && hd && hd <= bd) return api.say($("md-msg"), "The hire date must be after the birth date.", true);
        api.say($("md-msg"), "Saving…");
        b.setProfile(me.pos, { birthDate: bd || null, hireDate: hd || null })
          .then(function () { api.say($("md-msg"), "Saved."); }, function (er) { api.say($("md-msg"), er.message, true); });
      };
      $("me-contact").onsubmit = function (e) {
        e.preventDefault();
        var email = $("mc-email").value.trim();
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return api.say($("mc-msg"), "That email address doesn't look right.", true);
        api.say($("mc-msg"), "Saving…");
        b.saveContact({ contactEmail: email, phoneMobile: $("mc-mobile").value.trim(), phoneOther: $("mc-other").value.trim(), shareContact: $("mc-share").checked })
          .then(function () { api.renderAll(true); api.say($("mc-msg"), "Saved."); }, function (er) { api.say($("mc-msg"), er.message, true); });
      };
    }
    function kv(k, v) { return '<div class="kv"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + "</span></div>"; }

    /* ---------- Admin ---------- */
    function renderAdmin() {
      var out = $("admin-detail");
      if (!$("admin-users")) {
        out.innerHTML = '<p class="msg" id="admin-msg" role="status"></p>' +
          '<div class="card"><h3>Waiting for approval</h3><div id="admin-pending"><p class="hint">Loading…</p></div></div>' +
          '<div class="card"><div class="cal-head"><h3>Users</h3><input type="search" id="admin-q" class="grow" placeholder="Filter by name, email or position" aria-label="Filter users"></div>' +
          '<div class="table-wrap"><table class="list users"><thead><tr><th>Person</th><th>Roster position</th><th>Access</th><th>Status</th><th>Last sign-in</th></tr></thead>' +
          '<tbody id="admin-users"></tbody></table></div></div>' +
          '<datalist id="roster-dl">' + api.people().map(function (p) {
            return '<option value="' + esc(p.name + " · " + p.title + " (" + p.pos + ")") + '"></option>';
          }).join("") + "</datalist>";
        $("admin-q").oninput = function () { adminFilter = this.value.trim().toLowerCase(); drawUsers(); };
        out.addEventListener("click", onAdminClick);
        out.addEventListener("change", onAdminChange);
        out.addEventListener("submit", onAdminSubmit);
      }
      $("admin-q").value = adminFilter;
      api.backend().adminUsers().then(function (users) {
        adminUsersCache = users;
        drawPending();
        drawUsers();
      }, function (er) { api.say($("admin-msg"), er.message, true); });
    }

    function posLabel(pos) {
      var p = pos && api.byPos()[pos];
      return p ? esc(p.name || "Vacant") + ' <span class="hint">' + esc(p.title + " · " + pos) + "</span>" : '<span class="hint">—</span>';
    }

    function drawPending() {
      var pending = adminUsersCache.filter(function (u) { return u.status === "pending"; });
      $("admin-pending").innerHTML = pending.length ? '<ul class="hist pending">' + pending.map(function (u) {
        return '<li><div><b>' + esc(u.name) + "</b> " + '<span class="hint">' + esc(u.googleEmail) + "</span><br>" +
          (u.claimPos ? "Claims " + posLabel(u.claimPos) + (u.claimNote ? '<div class="hint">“' + esc(u.claimNote) + "”</div>" : "")
            : u.claimRequest ? 'Not on the list. Asks to be added as <b>' + esc(u.claimRequest.name) + "</b> · " + esc(u.claimRequest.rank) + " · " +
              esc(u.claimRequest.company) + " · Tour " + esc(u.claimRequest.tour) +
              (u.claimRequest.emplId ? " · ID " + esc(u.claimRequest.emplId) : "") + (u.claimRequest.note ? '<div class="hint">“' + esc(u.claimRequest.note) + "”</div>" : "")
            : '<span class="hint">Hasn\'t picked a roster entry yet.</span>') + "</div>" +
          '<div class="acts">' + (u.claimRequest && !u.claimPos
            ? '<button class="btn small primary" data-act="approve" data-id="' + esc(u.id) + '">Approve and add to roster</button>' +
              '<button class="btn small" data-act="reject" data-id="' + esc(u.id) + '">Reject request</button>'
            : u.claimPos
            ? '<button class="btn small primary" data-act="approve" data-id="' + esc(u.id) + '">Approve</button>' +
              '<button class="btn small" data-act="reject" data-id="' + esc(u.id) + '">Reject claim</button>'
            : '<button class="btn small" data-act="approve" data-id="' + esc(u.id) + '">Approve without roster link</button>') +
          "</div></li>";
      }).join("") + "</ul>" : '<p class="hint">Nobody is waiting.</p>';
    }

    function drawUsers() {
      var meId = api.backend().me().id;
      var rows = adminUsersCache.filter(function (u) {
        if (!adminFilter) return true;
        var p = u.pos && api.byPos()[u.pos];
        return [u.name, u.googleEmail, u.pos, p && p.name, u.role, u.status].join(" ").toLowerCase().indexOf(adminFilter) !== -1;
      });
      $("admin-users").innerHTML = rows.length ? rows.map(function (u) {
        var self = u.id === meId;
        return '<tr data-id="' + esc(u.id) + '"' + (u.status === "disabled" ? ' class="is-off"' : "") + ">" +
          "<td><b>" + esc(u.name) + "</b>" + (self ? ' <span class="hint">(you)</span>' : "") + '<br><span class="hint">' + esc(u.googleEmail) + "</span></td>" +
          "<td>" + posLabel(u.pos) + "<br>" +
          (u.pos ? '<button class="linkish small-link" data-act="unlink" data-id="' + esc(u.id) + '">Unlink</button> · ' : "") +
          '<button class="linkish small-link" data-act="show-link" data-id="' + esc(u.id) + '">' + (u.pos ? "Change" : "Link") + "</button>" +
          '<form class="link-form" data-id="' + esc(u.id) + '" hidden><input list="roster-dl" aria-label="Roster entry" placeholder="Type a name"><button class="btn small" type="submit">Link</button></form></td>' +
          '<td><select data-act="role" data-id="' + esc(u.id) + '" aria-label="Access">' + ["member", "editor", "admin"].map(function (r) {
            return '<option value="' + r + '"' + (u.role === r ? " selected" : "") + ">" + ROLE_LABEL[r] + "</option>";
          }).join("") + "</select></td>" +
          "<td>" + esc(u.status.charAt(0).toUpperCase() + u.status.slice(1)) + "<br>" + (self ? "" : u.status === "disabled"
            ? '<button class="linkish small-link" data-act="enable" data-id="' + esc(u.id) + '">Enable</button>'
            : '<button class="linkish small-link" data-act="disable" data-id="' + esc(u.id) + '">Disable</button>') + "</td>" +
          '<td class="mono">' + esc(u.lastLogin ? u.lastLogin.slice(0, 10) : "—") + "</td></tr>";
      }).join("") : '<tr><td colspan="5" class="hint">No users match.</td></tr>';
    }

    function act(id, body, okText) {
      api.say($("admin-msg"), "Saving…");
      return api.backend().adminAction(id, body).then(function () {
        api.say($("admin-msg"), okText);
        renderAdmin();
      }, function (er) { api.say($("admin-msg"), er.message, true); renderAdmin(); });
    }
    function userById(id) { return adminUsersCache.filter(function (u) { return u.id === id; })[0] || {}; }

    function onAdminClick(e) {
      var b = e.target.closest("button[data-act]");
      if (!b) return;
      var id = b.dataset.id, u = userById(id), a = b.dataset.act;
      if (a === "show-link") {
        var f = document.querySelector('.link-form[data-id="' + id + '"]');
        f.hidden = !f.hidden;
        if (!f.hidden) f.querySelector("input").focus();
        return;
      }
      if ((a === "disable" || a === "reject") && b.dataset.confirm !== "1") {
        b.dataset.confirm = "1"; b.textContent = "Confirm " + a; b.classList.add("danger");
        return;
      }
      var msgs = { approve: "Approved " + u.name + (u.claimRequest && !u.claimPos ? " and added " + u.claimRequest.name + " to the roster" : "") + ".",
        reject: "Rejected the request from " + u.name + ".", unlink: "Unlinked " + u.name + ".",
        disable: "Disabled " + u.name + ". They are signed out.", enable: "Enabled " + u.name + "." };
      act(id, { action: a }, msgs[a]);
    }
    function onAdminChange(e) {
      var s = e.target.closest('select[data-act="role"]');
      if (!s) return;
      act(s.dataset.id, { action: "role", role: s.value }, userById(s.dataset.id).name + " is now " + ROLE_LABEL[s.value] + ".");
    }
    function onAdminSubmit(e) {
      var f = e.target.closest(".link-form");
      if (!f) return;
      e.preventDefault();
      var m = POS_RE.exec(f.querySelector("input").value);
      if (!m || !api.byPos()[m[1]]) return api.say($("admin-msg"), "Pick a roster entry from the list.", true);
      act(f.dataset.id, { action: "link", pos: m[1] }, "Linked " + userById(f.dataset.id).name + " to " + (api.byPos()[m[1]].name || m[1]) + ".");
    }

    return { renderGate: renderGate, renderMe: renderMe, renderAdmin: renderAdmin };
  };
})(window);
