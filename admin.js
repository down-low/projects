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
    cell_moved: "Your cell is now on your existing account. Sign in with your cell once more to open it.",
  };
  // Why a cell sign-in didn't move into the account that owns its seat (functions: planPhoneSwitch).
  var CELL_NOTES = {
    staff: "Your cell belongs to an account with admin access. Sign in with Google, then add your cell on My page.",
    phone: "Your seat is linked to an account with a different cell number. Ask an admin to merge the two accounts.",
    disabled: "The account for your seat is disabled. Contact an admin.",
  };
  var ROLE_LABEL = { member: "Member", editor: "Editor", admin: "Admin" };
  var POS_RE = /([0-9]{1,2}[A-Z]{2,4}[0-9]{2,3}M)\s*\)?\s*$/;

  root.AccountViews = function (api) {
    var $ = api.$, esc = api.esc, M = root.TourMath;
    var roster = null, claimPick = null, adminFilter = "", adminUsersCache = [];

    /* ---------- Trade invite links (?t=<code>, Firebase) ----------
       Before sign-in: the trade and an answer form (answerInvite). Signed in and not yet approved: the Employee ID that
       proves it's the invited person (redeemInvite), which links and approves the account. The code survives sign-in. */
    function inviteCode() {
      try {
        var c = new URLSearchParams(location.search).get("t");
        if (c) sessionStorage.setItem("tradeInvite", c);
        return c || sessionStorage.getItem("tradeInvite");
      } catch (e) { return null; }
    }
    function dropInvite() {
      try { sessionStorage.removeItem("tradeInvite"); history.replaceState(null, "", location.pathname); } catch (e) { /* old browser */ }
    }
    function niceDate(s) { var d = api.fromIso(s); return api.shortDate(d) + ", " + d.getFullYear(); }
    function signInButton() {
      return api.backend().phoneSignIn ? phoneHtml() + '<p class="hint gate-or">or</p><button class="btn big" type="button" id="gate-in">Sign in with Google</button>'
        : '<button class="btn primary big" type="button" id="gate-in">Sign in with Google</button>';
    }
    /* Cell-number sign-in (Firebase): the cell, a texted 6-digit code, done. A staff-list cell is linked to its seat at
       once; anyone else lands on the claim screen. */
    function phoneHtml() {
      return '<form class="edit phone-in" id="ph-form" novalidate><label>Your cell number<input type="tel" id="ph-cell" inputmode="tel" autocomplete="tel" placeholder="(415) 555-0123"></label>' +
        '<div class="row"><button class="btn primary big" type="submit" id="ph-send">Text me a code</button></div>' +
        '<div id="ph-code-row" hidden><label>The 6-digit code we texted you<input type="text" id="ph-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>' +
        '<div class="row"><button class="btn primary big" type="button" id="ph-ok">Sign in</button><button class="linkish" type="button" id="ph-again">Send a new code</button></div></div>' +
        '<span class="msg" id="ph-msg" role="status"></span></form>';
    }
    function wirePhone() {
      var f = $("ph-form");
      if (!f) return;
      var msg = $("ph-msg"), b = api.backend();
      var send = function () {
        api.say(msg, "Sending…");
        b.sendCode($("ph-cell").value, "ph-send").then(function (num) {
          $("ph-code-row").hidden = false;
          api.say(msg, "Code sent to " + num.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") + ".");
          $("ph-code").focus();
        }, function (er) { api.say(msg, er.message, true); });
      };
      f.onsubmit = function (e) { e.preventDefault(); send(); };
      $("ph-again").onclick = send;
      var ok = function () {
        api.say(msg, "Signing in…");
        b.confirmCode($("ph-code").value).catch(function (er) { api.say(msg, er.message, true); });
      };
      $("ph-ok").onclick = ok;
      $("ph-code").oninput = function () { if (/^\d{6}$/.test(this.value.trim())) ok(); };
    }
    function wireSignIn(el) {
      wirePhone();
      if ($("gate-in")) $("gate-in").onclick = function () {
        api.backend().signIn().catch(function (er) { el.querySelector(".gate-card").insertAdjacentHTML("beforeend", '<p class="msg err" role="alert">' + esc(er.message) + "</p>"); });
      };
    }
    function renderInviteAnswer(el, code) {
      el.innerHTML = '<div class="card gate-card"><h2>Shift trade</h2><p class="hint" id="inv-body">Loading…</p></div>';
      api.backend().inviteInfo(code).then(function (info) {
        var card = el.querySelector(".gate-card");
        if (info.error) {
          card.innerHTML = "<h2>Shift trade</h2><p>" + esc(info.error) + ". Sign in to see the trade board.</p>" + signInButton();
          dropInvite();
          return wireSignIn(el);
        }
        var said = info.answer ? (info.answer.later ? "pay back later" : "they work your " + niceDate(info.answer.swapDate)) : "";
        var forWho = info.forName ? esc(info.forName) : "";
        card.innerHTML = "<h2>Shift trade</h2>" +
          (forWho ? "<p>Hi " + forWho + ", this trade invite is for you.</p>" : "") +
          "<p><b>" + esc(info.posterName) + "</b>" + (info.posterRank ? " (" + esc(info.posterRank) + ")" : "") + " wants to trade <b>" +
          esc(niceDate(info.date)) + "</b>, a 24-hr shift" + (info.station ? " at " + esc(info.station) : "") + ".</p>" +
          (info.note ? '<p class="trade-note">' + esc(info.note) + "</p>" : "") +
          (forWho ? '<p class="hint">Not ' + forWho + "? Don't answer here; ask " + esc(info.posterName) + " to send you your own link.</p>" : "") +
          (said ? "<p>You answered: <b>" + esc(said) + "</b>. You can change it below.</p>" : "") +
          (info.open && info.needsSignIn ? "<p>Sign in to answer.</p>" : "") +
          (info.open && !info.needsSignIn
            ? '<form class="edit" id="inv-form" novalidate><fieldset class="choice"><legend>I\'m interested</legend>' +
              '<label class="chk"><input type="radio" name="inv-kind" value="later" checked> Pay me back later</label>' +
              '<label class="chk"><input type="radio" name="inv-kind" value="swap"> Swap: they work one of my shifts</label>' +
              '<label class="indent">My day they\'d work<input type="date" id="inv-swap" disabled></label></fieldset>' +
              '<label>Note (optional)<input type="text" id="inv-note" maxlength="300"></label>' +
              '<label>Your Employee ID<input type="text" id="inv-empl" maxlength="6" placeholder="e.g. LE1234" autocapitalize="characters" autocomplete="off"></label>' +
              '<p class="hint">So only ' + (forWho || "the person this was sent to") + " can answer.</p>" +
              '<div class="row"><button class="btn primary" type="submit">Send my answer</button><span class="msg" id="inv-msg" role="status"></span></div></form>'
            : info.open ? "" : "<p>This trade is no longer open.</p>") +
          '<p class="hint">' + (info.used ? "Sign in to see it on the trade board." : "No account needed to answer. Sign in to see the whole trade board.") + "</p>" +
          signInButton();
        wireSignIn(el);
        var f = $("inv-form");
        if (!f) return;
        var swap = $("inv-swap");
        f.querySelectorAll("[name=inv-kind]").forEach(function (r) { r.onchange = function () { swap.disabled = f.querySelector("[name=inv-kind]:checked").value !== "swap"; }; });
        f.onsubmit = function (e) {
          e.preventDefault();
          var msg = $("inv-msg"), later = f.querySelector("[name=inv-kind]:checked").value === "later";
          if (!later && !swap.value) return api.say(msg, "Pick the day they'd work for you.", true);
          var empl = $("inv-empl").value.trim().toUpperCase();
          if (!/^[A-Z]{2}\d{4}$/.test(empl)) return api.say(msg, "Enter your Employee ID: two letters and four digits, e.g. LE1234.", true);
          api.say(msg, "Sending…");
          api.backend().answerInvite(code, later ? { later: true } : { swapDate: swap.value }, $("inv-note").value.trim(), empl)
            .then(function () { api.say(msg, "Sent. " + info.posterName + " will see it."); },
              function (er) { api.say(msg, er.message, true); });
        };
      }, function (er) {
        el.querySelector(".gate-card").innerHTML = "<h2>Shift trade</h2><p class=\"msg err\">" + esc(er.message) + "</p>" + signInButton();
        wireSignIn(el);
      });
    }
    function renderInviteRedeem(el, code, me) {
      el.innerHTML = '<div class="card gate-card"><h2>Confirm it\'s you</h2>' +
        '<p class="hint">Signed in as ' + esc(me.googleEmail) + ' · <button class="linkish" id="gate-out">Sign out</button></p>' +
        "<p>Enter your Employee ID. If it matches the person this trade invite was sent to, your account is set up right away.</p>" +
        '<form class="edit claim-form" id="inv-redeem" novalidate><label>Employee ID<input type="text" id="inv-id" maxlength="6" placeholder="e.g. LE1234" autocapitalize="characters"></label>' +
        '<div class="row"><button class="btn primary" type="submit">Confirm</button><span class="msg" id="inv-rmsg" role="status"></span></div></form>' +
        '<p><button class="linkish" type="button" id="inv-skip">Not you? Find yourself on the roster instead</button></p></div>';
      $("gate-out").onclick = function () { api.backend().signOut(); };
      $("inv-skip").onclick = function () { dropInvite(); renderGate(); };
      $("inv-redeem").onsubmit = function (e) {
        e.preventDefault();
        var id = $("inv-id").value.trim().toUpperCase(), msg = $("inv-rmsg");
        if (!/^[A-Z]{2}\d{4}$/.test(id)) return api.say(msg, "Employee ID is two letters and four digits, e.g. LE1234.", true);
        api.say(msg, "Checking…");
        api.backend().redeemInvite(code, id).then(function () { dropInvite(); location.reload(); }, function (er) { api.say(msg, er.message, true); });
      };
    }

    /* ---------- Sign-in and claim screen ---------- */
    /* "Verify with your cell": one texted code adds the cell to the signed-in account; the staff list then fills in the
       seat (Firebase only, store.js linkCell / confirmLink). id prefix keeps the claim screen and My page apart. */
    function cellLinkHtml(pre, title, lede) {
      return '<form class="edit cell-link" id="' + pre + '-form" novalidate><h3>' + esc(title) + "</h3><p class=\"hint\">" + esc(lede) + "</p>" +
        '<div class="row"><label>Cell number<input type="tel" id="' + pre + '-cell" maxlength="20" autocomplete="tel" placeholder="(415) 555-0100"></label>' +
        '<button class="btn primary" type="submit" id="' + pre + '-send">Text me a code</button></div>' +
        '<div class="row" id="' + pre + '-code-row" hidden><label>6-digit code<input type="text" id="' + pre + '-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>' +
        '<button class="btn primary" type="button" id="' + pre + '-confirm">Verify</button></div>' +
        '<span class="msg" id="' + pre + '-msg" role="status"></span></form>';
    }
    function wireCellLink(pre) {
      var b = api.backend(), msg = $(pre + "-msg");
      $(pre + "-form").onsubmit = function (e) {
        e.preventDefault();
        api.say(msg, "Sending…");
        b.linkCell($(pre + "-cell").value, pre + "-send").then(function (n) {
          api.say(msg, "Code sent to " + n.slice(2, 5) + "-" + n.slice(5, 8) + "-" + n.slice(8) + ".");
          $(pre + "-code-row").hidden = false;
          $(pre + "-code").focus();
        }, function (er) { api.say(msg, er.message, true); });
      };
      $(pre + "-confirm").onclick = function () {
        api.say(msg, "Checking…");
        b.confirmLink($(pre + "-code").value).catch(function (er) { api.say(msg, er.message, true); });
      };
    }

    function renderGate() {
      var me = api.backend().me();
      var el = $("gate");
      api.gate(true);
      var code = api.backend().inviteInfo ? inviteCode() : null;
      if (code && !me.signedIn) return renderInviteAnswer(el, code);
      if (code && !me.wrongSite && me.status === "pending") return renderInviteRedeem(el, code, me);
      var err = null;
      try { err = new URLSearchParams(location.search).get("auth_error"); } catch (e) { /* old browser */ }
      var errHtml = err ? '<p class="msg err" role="alert">' + esc(AUTH_ERRORS[err] || "Sign-in failed. Try again.") + "</p>" : "";

      if (!me.signedIn) {
        var how = me.google && api.backend().signIn
          ? signInButton()
          : me.google
          ? '<a class="btn primary big" href="auth/login">Sign in with Google</a>'
          : '<p class="hint">' + esc(AUTH_ERRORS.not_configured) + "</p>";
        var dev = me.devLogin
          ? '<form class="dev-login" action="auth/dev" method="get"><label for="dev-email">Developer sign-in (test mode)</label>' +
            '<div class="row"><input type="email" id="dev-email" name="email" required placeholder="name@example.org">' +
            '<button class="btn" type="submit">Sign in</button></div></form>'
          : "";
        el.innerHTML = '<div class="card gate-card"><h2>Sign in</h2><p>The tour schedule is for department members: who\'s working, your own tour, and shift trades. ' +
          (api.backend().phoneSignIn ? "Sign in with the cell number the department has for you; we text you a code.</p>" : "Sign in with your Google account.</p>") +
          errHtml + how + dev + "</div>";
        wireSignIn(el);
        return;
      }

      // The admin site, signed in without editor or admin access: point to the employee app.
      if (me.wrongSite) {
        el.innerHTML = '<div class="card gate-card"><h2>Admins only</h2><p>This site is the back office for admins and editors. ' +
          (me.appUrl ? 'Open the tour schedule at <a href="' + esc(me.appUrl) + '">' + esc(me.appUrl.replace(/^https?:\/\//, "")) + "</a>." : "Open the tour schedule app instead.") +
          '</p><p class="hint">Signed in as ' + esc(me.googleEmail) + ' · <button class="linkish" id="gate-out">Sign out</button></p></div>';
        $("gate-out").onclick = function () { api.backend().signOut(); };
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
        (me.phone && !me.claimPos && !req ? "<p>Your cell isn't on the department's staff list yet. Find yourself below and an admin will approve it.</p>" : "") +
        errHtml + waiting +
        (me.cellNote && CELL_NOTES[me.cellNote] ? '<p class="msg err" role="status">' + esc(CELL_NOTES[me.cellNote]) + "</p>" : "") +
        (api.backend().linkCell && !me.phone && !me.claimPos && !req
          ? cellLinkHtml("gl", "Verify with your cell (fastest)", "We text you a code. If your cell is on the department's staff list, your position fills in by itself.") +
            '<p class="hint">Or find yourself by name below.</p>'
          : "") +
        '<form class="edit claim-form" id="claim-form"' + (me.claimPos ? " hidden" : "") + ' novalidate>' +
        "<p>Find yourself on the roster so the schedule knows which position is yours.</p>" +
        '<label for="claim-q">Your name or position number</label>' +
        '<input type="search" id="claim-q" autocomplete="off" placeholder="First or last name, or position number">' +
        '<ul class="pick" id="claim-list"></ul>' +
        '<p id="claim-chosen" class="claim-chosen" hidden></p>' +
        (api.backend().hosted === "firebase"
          ? '<div id="claim-id-row" hidden><label for="claim-id">Your Employee ID</label><input type="text" id="claim-id" maxlength="6" placeholder="e.g. LE1234" autocapitalize="characters" autocomplete="off">' +
            '<p class="hint">If it matches the one on file, you\'re in right away. Otherwise an admin approves your request.</p></div>'
          : "") +
        '<label for="claim-note">Note for the admin (optional)</label><input type="text" id="claim-note" maxlength="300" placeholder="e.g. Captain E33, Tour 12">' +
        '<div class="row"><button class="btn primary" type="submit" id="claim-go">Continue</button><span class="msg" id="claim-msg" role="status"></span></div>' +
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
      if ($("gl-form")) wireCellLink("gl");
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
      // First name, last name or both, in any order ("dave", "lester", "dave lester"), or a position number: the
      // roster's short name plus the staff-list full name (r.full). Always a list to tap, never an automatic pick.
      // Seats already linked to an account show greyed, so their owner knows to sign in the way they did before.
      function showMatches() {
        var q = $("claim-q").value.trim();
        if (claimPick) unpick();
        if (!roster || q.length < 2) { listEl.innerHTML = ""; return; }
        var all = roster.filter(function (r) { return root.TourMath.wordsMatch(q, r.name + " " + (r.full || "") + " " + r.title + " " + r.pos); });
        var hits = all.slice(0, 12);
        listEl.innerHTML = hits.length ? hits.map(function (r) {
          var label = "<b>" + esc(r.full || r.name) + "</b> " + '<span class="hint">' + esc(r.title) + " · " + esc(r.pos) + "</span>";
          return r.taken
            ? '<li><div class="pick-btn taken">' + label + '<div class="hint">Already linked to an account. If that\'s you, sign in the way you did before (Google or your cell), or ask an admin to move it.</div></div></li>'
            : '<li><button type="button" class="pick-btn" data-pos="' + esc(r.pos) + '">' + label + "</button></li>";
        }).join("") + (all.length > hits.length ? '<li class="hint">More match: type more of your name.</li>' : "")
          : '<li class="hint">No roster entry matches. Check the spelling, try your last name, or tap "I\'m not on the list" below.</li>';
      }
      function pick(r) {
        claimPick = r.pos;
        $("claim-chosen").hidden = false;
        $("claim-chosen").innerHTML = "That's you: <b>" + esc(r.full || r.name) + "</b> · " + esc(r.title) + " · " + esc(r.pos) +
          ' <button class="linkish" type="button" id="claim-not-me">Not me</button>';
        $("claim-not-me").onclick = function () { $("claim-q").value = ""; unpick(); $("claim-q").focus(); };
        listEl.innerHTML = "";
        if ($("claim-id-row")) { $("claim-id-row").hidden = false; $("claim-id").focus(); }
      }
      function unpick() {
        claimPick = null;
        $("claim-chosen").hidden = true;
        if ($("claim-id-row")) $("claim-id-row").hidden = true;
      }
      $("claim-q").oninput = showMatches;
      listEl.onclick = function (e) {
        var b = e.target.closest("button[data-pos]");
        if (!b) return;
        var r = roster.filter(function (x) { return x.pos === b.dataset.pos && !x.taken; })[0];
        if (r) pick(r);
      };
      $("claim-form").onsubmit = function (e) {
        e.preventDefault();
        var msg = $("claim-msg");
        if (!claimPick) return api.say(msg, "Pick your name from the list first.", true);
        var empl = $("claim-id") ? $("claim-id").value.trim().toUpperCase() : "";
        if (empl && !/^[A-Z]{2}\d{4}$/.test(empl)) return api.say(msg, "Employee ID is two letters and four digits, e.g. LE1234.", true);
        api.say(msg, empl ? "Checking…" : "Sending…");
        api.backend().claim(claimPick, $("claim-note").value.trim(), empl || null).then(function (me) {
          // A matching Employee ID approves the account: reload into the schedule.
          if (me && me.status === "active") { location.reload(); return; }
          renderGate();
          var wait = document.querySelector("#gate .claim-wait");
          if (empl && wait) wait.insertAdjacentHTML("afterbegin", '<p class="msg err" role="status">That Employee ID didn\'t match the one on file for that position.</p>');
        }, function (er) { api.say(msg, er.message, true); });
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

      if (b.linkCell && !me.phone) {
        html += '<div class="card">' + cellLinkHtml("ml", "Add my cell for sign-in", "Then you can sign in with your cell or with Google, and both open this same account.") + "</div>";
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
      if ($("ml-form")) wireCellLink("ml");
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
          }).join("") + "</datalist>" + (api.backend().launchSent ? '<div class="card launch" id="launch"></div>' : "") +
          (api.backend().importBackup ? importHtml() : "");
        if ($("import-form")) wireImport();
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
      if ($("launch")) drawLaunch();
    }

    /* ---------- Invite people (Firebase admin site): the launch text with the sign-up link ----------
       Group texts from the admin's own phone, 10 people each, with their staff-list cells filled in; or one by one; or,
       once Twilio is approved, one personal text each from the department number. Contact cards (.vcf) for the chosen
       people, logged. Sent marks live in launchInvites/{pos}. */
    var launch = { dv: "", bt: "", co: "", grp: "", notOn: true, hideSent: true, msg: null, run: null, twilio: null, open: false };
    var GROUP = 10;
    function appLink() { return root.FIREBASE_APP_URL || location.origin + "/"; }
    function launchMsg() {
      return launch.msg != null ? launch.msg
        : "I'm using the new SFFD tour schedule app to see who's working and trade shifts. Sign in with your cell number: " + appLink();
    }
    function launchSms(cells, body) {
      var ios = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent), enc = encodeURIComponent(body);
      var nums = cells.map(function (c) { return String(c).replace(/[^0-9+]/g, ""); }).filter(Boolean);
      if (ios && nums.length > 1) return "sms:/open?addresses=" + nums.join(",") + "&body=" + enc;
      return "sms:" + nums.join(",") + (ios ? "&" : "?") + "body=" + enc;
    }
    function where(p) { return Organization.locate(p.company || p.title) || null; }
    // Everyone matching the filters: [{p, cell, on, sent}], in station order.
    function launchPeople() {
      var b = api.backend(), cells = b.contacts ? b.contacts() : {}, sent = b.launchSent(), M = root.TourMath;
      return api.people().filter(function (p) {
        var o = where(p);
        if (launch.dv && (!o || o.division.id !== launch.dv)) return false;
        if (launch.bt && (!o || o.battalion.id !== launch.bt)) return false;
        if (launch.co && (p.company || "") !== launch.co) return false;
        if (launch.grp && M.rankGroup(p.rank) !== launch.grp) return false;
        return true;
      }).map(function (p) {
        var c = cells[p.pos];
        var raw = c && c.staffList ? c.phoneMobile : null;
        return { p: p, cell: M.normCell(raw), badCell: !!raw && !M.normCell(raw), on: b.onTool && b.onTool(p.pos) === true, sent: sent[p.pos] || null };
      }).filter(function (x) { return !(launch.notOn && x.on); })
        .sort(function (a, c) { return Organization.order(a.p.company || a.p.title) - Organization.order(c.p.company || c.p.title) || a.p.name.localeCompare(c.p.name); });
    }
    function drawLaunch() {
      var el = $("launch"), b = api.backend();
      if (launch.twilio === null && b.launchStatus) { launch.twilio = false; b.launchStatus().then(function (r) { launch.twilio = !!r.twilio; drawLaunch(); }, function () {}); }
      var all = launchPeople(), todo = all.filter(function (x) { return x.cell && !(launch.hideSent && x.sent); });
      var groups = [];
      for (var i = 0; i < todo.length; i += GROUP) groups.push(todo.slice(i, i + GROUP));
      var opts = function (list, cur) { return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join(""); };
      var dvs = [], bts = [];
      Organization.DIVISIONS.forEach(function (dv) {
        if (dv.hidden) return;
        dvs.push([dv.id, dv.name]);
        dv.battalions.forEach(function (bt) { if (!launch.dv || launch.dv === dv.id) bts.push([bt.id, bt.name]); });
      });
      var cos = Array.from(new Set(api.people().filter(function (p) {
        var o = where(p); return p.company && (!launch.bt || (o && o.battalion.id === launch.bt)) && (!launch.dv || (o && o.division.id === launch.dv));
      }).map(function (p) { return p.company; }))).sort(function (a, c) { return Organization.order(a) - Organization.order(c); });
      var grps = Array.from(new Set(api.people().map(function (p) { return root.TourMath.rankGroup(p.rank); }))).sort();
      var noCell = all.filter(function (x) { return !x.cell; }).length, sentN = all.filter(function (x) { return x.sent; }).length;
      // Cells on file that aren't a phone number (fix them on the person's Employee card).
      var bad = all.filter(function (x) { return x.badCell; });
      var run = launch.run;
      el.innerHTML = '<details class="fold"' + (launch.open ? " open" : "") + ' id="launch-fold"><summary><h3>Invite people</h3><span class="fold-sum">Text the sign-up link</span></summary>' +
        '<p class="hint">They sign in with the cell number on the staff list and a texted code, and land on their own schedule. No Google account or approval needed.</p>' +
        '<div class="trade-filters launch-filters"><label>Division<select data-l="dv"><option value="">All</option>' + opts(dvs, launch.dv) + "</select></label>" +
        '<label>Battalion<select data-l="bt"><option value="">All</option>' + opts(bts, launch.bt) + "</select></label>" +
        '<label>Station<select data-l="co"><option value="">All</option>' + opts(cos.map(function (c) { return [c, c]; }), launch.co) + "</select></label>" +
        '<label>Rank group<select data-l="grp"><option value="">All</option>' + opts(grps.map(function (g) { return [g, g]; }), launch.grp) + "</select></label></div>" +
        '<label class="chk"><input type="checkbox" data-l="notOn"' + (launch.notOn ? " checked" : "") + "> Only people not on the tool yet</label>" +
        '<label class="chk"><input type="checkbox" data-l="hideSent"' + (launch.hideSent ? " checked" : "") + "> Hide people already texted</label>" +
        '<p class="launch-count"><b>' + all.length + "</b> people · " + todo.length + " to text" + (noCell ? " · " + noCell + " with no cell on file" : "") + (sentN ? " · " + sentN + " already texted" : "") + "</p>" +
        (bad.length ? '<p class="msg err">' + bad.length + (bad.length === 1 ? " cell on file isn't" : " cells on file aren't") + " a phone number: " +
          esc(bad.slice(0, 8).map(function (x) { return x.p.name; }).join(", ")) + (bad.length > 8 ? "…" : "") + ". Fix them on their Employee cards.</p>" : "") +
        '<label>Message<textarea id="launch-msg" rows="3" maxlength="600">' + esc(launchMsg()) + "</textarea></label>" +
        (run
          ? (run.i < run.list.length
            ? '<div class="invite-run"><span class="hint">' + (run.i + 1) + " of " + run.list.length + "</span> <b>" + esc(run.list[run.i].p.name) + '</b> <span class="hint">' + esc(run.list[run.i].p.title) + "</span>" +
              '<div class="row"><a class="btn small primary" target="_blank" rel="noopener" data-l1="send" href="' + esc(launchSms([run.list[run.i].cell], launchMsg())) + '">Text ' + esc(run.list[run.i].p.name) + "</a>" +
              '<button class="btn small" data-l1="skip">Skip</button><button class="btn small" data-l1="stop">Done</button></div></div>'
            : '<div class="row"><span class="hint">All done.</span><button class="btn small" data-l1="stop">Close</button></div>')
          : (groups.length
            ? '<p class="hint">Group texts from your phone, ' + GROUP + " people each. Everyone in a group sees the others' replies; use <b>One by one</b> to avoid that.</p>" +
              '<ul class="tlist launch-groups">' + groups.map(function (g, gi) {
                return "<li><div><b>Group " + (gi + 1) + " of " + groups.length + "</b> · " + g.length + ' people<div class="hint">' + esc(g.map(function (x) { return x.p.name; }).join(", ")) + "</div></div>" +
                  '<div class="row"><a class="btn small primary" target="_blank" rel="noopener" data-lg="' + gi + '" href="' + esc(launchSms(g.map(function (x) { return x.cell; }), launchMsg())) + '">Open in Messages</a>' +
                  '<button class="btn small" data-lmark="' + gi + '">Mark sent</button></div></li>';
              }).join("") + "</ul>" +
              '<div class="row"><button class="btn small" data-l1="start">One by one (' + todo.length + ")</button>" +
              '<button class="btn small" data-l1="vcf">Download contact cards (' + todo.length + ")</button>" +
              (launch.twilio ? '<button class="btn small" data-l1="twilio">Send from department number (' + todo.length + ")</button>" : "") + "</div>"
            : '<p class="hint">Nobody left to text with these filters.</p>')) +
        '<span class="msg" id="launch-say" role="status"></span></details>';
      el._groups = groups; el._todo = todo;
      wireLaunch(el);
    }
    function wireLaunch(el) {
      var b = api.backend(), say = function (t, bad) { api.say($("launch-say"), t, bad); };
      $("launch-fold").addEventListener("toggle", function () { launch.open = this.open; });
      el.querySelectorAll("[data-l]").forEach(function (c) {
        c.onchange = function () {
          var k = c.dataset.l;
          launch[k] = c.type === "checkbox" ? c.checked : c.value;
          if (k === "dv") { launch.bt = ""; launch.co = ""; }
          if (k === "bt") launch.co = "";
          launch.run = null;
          drawLaunch();
        };
      });
      $("launch-msg").onchange = function () { launch.msg = this.value; drawLaunch(); };
      el.querySelectorAll("[data-lmark]").forEach(function (x) {
        x.onclick = function () {
          var g = el._groups[+x.dataset.lmark];
          b.launchMark(g.map(function (y) { return y.p.pos; }), "group").then(function () { say("Marked " + g.length + " as texted."); drawLaunch(); }, function (er) { say(er.message, true); });
        };
      });
      el.querySelectorAll("[data-lg]").forEach(function (a) {
        a.addEventListener("click", function () { say("After you send it, tap Mark sent."); });
      });
      el.querySelectorAll("[data-l1]").forEach(function (x) {
        var act = x.dataset.l1;
        if (act === "send") {
          x.addEventListener("click", function () {
            var cur = launch.run.list[launch.run.i];
            launch.run.i++;
            b.launchMark([cur.p.pos], "single").catch(function () {});
            setTimeout(drawLaunch, 400);
          });
          return;
        }
        x.onclick = function () {
          if (act === "start") { launch.run = { list: el._todo.slice(), i: 0 }; drawLaunch(); }
          else if (act === "skip") { launch.run.i++; drawLaunch(); }
          else if (act === "stop") { launch.run = null; drawLaunch(); }
          else if (act === "vcf") downloadCards(el._todo, say);
          else if (act === "twilio") {
            if (x.dataset.confirm !== "1") { x.dataset.confirm = "1"; x.textContent = "Confirm: text " + el._todo.length + " people"; x.classList.add("danger"); return; }
            x.disabled = true;
            say("Sending…");
            b.launchSend(el._todo.map(function (y) { return y.p.pos; }), launchMsg()).then(function (r) {
              say("Sent " + r.sent + (r.failed ? ", " + r.failed + " failed" : "") + ".");
              drawLaunch();
            }, function (er) { x.disabled = false; say(er.message, true); });
          }
        };
      });
    }
    // Contact cards for the chosen people (name, rank and station, cell), saved on this device; the download is logged.
    function downloadCards(list, say) {
      var withCell = list.filter(function (x) { return x.cell; });
      if (!withCell.length) return say("No cells to save.", true);
      var vesc = function (t) { return String(t).replace(/[\\;,]/g, function (c) { return "\\" + c; }); };
      var cards = withCell.map(function (x) {
        var parts = x.p.name.split(","), last = parts[0].trim(), first = (parts[1] || "").trim();
        return ["BEGIN:VCARD", "VERSION:3.0", "N:" + vesc(last) + ";" + vesc(first) + ";;;", "FN:" + vesc((first ? first + " " : "") + last),
          "ORG:SFFD", "TITLE:" + vesc(x.p.rank + (x.p.company ? " " + x.p.company : "")), "TEL;TYPE=CELL:" + x.cell, "END:VCARD"].join("\r\n");
      }).join("\r\n");
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([cards + "\r\n"], { type: "text/vcard" }));
      a.download = "sffd-contacts.vcf";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      api.backend().launchAudit(withCell.length).catch(function () {});
      say("Saved " + withCell.length + " contact cards. The file has cell numbers: delete it once they're imported.");
    }

    /* Cut-over (Firebase only, CUTOVER.md): the backup file saved on the claude.ai page (Download backup) is loaded straight
       from this device. "Test copy" adds and updates records; "Replace everything" makes Firestore hold exactly the file's
       records (accounts and contact info stay). Only counts are shown; the file holds cell numbers, so delete it afterwards.
       Mode: the "Test copy" banner stays on until an admin sets the copy live. */
    function importHtml() {
      var mode = api.backend().siteMode ? api.backend().siteMode() : null;
      return '<form class="card edit" id="import-form" novalidate><h3>Cut-over</h3>' +
        '<p class="hint">Loads the records from a backup file saved on the claude.ai page (<b>Download backup</b>). ' +
        "<b>Import as test copy</b> adds and updates records. <b>Replace everything</b> (cut-over day) also removes records that aren't in the file, " +
        "so this site holds exactly the page's records; accounts and contact info stay. Afterwards, delete the file: it holds cell numbers.</p>" +
        '<label>Backup file<input type="file" id="import-file" accept=".json,application/json"></label>' +
        '<div class="row"><button class="btn" type="submit" id="import-test">Import as test copy</button>' +
        '<button class="btn danger" type="button" id="import-replace">Replace everything (cut-over)</button>' +
        '<span class="msg" id="import-msg" role="status"></span></div>' +
        '<div class="table-wrap" id="import-counts" hidden></div>' +
        '<h4>Mode</h4><div class="row"><span id="mode-now">' + modeText(mode) + "</span>" +
        '<button class="btn small" type="button" id="mode-set">' + (mode === "live" ? "Back to test copy" : "Set live") + "</button>" +
        '<span class="msg" id="mode-msg" role="status"></span></div></form>';
    }
    function modeText(mode) {
      return mode === "live" ? "<b>Live.</b> No banner; this is the schedule." : "<b>Test copy.</b> Everyone sees a “Test copy” banner.";
    }
    function wireImport() {
      $("import-form").onsubmit = function (e) { e.preventDefault(); runImport(false); };
      $("import-replace").onclick = function () {
        if (this.dataset.confirm !== "1") { this.dataset.confirm = "1"; this.textContent = "Confirm: replace everything"; return; }
        this.dataset.confirm = ""; this.textContent = "Replace everything (cut-over)";
        runImport(true);
      };
      $("mode-set").onclick = function () {
        var b = api.backend(), next = b.siteMode() === "live" ? "test" : "live";
        if (next === "live" && this.dataset.confirm !== "1") { this.dataset.confirm = "1"; this.textContent = "Confirm: set live"; return; }
        this.dataset.confirm = "";
        api.say($("mode-msg"), "Saving…");
        b.setSiteMode(next).then(function () {
          $("mode-now").innerHTML = modeText(next);
          $("mode-set").textContent = next === "live" ? "Back to test copy" : "Set live";
          api.say($("mode-msg"), "Saved.");
        }, function (er) { api.say($("mode-msg"), er.message, true); });
      };
    }
    function runImport(replace) {
      var file = $("import-file").files[0], msg = $("import-msg");
      if (!file) return api.say(msg, "Choose the backup file first.", true);
      api.say(msg, "Reading…");
      file.text().then(function (text) {
        var data;
        try { data = JSON.parse(text); } catch (er) { throw new Error("That file isn't a backup (not JSON)."); }
        return api.backend().importBackup(data, { replace: replace }, function (t) { api.say(msg, t); });
      }).then(function (counts) {
        var keys = Object.keys(counts).sort(), off = keys.filter(function (k) { return counts[k].backup !== counts[k].firestore; });
        api.say(msg, off.length ? "Done, but " + off.length + " collection" + (off.length === 1 ? "" : "s") + " don't match the file (marked below)."
          : "Done. Every count matches the file.", !!off.length);
        $("import-counts").hidden = false;
        $("import-counts").innerHTML = '<table class="list"><thead><tr><th>Collection</th><th class="num">In the file</th><th class="num">On this site</th><th></th></tr></thead><tbody>' +
          keys.map(function (k) {
            var c = counts[k], ok = c.backup === c.firestore;
            return "<tr><td>" + esc(k) + '</td><td class="num">' + c.backup + '</td><td class="num">' + c.firestore + "</td><td>" + (ok ? "✓" : '<b class="err">differs</b>') + "</td></tr>";
          }).join("") + "</tbody></table>";
      }, function (er) { api.say(msg, er.message, true); });
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
        return M.wordsMatch(adminFilter, [u.name, u.googleEmail, u.pos, p && p.name, u.role, u.status].join(" "));
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
            : '<button class="linkish small-link" data-act="disable" data-id="' + esc(u.id) + '">Disable</button>') +
          (!self && !u.pos && !u.claimPos && api.backend().mergeAccounts
            ? ' · <button class="linkish small-link" data-act="show-merge" data-id="' + esc(u.id) + '">Merge into…</button>' +
              '<form class="merge-form" data-id="' + esc(u.id) + '" hidden><select aria-label="Account to keep">' +
              adminUsersCache.filter(function (o) { return o.id !== u.id; }).map(function (o) {
                return '<option value="' + esc(o.id) + '">' + esc(o.name + " · " + (o.googleEmail || "") + (o.pos ? " · " + o.pos : "")) + "</option>";
              }).join("") + '</select><button class="btn small danger" type="submit">Merge (removes this account)</button></form>'
            : "") + "</td>" +
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
      if (a === "show-merge") {
        var mf = document.querySelector('.merge-form[data-id="' + id + '"]');
        mf.hidden = !mf.hidden;
        return;
      }
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
      var mf = e.target.closest(".merge-form");
      if (mf) {
        e.preventDefault();
        var keep = mf.querySelector("select").value, from = userById(mf.dataset.id), into = userById(keep);
        api.say($("admin-msg"), "Merging…");
        return api.backend().mergeAccounts(mf.dataset.id, keep).then(function () {
          api.say($("admin-msg"), "Merged " + from.name + " into " + into.name + ". Either sign-in now opens " + into.name + "'s account.");
          renderAdmin();
        }, function (er) { api.say($("admin-msg"), er.message, true); });
      }
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
