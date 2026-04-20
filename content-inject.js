// MAIN world — intercepts fetch & XHR and overrides configurable arrays in the JSON response
(function () {
  if (window.__ff_injected) return;
  window.__ff_injected = true;

  const KEY_LAST        = "__ff_last_flags";
  const KEY_OVR         = "__ff_overrides";
  const KEY_NESTED_OVR  = "__ff_nested_overrides";
  const KEY_LAST_NESTED = "__ff_last_nested";

  // Config written by content-bridge.js (ISOLATED world) at document_start via localStorage
  function getCfg() {
    return {
      settingsUrls:   JSON.parse(localStorage.getItem("__ff_settings_urls") || "[]"),
      rootPath:       localStorage.getItem("__ff_root_path") || "data",
      nestedSections: JSON.parse(localStorage.getItem("__ff_nested_sections") || "[]"),
    };
  }

  // Resolve a dot-notation path in an object
  function getByPath(obj, path) {
    if (!path) return obj;
    return path.split(".").reduce((acc, k) => acc?.[k], obj);
  }

  // Return a new object with the value replaced at the given dot-notation path
  function setByPath(obj, path, value) {
    const keys = path.split(".");
    const result = { ...obj };
    let curr = result;
    for (let i = 0; i < keys.length - 1; i++) {
      curr[keys[i]] = { ...curr[keys[i]] };
      curr = curr[keys[i]];
    }
    curr[keys[keys.length - 1]] = value;
    return result;
  }

  function matchesUrl(url, targetStr) {
    if (!targetStr) return false;
    try {
      const target = new URL(targetStr);
      const req    = new URL(url, location.origin);
      return req.host === target.host && req.pathname === target.pathname;
    } catch {
      return false;
    }
  }

  function getUrlKey(url) {
    if (typeof url !== "string") return null;
    const urls = JSON.parse(localStorage.getItem("__ff_settings_urls") || "[]");
    return urls.find(({ url: u }) => matchesUrl(url, u))?.key ?? null;
  }

  function getOverrides() {
    try { return JSON.parse(localStorage.getItem(KEY_OVR) || "{}"); } catch { return {}; }
  }

  function getNestedOverrides() {
    try { return JSON.parse(localStorage.getItem(KEY_NESTED_OVR) || "{}"); } catch { return {}; }
  }

  function collectNested(rootObj, ns) {
    const { path, idKeys, valueKey } = ns;
    const arrayKeys  = path.split(".");
    const sectionKey = arrayKeys[arrayKeys.length - 1];
    const items      = [];

    function recurse(obj, depth, parentIds) {
      const key = arrayKeys[depth];
      const arr = obj?.[key];
      if (!Array.isArray(arr)) return;
      for (const item of arr) {
        const id  = item[idKeys[depth]];
        const ids = [...parentIds, id];
        if (depth === arrayKeys.length - 1) {
          items.push({ compositeKey: ids.join(":"), value: item[valueKey] });
        } else {
          recurse(item, depth + 1, ids);
        }
      }
    }

    recurse(rootObj, 0, []);
    return { [sectionKey]: { valueKey, items } };
  }

  // Recursively patch a nested array structure per nestedSection config; returns new rootObj if changed
  function patchNested(rootObj, ns, overrides) {
    const { path, idKeys, valueKey } = ns;
    const arrayKeys = path.split(".");

    function recurse(obj, depth, parentIds) {
      const key = arrayKeys[depth];
      const arr = obj?.[key];
      if (!Array.isArray(arr)) return obj;

      let changed = false;
      const newArr = arr.map((item) => {
        const id  = item[idKeys[depth]];
        const ids = [...parentIds, id];
        if (depth === arrayKeys.length - 1) {
          const compositeKey = ids.join(":");
          if (compositeKey in overrides) {
            changed = true;
            return { ...item, [valueKey]: overrides[compositeKey] };
          }
          return item;
        }
        const newItem = recurse(item, depth + 1, ids);
        if (newItem !== item) changed = true;
        return newItem;
      });

      return changed ? { ...obj, [key]: newArr } : obj;
    }

    return recurse(rootObj, 0, []);
  }

  function detectIdKey(obj) {
    return ["id", "key", "name"].find((k) => typeof obj[k] === "string")
      ?? Object.keys(obj).find((k) => typeof obj[k] === "string");
  }

  function detectValueKey(obj) {
    return ["enabled", "active", "on", "isEnabled", "is_enabled"].find((k) => typeof obj[k] === "boolean")
      ?? Object.keys(obj).find((k) => typeof obj[k] === "boolean");
  }

  function applyOverrides(json, urlKey) {
    const { rootPath, nestedSections } = getCfg();
    let result = json;
    let changed = false;

    const rootObj = getByPath(json, rootPath);
    if (!rootObj || typeof rootObj !== "object" || Array.isArray(rootObj)) return null;

    const overrides        = getOverrides();
    const detectedSections = {};

    for (const [key, val] of Object.entries(rootObj)) {
      if (!Array.isArray(val) || val.length === 0 || val[0] === null || typeof val[0] !== "object") continue;
      const idKey    = detectIdKey(val[0]);
      const valueKey = detectValueKey(val[0]);
      if (!idKey || !valueKey) continue;

      detectedSections[key] = { idKey, valueKey, items: val };

      const sectionOverrides = overrides[key] || {};
      if (Object.keys(sectionOverrides).length) {
        const patched = val.map((item) =>
          item[idKey] in sectionOverrides
            ? { ...item, [valueKey]: sectionOverrides[item[idKey]] }
            : item,
        );
        result = setByPath(result, `${rootPath}.${key}`, patched);
        changed = true;
      }
    }

    const sfx = `_${urlKey}`;
    if (Object.keys(detectedSections).length) {
      localStorage.setItem(KEY_LAST + sfx, JSON.stringify(detectedSections));
    }

    try {
      if (nestedSections.length) {
        const lastNested = {};
        for (const ns of nestedSections) Object.assign(lastNested, collectNested(rootObj, ns));
        if (Object.keys(lastNested).length) localStorage.setItem(KEY_LAST_NESTED + sfx, JSON.stringify(lastNested));
      }
    } catch (e) { console.error("[ovrid] nested cache error", e); }

    const nestedOverrides = getNestedOverrides();
    if (nestedSections.length && Object.keys(nestedOverrides).length) {
      let patchRoot = getByPath(result, rootPath);
      let newRoot   = patchRoot;
      for (const ns of nestedSections) newRoot = patchNested(newRoot, ns, nestedOverrides);
      if (newRoot !== patchRoot) {
        result  = setByPath(result, rootPath, newRoot);
        changed = true;
      }
    }

    return changed ? result : null;
  }

  // --- Fetch ---
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === "string" ? args[0] : (args[0]?.url ?? "");
    const response = await origFetch.apply(this, args);
    const urlKey = getUrlKey(url);
    if (!urlKey) return response;
    try {
      const json = await response.clone().json();
      const patched = applyOverrides(json, urlKey);
      if (!patched) return response;
      return new Response(JSON.stringify(patched));
    } catch {
      return response;
    }
  };

  // --- XHR ---
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._ffUrl = url;
    return origOpen.apply(this, [method, url, ...rest]);
  };

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    const urlKey = getUrlKey(this._ffUrl ?? "");
    if (urlKey) {
      this.addEventListener("readystatechange", function () {
        if (this.readyState !== 4) return;
        try {
          const json = JSON.parse(this.responseText);
          const patched = applyOverrides(json, urlKey);
          if (!patched) return;
          const body = JSON.stringify(patched);
          Object.defineProperty(this, "responseText", {
            get: () => body,
            configurable: true,
          });
          Object.defineProperty(this, "response", {
            get: () => body,
            configurable: true,
          });
        } catch {
          /* not JSON */
        }
      });
    }
    return origSend.apply(this, args);
  };
})();
