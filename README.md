# basic_springai_agent

Monorepo d'un agent conversationnel en streaming :

- `backend/` — Spring Boot 4.2 + Spring AI 2.1 (`ChatClient`), modèles OpenAI via l'API Responses
- `frontend/` — Angular 22, UI de chat avec le menu des conversations à gauche

## Fonctionnalités

- **Réponses en arrière-plan** : envoyer un message démarre un *run* côté serveur et
  rend la main aussitôt ; la réponse se lit sur un flux Server-Sent Events à part, qu'on
  peut couper et reprendre là où on en était (`Last-Event-ID`). Aucune requête ne reste
  ouverte le temps que le modèle travaille, et une réponse continue même si on recharge
  la page ou qu'on change de conversation.
- **Choix du modèle et du raisonnement** : chaque message part avec le modèle choisi dans
  le menu du champ de saisie (GPT-6.2 Sol, GPT-6.1 Terra ou GPT-6 Luna) et le niveau de raisonnement pris
  dans son sous-menu. Les
  choix proposés viennent de la configuration du backend.
- **Sessions** (Spring AI Session) : chaque conversation est une session dont l'historique
  est stocké dans une base H2 locale et renvoyé au modèle à chaque tour. Les conversations
  précédentes se rouvrent depuis le menu de gauche, et survivent à un redémarrage.
- **Compaction récursive** : au-delà d'un seuil de tokens, les tours les plus anciens sont
  remplacés par un résumé écrit par le modèle, chaque nouveau résumé s'appuyant sur le
  précédent. Rien n'est supprimé du journal : l'UI affiche toujours tout.
- **`conversation_search`** : outil donné au modèle pour retrouver, par mots-clés, un
  message que la compaction a sorti de son contexte.
- **Interruption** : le bouton « Arrêter » coupe la réponse côté serveur ; ce qui a déjà
  été affiché est conservé dans l'historique, marqué comme interrompu.
- **Recherche web** (optionnelle, [Linkup](https://docs.linkup.so)) : avec une clé
  `LINKUP_API_KEY`, le modèle peut chercher sur le web, lire une page et lancer une
  recherche approfondie. Voir « Outils web ».
- **Réponses en interface** ([OpenUI](https://github.com/thesysdev/openui), partie open
  source uniquement) : le modèle écrit ses réponses en OpenUI Lang et le chat les dessine
  au fil du streaming : tableaux, graphiques, cartes, liens et sources citées, formulaires,
  suggestions de suite. Voir « Interface générée ».

## Prérequis

- Java 21+
- Node.js 22+
- Une clé API OpenAI
- Facultatif : une clé API Linkup (https://app.linkup.so) pour la recherche web

## Lancer en local

Backend (port 8080) :

```bash
cd backend
export OPENAI_API_KEY=sk-...
export LINKUP_API_KEY=...   # facultatif : active les outils web
./mvnw spring-boot:run
```

Sous PowerShell : `$env:OPENAI_API_KEY = "sk-..."`, `$env:LINKUP_API_KEY = "..."`, puis
`.\mvnw.cmd spring-boot:run`.

Sans `LINKUP_API_KEY`, l'application démarre normalement et les outils web ne sont
simplement pas proposés au modèle. Le log de démarrage dit lequel des deux cas s'applique
(`Web tools are on` / `Web tools are off`). La clé n'est jamais écrite dans les logs.

Frontend (port 4200, `/api` est proxifié vers le backend) :

```bash
cd frontend
npm install
npm start
```

Puis ouvrir http://localhost:4200.

Les conversations sont enregistrées dans `backend/data/` (fichier H2, ignoré par git).
Supprimer ce dossier remet tout à zéro.

## Configuration

Tout est dans `backend/src/main/resources/application.yaml` :

| Propriété | Rôle |
| --- | --- |
| `spring.ai.openai.api-key` | Clé API, lue depuis `OPENAI_API_KEY` |
| `spring.ai.openai.chat.api` | `responses` : l'API Responses d'OpenAI plutôt que Chat Completions |
| `spring.ai.openai.responses.model` | Modèle utilisé quand aucun n'est choisi par message : les résumés de compaction |
| `agent.models` | Modèles proposés dans l'UI (`id` envoyé à OpenAI, `label` affiché) ; le premier est le modèle par défaut |
| `agent.reasoning.efforts` | Niveaux de raisonnement proposés, du plus léger au plus lourd (`reasoning.effort`) |
| `agent.reasoning.default-effort` | Niveau utilisé par défaut |
| `spring.ai.openai.decision.model` | Modèle du `DecisionModel` fourni par le starter (API Decisions d'OpenAI) |
| `server.address` | Interface d'écoute : `127.0.0.1`, voir « Sécurité » |
| `spring.datasource.url` | Base des sessions (H2 fichier ; PostgreSQL, MySQL et SQL Server sont aussi supportés par Spring AI Session) |
| `agent.system-prompt` | Prompt système de l'agent |
| `agent.user` | Propriétaire des conversations (pas d'authentification pour l'instant) |
| `agent.stream-heartbeat` | Intervalle des lignes de keep-alive sur le flux quand le modèle est silencieux (à garder sous le délai d'inactivité des proxys) |
| `agent.compaction.trigger-tokens` | Taille estimée de la conversation qui déclenche une compaction |
| `agent.compaction.keep-tokens` | Part récente de la conversation gardée telle quelle après compaction |
| `agent.linkup.api-key` | Clé API Linkup, lue depuis `LINKUP_API_KEY` ; vide = pas d'outils web |
| `agent.linkup.base-url` | Racine de l'API Linkup (`https://api.linkup.so/v1`) |
| `agent.linkup.connect-timeout`, `agent.linkup.timeout` | Délais de connexion et de réponse d'un appel à Linkup (une recherche `deep` prend jusqu'à 30 s) |
| `agent.linkup.max-result-chars` | Taille maximale du texte qu'un résultat d'outil renvoie au modèle : une page lue est coupée là (le modèle peut lire la suite), les extraits d'une recherche se la partagent |
| `agent.linkup.instructions` | Paragraphe ajouté au prompt système quand les outils web sont actifs |
| `agent.linkup.research.enabled` | `false` pour ne pas donner au modèle les outils de recherche approfondie (payants à la tâche) |
| `agent.linkup.research.poll-interval`, `agent.linkup.research.max-wait` | Pendant que le modèle attend une recherche approfondie : fréquence des vérifications, et attente maximale d'un appel d'outil |
| `agent.openui.enabled` | `true` : le modèle écrit ses réponses en OpenUI Lang, que le frontend dessine ; `false` : réponses en texte brut |
| `agent.openui.prompt` | Le prompt qui enseigne au modèle le langage et le catalogue, généré depuis le frontend (`npm run openui:prompt`) |

## Interface générée

Le modèle ne répond pas en Markdown mais en **OpenUI Lang**, un petit langage d'appels de
composants (`root = Response([t, tbl])`, `tbl = Table([...], [...])`). Le chat l'analyse
à chaque fragment reçu et dessine ce qui est déjà là. Seule la partie open source
d'OpenUI est utilisée : pas de gateway, pas de clé Thesys, le modèle reste celui que
l'agent appelle déjà.

- **Le catalogue** (`frontend/src/app/openui/catalogue.ts`) décrit chaque composant : son
  nom, l'ordre et le type de ses arguments. C'est le contrat entre les deux côtés.
- **Côté frontend**, `library.ts` associe chaque nom à un composant Angular
  (`frontend/src/app/openui/components/`), dessiné par `@openuidev/angular-lang` avec les
  variables de `styles/tokens.css` : les deux thèmes suivent sans rien de plus.
- **Côté backend**, `npm run openui:prompt` (dans `frontend/`) transforme le même catalogue
  en prompt, écrit dans `backend/src/main/resources/openui/system-prompt.txt` et ajouté
  au prompt système. Le fichier est versionné ; `npm test` échoue s'il n'est plus à jour.
- Le reste ne change pas : une réponse est toujours du texte, porté par les mêmes
  événements du run, stocké tel quel dans la session.

| Famille | Composants |
| --- | --- |
| Texte | `Heading`, `TextContent` (gras, italique, code, liens, citations `[1]`), `Callout`, `Quote`, `CodeBlock`, `Separator` |
| Liens et médias | `LinkCards`, les `sources` de `Response`, `Image`, `ImageGallery` |
| Données | `Table`, `KeyValues`, `Metrics`, `Tags` |
| Graphiques | `BarChart`, `HorizontalBarChart`, `LineChart`, `AreaChart`, `PieChart` |
| Carte | `Map` et ses `Marker` (Leaflet, fonds OpenStreetMap) |
| Listes | `List`, `Steps`, `Timeline` |
| Cartes et actions | `Cards`, `Buttons`, `Button` (quatre variantes, trois tailles, un son), `FollowUps` |
| Mise en page | `Stack`, `Grid`, `Panel`, `Tabs`, `Accordion` : les conteneurs s'emboîtent |
| Formulaires et champs | `Form`, `Input`, `TextArea`, `Select`, `RadioGroup`, `CheckBoxGroup`, `Slider`, `DatePicker`, `Switch`, `Chips` |
| Mini-applications | `Display`, `Progress`, `Timer`, `Checklist` |
| Compositions | `Hero` (bandeau), `Columns` (colonnes de largeurs inégales), `Wizard` (parcours en étapes), `Carousel`, et le ton d'un `Panel` (cadre, papier, bois, orange) |
| HTML libre | `HtmlView` : une page écrite par le modèle, dans un cadre isolé, affichable en plein écran |

### HTML libre

`HtmlView` affiche une page HTML que le modèle a écrite : une maquette, une affiche, un
petit jeu. Ce HTML ne vient pas de nous, il est donc traité comme celui d'un inconnu.

- **Isolé de l'app** : la page vit dans une `<iframe sandbox="allow-scripts">`, donc dans
  une origine à elle. Ses scripts tournent, mais ne peuvent ni lire la page de l'app, ses
  cookies ou son stockage, ni appeler son API, ni ouvrir une fenêtre, ni envoyer un
  formulaire, ni faire naviguer l'app.
- **Sans réseau** : une politique de sécurité (CSP) est écrite en tête du document, avant
  tout ce que le modèle a écrit. Aucune requête ne sort : pas de `fetch`, pas de script,
  de feuille de style, de police ni d'image par URL. Tout doit être en ligne dans la page.
- **Pas pendant l'écriture** : la page n'est dessinée qu'une fois la réponse complète.
- **Une limite** : un cadre peut se faire naviguer lui-même vers une autre adresse, ce que
  ni le bac à sable ni la CSP n'interdisent. C'est détecté et la page est remise, mais
  une requête est partie entre-temps, avec ce que la page contenait seulement.
- **Plein écran** : le bouton demande le plein écran du navigateur ; s'il est refusé, la
  vue couvre la fenêtre. Échap ou le bouton en sortent, sans recharger la page.

### Mini-applications

Une interface générée peut vivre dans le navigateur, sans repasser par le modèle : une
calculatrice, un convertisseur, un minuteur, un tableau de suivi.

- **État** : le modèle déclare des variables (`$total = 0`), qui tiennent un nombre, un
  texte ou un booléen. Elles sont remises à zéro au rechargement de la page.
- **Actions** : un bouton les modifie avec `Action([@Set($n, $n + 1)])` ou `@Reset(...)`.
  Rien n'est envoyé au backend ; ces boutons restent actifs pendant qu'une réponse arrive.
- **Champs reliés** : un champ reçoit une variable en dernier argument
  (`Input("km", "0", "number", null, $km)`) : ce qu'on tape devient la variable.
- **Expressions** : arithmétique, comparaisons, `? :`, `@Round`, `@Sum`, `@Each`… recalculées
  à chaque changement. Un bloc s'affiche sous condition : `$n > 1 ? detail : null`.
- **Ce que le langage ne sait pas exprimer** est porté par un composant : le temps qui
  passe par `Timer`, une liste qui grandit par `Checklist`, un son par `Button`.

La page http://localhost:4200/catalogue les montre tous, chacun à partir du programme
qu'écrirait le modèle, sans appeler le backend.

Pour ajouter un composant : le définir dans `catalogue.ts`, écrire son composant Angular,
l'enregistrer dans `library.ts`, ajouter un exemple à `samples.ts`, puis
`npm run openui:prompt`. Les arguments sont positionnels : n'en ajouter qu'à la fin, sinon
les conversations déjà stockées ne se dessinent plus.

À savoir :

- Un clic sur un bouton, une suggestion ou l'envoi d'un formulaire part comme le message
  suivant de l'utilisateur ; les valeurs du formulaire l'accompagnent.
- Ce que le modèle écrit de travers est retiré, le reste s'affiche. Rien ne corrige la
  sortie du modèle : cette correction passe par les services hébergés d'OpenUI.
- Les réponses écrites avant cette fonctionnalité, ou avec `agent.openui.enabled: false`,
  sont du texte brut et s'affichent comme tel.
- Les liens et les images ne sont suivis qu'en `http(s)`. Une carte charge ses tuiles
  depuis les serveurs d'OpenStreetMap, une image depuis l'adresse donnée par le modèle.
- `@openuidev/lang-core` envoie une télémétrie d'installation à son éditeur lors de
  `npm install` ; `OPENUI_TELEMETRY_DISABLED=1` (ou `DO_NOT_TRACK=1`) la coupe. Rien n'est
  envoyé à l'exécution.

## Outils web

Avec une clé Linkup, le modèle reçoit ces outils en plus de `conversation_search`. Leurs
paramètres portent les noms de l'API Linkup ; les descriptions envoyées au modèle lui
disent quand choisir chaque option.

| Outil | Rôle | Paramètres |
| --- | --- | --- |
| `linkup_search` | Recherche web (`POST /search`) | `query`, `depth` (`flash`, `fast`, `standard`, `deep`), `outputType` (`searchResults`, `sourcedAnswer`, `structured`), `structuredOutputSchema`, `includeSources`, `includeInlineCitations`, `includeImages`, `fromDate`, `toDate`, `sinceDays`, `includeDomains`, `excludeDomains`, `maxResults` |
| `linkup_fetch` | Lit une page ou un PDF dont on connaît l'URL (`POST /fetch`) | `url`, `renderJs`, `mode` (`standard`, `pro`), `extractImages`, `includeRawContent`, `schema`, `instructions`, `offset` |
| `linkup_research_start` | Lance une recherche approfondie, asynchrone (`POST /research`) : 2 à 20 minutes, 0,25 à 2,50 USD la tâche | `query`, `reasoningDepth` (`S`, `M`, `L`, `XL`), `mode` (`answer`, `investigate`, `research`), `outputType` (`sourcedAnswer`, `structured`), `structuredOutputSchema`, `fromDate`, `toDate`, `includeDomains`, `excludeDomains` |
| `linkup_research_result` | État ou résultat d'une recherche approfondie (`GET /research/{id}`) | `id`, `waitSeconds` |
| `linkup_credit_balance` | Crédits restants du compte (`GET /credits/balance`) | aucun |

`sinceDays` (les N derniers jours, converti en `fromDate`) et `offset` (lire la suite
d'une page coupée) n'existent pas dans l'API : ils sont ajoutés par le backend. Chaque
résultat de recherche porte la date du jour, que le modèle ne connaît pas autrement.

Une erreur de l'API (clé refusée, crédits épuisés, limite de débit, délai dépassé, page
illisible) ne fait pas échouer le run : elle revient au modèle comme résultat d'outil,
avec ce qu'il convient de faire (corriger, réessayer, prévenir l'utilisateur).

L'interface n'affiche pas encore les appels d'outil : pendant une recherche, le flux du
run ne porte que les lignes de keep-alive.

## Sécurité

L'API n'a pas encore d'authentification : n'importe qui pouvant la joindre peut lire et
supprimer les conversations, et faire appeler le modèle avec la clé configurée. Le
backend n'écoute donc que sur `127.0.0.1` (`server.address`). Ne retirer ce réglage
qu'une fois l'accès protégé (clé d'API ou login).

## Comment ça marche

### Un message = un run

1. `POST /api/runs` enregistre le message, démarre un worker en arrière-plan et répond
   `202` avec l'identifiant du run.
2. Le worker appelle le modèle et écrit chaque morceau de réponse dans le journal du run
   (`RunStore`), numéroté 1, 2, 3…
3. `GET /api/runs/{id}/events` rejoue le journal puis suit le direct, pour un
   `EventSource`. Chaque événement porte son numéro en `id` : quand la connexion tombe,
   le navigateur se reconnecte tout seul avec l'en-tête `Last-Event-ID` et le serveur
   reprend juste après, sans perte ni doublon.

Le journal des runs est en mémoire pour l'instant (`InMemoryRunStore`) : un run terminé
reste lisible 10 minutes, puis la réponse se relit dans la session, où elle est stockée.
`RunStore` est l'interface à réimplémenter pour passer à PostgreSQL (tables `run` et
`run_event`, plus LISTEN/NOTIFY ou du polling pour le direct). Le signal d'arrêt
(`ActiveTurns`) est lui aussi local au processus.

### Un tour de conversation

Le worker (`ChatService`) passe par ces advisors du `ChatClient` :

1. `SessionTurnAdvisor` + `SessionMemoryAdvisor` (Spring AI Session) : ajoutent
   l'historique de la session au prompt et enregistrent les nouveaux messages, y compris
   à chaque aller-retour d'outil.
2. `InterruptAdvisor` (spring-ai-agent-utils) : vérifié avant chaque appel au modèle de
   la boucle d'outils, il refuse l'appel suivant quand un arrêt a été demandé.

Un arrêt (`POST /api/sessions/{id}/interrupt`) coupe aussi le flux du modèle, ce qui
ferme l'appel, puis la partie déjà produite de la réponse est enregistrée. Fermer la
page n'arrête pas un run : seul cet appel le fait. Un tour arrêté alors qu'il attend
encore la compaction du précédent n'appelle pas le modèle, et son message reste dans
la conversation.

Une fois la réponse terminée, la session est compactée si nécessaire
(`SessionCompactor`). Le message suivant est accepté tout de suite, mais son tour attend
la fin de cette compaction : l'historique ne change donc jamais pendant qu'un tour
l'utilise.

## API

| Requête | Rôle |
| --- | --- |
| `GET /api/runs/options` | Modèles et niveaux de raisonnement proposés, avec les valeurs par défaut |
| `POST /api/runs` | Envoie `{"sessionId", "message", "model", "reasoningEffort"}` ; sans `sessionId`, crée une conversation ; `model` et `reasoningEffort` sont optionnels et doivent faire partie des choix proposés (sinon `400`). Répond `202` avec `{"runId", "session"}` |
| `GET /api/runs/{id}/events` | Flux SSE du run, reprenable avec `Last-Event-ID` |
| `GET /api/sessions` | Conversations, la plus récente d'abord |
| `GET /api/sessions/{id}` | Messages d'une conversation, et `activeRunId` si une réponse est en cours |
| `POST /api/sessions/{id}/interrupt` | Arrête la réponse en cours |
| `DELETE /api/sessions/{id}` | Supprime une conversation |

Événements du flux d'un run :

```
id:1
data:{"text":"Bon"}

id:2
data:{"text":"jour"}

id:3
event:done
data:{"interrupted":false}
```

Un run qui échoue se termine par un `event:failed` avec `{"message": "..."}` à la place
de `done`. Le flux se ferme après le dernier événement : le client doit alors fermer son
`EventSource`, sinon le navigateur se reconnecte.

## Tests

```bash
cd backend && ./mvnw test
cd frontend && npm test -- --watch=false
```

Les tests d'intégration du backend tournent sur une base en mémoire avec un modèle
scripté, et un serveur HTTP local à la place de l'API Linkup : aucune clé API n'est
nécessaire et aucun appel ne sort de la machine.
