# basic_springai_agent

Monorepo d'un agent conversationnel en streaming :

- `backend/` — Spring Boot 4.2 + Spring AI 2.1 (`ChatClient`), modèle OpenAI
- `frontend/` — Angular 22, UI de chat avec le menu des conversations à gauche

## Fonctionnalités

- **Réponses en arrière-plan** : envoyer un message démarre un *run* côté serveur et
  rend la main aussitôt ; la réponse se lit sur un flux Server-Sent Events à part, qu'on
  peut couper et reprendre là où on en était (`Last-Event-ID`). Aucune requête ne reste
  ouverte le temps que le modèle travaille, et une réponse continue même si on recharge
  la page ou qu'on change de conversation.
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

## Prérequis

- Java 21+
- Node.js 22+
- Une clé API OpenAI

## Lancer en local

Backend (port 8080) :

```bash
cd backend
export OPENAI_API_KEY=sk-...
./mvnw spring-boot:run
```

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
| `spring.ai.openai.chat.model` | Modèle de chat (`gpt-6.1-sol` par défaut) |
| `spring.ai.openai.decision.model` | Modèle du `DecisionModel` fourni par le starter (API Decisions d'OpenAI) |
| `server.address` | Interface d'écoute : `127.0.0.1`, voir « Sécurité » |
| `spring.datasource.url` | Base des sessions (H2 fichier ; PostgreSQL, MySQL et SQL Server sont aussi supportés par Spring AI Session) |
| `agent.system-prompt` | Prompt système de l'agent |
| `agent.user` | Propriétaire des conversations (pas d'authentification pour l'instant) |
| `agent.stream-heartbeat` | Intervalle des lignes de keep-alive sur le flux quand le modèle est silencieux (à garder sous le délai d'inactivité des proxys) |
| `agent.compaction.trigger-tokens` | Taille estimée de la conversation qui déclenche une compaction |
| `agent.compaction.keep-tokens` | Part récente de la conversation gardée telle quelle après compaction |

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
| `POST /api/runs` | Envoie `{"sessionId": "...", "message": "..."}` ; sans `sessionId`, crée une conversation. Répond `202` avec `{"runId", "session"}` |
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
scripté : aucune clé API n'est nécessaire.
