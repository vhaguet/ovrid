const CONFIG_STORAGE_KEY = "__ff_config_settings";

const SETTINGS_FIELDS = [
  { key: "settingsUrl",         label: "URL de l'endpoint" },
  { key: "rootPath",            label: "Propriété racine (JSON)" },
  { key: "storageKeyLast",      label: "Clé cache (localStorage)", advanced: true },
  { key: "storageKeyOverrides", label: "Clé overrides (localStorage)", advanced: true },
];

function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(CONFIG_STORAGE_KEY, (result) => {
      resolve({ ...FF_CONFIG, ...(result[CONFIG_STORAGE_KEY] || {}) });
    });
  });
}

function saveConfig(config) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: config }, resolve);
  });
}

function escapeAttr(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function renderSettings(config) {
  const panel = document.getElementById("settings-panel");

  const renderField = (field) => {
    const val        = config[field.key] ?? "";
    const isModified = String(val) !== String(FF_CONFIG[field.key] ?? "");
    return `
      <div class="settings-field">
        <div class="settings-field-label">
          <label for="cfg-${field.key}">${field.label}</label>
          ${isModified ? `<button class="btn-field-reset" data-key="${field.key}" title="Réinitialiser">↺</button>` : ""}
        </div>
        <input type="text" id="cfg-${field.key}"
          class="settings-input${isModified ? " modified" : ""}"
          data-key="${field.key}"
          value="${escapeAttr(val)}"
          spellcheck="false" autocomplete="off">
      </div>`;
  };

  const regular  = SETTINGS_FIELDS.filter((f) => !f.advanced);
  const advanced = SETTINGS_FIELDS.filter((f) =>  f.advanced);

  const renderToggleRow = (label, key) => {
    const isOn = config[key] !== false;
    return `
      <div class="settings-field settings-toggle-row">
        <span class="settings-toggle-label">${label}</span>
        <div class="toggle-wrap">
          <span class="toggle-label ${isOn ? "on" : "off"}">${isOn ? "ON" : "OFF"}</span>
          <label class="toggle">
            <input type="checkbox" class="settings-toggle" data-key="${key}" ${isOn ? "checked" : ""}>
            <span class="slider"></span>
          </label>
        </div>
      </div>`;
  };

  panel.innerHTML = `
    <div class="settings-content">
      <div class="settings-section-divider">Overrides</div>
      ${renderToggleRow("Overrides de toggles", "overridesEnabled")}
      ${renderToggleRow("Overrides de texte",   "textOverridesEnabled")}
      ${regular.map(renderField).join("")}
      <div class="settings-section-divider">Avancé</div>
      ${advanced.map(renderField).join("")}
    </div>`;
}

// ── State ──────────────────────────────────────────────────────────────────

let currentState  = null;
let activeConfig  = null;
let settingsOpen  = false;

// ── Helpers ────────────────────────────────────────────────────────────────

async function getTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function msg(tabId, payload) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, (res) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(res);
    });
  });
}

function totalOverrides(overrides, textOverrides, nestedOverrides) {
  const toggleCount = Object.values(overrides).reduce((sum, sec) => sum + Object.keys(sec).length, 0);
  return toggleCount + Object.keys(textOverrides).length + Object.keys(nestedOverrides || {}).length;
}

function filterState(state, query) {
  if (!query) return state;
  const q = query.toLowerCase();
  const filteredSections = {};
  for (const [name, section] of Object.entries(state.lastSections || {})) {
    const filteredItems = section.items.filter((item) =>
      String(item[section.idKey]).toLowerCase().includes(q),
    );
    if (filteredItems.length) filteredSections[name] = { ...section, items: filteredItems };
  }
  const filteredNested = {};
  for (const [name, { valueKey, items }] of Object.entries(state.lastNested || {})) {
    const filteredItems = items.filter(({ compositeKey }) => compositeKey.toLowerCase().includes(q));
    if (filteredItems.length) filteredNested[name] = { valueKey, items: filteredItems };
  }
  return {
    ...state,
    lastSections: filteredSections,
    lastText: state.lastText
      ? Object.fromEntries(Object.entries(state.lastText).filter(([k]) => k.toLowerCase().includes(q)))
      : null,
    lastNested: Object.keys(filteredNested).length ? filteredNested : null,
  };
}

function searchQuery() {
  return document.getElementById("search-input")?.value.trim() ?? "";
}

// ── Settings panel ─────────────────────────────────────────────────────────

function showSettings() {
  settingsOpen = true;
  renderSettings(activeConfig);
  document.getElementById("settings-panel").classList.remove("hidden");
  document.getElementById("main-content").classList.add("hidden");
  document.getElementById("search-bar").classList.add("hidden");
  document.getElementById("btn-settings").classList.add("active");
  document.getElementById("btn-reset").style.display = "none";
}

function hideSettings() {
  settingsOpen = false;
  document.getElementById("settings-panel").classList.add("hidden");
  document.getElementById("main-content").classList.remove("hidden");
  document.getElementById("btn-settings").classList.remove("active");
  document.getElementById("btn-reset").style.display = "";
  if (currentState) {
    const hasData = currentState.lastSections !== null || currentState.lastText !== null;
    document.getElementById("search-bar").classList.toggle("hidden", !hasData);
  }
}

// ── Flags rendering ────────────────────────────────────────────────────────

function renderFlags(state, query = "") {
  const { lastSections, overrides, lastText, textOverrides, lastNested, nestedOverrides } = filterState(state, query);
  const searchBar  = document.getElementById("search-bar");
  const main       = document.getElementById("main-content");
  const statusBar  = document.getElementById("status-bar");
  const statusText = document.getElementById("status-text");

  const hasData = (state.lastSections && Object.keys(state.lastSections).length > 0)
    || state.lastText   !== null
    || (state.lastNested && Object.keys(state.lastNested).length > 0);
  searchBar.classList.toggle("hidden", !hasData);

  if (!hasData) {
    main.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <p>Impossible de récupérer les modules.</p>
        <p class="hint">Vérifiez que vous êtes connecté sur l'instance de l'app et rouvrez l'extension.</p>
      </div>`;
    statusBar.classList.add("hidden");
    return;
  }

  const total = totalOverrides(overrides, textOverrides, nestedOverrides);
  if (total > 0) {
    statusBar.classList.remove("hidden");
    statusText.textContent = `${total} override${total > 1 ? "s" : ""} actif${total > 1 ? "s" : ""}`;
  } else {
    statusBar.classList.add("hidden");
  }

  main.innerHTML = "";

  // --- Toggle sections (arrays) ---
  for (const [sectionName, { idKey, valueKey, items }] of Object.entries(lastSections || {})) {
    const sectionOverrides = overrides[sectionName] || {};
    const section = document.createElement("div");
    section.className = "category";

    const header = document.createElement("div");
    header.className = "category-header";
    header.textContent = `${sectionName} — ${valueKey}`;
    section.appendChild(header);

    for (const mod of items) {
      const itemId      = mod[idKey];
      const originalVal = mod[valueKey];
      const hasOverride = itemId in sectionOverrides;
      const effectiveVal = hasOverride ? sectionOverrides[itemId] : originalVal;
      const isOn        = effectiveVal === true || effectiveVal === "ON";
      const isLocked    = !!mod.locked;

      const row = document.createElement("div");
      row.className = "flag-row";
      row.innerHTML = `
        <div class="flag-info">
          <div class="flag-name${hasOverride ? " overridden" : ""}">${itemId}${isLocked ? " 🔒" : ""}</div>
          ${hasOverride ? `<div class="original-badge">Valeur API : ${originalVal}</div>` : ""}
        </div>
        <div class="toggle-wrap">
          <span class="toggle-label ${isOn ? "on" : "off"}">${isOn ? "ON" : "OFF"}</span>
          <label class="toggle">
            <input type="checkbox"
              ${isOn ? "checked" : ""}
              ${isLocked ? "disabled" : ""}
              data-id="${itemId}"
              data-section="${sectionName}"
              data-original="${originalVal}">
            <span class="slider"></span>
          </label>
          ${
            hasOverride
              ? `<button class="reset-flag-btn" data-id="${itemId}" data-section="${sectionName}" title="Réinitialiser">✕</button>`
              : '<span style="width:18px"></span>'
          }
        </div>`;
      section.appendChild(row);
    }

    main.appendChild(section);
  }

  // --- Text section ---
  const textEntries = lastText ? Object.entries(lastText) : [];
  if (textEntries.length > 0) {
    const section = document.createElement("div");
    section.className = "category";

    const header = document.createElement("div");
    header.className = "category-header";
    header.textContent = "text";
    section.appendChild(header);

    for (const [key, originalVal] of textEntries) {
      const hasOverride  = key in textOverrides;
      const effectiveVal = hasOverride ? textOverrides[key] : originalVal;
      const safeOriginal = String(originalVal).replace(/"/g, "&quot;");
      const safeValue    = String(effectiveVal).replace(/"/g, "&quot;");

      const row = document.createElement("div");
      row.className = "flag-row";
      row.innerHTML = `
        <div class="flag-info">
          <div class="flag-name${hasOverride ? " overridden" : ""}">${key}</div>
          ${hasOverride ? `<div class="original-badge">Valeur API : ${originalVal}</div>` : ""}
        </div>
        <div class="text-wrap">
          <input type="text"
            class="text-override-input${hasOverride ? " overridden" : ""}"
            data-key="${key}"
            data-original="${safeOriginal}"
            value="${safeValue}">
          ${
            hasOverride
              ? `<button class="reset-flag-btn" data-key="${key}" title="Réinitialiser">✕</button>`
              : '<span style="width:18px"></span>'
          }
        </div>`;
      section.appendChild(row);
    }

    main.appendChild(section);
  }

  // --- Nested sections ---
  for (const [sectionName, { valueKey, items }] of Object.entries(lastNested || {})) {
    const section = document.createElement("div");
    section.className = "category";

    const header = document.createElement("div");
    header.className = "category-header";
    header.textContent = `${sectionName} — ${valueKey}`;
    section.appendChild(header);

    // Group by all key segments except the last (leaf)
    const groups = new Map();
    for (const item of items) {
      const parts    = item.compositeKey.split(":");
      const groupKey = parts.slice(0, -1).join(":");
      const label    = parts[parts.length - 1];
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push({ ...item, label });
    }

    for (const [groupKey, groupItems] of groups) {
      const groupHeader = document.createElement("div");
      groupHeader.className = "nested-group-header";
      const gParts = groupKey.split(":");
      groupHeader.textContent = gParts[gParts.length - 1];
      section.appendChild(groupHeader);

      for (const { compositeKey, value: originalVal, label } of groupItems) {
        const hasOverride  = compositeKey in (nestedOverrides || {});
        const effectiveVal = hasOverride ? nestedOverrides[compositeKey] : originalVal;
        const isOnOff      = /^(on|off)$/i.test(String(originalVal));
        const safeOriginal = String(originalVal).replace(/"/g, "&quot;");

        const row = document.createElement("div");
        row.className = "flag-row";

        if (isOnOff) {
          const isOn = String(effectiveVal).toUpperCase() === "ON";
          row.innerHTML = `
            <div class="flag-info">
              <div class="flag-name${hasOverride ? " overridden" : ""}">${label}</div>
              ${hasOverride ? `<div class="original-badge">Valeur API : ${safeOriginal}</div>` : ""}
            </div>
            <div class="toggle-wrap">
              <span class="toggle-label ${isOn ? "on" : "off"}">${isOn ? "ON" : "OFF"}</span>
              <label class="toggle">
                <input type="checkbox"
                  class="nested-toggle-input"
                  data-nested-key="${escapeAttr(compositeKey)}"
                  data-original="${safeOriginal}"
                  ${isOn ? "checked" : ""}>
                <span class="slider"></span>
              </label>
              ${hasOverride
                ? `<button class="reset-flag-btn" data-nested-key="${escapeAttr(compositeKey)}" title="Réinitialiser">✕</button>`
                : '<span style="width:18px"></span>'}
            </div>`;
        } else {
          const safeValue = String(effectiveVal).replace(/"/g, "&quot;");
          row.innerHTML = `
            <div class="flag-info">
              <div class="flag-name${hasOverride ? " overridden" : ""}">${label}</div>
              ${hasOverride ? `<div class="original-badge">Valeur API : ${safeOriginal}</div>` : ""}
            </div>
            <div class="text-wrap">
              <input type="text"
                class="text-override-input nested-override-input${hasOverride ? " overridden" : ""}"
                data-nested-key="${escapeAttr(compositeKey)}"
                data-original="${safeOriginal}"
                value="${safeValue}">
              ${hasOverride
                ? `<button class="reset-flag-btn" data-nested-key="${escapeAttr(compositeKey)}" title="Réinitialiser">✕</button>`
                : '<span style="width:18px"></span>'}
            </div>`;
        }

        section.appendChild(row);
      }
    }

    main.appendChild(section);
  }

  if (main.children.length === 0 && query) {
    main.innerHTML = `<div class="empty-state"><p>Aucun résultat pour « ${query} »</p></div>`;
  }
}

async function refresh(tabId) {
  currentState = await msg(tabId, { type: "GET_STATE" });
  renderFlags(currentState, searchQuery());
}

function showLoading() {
  document.getElementById("main-content").innerHTML = `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="spin">
        <circle cx="12" cy="12" r="10" stroke-dasharray="30 10"/>
      </svg>
      <p>Chargement…</p>
    </div>`;
}

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  activeConfig = await loadConfig();

  const tabId = await getTabId();
  if (!tabId) return;

  // Settings toggle
  document.getElementById("btn-settings").addEventListener("click", () => {
    if (settingsOpen) hideSettings();
    else showSettings();
  });

  // Settings: save on any change (text input blur or toggle click)
  document.getElementById("settings-panel").addEventListener("change", async (e) => {
    const input  = e.target.closest("input.settings-input");
    const toggle = e.target.closest("input.settings-toggle");
    if (!input && !toggle) return;

    if (input)  activeConfig = { ...activeConfig, [input.dataset.key]:  input.value };
    if (toggle) activeConfig = { ...activeConfig, [toggle.dataset.key]: toggle.checked };

    await saveConfig(activeConfig);
    renderSettings(activeConfig);
    const reloadText = document.getElementById("reload-text");
    reloadText.textContent = "Rechargez pour appliquer les paramètres";
    document.getElementById("reload-bar").classList.remove("hidden");
  });

  // Settings: reset individual field to FF_CONFIG default
  document.getElementById("settings-panel").addEventListener("click", async (e) => {
    const btn = e.target.closest(".btn-field-reset");
    if (!btn) return;
    const key = btn.dataset.key;
    activeConfig = { ...activeConfig, [key]: FF_CONFIG[key] };
    await saveConfig(activeConfig);
    renderSettings(activeConfig);
  });

  showLoading();

  let state;
  try {
    state = await msg(tabId, { type: "FETCH_FLAGS" });
  } catch {
    document.getElementById("main-content").innerHTML = `
      <div class="error-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p>Extension inactive sur cette page.</p>
        <p class="hint">Ouvrez l'extension depuis l'onglet de l'app.</p>
      </div>`;
    return;
  }

  currentState = state;
  renderFlags(currentState);

  document.getElementById("search-input").addEventListener("input", (e) => {
    renderFlags(currentState, e.target.value.trim());
  });

  // Toggle change
  document.addEventListener("change", async (e) => {
    if (!e.target.matches('input[type="checkbox"][data-id]')) return;
    const { id, section, original } = e.target.dataset;
    const newValue     = e.target.checked;
    const originalBool = original === "true";
    if (newValue === originalBool) {
      await msg(tabId, { type: "CLEAR_OVERRIDE", id, section });
    } else {
      await msg(tabId, { type: "SET_OVERRIDE", id, section, value: newValue });
    }
    await refresh(tabId);
  });

  // Text input change (on blur / Enter)
  document.addEventListener("change", async (e) => {
    if (!e.target.matches("input.text-override-input")) return;
    if (e.target.dataset.nestedKey) return; // handled below
    const { key, original } = e.target.dataset;
    const newValue = e.target.value;
    if (newValue === original) {
      await msg(tabId, { type: "CLEAR_TEXT_OVERRIDE", key });
    } else {
      await msg(tabId, { type: "SET_TEXT_OVERRIDE", key, value: newValue });
    }
    await refresh(tabId);
  });

  // Nested ON/OFF toggle change
  document.addEventListener("change", async (e) => {
    if (!e.target.matches("input.nested-toggle-input")) return;
    const key      = e.target.dataset.nestedKey;
    const original = e.target.dataset.original;
    const newValue = e.target.checked ? "ON" : "OFF";
    if (newValue === original.toUpperCase()) {
      await msg(tabId, { type: "CLEAR_NESTED_OVERRIDE", key });
    } else {
      await msg(tabId, { type: "SET_NESTED_OVERRIDE", key, value: newValue });
    }
    await refresh(tabId);
  });

  // Nested input change
  document.addEventListener("change", async (e) => {
    if (!e.target.matches("input.nested-override-input")) return;
    const key      = e.target.dataset.nestedKey;
    const original = e.target.dataset.original;
    const newValue = e.target.value;
    if (newValue === original) {
      await msg(tabId, { type: "CLEAR_NESTED_OVERRIDE", key });
    } else {
      await msg(tabId, { type: "SET_NESTED_OVERRIDE", key, value: newValue });
    }
    await refresh(tabId);
  });

  // Reset individual toggle
  document.addEventListener("click", async (e) => {
    if (!e.target.matches(".reset-flag-btn[data-id]")) return;
    const { id, section } = e.target.dataset;
    await msg(tabId, { type: "CLEAR_OVERRIDE", id, section });
    await refresh(tabId);
  });

  // Reset individual text
  document.addEventListener("click", async (e) => {
    if (!e.target.matches(".reset-flag-btn[data-key]")) return;
    await msg(tabId, { type: "CLEAR_TEXT_OVERRIDE", key: e.target.dataset.key });
    await refresh(tabId);
  });

  // Reset individual nested
  document.addEventListener("click", async (e) => {
    if (!e.target.matches(".reset-flag-btn[data-nested-key]")) return;
    await msg(tabId, { type: "CLEAR_NESTED_OVERRIDE", key: e.target.dataset.nestedKey });
    await refresh(tabId);
  });

  // Reset all
  document.getElementById("btn-reset").addEventListener("click", async () => {
    await msg(tabId, { type: "RESET_ALL" });
    await refresh(tabId);
  });

  // Reload page
  document.getElementById("btn-reload").addEventListener("click", async () => {
    await msg(tabId, { type: "RELOAD_PAGE" });
    window.close();
  });
}

init();
