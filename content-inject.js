// MAIN world — intercepts fetch & XHR and overrides a configurable array in the JSON response
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
      settingsPath:         localStorage.getItem("__ff_settings_path"),
      dataPath:             localStorage.getItem("__ff_data_path"),
      idKey:                localStorage.getItem("__ff_id_key"),
      valueKey:             localStorage.getItem("__ff_value_key"),
      textPath:             localStorage.getItem("__ff_text_path"),
      overridesEnabled:     localStorage.getItem("__ff_overrides_enabled")  !== "false",
      textOverridesEnabled: localStorage.getItem("__ff_text_ovr_enabled")   !== "false",
    };
  }

  // Resolve a dot-notation path in an object
  function getByPath(obj, path) {
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
      return new URL(url, location.origin).pathname === getCfg().settingsPath;
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

  // Apply both array (toggle) overrides and text overrides — returns patched JSON or null if unchanged
  function applyOverrides(json) {
    const { dataPath, idKey, valueKey, textPath, overridesEnabled, textOverridesEnabled } = getCfg();
    let result = json;
    let changed = false;

    // Array (toggle) overrides
    if (dataPath && overridesEnabled) {
      const items = getByPath(json, dataPath);
      if (Array.isArray(items)) {
        localStorage.setItem(KEY_LAST, JSON.stringify(items));
        const overrides = getOverrides();
        if (Object.keys(overrides).length) {
          const patched = items.map((item) =>
            item[idKey] in overrides
              ? { ...item, [valueKey]: overrides[item[idKey]] }
              : item,
          );
          result = setByPath(result, dataPath, patched);
          changed = true;
        }
      }
    }

    // Text overrides
    if (textPath && textOverridesEnabled) {
      const textObj = getByPath(json, textPath);
      if (textObj && typeof textObj === "object" && !Array.isArray(textObj)) {
        // Save only primitive properties for the popup to display
        const primitives = Object.fromEntries(
          Object.entries(textObj).filter(([, v]) => v !== null && typeof v !== "object"),
        );
        localStorage.setItem(KEY_LAST_TEXT, JSON.stringify(primitives));
        const textOverrides = getTextOverrides();
        if (Object.keys(textOverrides).length) {
          result = setByPath(result, textPath, {
            ...getByPath(result, textPath),
            ...textOverrides,
          });
          changed = true;
        }
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
