/* Demo only (tools/build_artifact.py --hide-tours): hides tour numbers, since not every department works tours.
 * It edits the rendered page rather than the screens, so app code can still be cherry-picked from main unchanged:
 * tour text ("· T12", "Tour 12", "(Tour 27)", "Tours 2 · 5 · …") is removed from text, and tour-only parts (Tour tiles,
 * the Tour column, tour pickers, 6 of 9) are hidden. Position numbers and watch numbers stay.
 */
(function () {
  "use strict";
  var TEXT = [
    [/Tours (\d{1,2} · )+/g, ""], // Projection: "Tours 2 · 5 · … · 50 on duty"
    [/\s?\(Tour \d{1,2}\)/g, ""],
    [/(,|\s·)?\s?\bTour \d{1,2}\b/g, ""],
    [/(\s·)?\sT(?!0)\d{1,2}\b/g, ""], // "· T12", "E10 T22" (truck companies like T03 keep their leading 0)
  ];
  function cleanText(node) {
    var v = node.nodeValue, out = v;
    TEXT.forEach(function (r) { out = out.replace(r[0], r[1]); });
    if (out !== v) node.nodeValue = out;
  }
  function hide(el) { if (el && el.style.display !== "none") el.style.display = "none"; } // CSS display rules beat [hidden]
  function label(el) { return ((el && el.textContent) || "").trim(); }
  function sweep(root) {
    var walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.parentNode && /^(SCRIPT|STYLE|TEXTAREA|OPTION)$/.test(n.parentNode.nodeName) ? 2 : 1; },
    });
    for (var n = walk.nextNode(); n; n = walk.nextNode()) cleanText(n);
    // Tiles and key/value rows labelled Tour or Tour change.
    root.querySelectorAll(".kv .k, .tile .k").forEach(function (k) {
      if (/^Tour( change)?$/i.test(label(k))) hide(k.parentNode);
    });
    // "Tours working" chips on Projection.
    root.querySelectorAll(".chips .lbl").forEach(function (l) { if (/^Tours/.test(label(l))) hide(l.parentNode); });
    // Table columns headed Tour.
    root.querySelectorAll("table").forEach(function (t) {
      var ths = t.querySelectorAll("thead th"), col = -1;
      ths.forEach(function (th, i) { if (/^Tour$/i.test(label(th))) col = i; });
      if (col < 0) return;
      t.querySelectorAll("tr").forEach(function (tr) { hide(tr.children[col]); });
    });
    // Tour pickers (By rank filter, "This is me" tour) and the 6 of 9 view.
    root.querySelectorAll("select").forEach(function (s) {
      var o = s.options[s.options.length - 1];
      if (s.id === "rank-tour" || (o && /^Tour \d+$/.test(o.textContent))) {
        hide(s);
        if (s.parentNode && s.parentNode.nodeName === "LABEL") hide(s.parentNode);
      }
    });
    // The page footer explains the tour rotation.
    hide(document.querySelector("footer.foot"));
    hide(document.getElementById("six-link"));
    var six = document.querySelector('[data-go="six"]');
    if (six) hide(six.parentNode);
  }
  var busy = false;
  function run() {
    if (busy) return;
    busy = true;
    try { sweep(document.body); } finally { busy = false; }
  }
  new MutationObserver(function () { if (!busy) run(); }).observe(document.body, { childList: true, subtree: true, characterData: true });
  run();
})();
