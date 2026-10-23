/* "Add to Home Screen" banner for first-time visitors to the employee app (FIREBASE_SITE "app"), on phones only, and only
 * when the app wasn't opened from the home screen. On iPhone the home-screen app is also what app notifications need.
 * - iPhone Safari: Share → Add to Home Screen. iPhone in another browser (Chrome, an app's built-in browser): open the
 *   link in Safari first. Android: an Install button from the browser's own prompt (beforeinstallprompt), else ⋮ → Add
 *   to Home screen.
 * - Got it hides it for good on that phone; × until the next visit. It never shows on the admin site or the claude.ai page.
 * Runs on its own at load; window.HomeScreen.state() reports what it decided (for tests).
 */
(function (root) {
  "use strict";
  var KEY = "tour-schedule:homescreen-done";
  var promptEvent = null, decided = "hidden";

  function done() { try { return root.localStorage.getItem(KEY) === "1"; } catch (e) { return false; } }
  function remember() { try { root.localStorage.setItem(KEY, "1"); } catch (e) { /* storage unavailable */ } }
  function standalone() {
    return root.navigator.standalone === true || !!(root.matchMedia && root.matchMedia("(display-mode: standalone)").matches);
  }
  function platform() {
    var ua = root.navigator.userAgent || "";
    var ios = /iPhone|iPad|iPod/.test(ua) || (root.navigator.platform === "MacIntel" && root.navigator.maxTouchPoints > 1);
    if (ios) return /CriOS|FxiOS|EdgiOS|GSA\/|FBAN|FBAV|Instagram|Line\//.test(ua) ? "ios-other" : "ios";
    return /Android/.test(ua) ? "android" : null;
  }
  var SHARE_ICON = '<svg class="hs-share" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M6 11v9h12v-9"/></svg>';
  function text(kind) {
    if (kind === "ios") return "Tap Share " + SHARE_ICON + " at the bottom of Safari, then <b>Add to Home Screen</b>. Open the app from there from now on.";
    if (kind === "ios-other") return "Open this link in <b>Safari</b>, then tap Share " + SHARE_ICON + " → <b>Add to Home Screen</b>.";
    return promptEvent ? "Install it on this phone so it opens like an app." : "Tap <b>⋮</b> (top right), then <b>Add to Home screen</b> or <b>Install app</b>.";
  }

  function hide() { var el = document.getElementById("hs-banner"); if (el) el.remove(); }
  function show(kind) {
    hide();
    var page = document.querySelector(".page");
    if (!page) return;
    decided = kind;
    page.insertAdjacentHTML("afterbegin", '<section class="hs-banner" id="hs-banner" role="region" aria-label="Add to Home Screen">' +
      '<div class="hs-text"><b class="hs-title">Add this app to your home screen</b><span>' + text(kind) + "</span></div>" +
      '<div class="hs-acts">' + (kind === "android" && promptEvent ? '<button class="btn small primary" type="button" id="hs-install">Install</button>' : "") +
      '<button class="btn small" type="button" id="hs-done">Got it</button></div>' +
      '<button class="hs-x" type="button" id="hs-x" aria-label="Close">×</button></section>');
    document.getElementById("hs-done").onclick = function () { remember(); hide(); };
    document.getElementById("hs-x").onclick = hide;
    var inst = document.getElementById("hs-install");
    if (inst) inst.onclick = function () {
      var ev = promptEvent;
      promptEvent = null;
      ev.prompt();
      (ev.userChoice || Promise.resolve({})).then(function (c) { if (c.outcome === "accepted") { remember(); hide(); } else show(kind); });
    };
  }
  function start() {
    if (root.FIREBASE_SITE !== "app" || done() || standalone()) return;
    var kind = platform();
    if (kind) show(kind);
  }

  root.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); // our own Install button instead of the browser's mini bar
    promptEvent = e;
    if (document.getElementById("hs-banner") && decided === "android") show("android");
  });
  root.addEventListener("appinstalled", function () { remember(); hide(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  root.HomeScreen = { state: function () { return document.getElementById("hs-banner") ? decided : "hidden"; } };
})(window);
