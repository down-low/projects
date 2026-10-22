/* Invite a coworker: the app's address as a QR code to scan in person, plus Share and Copy link, so more people install
 * the app. Separate from trade invites (trades.js), which it doesn't touch.
 * window.InviteViews(api) -> {open, canShow, wire}. `api` comes from app.js.
 * - Shown to anyone signed in on the Firebase sites, where the employee app's address is known (FIREBASE_APP_URL, or this
 *   site itself on the app). The claude.ai page doesn't know that address, so the item stays hidden there.
 * - The QR code is drawn as SVG from vendor/qrcode.js, dark on a white card in either theme so phones can scan it.
 */
(function (root) {
  "use strict";

  root.InviteViews = function (api) {
    var $ = api.$, esc = api.esc;

    function appUrl() {
      if (root.FIREBASE_APP_URL) return String(root.FIREBASE_APP_URL).replace(/\/?$/, "/");
      return root.FIREBASE_SITE === "app" ? location.origin + "/" : null;
    }
    function canShow() {
      var b = api.backend(), me = b && b.me ? b.me() : null;
      return !!(appUrl() && root.QRCodeLib && me && me.signedIn);
    }

    // SVG for text: one path of dark modules, with a 4-module quiet zone (the scanner needs the white margin).
    function qrSvg(text) {
      var L = root.QRCodeLib, q = new L.QRCode(-1, L.QRErrorCorrectLevel.M);
      q.addData(text);
      q.make();
      var n = q.getModuleCount(), pad = 4, size = n + pad * 2, d = "";
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) if (q.isDark(r, c)) d += "M" + (c + pad) + " " + (r + pad) + "h1v1h-1z";
      }
      return '<svg class="qr" viewBox="0 0 ' + size + " " + size + '" role="img" aria-label="QR code for ' + esc(text) +
        '" shape-rendering="crispEdges"><rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
    }

    function open() {
      var url = appUrl();
      if (!url) return;
      var share = !!navigator.share;
      $("invite-body").innerHTML =
        '<p class="hint">Have a coworker scan this with their phone camera, or send them the link.</p>' +
        '<div class="qr-box">' + qrSvg(url) + "</div>" +
        '<p class="invite-url" id="invite-url">' + esc(url) + "</p>" +
        '<div class="row invite-acts">' +
        (share ? '<button class="btn primary" type="button" id="invite-share">Share</button>' : "") +
        '<button class="btn' + (share ? "" : " primary") + '" type="button" id="invite-copy">Copy link</button>' +
        '<span class="msg" id="invite-msg" role="status"></span></div>' +
        '<p class="hint">They sign in with the cell number on the staff list. On iPhone, Share → Add to Home Screen installs it.</p>';
      $("invite-sheet").hidden = false;
      var msg = $("invite-msg");
      if ($("invite-share")) $("invite-share").onclick = function () {
        navigator.share({ title: "SFFD Tour Schedule", text: "SFFD tour schedule: sign in with your cell number.", url: url })
          .catch(function () {}); // closing the share sheet isn't an error
      };
      $("invite-copy").onclick = function () {
        var done = function () { api.say(msg, "Link copied."); };
        var pick = function () {
          var range = document.createRange();
          range.selectNodeContents($("invite-url"));
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          api.say(msg, "Selected. Copy it from here.");
        };
        try { navigator.clipboard.writeText(url).then(done, pick); } catch (e) { pick(); }
      };
      $("invite-copy").focus();
    }
    function close() { $("invite-sheet").hidden = true; }

    function wire() {
      $("invite-sheet").addEventListener("click", function (e) { if (e.target.closest("[data-close]")) close(); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("invite-sheet").hidden) close(); });
    }

    return { open: open, canShow: canShow, wire: wire };
  };
})(typeof window !== "undefined" ? window : globalThis);
