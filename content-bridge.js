// Runs in ISOLATED world — bridges popup messages with page localStorage
const KEY_LAST = FF_CONFIG.storageKeyLast;
const KEY_OVR = FF_CONFIG.storageKeyOverrides;
const SETTINGS_URL = `https://${FF_CONFIG.defaultHost}${FF_CONFIG.settingsPath}`;

// Publish config to localStorage so content-inject.js (MAIN world) can read it
localStorage.setItem("__ff_settings_path", FF_CONFIG.settingsPath);
localStorage.setItem("__ff_data_path", FF_CONFIG.dataPath);
localStorage.setItem("__ff_id_key", FF_CONFIG.itemIdKey);
localStorage.setItem("__ff_value_key", FF_CONFIG.itemValueKey);

function getByPath(obj, path) {
  return path.split(".").reduce((acc, k) => acc?.[k], obj);
}

function currentConfig() {
  return {
    dataPath: FF_CONFIG.dataPath,
    idKey: FF_CONFIG.itemIdKey,
    valueKey: FF_CONFIG.itemValueKey,
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
          if (lastFlags)
            localStorage.setItem(KEY_LAST, JSON.stringify(lastFlags));
          const overrides = JSON.parse(localStorage.getItem(KEY_OVR) || "{}");
          reply({ lastFlags, overrides, config: currentConfig() });
        })
        .catch(() => {
          const lastFlags = JSON.parse(
            localStorage.getItem(KEY_LAST) || "null",
          );
          const overrides = JSON.parse(localStorage.getItem(KEY_OVR) || "{}");
          reply({
            lastFlags,
            overrides,
            config: currentConfig(),
            fetchError: true,
          });
        });
      return true;
    }
    case "GET_STATE": {
      const lastFlags = JSON.parse(localStorage.getItem(KEY_LAST) || "null");
      const overrides = JSON.parse(localStorage.getItem(KEY_OVR) || "{}");
      reply({ lastFlags, overrides, config: currentConfig() });
      break;
    }
    case "SET_OVERRIDE": {
      const overrides = JSON.parse(localStorage.getItem(KEY_OVR) || "{}");
      overrides[msg.id] = msg.value;
      localStorage.setItem(KEY_OVR, JSON.stringify(overrides));
      reply({ ok: true });
      break;
    }
    case "CLEAR_OVERRIDE": {
      const overrides = JSON.parse(localStorage.getItem(KEY_OVR) || "{}");
      delete overrides[msg.id];
      localStorage.setItem(KEY_OVR, JSON.stringify(overrides));
      reply({ ok: true });
      break;
    }
    case "RESET_ALL": {
      localStorage.removeItem(KEY_OVR);
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
