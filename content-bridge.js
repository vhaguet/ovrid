// Runs in ISOLATED world — bridges popup messages with page localStorage
const KEY_LAST      = FF_CONFIG.storageKeyLast;
const KEY_OVR       = FF_CONFIG.storageKeyOverrides;
const KEY_LAST_TEXT = "__ff_last_text";
const KEY_TEXT_OVR  = "__ff_text_overrides";
const SETTINGS_URL  = `https://${FF_CONFIG.defaultHost}${FF_CONFIG.settingsPath}`;

// Publish config to localStorage so content-inject.js (MAIN world) can read it
localStorage.setItem("__ff_settings_path", FF_CONFIG.settingsPath);
localStorage.setItem("__ff_data_path",     FF_CONFIG.dataPath     || "data.module_bar");
localStorage.setItem("__ff_id_key",        FF_CONFIG.itemIdKey    || "id");
localStorage.setItem("__ff_value_key",     FF_CONFIG.itemValueKey || "enabled");
localStorage.setItem("__ff_text_path",     FF_CONFIG.textPath     || "");
updateBadge();

function updateBadge() {
  const overrides     = JSON.parse(localStorage.getItem(KEY_OVR)      || "{}");
  const textOverrides = JSON.parse(localStorage.getItem(KEY_TEXT_OVR) || "{}");
  const count = Object.keys(overrides).length + Object.keys(textOverrides).length;
  chrome.runtime.sendMessage({ type: "UPDATE_BADGE", count });
}

function getByPath(obj, path) {
  return path.split(".").reduce((acc, k) => acc?.[k], obj);
}

function currentConfig() {
  return {
    dataPath:  FF_CONFIG.dataPath     || "data.module_bar",
    idKey:     FF_CONFIG.itemIdKey    || "id",
    valueKey:  FF_CONFIG.itemValueKey || "enabled",
    textPath:  FF_CONFIG.textPath     || "",
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  switch (msg.type) {
    case "FETCH_FLAGS": {
      fetch(SETTINGS_URL)
        .then((r) => r.json())
        .then((json) => {
          const items = getByPath(json, FF_CONFIG.dataPath);
          const lastFlags = Array.isArray(items) ? items : null;
          if (lastFlags) localStorage.setItem(KEY_LAST, JSON.stringify(lastFlags));

          let lastText = null;
          const textPath = FF_CONFIG.textPath;
          if (textPath) {
            const textObj = getByPath(json, textPath);
            if (textObj && typeof textObj === "object" && !Array.isArray(textObj)) {
              lastText = Object.fromEntries(
                Object.entries(textObj).filter(([, v]) => v !== null && typeof v !== "object"),
              );
              localStorage.setItem(KEY_LAST_TEXT, JSON.stringify(lastText));
            }
          }

          const overrides     = JSON.parse(localStorage.getItem(KEY_OVR)      || "{}");
          const textOverrides = JSON.parse(localStorage.getItem(KEY_TEXT_OVR) || "{}");
          reply({ lastFlags, overrides, lastText, textOverrides, config: currentConfig() });
        })
        .catch(() => {
          const lastFlags     = JSON.parse(localStorage.getItem(KEY_LAST)      || "null");
          const overrides     = JSON.parse(localStorage.getItem(KEY_OVR)       || "{}");
          const lastText      = JSON.parse(localStorage.getItem(KEY_LAST_TEXT) || "null");
          const textOverrides = JSON.parse(localStorage.getItem(KEY_TEXT_OVR)  || "{}");
          reply({ lastFlags, overrides, lastText, textOverrides, config: currentConfig(), fetchError: true });
        });
      return true;
    }
    case "GET_STATE": {
      const lastFlags     = JSON.parse(localStorage.getItem(KEY_LAST)      || "null");
      const overrides     = JSON.parse(localStorage.getItem(KEY_OVR)       || "{}");
      const lastText      = JSON.parse(localStorage.getItem(KEY_LAST_TEXT) || "null");
      const textOverrides = JSON.parse(localStorage.getItem(KEY_TEXT_OVR)  || "{}");
      reply({ lastFlags, overrides, lastText, textOverrides, config: currentConfig() });
      break;
    }
    case "SET_OVERRIDE": {
      const overrides = JSON.parse(localStorage.getItem(KEY_OVR) || "{}");
      overrides[msg.id] = msg.value;
      localStorage.setItem(KEY_OVR, JSON.stringify(overrides));
      updateBadge();
      reply({ ok: true });
      break;
    }
    case "CLEAR_OVERRIDE": {
      const overrides = JSON.parse(localStorage.getItem(KEY_OVR) || "{}");
      delete overrides[msg.id];
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
