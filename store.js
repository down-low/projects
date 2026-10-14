/* Storage for tour changes and work statuses (VA, D, S).
 *
 * ScheduleStore.connect(onChange) resolves an adapter for wherever the page is running:
 *   - "db":     the shared claude.ai page database (single-file build opened on claude.ai)
 *   - "server": the repo's server.py (/api/*), editors sign in with a token
 *   - "none":   read-only (plain static hosting or a local file)
 * onChange({statuses, tourChanges}) fires whenever the records change.
 * Adapter: {mode, canEdit(), editorName(), needsSignIn(), signIn(token), signOut(),
 *           addStatus(rec), addTourChange(rec), remove(kind, id)}  kind = "statuses" | "tourChanges"
 */
(function (root) {
  "use strict";
  var TOKEN_KEY = "tour-schedule:editor-token";
  var COLLECTIONS = { statuses: "statuses", tourChanges: "tourChanges" };

  function nowIso() { return new Date().toISOString(); }
  function session(k, v) {
    try {
      if (v === undefined) return sessionStorage.getItem(k);
      if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v);
    } catch (e) { /* storage unavailable */ }
    return null;
  }

  /* ---------- claude.ai page database ---------- */
  function dbAdapter(onChange) {
    if (!root.claude || typeof root.claude.use !== "function") return Promise.resolve(null);
    return Promise.all([root.claude.use("db"), root.claude.use("user")]).then(function (caps) {
      var db = caps[0], user = caps[1];
      if (!db) return null;
      var records = { statuses: [], tourChanges: [] };
      var editable = false, uid = null, failed = false;
      Object.keys(COLLECTIONS).forEach(function (kind) {
        db.collection(COLLECTIONS[kind]).onSnapshot(function (snap) {
          records[kind] = snap.docs.map(function (d) {
            var o = Object.assign({}, d.data());
            o.id = d.id;
            return o;
          });
          onChange({ statuses: records.statuses, tourChanges: records.tourChanges });
        }, function () { onChange({ statuses: records.statuses, tourChanges: records.tourChanges }); });
      });
      var ready = user
        ? Promise.all([user.canEdit(), user.id()]).then(function (r) { editable = !!r[0]; uid = r[1]; })
        : Promise.resolve();
      function write(kind, rec) {
        if (!editable || failed) return Promise.reject(new Error("Only editors can make changes on this page."));
        rec.createdAt = nowIso();
        rec.createdBy = uid;
        return db.collection(COLLECTIONS[kind]).add(rec).catch(function (e) {
          if (e && e.code === "invalid_argument") { failed = true; editable = false; }
          throw new Error(e && e.code === "quota_exceeded" ? "The page's storage is full. Remove old records, then try again." :
            "The change was not saved (" + ((e && e.code) || "error") + ").");
        });
      }
      return ready.then(function () {
        return {
          mode: "db",
          canEdit: function () { return editable && !failed; },
          editorName: function () { return null; },
          needsSignIn: function () { return false; },
          signIn: function () { return Promise.resolve(false); },
          signOut: function () {},
          addStatus: function (rec) { return write("statuses", rec); },
          addTourChange: function (rec) { return write("tourChanges", rec); },
          remove: function (kind, id) {
            if (!editable) return Promise.reject(new Error("Only editors can make changes on this page."));
            return db.collection(COLLECTIONS[kind]).doc(id).delete();
          },
        };
      });
    }).catch(function () { return null; });
  }

  /* ---------- server.py ---------- */
  function serverAdapter(onChange) {
    if (!root.fetch || location.protocol === "file:") return Promise.resolve(null);
    return fetch("api/health", { cache: "no-store" }).then(function (r) {
      if (!r.ok) return null;
      return r.json().then(function (health) {
        var token = session(TOKEN_KEY), name = null;
        function headers(json) {
          var h = {};
          if (json) h["Content-Type"] = "application/json";
          if (token) h.Authorization = "Bearer " + token;
          return h;
        }
        function refresh() {
          return fetch("api/records", { cache: "no-store" }).then(function (r2) { return r2.json(); }).then(onChange);
        }
        function call(method, path, body) {
          return fetch(path, { method: method, headers: headers(!!body), body: body ? JSON.stringify(body) : undefined })
            .then(function (r2) {
              return r2.json().catch(function () { return {}; }).then(function (j) {
                if (r2.status === 401) { token = null; name = null; session(TOKEN_KEY, null); }
                if (!r2.ok) throw new Error(j.error || "The server refused the change (" + r2.status + ").");
                return refresh().then(function () { return j; });
              });
            });
        }
        function whoami() {
          if (!token) return Promise.resolve(null);
          return fetch("api/whoami", { headers: headers(false), cache: "no-store" }).then(function (r2) {
            return r2.ok ? r2.json().then(function (j) { return j.name; }) : null;
          });
        }
        setInterval(function () { if (!document.hidden) refresh().catch(function () {}); }, 60000);
        return Promise.all([refresh(), whoami()]).then(function (res) {
          name = res[1];
          if (!name) { token = null; session(TOKEN_KEY, null); }
          return {
            mode: "server",
            editingEnabled: !!health.editing,
            canEdit: function () { return !!name; },
            editorName: function () { return name; },
            needsSignIn: function () { return !!health.editing && !name; },
            signIn: function (t) {
              token = (t || "").trim();
              return whoami().then(function (n) {
                name = n;
                if (n) session(TOKEN_KEY, token); else { token = null; session(TOKEN_KEY, null); }
                return !!n;
              });
            },
            signOut: function () { token = null; name = null; session(TOKEN_KEY, null); },
            addStatus: function (rec) { return call("POST", "api/statuses", rec); },
            addTourChange: function (rec) { return call("POST", "api/tour-changes", rec); },
            remove: function (kind, id) {
              return call("DELETE", "api/" + (kind === "statuses" ? "statuses" : "tour-changes") + "/" + encodeURIComponent(id));
            },
          };
        });
      });
    }).catch(function () { return null; });
  }

  var readOnly = {
    mode: "none",
    canEdit: function () { return false; },
    editorName: function () { return null; },
    needsSignIn: function () { return false; },
    signIn: function () { return Promise.resolve(false); },
    signOut: function () {},
    addStatus: function () { return Promise.reject(new Error("Editing is not available here.")); },
    addTourChange: function () { return Promise.reject(new Error("Editing is not available here.")); },
    remove: function () { return Promise.reject(new Error("Editing is not available here.")); },
  };

  function connect(onChange) {
    return dbAdapter(onChange).then(function (a) {
      return a || serverAdapter(onChange).then(function (b) { return b || readOnly; });
    });
  }

  root.ScheduleStore = { connect: connect };
})(window);
