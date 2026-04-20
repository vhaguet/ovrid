// Copier ce fichier en config.js et renseigner les valeurs réelles.
// config.js est ignoré par git (.gitignore).

var FF_CONFIG = {
  // URL(s) des endpoints à intercepter (un ou plusieurs, host différent autorisé)
  settingsUrls: [
    { key: "prod", url: "https://your-app.example.com/api/settings" },
  ],

  // Propriété racine dans la réponse JSON (notation pointée, ex. "data" ou "response.data")
  // Le script détecte automatiquement :
  //   — les tableaux       → sections de toggles (idKey et valueKey auto-détectés)
  //   — les primitives     → overrides de texte
  rootPath: "data",

  // (Optionnel) Tableaux imbriqués à surcharger manuellement.
  // path    : chemin en notation pointée depuis rootObj, chaque segment est un tableau
  // idKeys  : clé identifiante à chaque niveau (même ordre que path)
  // valueKey: champ à surcharger dans les items feuilles
  // nestedSections: [
  //   {
  //     path: "topics.subTopics.subTopicParameters",
  //     idKeys: ["topicCode", "subTopicCode", "parameterCode"],
  //     valueKey: "parameterValue",
  //   },
  // ],
  // Clés localStorage internes (modifier uniquement en cas de conflit)
  storageKeyLast: "__ff_last_flags",
  storageKeyOverrides: "__ff_overrides",
};
