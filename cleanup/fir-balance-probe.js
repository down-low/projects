/* fir-db1 balance report probe (read-only). The balance pull found no tables in the page it fetched; this shows where the
 * report's two bottom tables (Status / OFF PM FF, and Rank / Voluntary …) actually come from.
 *
 * Run: open the Daily Balance Report in fir-db1 for any date, so the tables are on screen. Paste this into the console
 * (F12 > Console) and press Enter. It copies its report to the clipboard; paste that back in the chat. No names or
 * numbers from the report are included, only where things are.
 */
(async () => {
  const has = (root) => {
    const cells = [...root.querySelectorAll("td, th, span, div")].filter((e) => !e.children.length).map((e) => e.textContent.trim());
    return { tables: root.querySelectorAll("table").length, statusCell: cells.includes("Status"), voluntaryCell: cells.includes("Voluntary"),
      sffdTotal: /SFFD Total/.test(root.textContent || "") };
  };
  const out = { url: location.pathname + location.search.replace(/(p=\d+:\d+:)\d+/, "$1#"), title: document.title };
  out.pageItems = [...document.querySelectorAll("input[id^=P], select[id^=P]")].map((e) => e.id + (/DATE|DT/.test(e.id) ? "=" + e.value : "")).slice(0, 30);
  out.onScreen = has(document);
  out.frames = [...document.querySelectorAll("iframe, embed, object")].map((f) => (f.tagName + " " + (f.src || f.data || "")).replace(/(p=\d+:\d+:)\d+/, "$1#").slice(0, 200));
  out.regions = [...document.querySelectorAll("[id]")].filter((e) => /t-Region|a-IRR|t-Report|a-IG|t-Form/.test(e.className || "")).map((e) => e.id + " (" + String(e.className).split(" ")[0] + ")").slice(0, 20);
  // Where in the page the Status table sits (its region / parents), so a fetch can find it.
  const st = [...document.querySelectorAll("td, th")].find((e) => e.textContent.trim() === "Status");
  if (st) { const path = []; for (let e = st; e && e !== document.body && path.length < 12; e = e.parentElement) path.push(e.tagName + (e.id ? "#" + e.id : "") + (e.className ? "." + String(e.className).split(" ")[0] : "")); out.statusPath = path; }
  try {
    const html = await (await fetch(location.href, { credentials: "same-origin" })).text();
    out.fetchedPage = has(new DOMParser().parseFromString(html, "text/html"));
    out.fetchedLength = html.length;
  } catch (e) { out.fetchError = String(e); }
  const text = JSON.stringify(out, null, 2);
  console.log(text);
  try { copy(text); console.log("Report copied to the clipboard."); } catch (e) { console.log("Copy the report above."); }
})();
