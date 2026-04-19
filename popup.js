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

function totalOverrides(overrides, textOverrides) {
  return Object.keys(overrides).length + Object.keys(textOverrides).length;
}

function filterState(state, query) {
  if (!query) return state;
  const q = query.toLowerCase();
  const { config } = state;
  return {
    ...state,
    lastFlags: state.lastFlags?.filter((item) =>
      String(item[config.idKey]).toLowerCase().includes(q),
    ) ?? null,
    lastText: state.lastText
      ? Object.fromEntries(
          Object.entries(state.lastText).filter(([k]) => k.toLowerCase().includes(q)),
        )
      : null,
  };
}

function renderFlags(state, query = "") {
  const { lastFlags, overrides, lastText, textOverrides, config } = filterState(state, query);
  const searchBar  = document.getElementById("search-bar");
  const main       = document.getElementById("main-content");
  const statusBar  = document.getElementById("status-bar");
  const statusText = document.getElementById("status-text");

  const hasData = state.lastFlags !== null || state.lastText !== null;
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

  const total = totalOverrides(overrides, textOverrides);
  if (total > 0) {
    statusBar.classList.remove("hidden");
    statusText.textContent = `${total} override${total > 1 ? "s" : ""} actif${total > 1 ? "s" : ""}`;
  } else {
    statusBar.classList.add("hidden");
  }

  main.innerHTML = "";

  // --- Toggle section (array overrides) ---
  if (lastFlags && config.dataPath) {
    const { idKey, valueKey, dataPath } = config;
    const section = document.createElement("div");
    section.className = "category";

    const header = document.createElement("div");
    header.className = "category-header";
    header.textContent = dataPath.split(".").pop() + " — " + valueKey;
    section.appendChild(header);

    for (const mod of lastFlags) {
      const itemId      = mod[idKey];
      const originalVal = mod[valueKey];
      const hasOverride = itemId in overrides;
      const effectiveVal = hasOverride ? overrides[itemId] : originalVal;
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
              data-original="${originalVal}">
            <span class="slider"></span>
          </label>
          ${
            hasOverride
              ? `<button class="reset-flag-btn" data-id="${itemId}" title="Réinitialiser">✕</button>`
              : '<span style="width:18px"></span>'
          }
        </div>`;
      section.appendChild(row);
    }

    main.appendChild(section);
  }

  // --- Text section ---
  const textEntries = lastText ? Object.entries(lastText) : [];
  if (textEntries.length > 0 && config.textPath) {
    const section = document.createElement("div");
    section.className = "category";

    const header = document.createElement("div");
    header.className = "category-header";
    header.textContent = config.textPath.split(".").pop() + " — text";
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

  if (main.children.length === 0 && query) {
    main.innerHTML = `<div class="empty-state"><p>Aucun résultat pour « ${query} »</p></div>`;
  }
}

let currentState = null;

function searchQuery() {
  return document.getElementById("search-input")?.value.trim() ?? "";
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

async function init() {
  const tabId = await getTabId();
  if (!tabId) return;

  showLoading();

  let state;
  try {
    // Always fetch fresh on popup open — content-bridge uses page session cookies
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
    const { id, original } = e.target.dataset;
    const newValue    = e.target.checked;
    const originalBool = original === "true";
    if (newValue === originalBool) {
      await msg(tabId, { type: "CLEAR_OVERRIDE", id });
    } else {
      await msg(tabId, { type: "SET_OVERRIDE", id, value: newValue });
    }
    await refresh(tabId);
  });

  // Text input change (on blur / Enter)
  document.addEventListener("change", async (e) => {
    if (!e.target.matches("input.text-override-input")) return;
    const { key, original } = e.target.dataset;
    const newValue = e.target.value;
    if (newValue === original) {
      await msg(tabId, { type: "CLEAR_TEXT_OVERRIDE", key });
    } else {
      await msg(tabId, { type: "SET_TEXT_OVERRIDE", key, value: newValue });
    }
    await refresh(tabId);
  });

  // Reset individual toggle
  document.addEventListener("click", async (e) => {
    if (!e.target.matches(".reset-flag-btn[data-id]")) return;
    await msg(tabId, { type: "CLEAR_OVERRIDE", id: e.target.dataset.id });
    await refresh(tabId);
  });

  // Reset individual text
  document.addEventListener("click", async (e) => {
    if (!e.target.matches(".reset-flag-btn[data-key]")) return;
    await msg(tabId, { type: "CLEAR_TEXT_OVERRIDE", key: e.target.dataset.key });
    await refresh(tabId);
  });

  // Reset all
  document.getElementById("btn-reset").addEventListener("click", async () => {
    await msg(tabId, { type: "RESET_ALL" });
    await refresh(tabId);
  });

  // Reload page so the overrides are applied on the next fetch
  document.getElementById("btn-reload").addEventListener("click", async () => {
    await msg(tabId, { type: "RELOAD_PAGE" });
    window.close();
  });
}

init();
