// Runs in ISOLATED world — bridges popup messages with page localStorage
const CONFIG_STORAGE_KEY = "__ff_config_settings";
const KEY_LAST_TEXT   = "__ff_last_text";
const KEY_TEXT_OVR    = "__ff_text_overrides";
const KEY_NESTED_OVR  = "__ff_nested_overrides";
const KEY_LAST_NESTED = "__ff_last_nested";

// Publish FF_CONFIG defaults synchronously so content-inject.js (MAIN world) can read them
// before the page makes its first API request — the async callback below will update with stored overrides.
localStorage.setItem("__ff_settings_urls",     JSON.stringify(FF_CONFIG.settingsUrls || []));
localStorage.setItem("__ff_root_path",         FF_CONFIG.rootPath || "data");
localStorage.setItem("__ff_overrides_enabled", String(FF_CONFIG.overridesEnabled     !== false));
localStorage.setItem("__ff_text_ovr_enabled",  String(FF_CONFIG.textOverridesEnabled !== false));
localStorage.setItem("__ff_nested_sections",   JSON.stringify(FF_CONFIG.nestedSections || []));

chrome.storage.local.get(CONFIG_STORAGE_KEY, (stored) => {
  const cfg = { ...FF_CONFIG, ...(stored[CONFIG_STORAGE_KEY] || {}) };

  const KEY_LAST = cfg.storageKeyLast;
  const KEY_OVR  = cfg.storageKeyOverrides;
  const SETTINGS_URL = cfg.settingsUrl;

  // Update localStorage with merged config (stored popup settings take priority over FF_CONFIG)
  localStorage.setItem("__ff_settings_urls",     JSON.stringify(cfg.settingsUrls || []));
  localStorage.setItem("__ff_root_path",         cfg.rootPath || "data");
  localStorage.setItem("__ff_overrides_enabled", String(cfg.overridesEnabled     !== false));
  localStorage.setItem("__ff_text_ovr_enabled",  String(cfg.textOverridesEnabled !== false));
  localStorage.setItem("__ff_nested_sections",   JSON.stringify(cfg.nestedSections || []));
  updateBadge();

  function updateBadge() {
    const overrides       = JSON.parse(localStorage.getItem(KEY_OVR)         || "{}");
    const textOverrides   = JSON.parse(localStorage.getItem(KEY_TEXT_OVR)    || "{}");
    const nestedOverrides = JSON.parse(localStorage.getItem(KEY_NESTED_OVR)  || "{}");
    const toggleCount     = Object.values(overrides).reduce((sum, sec) => sum + Object.keys(sec).length, 0);
    chrome.runtime.sendMessage({ type: "UPDATE_BADGE", count: toggleCount + Object.keys(textOverrides).length + Object.keys(nestedOverrides).length });
  }

  // Traverse nested arrays (per nestedSections config) and return flat items with composite keys
  function traverseNested(rootObj, ns) {
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

  function getByPath(obj, path) {
    if (!path) return obj;
    return path.split(".").reduce((acc, k) => acc?.[k], obj);
  }

  function detectIdKey(obj) {
    return ["id", "key", "name"].find((k) => typeof obj[k] === "string")
      ?? Object.keys(obj).find((k) => typeof obj[k] === "string");
  }

  function detectValueKey(obj) {
    return ["enabled", "active", "on", "isEnabled", "is_enabled"].find((k) => typeof obj[k] === "boolean")
      ?? Object.keys(obj).find((k) => typeof obj[k] === "boolean");
  }

  // Returns { sections: { name: { idKey, valueKey, items } }, textFields: { key: value } }
  function detectSections(rootObj) {
    const sections   = {};
    const textFields = {};
    if (!rootObj || typeof rootObj !== "object" || Array.isArray(rootObj)) return { sections, textFields };
    for (const [key, val] of Object.entries(rootObj)) {
      if (Array.isArray(val) && val.length > 0 && val[0] !== null && typeof val[0] === "object") {
        const idKey    = detectIdKey(val[0]);
        const valueKey = detectValueKey(val[0]);
        if (idKey && valueKey) sections[key] = { idKey, valueKey, items: val };
      } else if (val !== null && !Array.isArray(val) && typeof val !== "object") {
        textFields[key] = val;
      }
    }
    return { sections, textFields };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    switch (msg.type) {
      case "FETCH_FLAGS":
      case "GET_STATE": {
        // content-inject.js writes one cache entry per URL index; merge them all here.
        const urls = JSON.parse(localStorage.getItem("__ff_settings_urls") || "[]");
        const lastSections = {};
        let   lastText     = null;
        const lastNested   = {};
        for (let i = 0; i < urls.length; i++) {
          const s = JSON.parse(localStorage.getItem(`${KEY_LAST}_${i}`)        || "null");
          if (s) Object.assign(lastSections, s);
          const t = JSON.parse(localStorage.getItem(`${KEY_LAST_TEXT}_${i}`)   || "null");
          if (t) { lastText = lastText || {}; Object.assign(lastText, t); }
          const n = JSON.parse(localStorage.getItem(`${KEY_LAST_NESTED}_${i}`) || "null");
          if (n) Object.assign(lastNested, n);
        }
        const overrides       = JSON.parse(localStorage.getItem(KEY_OVR)       || "{}");
        const textOverrides   = JSON.parse(localStorage.getItem(KEY_TEXT_OVR)  || "{}");
        const nestedOverrides = JSON.parse(localStorage.getItem(KEY_NESTED_OVR)|| "{}");
        reply({
          lastSections: Object.keys(lastSections).length ? lastSections : null,
          overrides,
          lastText,
          textOverrides,
          lastNested: Object.keys(lastNested).length ? lastNested : null,
          nestedOverrides,
        });
        break;
      }
      case "SET_OVERRIDE": {
        const overrides = JSON.parse(localStorage.getItem(KEY_OVR) || "{}");
        if (!overrides[msg.section]) overrides[msg.section] = {};
        overrides[msg.section][msg.id] = msg.value;
        localStorage.setItem(KEY_OVR, JSON.stringify(overrides));
        updateBadge();
        reply({ ok: true });
        break;
      }
      case "CLEAR_OVERRIDE": {
        const overrides = JSON.parse(localStorage.getItem(KEY_OVR) || "{}");
        if (overrides[msg.section]) {
          delete overrides[msg.section][msg.id];
          if (!Object.keys(overrides[msg.section]).length) delete overrides[msg.section];
        }
        localStorage.setItem(KEY_OVR, JSON.stringify(overrides));
        updateBadge();
        reply({ ok: true });
        break;
      }
      case "SET_TEXT_OVERRIDE": {
        const textOverrides = JSON.parse(localStorage.getItem(KEY_TEXT_OVR) || "{}");
        textOverrides[msg.key] = msg.value;
        localStorage.setItem(KEY_TEXT_OVR, JSON.stringify(textOverrides));
        updateBadge();
        reply({ ok: true });
        break;
      }
      case "CLEAR_TEXT_OVERRIDE": {
        const textOverrides = JSON.parse(localStorage.getItem(KEY_TEXT_OVR) || "{}");
        delete textOverrides[msg.key];
        localStorage.setItem(KEY_TEXT_OVR, JSON.stringify(textOverrides));
        updateBadge();
        reply({ ok: true });
        break;
      }
      case "SET_NESTED_OVERRIDE": {
        const nestedOverrides = JSON.parse(localStorage.getItem(KEY_NESTED_OVR) || "{}");
        nestedOverrides[msg.key] = msg.value;
        localStorage.setItem(KEY_NESTED_OVR, JSON.stringify(nestedOverrides));
        updateBadge();
        reply({ ok: true });
        break;
      }
      case "CLEAR_NESTED_OVERRIDE": {
        const nestedOverrides = JSON.parse(localStorage.getItem(KEY_NESTED_OVR) || "{}");
        delete nestedOverrides[msg.key];
        localStorage.setItem(KEY_NESTED_OVR, JSON.stringify(nestedOverrides));
        updateBadge();
        reply({ ok: true });
        break;
      }
      case "RESET_ALL": {
        localStorage.removeItem(KEY_OVR);
        localStorage.removeItem(KEY_TEXT_OVR);
        localStorage.removeItem(KEY_NESTED_OVR);
        updateBadge();
        reply({ ok: true });
        break;
      }
      case "RELOAD_PAGE": {
        reply({ ok: true });
        window.location.reload();
        break;
      }
    }
    return true;
  });
});
