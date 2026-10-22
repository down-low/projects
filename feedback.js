/* Feedback about the app itself (problems, ideas, questions), separate from "Something wrong?" (schedule data).
 * window.FeedbackViews(api) -> {open, refresh, render, count, canSend, isAdmin, wire}. `api` comes from app.js.
 * - Anyone who can send (backend().sendFeedback, canFeedback()) opens a short form from the header link or the More sheet;
 *   it can carry what they were looking at (tab, date or person, site, screen width; never contact details). Their own
 *   feedback, with its state and any reply, shows below the form.
 * - Admins (backend().handleFeedback) see everything on the Feedback view: Done / Reopen with a reply the sender sees,
 *   Delete, and Copy all open (plain text to paste to Claude).
 * Stored like corrections, one record per member (`feedback/<user id>` = {items: {<id>: feedback}}): members read and
 * write their own, admins read and update all.
 */
(function (root) {
  "use strict";

  root.FeedbackViews = function (api) {
    var $ = api.$, esc = api.esc;
    var KINDS = [["problem", "Problem"], ["idea", "Idea"], ["question", "Question"]];
    var KIND_LABEL = { problem: "Problem", idea: "Idea", question: "Question" };
    var MAX = 2000;
    var ui = { kind: "problem", show: "open", sent: false };

    function backend() { return api.backend(); }
    function canSend() { var b = backend(); return !!(b && b.sendFeedback && (!b.canFeedback || b.canFeedback())); }
    function isAdmin() { var b = backend(); return !!(b && b.handleFeedback && b.canEdit && b.canEdit()); }
    function list() { return (api.recs().feedback || []).slice().sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }); }
    function mine() { var b = backend(), uid = b && b.userId ? b.userId() : null; return list().filter(function (f) { return f.owner === uid; }); }
    function count() { return list().filter(function (f) { return f.state === "open"; }).length; }
    function when(isoTs) { var d = new Date(isoTs); return isNaN(d) ? "" : api.shortDate(d); }
    function who(f) { var p = f.byKey && api.byPos()[f.byKey]; return f.byName || (p ? p.name : "A member"); }

    // ---------- The form (sheet) ----------
    function open() {
      ui.sent = false;
      draw();
      $("feedback-sheet").hidden = false;
      var t = $("fb-text");
      if (t) t.focus();
    }
    function close() { $("feedback-sheet").hidden = true; }
    // Records changed: once something was sent, redraw so it shows under "Your feedback" (the text box is empty then).
    function refresh() { if (ui.sent && !$("feedback-sheet").hidden) draw(); }
    function draw() {
      var own = mine();
      $("feedback-body").innerHTML = (ui.sent ? '<p class="msg">Thanks, sent to the admins.</p>' : "") +
        '<form class="edit fb-form" id="fb-form" novalidate>' +
        '<p class="hint">Tell us what isn\'t working or what would help. For a wrong seat, leave or tour, use <b>Something wrong?</b> on the person\'s page instead.</p>' +
        '<div class="seg" role="group" aria-label="Kind">' + KINDS.map(function (k) {
          return '<button class="btn small' + (ui.kind === k[0] ? " primary" : "") + '" type="button" data-fbkind="' + k[0] + '" aria-pressed="' +
            (ui.kind === k[0]) + '">' + k[1] + "</button>";
        }).join("") + "</div>" +
        '<label>What happened, or what would help?<textarea id="fb-text" rows="5" maxlength="' + MAX + '"></textarea></label>' +
        '<label class="chk"><input type="checkbox" id="fb-ctx" checked> Include what I was looking at</label>' +
        '<p class="hint" id="fb-ctx-text">' + esc(api.context()) + "</p>" +
        '<div class="row"><button class="btn primary" type="submit">Send</button><span class="msg" id="fb-msg" role="status"></span></div></form>' +
        (own.length ? '<h3 class="sub-h">Your feedback</h3><ul class="tlist fb-list">' + own.map(function (f) {
          return "<li><div><span class=\"tag\">" + esc(KIND_LABEL[f.kind] || f.kind) + "</span> " + esc(when(f.createdAt)) +
            " · " + esc(f.state === "open" ? "Open" : "Done") + "<div>" + esc(f.text) + "</div>" +
            (f.reply ? '<div class="hint">Reply: “' + esc(f.reply) + "”</div>" : "") + "</div></li>";
        }).join("") + "</ul>" : "");
      $("feedback-body").querySelectorAll("[data-fbkind]").forEach(function (b) {
        b.onclick = function () { ui.kind = b.dataset.fbkind; var t = $("fb-text").value; draw(); $("fb-text").value = t; };
      });
      $("fb-ctx").onchange = function () { $("fb-ctx-text").hidden = !this.checked; };
      $("fb-form").onsubmit = function (e) { e.preventDefault(); send(); };
    }
    function send() {
      var msg = $("fb-msg"), text = $("fb-text").value.trim();
      if (!text) return api.say(msg, "Write a few words first.", true);
      api.say(msg, "Sending…");
      backend().sendFeedback({ kind: ui.kind, text: text.slice(0, MAX), context: $("fb-ctx").checked ? api.context() : null }).then(function () {
        ui.sent = true;
        draw();
        api.renderAll();
      }, function (er) { api.say(msg, er.message, true); });
    }

    // ---------- Admin list ----------
    function plain(f) {
      return "[" + (KIND_LABEL[f.kind] || f.kind) + "] " + when(f.createdAt) + " · " + who(f) + "\n" + f.text + (f.context ? "\n(" + f.context + ")" : "");
    }
    function render() {
      var el = $("feedback-detail");
      if (!isAdmin()) { el.innerHTML = '<div class="empty">Only admins see everyone\'s feedback.</div>'; return; }
      var all = list(), shown = all.filter(function (f) { return ui.show === "all" ? true : ui.show === "open" ? f.state === "open" : f.state !== "open"; });
      el.innerHTML = '<div class="card"><h2 class="view-title">Feedback</h2>' +
        '<p class="hint">Sent by members from <b>Feedback</b>. Mark it done with a reply they\'ll see, or copy the open ones to paste to Claude.</p>' +
        '<div class="row"><p>' + count() + ' open</p><button class="btn small" type="button" id="fb-new">Send feedback</button>' +
        '<button class="btn small" type="button" id="fb-copy"' + (count() ? "" : " disabled") + '>Copy all open</button></div>' +
        '<div class="seg" role="group" aria-label="Show">' + [["open", "Open"], ["done", "Done"], ["all", "All"]].map(function (s) {
          return '<button class="btn small' + (ui.show === s[0] ? " primary" : "") + '" type="button" data-fbshow="' + s[0] + '">' + s[1] + "</button>";
        }).join("") + "</div>" +
        (shown.length ? '<ul class="tlist fb-list">' + shown.map(function (f) {
          var open = f.state === "open";
          return '<li><div><span class="tag">' + esc(KIND_LABEL[f.kind] || f.kind) + "</span> <b>" + esc(who(f)) + "</b> " +
            '<span class="hint">' + esc(when(f.createdAt)) + (open ? "" : " · done") + "</span>" +
            '<div class="fb-text">' + esc(f.text) + "</div>" + (f.context ? '<div class="hint">' + esc(f.context) + "</div>" : "") +
            (f.reply ? '<div class="hint">Reply: “' + esc(f.reply) + "”</div>" : "") +
            (open ? '<div class="row fb-reply"><input type="text" maxlength="500" placeholder="Reply (optional, the sender sees it)" data-fbreply="' + esc(f.id) + '"></div>' : "") +
            '</div><div class="acts">' +
            (open ? '<button class="btn small primary" type="button" data-fbdone="' + esc(f.id) + '">Done</button>'
              : '<button class="btn small" type="button" data-fbreopen="' + esc(f.id) + '">Reopen</button>') +
            (backend().deleteFeedback ? '<button class="btn small danger" type="button" data-fbdel="' + esc(f.id) + '">Delete</button>' : "") +
            "</div></li>";
        }).join("") + "</ul>" : '<p class="hint">Nothing here.</p>') + '<span class="msg" id="fbl-msg" role="status"></span></div>';
      var fail = function (er) { api.say($("fbl-msg"), er.message, true); };
      $("fb-new").onclick = open;
      $("fb-copy").onclick = function () {
        var text = all.filter(function (f) { return f.state === "open"; }).map(plain).join("\n\n");
        var done = function () { api.say($("fbl-msg"), "Copied " + count() + " to the clipboard."); };
        try { navigator.clipboard.writeText(text).then(done, function () { api.say($("fbl-msg"), "Couldn't copy here.", true); }); }
        catch (e) { api.say($("fbl-msg"), "Couldn't copy here.", true); }
      };
      el.querySelectorAll("[data-fbshow]").forEach(function (b) { b.onclick = function () { ui.show = b.dataset.fbshow; render(); }; });
      el.querySelectorAll("[data-fbdone]").forEach(function (b) {
        b.onclick = function () {
          var r = el.querySelector('[data-fbreply="' + b.dataset.fbdone + '"]');
          backend().handleFeedback(b.dataset.fbdone, "done", r && r.value.trim() ? r.value.trim() : null).then(render, fail);
        };
      });
      el.querySelectorAll("[data-fbreopen]").forEach(function (b) {
        b.onclick = function () { backend().handleFeedback(b.dataset.fbreopen, "open").then(render, fail); };
      });
      el.querySelectorAll("[data-fbdel]").forEach(function (b) {
        b.onclick = function () {
          if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Confirm delete"; return; }
          backend().deleteFeedback(b.dataset.fbdel).then(render, fail);
        };
      });
    }

    function wire() {
      $("feedback-sheet").addEventListener("click", function (e) { if (e.target.closest("[data-close]")) close(); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("feedback-sheet").hidden) close(); });
    }

    return { open: open, refresh: refresh, render: render, count: count, canSend: canSend, isAdmin: isAdmin, wire: wire };
  };
})(typeof window !== "undefined" ? window : globalThis);
