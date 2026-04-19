# Ovrid — Extension Chrome

Extension Chrome permettant de visualiser et surcharger en temps réel des propriétés d'une réponse HTTP JSON, sans modifier le code source ni l'API.

Supporte les overrides de **toggles booléens** (tableaux d'items) et de **valeurs texte** (propriétés scalaires) — auto-détectés à partir d'un chemin racine configurable.

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
                         │ __ff_last_flags / __ff_last_text
                         │ __ff_overrides  / __ff_text_overrides
                         │ __ff_settings_url / __ff_root_path / …
┌────────────────────────┴────────────────────────────┐
│              content-bridge.js                      │
│              (ISOLATED world)                       │
│  lit/écrit localStorage · répond aux messages popup │
│  notifie background.js pour le badge               │
└────────────────┬───────────────────┬────────────────┘
                 │ chrome.tabs       │ chrome.runtime
                 │ .sendMessage      │ .sendMessage
┌────────────────┴──────┐  ┌─────────┴───────────────┐
│       popup.js        │  │      background.js       │
│  affiche les items    │  │  met à jour le badge     │
│  envoie les toggles   │  │                          │
└───────────────────────┘  └─────────────────────────┘
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

## Configuration

### Via le popup (recommandé)

Cliquer l'icône ⚙ dans le header du popup ouvre le **panneau Paramètres**. Les champs configurables sont :

| Champ | Description |
|---|---|
| Overrides de toggles | Active/désactive l'interception des tableaux booléens |
| Overrides de texte | Active/désactive l'interception des propriétés scalaires |
| URL de l'endpoint | URL complète à intercepter (peut être cross-origin) |
| Propriété racine (JSON) | Chemin vers l'objet racine dans la réponse (notation pointée) |
| Clé cache (avancé) | Clé `localStorage` interne pour le cache des items |
| Clé overrides (avancé) | Clé `localStorage` interne pour les overrides de toggles |

Chaque champ affiche un bouton **↺** dès qu'il diffère de la valeur par défaut de `config.js`. Les modifications prennent effet au prochain rechargement de la page.

### Via `config.js`

`config.js` est **ignoré par git** — copier `config.example.js` et renseigner les valeurs réelles. Ces valeurs servent de **defaults** : si aucun paramètre n'a été sauvegardé dans le popup, c'est `config.js` qui s'applique.

```js
var FF_CONFIG = {
  // URL complète de l'endpoint à intercepter (peut être cross-origin)
  settingsUrl: "https://your-app.example.com/api/settings",

  // Chemin vers l'objet racine dans la réponse JSON (notation pointée)
  // Les tableaux d'objets → sections de toggles (idKey/valueKey auto-détectés)
  // Les primitives → champs texte overridables
  rootPath: "data",

  // Clés localStorage internes (optionnel — modifier en cas de conflit)
  storageKeyLast:      "__ff_last_flags",
  storageKeyOverrides: "__ff_overrides",
};
```

### Auto-détection des sections

À partir de l'objet pointé par `rootPath`, le script parcourt chaque propriété :

- **Tableau d'objets** → section de toggles. La clé d'identification (`id`, `key`, `name`…) et la propriété booléenne (`enabled`, `active`, `on`…) sont détectées automatiquement sur le premier item.
- **Valeur primitive** (string, number…) → champ texte overridable.
- **Objet ou tableau vide** → ignoré.

### Exemples de `rootPath`

| Structure de réponse | `rootPath` | Ce qui est détecté |
|---|---|---|
| `{ data: { flags: [...], title: "..." } }` | `"data"` | section `flags` (toggles) + champ `title` (texte) |
| `{ response: { modules: [...] } }` | `"response"` | section `modules` (toggles) |
| `{ config: { sections: { items: [...] } } }` | `"config.sections"` | section `items` (toggles) |

### Changer d'instance

Pour pointer sur un autre endpoint :

1. **Popup → Paramètres** — modifier `URL de l'endpoint` (ou éditer `config.js`)

> Le manifest utilise `<all_urls>` — le content script MAIN world vérifie l'URL cible à l'exécution via `localStorage`. Aucune modification du `manifest.json` n'est nécessaire pour changer d'instance.

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

Quand l'app appelle l'endpoint configuré (`settingsUrl`) :

1. Le wrapper intercepte la réponse
2. `getByPath(json, rootPath)` extrait l'objet racine
3. **Overrides de toggles** : chaque sous-tableau est parcouru — les overrides de `__ff_overrides[sectionKey][itemId]` sont appliqués sur la propriété booléenne auto-détectée
4. **Overrides texte** : les primitives de l'objet racine sont remplacées par les valeurs de `__ff_text_overrides`
5. `setByPath` reconstruit le JSON complet pour chaque section modifiée
6. L'app reçoit la réponse patchée

> **Pourquoi `"world": "MAIN"` dans le manifest ?**
> Sans ça, le content script tourne dans un sandbox isolé où `window.fetch` est une copie — wrapper cette copie n'affecte pas la page. `"world": "MAIN"` est l'équivalent de `@run-at document-start` de Tampermonkey.

---

## Persistance des overrides (`localStorage`)

| Clé | Contenu | Rôle |
|---|---|---|
| `__ff_last_flags` | `{ [sectionKey]: { idKey, valueKey, items } }` | sections détectées — référence affichée dans le popup |
| `__ff_overrides` | `{ [sectionKey]: { [itemId]: boolean } }` | overrides de toggles par section — lu par `content-inject.js` |
| `__ff_last_text` | `{ [key]: value }` | valeurs scalaires originales |
| `__ff_text_overrides` | `{ [key]: string }` | overrides de texte — lu par `content-inject.js` |
| `__ff_settings_url` | string | URL complète de l'endpoint |
| `__ff_root_path` | string | chemin vers l'objet racine dans le JSON |
| `__ff_overrides_enabled` | `"true"` / `"false"` | activation des overrides de toggles |
| `__ff_text_ovr_enabled` | `"true"` / `"false"` | activation des overrides de texte |

Les clés `__ff_*` sont écrites par `content-bridge.js` au démarrage à partir de la config mergée (`chrome.storage.local` + `config.js`), puis lues par `content-inject.js` (MAIN world) qui n'a pas accès à `config.js`.

---

## Paramètres (`chrome.storage.local`)

Les paramètres modifiés via le popup sont stockés dans `chrome.storage.local` sous la clé `__ff_config_settings`. Au démarrage, `content-bridge.js` merge ces valeurs avec les defaults de `config.js` (les valeurs du storage ont priorité).

La réinitialisation champ par champ (bouton ↺) revient aux defaults de `config.js`.

---

## Icône

Les fichiers `icons/icon16.png`, `icons/icon48.png` et `icons/icon128.png` sont référencés dans `manifest.json`.

Pour les régénérer (après modification du design) :

```bash
node generate-icons.js
```

Le script `generate-icons.js` n'a aucune dépendance externe — il génère les PNGs via les modules natifs Node.js (`zlib`). Le fichier source `icons/icon.svg` sert de référence de design.

Le badge rouge (nombre d'overrides actifs) est mis à jour par `content-bridge.js` via un message `UPDATE_BADGE` après chaque modification.

---

## Communication popup ↔ page (`content-bridge.js`)

| Message | Paramètres | Action |
|---|---|---|
| `FETCH_FLAGS` | — | Fait un `fetch(settingsUrl)` depuis le contexte de la page (cookies de session inclus) — renvoie `{ lastSections, overrides, lastText, textOverrides }` |
| `GET_STATE` | — | Lit `localStorage` — renvoie `{ lastSections, overrides, lastText, textOverrides }` |
| `SET_OVERRIDE` | `{ id, section, value }` | Écrit `overrides[section][id] = value` dans `localStorage` |
| `CLEAR_OVERRIDE` | `{ id, section }` | Supprime un override de toggle individuel |
| `SET_TEXT_OVERRIDE` | `{ key, value }` | Écrit `textOverrides[key] = value` dans `localStorage` |
| `CLEAR_TEXT_OVERRIDE` | `{ key }` | Supprime un override texte individuel |
| `RESET_ALL` | — | Supprime `__ff_overrides` et `__ff_text_overrides` |
| `RELOAD_PAGE` | — | Appelle `window.location.reload()` |

> **Pourquoi `FETCH_FLAGS` passe par le content script ?**
> Le popup est une page à part — ses requêtes `fetch` ne portent pas les cookies de session. Le content script, lui, s'exécute dans le contexte de la page et en hérite.

---

## Structure des fichiers

```
ovrid/
├── config.example.js    # template de configuration (commité)
├── config.js            # configuration réelle — ignoré par git
├── manifest.json        # déclaration MV3 — permissions, content scripts, service worker
├── background.js        # service worker — badge
├── generate-icons.js    # script Node.js — génère les PNGs (sans dépendances)
├── content-inject.js    # MAIN world — intercepte fetch & XHR, applique les overrides
├── content-bridge.js    # ISOLATED world — pont popup ↔ localStorage, badge
├── popup.html           # structure du popup
├── popup.css            # styles du popup
├── popup.js             # logique UI du popup (flags + settings)
└── icons/
    └── icon.svg         # source de design de l'icône
```
