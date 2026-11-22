# basic_springai_agent

Monorepo d'un agent conversationnel en streaming :

- `backend/` — Spring Boot 4.2 + Spring AI 2.1 (`ChatClient`), modèle Claude via l'API Anthropic
- `frontend/` — Angular 22, UI de chat avec le menu des conversations à gauche

## Fonctionnalités

- **Streaming** de la réponse en Server-Sent Events.
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
- Une clé API Anthropic

## Lancer en local

Backend (port 8080) :

```bash
cd backend
export ANTHROPIC_API_KEY=sk-ant-...
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
| `spring.ai.anthropic.api-key` | Clé API, lue depuis `ANTHROPIC_API_KEY` |
| `spring.ai.anthropic.chat.model` | Modèle Claude (`claude-opus-5-5` par défaut) |
| `spring.ai.anthropic.chat.max-tokens` | Plafond de tokens de sortie par réponse |
| `spring.datasource.url` | Base des sessions (H2 fichier ; PostgreSQL, MySQL et SQL Server sont aussi supportés par Spring AI Session) |
| `agent.system-prompt` | Prompt système de l'agent |
| `agent.user` | Propriétaire des conversations (pas d'authentification pour l'instant) |
| `agent.compaction.trigger-tokens` | Taille estimée de la conversation qui déclenche une compaction |
| `agent.compaction.keep-tokens` | Part récente de la conversation gardée telle quelle après compaction |

## Comment ça marche

Un tour de conversation (`ChatService`) passe par ces advisors du `ChatClient` :

1. `SessionTurnAdvisor` + `SessionMemoryAdvisor` (Spring AI Session) : ajoutent
   l'historique de la session au prompt et enregistrent les nouveaux messages, y compris
   à chaque aller-retour d'outil.
2. `InterruptAdvisor` (spring-ai-agent-utils) : vérifié avant chaque appel au modèle de
   la boucle d'outils, il refuse l'appel suivant quand un arrêt a été demandé.

Un arrêt (`POST /api/sessions/{id}/interrupt`) coupe aussi le flux en cours, ce qui ferme
l'appel au modèle, puis la partie déjà affichée de la réponse est enregistrée.

Une fois la réponse envoyée, la session est compactée si nécessaire (`SessionCompactor`).
Le message suivant de la même session attend la fin de cette compaction : l'historique ne
change donc jamais pendant qu'un tour l'utilise.

## API

| Requête | Rôle |
| --- | --- |
| `POST /api/chat/stream` | Envoie `{"sessionId": "...", "message": "..."}` et répond en SSE ; sans `sessionId`, crée une conversation |
| `GET /api/sessions` | Conversations, la plus récente d'abord |
| `GET /api/sessions/{id}/messages` | Messages d'une conversation |
| `POST /api/sessions/{id}/interrupt` | Arrête la réponse en cours |
| `DELETE /api/sessions/{id}` | Supprime une conversation |

Événements du flux, dans l'ordre :

```
event:session
data:{"id":"...","title":"...","createdAt":"..."}     (seulement pour une nouvelle conversation)

data:{"text":"Bon"}
data:{"text":"jour"}

event:done
data:{"interrupted":false}
```

Un échec en cours de réponse arrive sous la forme d'un `event:error` avec
`{"message": "..."}` à la place de `done`.

## Tests

```bash
cd backend && ./mvnw test
cd frontend && npm test -- --watch=false
```

Les tests d'intégration du backend tournent sur une base en mémoire avec un modèle
scripté : aucune clé API n'est nécessaire.
