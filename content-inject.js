// MAIN world — intercepts fetch & XHR and overrides a configurable array in the JSON response
(function () {
  if (window.__ff_injected) return;
  window.__ff_injected = true;

  const KEY_LAST = "__ff_last_flags";
  const KEY_OVR = "__ff_overrides";

  // Config written by content-bridge.js (ISOLATED world) at document_start via localStorage
  function getCfg() {
    return {
      settingsPath: localStorage.getItem("__ff_settings_path"),
      dataPath: localStorage.getItem("__ff_data_path"),
      idKey: localStorage.getItem("__ff_id_key"),
      valueKey: localStorage.getItem("__ff_value_key"),
    };
  }

  // Resolve a dot-notation path in an object: dataPath → obj[dataPath]
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
    try {
      return JSON.parse(localStorage.getItem(KEY_OVR) || "{}");
    } catch {
      return {};
    }
  }

  // Extract the target array, save it, apply overrides
  function patch(json) {
    const { dataPath, idKey, valueKey } = getCfg();
    const items = getByPath(json, dataPath);
    if (!Array.isArray(items)) return null;
    localStorage.setItem(KEY_LAST, JSON.stringify(items));
    const overrides = getOverrides();
    if (!Object.keys(overrides).length) return null;
    return items.map((item) =>
      item[idKey] in overrides
        ? { ...item, [valueKey]: overrides[item[idKey]] }
        : item,
    );
  }

  // --- Fetch ---
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === "string" ? args[0] : (args[0]?.url ?? "");
    const response = await origFetch.apply(this, args);
    if (!isTarget(url)) return response;
    try {
      const json = await response.clone().json();
      const patched = patch(json);
      if (!patched) return response;
      return new Response(
        JSON.stringify(setByPath(json, getCfg().dataPath, patched)),
      );
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
          const patched = patch(json);
          if (!patched) return;
          const body = JSON.stringify(
            setByPath(json, getCfg().dataPath, patched),
          );
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
