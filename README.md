# GitGud

Assistant IA open source pour jeux PC, inspiré de Gamekin : tu poses une question à la voix pendant que tu joues, il regarde l'écran du jeu et te répond dans un overlay, à voix haute.

**Aucun abonnement GitGud, aucun serveur.** Tout tourne sur ta machine et utilise **ton** accès IA :

| Moteur des réponses | Ce qu'il faut |
|---|---|
| ChatGPT — abonnement | [Codex CLI](https://github.com/openai/codex) installé et connecté avec ton compte ChatGPT |
| Claude — abonnement Pro/Max | [Claude Code](https://code.claude.com) installé et connecté avec ton compte Claude |
| Claude — clé API | une clé sur console.anthropic.com |
| OpenAI — clé API | une clé sur platform.openai.com |

La reconnaissance vocale tourne **en local avec Whisper**, et chaque mascotte parle avec **sa propre voix neuronale locale (Piper)** : tout est gratuit et hors ligne. Les voix OpenAI restent disponibles en option avec une clé API.

## Installation

Deux installateurs (`npm run dist` / `npm run dist:full`) :

| Installateur | Taille | Contenu |
|---|---|---|
| `GitGud-Setup-x.y.z.exe` | ~120 Mo | l'app ; le modèle Whisper se télécharge pendant la configuration |
| `GitGud-Setup-x.y.z-complet.exe` | ~305 Mo | l'app + Whisper Small inclus, la voix marche hors ligne dès l'installation |

Windows SmartScreen peut avertir : l'exécutable n'est pas signé.

### Premier lancement : l'assistant de configuration

1. **IA** : GitGud détecte ce qui est déjà installé, pour ne rien installer en double :
   - Codex : app Codex d'OpenAI, installation npm, ou PATH ;
   - Claude Code : installation native, npm, ou la copie fournie par Claude Desktop ;
   - quand plusieurs copies existent, la plus récente est retenue.

   Chaque moteur est ensuite **testé pour de vrai**, car Claude Code peut se dire connecté avec une session expirée. Les boutons « Se connecter » et « Installer » ouvrent la commande officielle dans une fenêtre visible.
2. **Voix** : choix du modèle Whisper (téléchargé automatiquement s'il manque), test du micro, test de la voix.
3. **Jeu** : fenêtre à observer, recherche web, personnalité, langue.
4. **Récapitulatif**.

L'assistant se rouvre depuis l'icône de la zone de notification → « Assistant de configuration ».

### Depuis les sources
```bash
npm install
npm start
```

Diagnostic de la détection :
```bash
npm run detect
```

## Utilisation

L'app se loge dans la zone de notification (carré violet). Au premier lancement, les paramètres s'ouvrent : choisis le moteur et la fenêtre du jeu.

| Raccourci (par défaut) | Action |
|---|---|
| **Alt+V** maintenu | Parler (relâcher pour envoyer) |
| **Alt+T** | Poser une question écrite |
| **Alt+X** | Fermer l'overlay et couper la réponse |
| **Alt+O** | Afficher / masquer l'overlay (reste affiché tant qu'il n'est pas masqué) |

Tous les raccourcis se changent dans les paramètres (ou à la fin de l'assistant). Ils acceptent une touche avec Ctrl / Alt / Maj / Win, ou un bouton de souris (molette, boutons latéraux 4 et 5).

**Déplacer l'overlay :** tire son en-tête (la mascotte) où tu veux. La position est mémorisée, et l'icône de notification permet de le replacer à sa position d'origine.

**Overlay réglable** (Paramètres → Overlay) :
- **taille :** de 80 à 140 % ;
- **opacité du fond ;**
- **mode compact :** la mascotte et la réponse sur deux lignes.

La mascotte réagit au son réel : son halo suit le volume de ta voix quand tu parles, et sa bouche suit la voix quand elle répond.

**Manette :** n'importe quel bouton d'une manette Xbox ou compatible (XInput) peut servir de raccourci, gâchettes comprises. Les manettes PlayStation passent par Steam Input ou DS4Windows. Le jeu reçoit aussi l'appui : choisis un bouton peu utilisé.

### Jeux pris en charge

GitGud reconnaît le jeu d'après la fenêtre observée ou les fenêtres ouvertes. Pour les autres jeux, il fonctionne normalement, avec la recherche web.

| Jeu | Ce qui est ajouté aux questions |
|---|---|
| **Deadlock** | Statistiques en direct de [deadlock-api.com](https://deadlock-api.com) sur 30 jours : méta des héros, matchups de couloir, objets les plus gagnants par palier de prix (et contre l'adversaire cité). Avec ton identifiant Steam (Paramètres → Jeux) : analyse de tes dernières parties. Les noms de héros français et anglais sont reconnus. |
| **Diablo IV** | Module complet, voir ci-dessous : lecture des objets survolés, build importé, verdict ✓ / ✗ instantané, scan du sac et de l'équipement. La recherche web est orientée vers Maxroll, D4Builds, Mobalytics et les notes de patch. |

Les réponses citent leurs sources : les liens apparaissent en pastilles cliquables sous la réponse et ne sont pas lus à voix haute.

D'autres jeux sont reconnus grâce à des **modules JSON**, sans code : Elden Ring, Baldur's Gate 3, Path of Exile 2 et Dota 2 sont fournis. N'importe qui peut en écrire un et le déposer dans `%APPDATA%\gitgud\games\` (Paramètres → Jeux → « Ouvrir le dossier des modules »). Un module contient :
- la reconnaissance de la fenêtre ;
- les consignes pour l'IA et les sites de référence pour la recherche web ;
- le vocabulaire du jeu ;
- des minuteurs prêts à l'emploi (« lance Roshan ») ;
- des données en direct en HTTPS.

Le format est décrit dans [src/games/packs/README.md](src/games/packs/README.md). Pour les intégrations poussées, un module JS reste possible dans `src/games/`, sur le modèle de `deadlock.js`.

### Mémoire, repères et minuteurs

- **Mémoire du joueur :** GitGud retient d'une session à l'autre tes objectifs, ta progression, les difficultés qui reviennent et tes préférences, jeu par jeu. L'IA note un fait quand tu en parles, sans appel supplémentaire. Tu peux aussi lui dire « souviens-toi que… » ou « oublie que… ». Tout reste en local (`memory.json`). Les souvenirs se consultent et s'effacent dans Paramètres → Mémoire.
- **Repères sur le jeu :** quand c'est utile (« où est l'entrée ? », « je clique où ? »), l'IA entoure ou pointe l'endroit sur la capture, et le repère s'affiche par-dessus le jeu pendant 12 s.
- **Minuteurs :** « minuteur 5 minutes boss », « rappelle-moi dans 30 secondes », « annule le minuteur ». Ces phrases sont reconnues en local, sans IA, et le minuteur démarre tout de suite. Il s'affiche en pastille dans l'overlay (un clic l'annule) et la mascotte prévient à l'échéance.

### Module Diablo IV

C'est le même principe que [D4LF](https://github.com/d4lfteam/d4lf) (MIT), dont il reprend la DLL : le jeu envoie le texte de chaque infobulle survolée à un « lecteur d'écran tiers ». La DLL `saapi64.dll`, placée dans le dossier du jeu, le transmet à GitGud. Rien n'est injecté dans le jeu et aucune mémoire n'est lue.

- **Panneau Diablo IV** (icône de notification → « Diablo IV… », ou depuis les paramètres), en 4 onglets :
  - **Builds :** import de liens **Mobalytics** (guides et builds de profil), **Maxroll** (planificateur ou guide) et **D4Builds**, ou un build vierge créé soi-même. Plusieurs builds sont enregistrés, pratique pour un reroll ; on choisit le build actif et sa variante (Starter, Endgame…).
  - **Priorités :** tous les éléments importés, modifiables : objet unique ou aspect visé, affixes dans l'ordre de priorité, ★ supérieur, ajout ou retrait d'affixes et de trempes.
  - **Équipement :** chaque pièce portée face au build : ✓ / ✗, aspect présent ou non, affixes manquants.
  - **Connexion & scan :** état de la liaison avec le jeu, prérequis, calibrage, fiche au survol.
- **Reconnaissance :** les emplacements sont reconnus d'après les noms officiels des types d'objets (Heaume, Couteau de brèche, Catalyseur…). Les affixes sont comparés par famille : « Maximum de vie » et « points de vie maximum » comptent pour le même affixe, et une résistance doit être du bon élément. L'aspect visé est vérifié dans le nom de l'objet.
- **Fiche d'objet au survol :** pour chaque affixe, ✓ s'il est prioritaire pour cet emplacement, ~ s'il est utile ailleurs dans le build ou proche (dégâts sur la durée ≈ multiplicateur de dégâts sur la durée), ✗ s'il est inutile. À côté : l'écart avec la pièce portée et la qualité du tirage. Puis le bilan face à la pièce portée (▲ ce qu'on gagne, ▼ ce qu'on perd) et le verdict. Tout est calculé en local, sans IA ni quota.
- **Verdict :** l'objet n'a pas besoin d'être identique au guide. Chaque affixe est pondéré selon tout le build et les valeurs sont comparées à la pièce portée, avec les écarts que le jeu affiche lui-même : 130 de dextérité au lieu de 140, c'est une perte. Les pouvoirs comptent aussi (unique du build, aspect de l'emplacement). Règles selon la rareté :
  - **unique :** celui du build est à garder ; un autre unique est à recycler (ses affixes ne se changent pas), sauf s'il bat nettement la pièce portée ;
  - **légendaire / rare :** à garder s'il bat la pièce portée, ou comme base à imprégner si ses caractéristiques valent presque celles de la pièce portée et qu'il ne lui manque que l'aspect ; sinon à recycler (l'aspect ira au codex s'il est meilleur) ;
  - **ancestral :** quand ton équipement est majoritairement ancestral, un objet non ancestral est à recycler, sauf s'il bat nettement la pièce portée ;
  - **magique :** à recycler.
- **Le jeu peut rester en français :** contrairement à D4LF, aucune langue n'est imposée, et aucune taille de police ni réglage HDR n'est exigé.
- **Équipement porté :** reconnu au simple survol (une pièce portée n'affiche pas d'écarts de comparaison, contrairement à un objet du sac). Sa position à l'écran, utilisée par le scan, n'est retenue que pendant la synchronisation de l'équipement (panneau Diablo IV) : un survol dans le coffre ou chez un marchand ne la fausse plus.
- **Scan (F8 par défaut) :**
  - le premier appui lance le calibrage : case en haut à gauche, puis en bas à droite du sac ;
  - ensuite, la souris survole automatiquement tes pièces portées puis les 33 cases du sac ;
  - des repères ★ / ✓ / ✗ s'affichent sur les cases pendant 30 s ; si plusieurs objets sont bons pour le même emplacement, seul le meilleur reste à garder (les deux meilleurs pour les anneaux) ;
  - Échap ou F8 interrompt le scan, qui s'arrête aussi tout seul si tu bouges la souris.
- **Avec l'IA :** chaque question posée pendant une partie de Diablo IV reçoit ton build, ton équipement lu dans le jeu, le dernier objet survolé et le résultat du scan. Par exemple « je fais quoi en priorité ? » ou « je garde celui-là ? ».

**Prérequis dans le jeu :**
- Options → Accessibilité : « Lecteur d'écran » et « Lecteur d'écran tiers » activés ;
- Options → Jeu : « Informations d'infobulle avancées » activé ;
- la DLL installée avec l'outil de D4LF ;
- D4LF fermé, car les deux utilisent le même canal.

**Limites :**
- **Affixes supérieurs et trempes :** le texte du lecteur d'écran ne les distingue pas. Le ★ indique ce que le build *veut* en supérieur.
- **Risque :** survoler automatiquement est une automatisation de la souris, comme dans D4LF. L'usage est toléré en pratique, mais le risque vis-à-vis des conditions de Blizzard n'est pas nul.

### Voix des mascottes

| Mascotte | Voix Piper (français) |
|---|---|
| KIN | Siwis — féminine, chaleureuse |
| AXIOM | Tom — masculine, posée |
| RAZOR | UPMC Pierre — masculine, rapide |
| GREMLIN | Siwis, 3 demi-tons plus haut — espiègle |
| ZENITH | UPMC Jessica — féminine, lente |

Chaque voix (60 à 80 Mo) est téléchargée à sa première utilisation, sauf Siwis, incluse dans l'installateur complet. Les réponses en anglais utilisent des voix anglaises. Pour les autres langues, la voix Windows prend le relais.

## Fonctionnement

1. **Alt+V** : enregistrement du micro, puis transcription locale par Whisper (~4 s avec small, ~1,5 s avec base)
2. **Capture** de la fenêtre choisie (l'overlay est exclu de la capture)
3. **Question + capture** envoyées au moteur choisi, avec recherche web pour les infos à jour (patchs, builds, méta)
4. **Réponse** affichée dans l'overlay et lue à voix haute

**Réponse rapide :**
- **Lecture en flux :** la voix commence dès la première phrase écrite, sans attendre la fin de la réponse. Piper met environ 350 ms à synthétiser une phrase.
- **Voie rapide :** les questions courtes et factuelles partent vers un modèle léger, sans recherche web :
  - Codex : le modèle que Codex présente comme rapide (`gpt-6-luna` aujourd'hui) ;
  - Claude Code : Haiku ;
  - clés API : Claude Haiku 5.5.

  Les analyses (build, stratégie, méta, patch, comparaison) gardent le moteur complet. Si la voie rapide échoue, la question repart aussitôt par le moteur complet.
- **Claude Code démarré à l'avance :** le process est lancé avant la première question, et relancé dès qu'une conversation expire.

Mesures sans capture (`npx electron scripts/latency-test.js`) : via Codex, premier mot en ~3 à 5 s en voie rapide, contre ~10 s avec le moteur complet.

- La conversation garde le fil pendant 5 minutes d'inactivité.
- Avec les clés API, seule la question en cours porte une image.
- Les captures ne sont jamais enregistrées, sauf la dernière, gardée temporairement pour Codex dans le dossier de l'app.

### Personnalités
KIN (complice), AXIOM (analytique), RAZOR (brutal), GREMLIN (moqueur), ZENITH (serein). Le ton change, pas les faits.

## Abonnements : ce qui est autorisé

- **ChatGPT** : OpenAI permet d'utiliser l'abonnement via Codex dans des outils externes. C'est le même mécanisme qu'OpenClaw.
- **Claude** : depuis mai 2026, Anthropic autorise `claude -p` et l'Agent SDK dans **tes propres projets** avec ton abonnement. L'usage est décompté d'une réserve de crédits « Agent SDK » mensuelle, séparée de tes limites habituelles. Il est interdit de distribuer un produit qui utilise l'abonnement Claude d'autres personnes : chaque utilisateur doit utiliser son propre Claude Code.

## Limites

- **Plein écran exclusif** : l'overlay ne s'affiche pas par-dessus. Passe le jeu en « fenêtré sans bordure ».
- **Capture noire** : certains jeux (anti-cheat, DirectX exclusif) en renvoient une. Choisis alors « Écran entier ».
- **Lenteur** : Codex et Claude Code sont des agents complets, donc plus lents qu'un appel API direct.

## Mises à jour automatiques

L'app installée vérifie les nouvelles versions publiées sur GitHub (au démarrage, puis toutes les 6 h). Elle les télécharge en arrière-plan et les installe à la fermeture. L'icône de notification propose aussi « Redémarrer pour installer ».

Pour l'activer :
1. Crée le dépôt GitHub.
2. Renseigne `updates.owner` (et `updates.repo`) dans `package.json`.
3. Publie une version avec `GH_TOKEN=<jeton> npm run release`.

Les mises à jour utilisent l'installateur léger : les modèles inclus dans la version complète sont alors retéléchargés au besoin.

## Développement

Variables d'environnement utiles :
- `GITGUD_DATA=dossier` : utilise un profil séparé (pratique pour rejouer le premier lancement)
- `GITGUD_SNAPSHOT=dossier` : capture chaque étape de l'assistant en PNG

```bash
npm run smoke -- --image=capture.jpg question.wav
```
Ce test de bout en bout couvre la capture, Codex, Claude Code et Whisper.

```bash
npm run dist
```
Cette commande construit l'installateur léger dans `dist/`, et `npm run dist:full` construit la version complète.

Structure :
- `main.js` : overlay, raccourcis globaux, capture, orchestration
- `src/providers/` : `claude-cli.js`, `codex-cli.js`, `api.js` (clés API)
- `src/setup/` : détection des outils installés, IPC de l'assistant ; `src/wizard.*` : interface de l'assistant
- `src/stt/` : Whisper local (transformers.js + ONNX Runtime, dans un thread séparé)
- `src/personalities.js` : prompts système et personnalités

## Licences

- **Code de GitGud :** MIT.
- **Synthèse vocale :** elle embarque [espeak-ng](https://github.com/espeak-ng/espeak-ng) (GPL-3.0) pour la phonétisation. Les installateurs, qui contiennent ce composant, sont donc distribués selon les termes de la GPL-3.0. Le code source complet est ce dépôt.
- **Voix Piper :** elles ont leurs propres licences (voir les fiches sur [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices)).
- **Modèles Whisper :** MIT.
