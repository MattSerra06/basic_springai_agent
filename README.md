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
  la liste (GPT-6.2 Sol ou Astra) et le niveau de raisonnement réglé au curseur. Les
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
| `agent.reasoning.efforts` | Niveaux de raisonnement du curseur, du plus léger au plus lourd (`reasoning.effort`) |
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
