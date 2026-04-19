# Ovrid — Extension Chrome

Extension Chrome permettant de visualiser et surcharger en temps réel des propriétés d'une réponse HTTP JSON, sans modifier le code source ni l'API.

Supporte les overrides de **toggles booléens** (tableau d'items) et de **valeurs texte** (propriétés scalaires d'un objet).

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
                         │ __ff_settings_path / __ff_data_path / …
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

Cliquer l'icône ⚙ dans le header du popup ouvre le **panneau Paramètres**. Toutes les valeurs de `FF_CONFIG` sont éditables en direct et sauvegardées dans `chrome.storage.local`. Les modifications prennent effet au prochain rechargement de la page.

Chaque champ affiche un bouton **↺** dès qu'il diffère de la valeur par défaut de `config.js`.

### Via `config.js`

`config.js` est **ignoré par git** — copier `config.example.js` et renseigner les valeurs réelles. Ces valeurs servent de **defaults** : si aucun paramètre n'a été sauvegardé dans le popup, c'est `config.js` qui s'applique.

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

  // Chemin vers l'objet contenant les propriétés texte à overrider (optionnel)
  textPath: "data",

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

### Changer d'instance

Pour pointer sur un autre host :

1. **Popup → Paramètres** — modifier `Hôte de l'API` et `Chemin de l'endpoint` (ou éditer `config.js`)
2. **`manifest.json`** — mettre à jour le champ `matches` du content script ISOLATED world

> Le manifest ne peut pas lire `config.js` dynamiquement (limitation MV3). Le content script MAIN world utilise `<all_urls>` et vérifie l'URL cible à l'exécution via `localStorage` — seul le script ISOLATED world a besoin du match précis.

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
2. **Overrides de tableau** : `getByPath(json, dataPath)` extrait le tableau cible, les overrides de `__ff_overrides` sont appliqués sur `itemValueKey`
3. **Overrides texte** : `getByPath(json, textPath)` extrait l'objet cible, les overrides de `__ff_text_overrides` sont fusionnés
4. `setByPath` reconstruit le JSON complet pour chaque section modifiée
5. L'app reçoit la réponse patchée

> **Pourquoi `"world": "MAIN"` dans le manifest ?**
> Sans ça, le content script tourne dans un sandbox isolé où `window.fetch` est une copie — wrapper cette copie n'affecte pas la page. `"world": "MAIN"` est l'équivalent de `@run-at document-start` de Tampermonkey.

---

## Persistance des overrides (`localStorage`)

| Clé | Contenu | Rôle |
|---|---|---|
| `__ff_last_flags` | tableau brut de l'API | référence originale des items toggle affichée dans le popup |
| `__ff_overrides` | `{ [itemId]: value }` | overrides de toggles — lu par `content-inject.js` |
| `__ff_last_text` | `{ [key]: value }` | valeurs scalaires originales à la racine de `textPath` |
| `__ff_text_overrides` | `{ [key]: string }` | overrides de texte — lu par `content-inject.js` |
| `__ff_settings_path` | string | chemin de l'endpoint |
| `__ff_data_path` | string | chemin vers le tableau dans le JSON |
| `__ff_id_key` | string | clé d'identification des items |
| `__ff_value_key` | string | propriété à overrider sur les items |
| `__ff_text_path` | string | chemin vers l'objet texte dans le JSON |

Les clés de config (`__ff_*`) sont écrites par `content-bridge.js` au démarrage à partir de la config mergée (`chrome.storage.local` + `config.js`), puis lues par `content-inject.js` (MAIN world) qui n'a pas accès à `config.js`.

---

## Paramètres (`chrome.storage.local`)

Les paramètres modifiés via le popup sont stockés dans `chrome.storage.local` sous la clé `__ff_config_settings`. Au démarrage, `content-bridge.js` merge ces valeurs avec les defaults de `config.js` (les valeurs du storage ont priorité).

La réinitialisation champ par champ (bouton ↺) ou globale supprime les surcharges et revient aux defaults de `config.js`.

---

## Icône

Les fichiers `icons/icon16.png`, `icons/icon48.png` et `icons/icon128.png` sont référencés dans `manifest.json` (champs `icons` et `action.default_icon`).

Pour les régénérer (après modification du design) :

```bash
node generate-icons.js
```

Le script `generate-icons.js` n'a aucune dépendance externe — il génère les PNGs via les modules natifs Node.js (`zlib`). Le fichier source `icons/icon.svg` sert de référence de design.

Le badge rouge (nombre d'overrides actifs) est mis à jour par `content-bridge.js` via un message `UPDATE_BADGE` après chaque modification.

---

## Communication popup ↔ page (`content-bridge.js`)

| Message | Action |
|---|---|
| `FETCH_FLAGS` | Fait un `fetch(settingsPath)` depuis le contexte de la page (cookies de session inclus) — renvoie `{ lastFlags, overrides, lastText, textOverrides, config }` |
| `GET_STATE` | Lit `localStorage` — renvoie `{ lastFlags, overrides, lastText, textOverrides, config }` |
| `SET_OVERRIDE` | Écrit `overrides[id] = value` dans `localStorage` |
| `CLEAR_OVERRIDE` | Supprime un override de toggle individuel |
| `SET_TEXT_OVERRIDE` | Écrit `textOverrides[key] = value` dans `localStorage` |
| `CLEAR_TEXT_OVERRIDE` | Supprime un override texte individuel |
| `RESET_ALL` | Supprime `__ff_overrides` et `__ff_text_overrides` |
| `RELOAD_PAGE` | Appelle `window.location.reload()` |

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
├── content-inject.js    # MAIN world — intercepte fetch & XHR
├── content-bridge.js    # ISOLATED world — pont popup ↔ localStorage, badge
├── popup.html           # structure du popup
├── popup.css            # styles du popup
├── popup.js             # logique UI du popup (flags + settings)
└── icons/
    └── icon.svg         # source de design de l'icône
```
