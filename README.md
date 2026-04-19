# Feature Flipper — Extension Chrome

Extension Chrome permettant de visualiser et surcharger en temps réel des propriétés d'une réponse HTTP JSON, sans modifier le code source ni l'API.

---

## Fonctionnement général

```
┌─────────────────────────────────────────────────────┐
│                   Page cible                        │
│                                                     │
│  window.fetch('/settings')  ──►  content-inject.js  │
│                                  (MAIN world)       │
│         réponse patchée  ◄──     lit localStorage   │
└────────────────────────┬────────────────────────────┘
                         │ localStorage
                         │ __ff_last_flags
                         │ __ff_overrides
                         │ __ff_settings_path / __ff_data_path / …
┌────────────────────────┴────────────────────────────┐
│              content-bridge.js                      │
│              (ISOLATED world)                       │
│  lit/écrit localStorage · répond aux messages popup │
└────────────────────────┬────────────────────────────┘
                         │ chrome.tabs.sendMessage
┌────────────────────────┴────────────────────────────┐
│                    popup.js                         │
│  affiche les items · envoie les toggles             │
└─────────────────────────────────────────────────────┘
```

---

## Installation (mode développeur)

```bash
cp config.example.js config.js
# éditer config.js avec les vraies valeurs
```

1. Ouvrir `chrome://extensions`
2. Activer le **mode développeur** (coin supérieur droit)
3. Cliquer **"Charger l'extension non empaquetée"** → sélectionner ce dossier
4. Naviguer sur l'app cible
5. Ouvrir le popup via l'icône de l'extension

Les overrides s'appliquent au **prochain rechargement** de la page.

---

## Configuration (`config.js`)

`config.js` est **ignoré par git** — copier `config.example.js` et renseigner les valeurs réelles.

```js
var FF_CONFIG = {
  // Hôte de l'instance cible (sans protocole)
  defaultHost: "your-app.example.com",

  // Endpoint HTTP à intercepter
  settingsPath: "/settings",

  // Chemin vers le tableau à overrider (notation pointée)
  dataPath: "data.module_bar",

  // Clé identifiant chaque item du tableau
  itemIdKey: "id",

  // Propriété à modifier sur chaque item
  itemValueKey: "enabled",

  // Clés localStorage internes (optionnel — modifier en cas de conflit)
  storageKeyLast:      "__ff_last_flags",
  storageKeyOverrides: "__ff_overrides",
};
```

### Exemples de `dataPath`

| Structure de réponse | `dataPath` |
|---|---|
| `{ data: { module_bar: [...] } }` | `"data.module_bar"` |
| `{ featureFlipping: [...] }` | `"featureFlipping"` |
| `{ config: { modules: { items: [...] } } }` | `"config.modules.items"` |

Les champs `dataPath`, `itemIdKey` et `itemValueKey` sont **optionnels** — ils valent respectivement `"data.module_bar"`, `"id"` et `"enabled"` par défaut.

### Changer d'instance

Deux endroits à modifier :

1. **`config.js`** — mettre à jour `defaultHost` (et `settingsPath` si besoin)
2. **`manifest.json`** — mettre à jour le champ `matches` du content script ISOLATED world (`config.js` + `content-bridge.js`)

> Le manifest ne peut pas lire `config.js` dynamiquement (limitation MV3). Le content script MAIN world utilise `<all_urls>` et vérifie l'URL cible à l'exécution via `localStorage` — seul le script ISOLATED world a besoin du match précis pour charger `config.js`.

---

## Les deux mondes d'un content script

Chrome isole les extensions de la page via deux contextes JavaScript distincts :

| Monde | Fichier | Accès |
|---|---|---|
| **MAIN** | `content-inject.js` | `window.fetch`, `XMLHttpRequest` de la page — peut modifier les requêtes réseau |
| **ISOLATED** | `content-bridge.js` | APIs Chrome (`chrome.runtime`, `chrome.tabs`) — ne touche pas au JS de la page |

Les deux partagent le même **DOM** et le même **`localStorage`**, ce qui sert de canal de communication entre eux.

---

## Interception réseau (`content-inject.js`)

Le script s'exécute à `document_start` dans le monde MAIN — **avant tout script de la page**. Il enveloppe `window.fetch` et `XMLHttpRequest` :

```js
const origFetch = window.fetch;
window.fetch = async function (...args) {
  const response = await origFetch.apply(this, args);
  if (!isTarget(url)) return response;
  // … lit les overrides, reconstruit la réponse
};
```

Quand l'app appelle l'endpoint configuré (`settingsPath`) :

1. Le wrapper intercepte la réponse
2. `getByPath(json, dataPath)` extrait le tableau cible
3. Les overrides stockés dans `localStorage` sont appliqués sur `itemValueKey`
4. `setByPath(json, dataPath, patched)` reconstruit le JSON complet
5. L'app reçoit la réponse modifiée — les items overridés sont déjà patchés

> **Pourquoi `"world": "MAIN"` dans le manifest ?**  
> Sans ça, le content script tourne dans un sandbox isolé où `window.fetch` est une copie — wrapper cette copie n'affecte pas la page. `"world": "MAIN"` est l'équivalent de `@run-at document-start` de Tampermonkey.

---

## Persistance des overrides (`localStorage`)

| Clé | Contenu | Rôle |
|---|---|---|
| `__ff_last_flags` | tableau brut de l'API | référence originale affichée dans le popup |
| `__ff_overrides` | `{ [itemId]: value }` | overrides actifs — lu par `content-inject.js` à chaque interception |
| `__ff_settings_path` | string | chemin de l'endpoint |
| `__ff_data_path` | string | chemin vers le tableau dans le JSON |
| `__ff_id_key` | string | clé d'identification des items |
| `__ff_value_key` | string | propriété à overrider |

Les clés de config (`__ff_*`) sont écrites par `content-bridge.js` au démarrage à partir de `FF_CONFIG`, puis lues par `content-inject.js` (MAIN world) qui n'a pas accès à `config.js`.

---

## Communication popup ↔ page (`content-bridge.js`)

| Message | Action |
|---|---|
| `FETCH_FLAGS` | Fait un `fetch(settingsPath)` depuis le contexte de la page (cookies de session inclus) — renvoie `{ lastFlags, overrides, config }` |
| `GET_STATE` | Lit `localStorage` — renvoie `{ lastFlags, overrides, config }` |
| `SET_OVERRIDE` | Écrit `overrides[id] = value` dans `localStorage` |
| `CLEAR_OVERRIDE` | Supprime un override individuel |
| `RESET_ALL` | Supprime `__ff_overrides` entièrement |
| `RELOAD_PAGE` | Appelle `window.location.reload()` |

> **Pourquoi `FETCH_FLAGS` passe par le content script ?**  
> Le popup est une page à part — ses requêtes `fetch` ne portent pas les cookies de session. Le content script, lui, s'exécute dans le contexte de la page et en hérite.

---

## Structure des fichiers

```
chrome-extension/
├── config.example.js    # template de configuration (commité)
├── config.js            # configuration réelle — ignoré par git
├── manifest.json        # déclaration MV3 — permissions, content scripts
├── content-inject.js    # MAIN world — intercepte fetch & XHR
├── content-bridge.js    # ISOLATED world — pont popup ↔ localStorage
├── popup.html           # structure du popup
├── popup.css            # styles du popup
└── popup.js             # logique UI du popup
```
