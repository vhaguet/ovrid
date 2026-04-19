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

function countOverrides(overrides) {
  return Object.keys(overrides).length;
}

function renderFlags(
  lastFlags,
  overrides,
  config = { dataPath, idKey, valueKey },
) {
  const main = document.getElementById("main-content");
  const statusBar = document.getElementById("status-bar");
  const statusText = document.getElementById("status-text");

  if (!lastFlags) {
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

  const total = countOverrides(overrides);
  if (total > 0) {
    statusBar.classList.remove("hidden");
    statusText.textContent = `${total} override${total > 1 ? "s" : ""} actif${total > 1 ? "s" : ""}`;
  } else {
    statusBar.classList.add("hidden");
  }

  main.innerHTML = "";

  const section = document.createElement("div");
  section.className = "category";

  const { idKey, valueKey, dataPath } = config;
  const label = dataPath.split(".").pop() + " — " + valueKey;

  const header = document.createElement("div");
  header.className = "category-header";
  header.textContent = label;
  section.appendChild(header);

  for (const mod of lastFlags) {
    const itemId = mod[idKey];
    const originalVal = mod[valueKey];
    const hasOverride = itemId in overrides;
    const effectiveVal = hasOverride ? overrides[itemId] : originalVal;
    const isOn = effectiveVal === true || effectiveVal === "ON";
    const isLocked = !!mod.locked;

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

async function refresh(tabId) {
  const state = await msg(tabId, { type: "GET_STATE" });
  renderFlags(state.lastFlags, state.overrides, state.config);
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

  renderFlags(state.lastFlags, state.overrides, state.config);

  // Toggle enabled
  document.addEventListener("change", async (e) => {
    if (!e.target.matches('input[type="checkbox"][data-id]')) return;
    const { id, original } = e.target.dataset;
    const newValue = e.target.checked;
    const originalBool = original === "true";

    if (newValue === originalBool) {
      await msg(tabId, { type: "CLEAR_OVERRIDE", id });
    } else {
      await msg(tabId, { type: "SET_OVERRIDE", id, value: newValue });
    }
    await refresh(tabId);
  });

  // Reset individual
  document.addEventListener("click", async (e) => {
    if (!e.target.matches(".reset-flag-btn")) return;
    await msg(tabId, { type: "CLEAR_OVERRIDE", id: e.target.dataset.id });
    await refresh(tabId);
  });

  // Reset all
  document.getElementById("btn-reset").addEventListener("click", async () => {
    await msg(tabId, { type: "RESET_ALL" });
    await refresh(tabId);
  });

  // Reload page so the overrides are applied on the next /settings fetch
  document.getElementById("btn-reload").addEventListener("click", async () => {
    await msg(tabId, { type: "RELOAD_PAGE" });
    window.close();
  });
}

init();
