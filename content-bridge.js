// Runs in ISOLATED world — bridges popup messages with page localStorage
const CONFIG_STORAGE_KEY = "__ff_config_settings";
const KEY_LAST_TEXT = "__ff_last_text";
const KEY_TEXT_OVR  = "__ff_text_overrides";

chrome.storage.local.get(CONFIG_STORAGE_KEY, (stored) => {
  const cfg = { ...FF_CONFIG, ...(stored[CONFIG_STORAGE_KEY] || {}) };

  const KEY_LAST = cfg.storageKeyLast;
  const KEY_OVR  = cfg.storageKeyOverrides;
  const SETTINGS_URL = cfg.settingsUrl;

  // Publish config to localStorage so content-inject.js (MAIN world) can read it
  localStorage.setItem("__ff_settings_url",  cfg.settingsUrl);
  localStorage.setItem("__ff_root_path",     cfg.rootPath || "data");
  localStorage.setItem("__ff_overrides_enabled", String(cfg.overridesEnabled     !== false));
  localStorage.setItem("__ff_text_ovr_enabled",  String(cfg.textOverridesEnabled !== false));
  updateBadge();

  function updateBadge() {
    const overrides     = JSON.parse(localStorage.getItem(KEY_OVR)      || "{}");
    const textOverrides = JSON.parse(localStorage.getItem(KEY_TEXT_OVR) || "{}");
    const toggleCount   = Object.values(overrides).reduce((sum, sec) => sum + Object.keys(sec).length, 0);
    chrome.runtime.sendMessage({ type: "UPDATE_BADGE", count: toggleCount + Object.keys(textOverrides).length });
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
      case "FETCH_FLAGS": {
        fetch(SETTINGS_URL, { credentials: "include" })
          .then((r) => r.ok ? r.json() : Promise.reject(r.status))
          .then((json) => {
            const rootPath = cfg.rootPath || "data";
            const rootObj  = getByPath(json, rootPath);
            const { sections, textFields } = detectSections(rootObj);

            const lastSections = Object.keys(sections).length  > 0 ? sections   : null;
            const lastText     = Object.keys(textFields).length > 0 ? textFields : null;
            if (lastSections) localStorage.setItem(KEY_LAST,      JSON.stringify(lastSections));
            if (lastText)     localStorage.setItem(KEY_LAST_TEXT, JSON.stringify(lastText));

            const overrides     = JSON.parse(localStorage.getItem(KEY_OVR)      || "{}");
            const textOverrides = JSON.parse(localStorage.getItem(KEY_TEXT_OVR) || "{}");
            reply({ lastSections, overrides, lastText, textOverrides });
          })
          .catch(() => {
            const lastSections  = JSON.parse(localStorage.getItem(KEY_LAST)      || "null");
            const overrides     = JSON.parse(localStorage.getItem(KEY_OVR)       || "{}");
            const lastText      = JSON.parse(localStorage.getItem(KEY_LAST_TEXT) || "null");
            const textOverrides = JSON.parse(localStorage.getItem(KEY_TEXT_OVR)  || "{}");
            reply({ lastSections, overrides, lastText, textOverrides, fetchError: true });
          });
        return true;
      }
      case "GET_STATE": {
        const lastSections  = JSON.parse(localStorage.getItem(KEY_LAST)      || "null");
        const overrides     = JSON.parse(localStorage.getItem(KEY_OVR)       || "{}");
        const lastText      = JSON.parse(localStorage.getItem(KEY_LAST_TEXT) || "null");
        const textOverrides = JSON.parse(localStorage.getItem(KEY_TEXT_OVR)  || "{}");
        reply({ lastSections, overrides, lastText, textOverrides });
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
      case "RESET_ALL": {
        localStorage.removeItem(KEY_OVR);
        localStorage.removeItem(KEY_TEXT_OVR);
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
