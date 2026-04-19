// Copier ce fichier en config.js et renseigner les valeurs réelles.
// config.js est ignoré par git (.gitignore).

var FF_CONFIG = {
  // Hôte de l'instance cible (sans protocole)
  defaultHost: "your-app.example.com",

  // Endpoint HTTP à intercepter
  settingsPath: "/settings",

  // Chemin vers le tableau à overrider dans la réponse JSON (notation pointée)
  // Exemples : "data.module_bar"  |  "featureFlipping"  |  "config.modules"
  dataPath: "data.module_bar",

  // Clé identifiant chaque item du tableau (utilisée comme clé d'override)
  itemIdKey: "id",

  // Propriété à modifier sur chaque item
  itemValueKey: "enabled",

  // Clés localStorage internes (modifier uniquement en cas de conflit)
  storageKeyLast:      "__ff_last_flags",
  storageKeyOverrides: "__ff_overrides",
};
