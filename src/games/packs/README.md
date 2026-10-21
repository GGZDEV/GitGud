# Modules de jeu en JSON

Un module apprend à GitGud à reconnaître un jeu et à mieux y répondre, sans écrire de code.

**Où le mettre :** dans `%APPDATA%\gitgud\games\`. Le bouton « Ouvrir le dossier des modules » se trouve dans Paramètres → Jeux. Les modifications sont prises en compte à chaud, en 5 secondes au plus. Un module perso qui porte le même `id` qu'un module fourni le remplace.

## Exemple minimal

```json
{
  "id": "hades-2",
  "name": "Hades II",
  "match": ["hades\\s*(ii|2)"]
}
```

## Tous les champs

| Champ | Obligatoire | Rôle |
|---|---|---|
| `id` | oui | identifiant unique : minuscules, chiffres et tirets |
| `name` | oui | nom affiché et donné à l'IA |
| `match` | oui | une ou plusieurs expressions régulières, comparées au titre de la fenêtre du jeu, sans tenir compte de la casse. Dans le JSON, il faut doubler les `\` |
| `guidance` | non | consignes pour l'IA : ton, priorités, pièges du jeu |
| `sources` | non | sites à privilégier pour la recherche web (wiki, guides) |
| `facts` | non | faits courts toujours fournis à l'IA |
| `glossary` | non | vocabulaire du jeu : `{ "PC": "points de concentration" }` |
| `keywords` | non | consignes ajoutées seulement si la question correspond : `[{ "when": "boss\|battre", "say": "…" }]` |
| `timers` | non | minuteurs prêts à l'emploi : `[{ "name": "Roshan", "aliases": ["rosh"], "seconds": 480 }]`. On les lance en disant « lance Roshan » ou « timer Roshan » |
| `data` | non | données en direct, voir ci-dessous |
| `author`, `version`, `description` | non | affichés dans les paramètres |

### Données en direct (`data`)

```json
"data": [
  {
    "url": "https://api.exemple.com/meta.json",
    "when": "méta|tier",
    "label": "Méta actuelle",
    "pick": "data.top",
    "ttl": 3600,
    "maxChars": 1500
  }
]
```

- La requête est un simple **GET HTTPS**. Aucune donnée du joueur n'est ajoutée à l'URL.
- `when` : la requête n'est envoyée que si la question correspond. Sans `when`, elle part à chaque question.
- `pick` : chemin dans la réponse JSON, par exemple `data.top`.
- `ttl` : durée du cache en secondes (30 min par défaut).
- `maxChars` : longueur maximale du texte envoyé à l'IA (1 500 par défaut, 6 000 au plus).
- Au-delà de 4 s sans réponse, la question part sans ces données.

## Tester son module

Paramètres → Jeux liste les modules chargés et les erreurs de format. Ouvre ensuite le jeu en fenêtré sans bordure : le nom du jeu doit apparaître sous la mascotte quand tu poses une question.
