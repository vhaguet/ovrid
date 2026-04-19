// MAIN world — intercepts fetch & XHR and overrides configurable arrays in the JSON response
(function () {
  if (window.__ff_injected) return;
  window.__ff_injected = true;

  const KEY_LAST      = "__ff_last_flags";
  const KEY_OVR       = "__ff_overrides";
  const KEY_LAST_TEXT = "__ff_last_text";
  const KEY_TEXT_OVR  = "__ff_text_overrides";

  // Config written by content-bridge.js (ISOLATED world) at document_start via localStorage
  function getCfg() {
    return {
      settingsUrl:          localStorage.getItem("__ff_settings_url"),
      rootPath:             localStorage.getItem("__ff_root_path") || "data",
      overridesEnabled:     localStorage.getItem("__ff_overrides_enabled")  !== "false",
      textOverridesEnabled: localStorage.getItem("__ff_text_ovr_enabled")   !== "false",
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

  function isTarget(url) {
    if (typeof url !== "string") return false;
    try {
      const target = new URL(getCfg().settingsUrl);
      const req    = new URL(url, location.origin);
      return req.host === target.host && req.pathname === target.pathname;
    } catch {
      return false;
    }
  }

  function getOverrides() {
    try { return JSON.parse(localStorage.getItem(KEY_OVR) || "{}"); } catch { return {}; }
  }

  function getTextOverrides() {
    try { return JSON.parse(localStorage.getItem(KEY_TEXT_OVR) || "{}"); } catch { return {}; }
  }

  function detectIdKey(obj) {
    return ["id", "key", "name"].find((k) => typeof obj[k] === "string")
      ?? Object.keys(obj).find((k) => typeof obj[k] === "string");
  }

  function detectValueKey(obj) {
    return ["enabled", "active", "on", "isEnabled", "is_enabled"].find((k) => typeof obj[k] === "boolean")
      ?? Object.keys(obj).find((k) => typeof obj[k] === "boolean");
  }

  // Apply both array (toggle) overrides and text overrides — returns patched JSON or null if unchanged
  function applyOverrides(json) {
    const { rootPath, overridesEnabled, textOverridesEnabled } = getCfg();
    let result = json;
    let changed = false;

    const rootObj = getByPath(json, rootPath);
    if (!rootObj || typeof rootObj !== "object" || Array.isArray(rootObj)) return null;

    const overrides     = getOverrides();
    const textOverrides = getTextOverrides();
    const detectedSections = {};
    const detectedText     = {};

    for (const [key, val] of Object.entries(rootObj)) {
      if (Array.isArray(val) && val.length > 0 && val[0] !== null && typeof val[0] === "object") {
        const idKey    = detectIdKey(val[0]);
        const valueKey = detectValueKey(val[0]);
        if (!idKey || !valueKey) continue;

        detectedSections[key] = { idKey, valueKey, items: val };

        if (overridesEnabled) {
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
      } else if (val !== null && !Array.isArray(val) && typeof val !== "object") {
        detectedText[key] = val;
      }
    }

    // Cache for popup
    if (Object.keys(detectedSections).length) {
      localStorage.setItem(KEY_LAST, JSON.stringify(detectedSections));
    }
    if (Object.keys(detectedText).length) {
      localStorage.setItem(KEY_LAST_TEXT, JSON.stringify(detectedText));
    }

    // Text overrides
    if (textOverridesEnabled && Object.keys(textOverrides).length) {
      const rootCopy = { ...getByPath(result, rootPath) };
      let textChanged = false;
      for (const [k, v] of Object.entries(textOverrides)) {
        if (k in rootCopy && rootCopy[k] !== null && typeof rootCopy[k] !== "object" && !Array.isArray(rootCopy[k])) {
          rootCopy[k] = v;
          textChanged = true;
        }
      }
      if (textChanged) {
        result = setByPath(result, rootPath, rootCopy);
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
    if (!isTarget(url)) return response;
    try {
      const json = await response.clone().json();
      const patched = applyOverrides(json);
      if (!patched) return response;
      return new Response(JSON.stringify(patched));
    } catch {
      return response;
    }
  };

  // --- XHR (axios fallback) ---
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._ffUrl = url;
    return origOpen.apply(this, [method, url, ...rest]);
  };

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    if (isTarget(this._ffUrl ?? "")) {
      this.addEventListener("readystatechange", function () {
        if (this.readyState !== 4) return;
        try {
          const json = JSON.parse(this.responseText);
          const patched = applyOverrides(json);
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
