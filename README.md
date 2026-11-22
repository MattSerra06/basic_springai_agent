# basic_springai_agent

Monorepo d'un agent conversationnel minimal, en streaming :

- `backend/` — Spring Boot 4.2 + Spring AI 2.1 (`ChatClient`), modèle Claude via l'API Anthropic
- `frontend/` — Angular 22, UI de chat qui affiche la réponse au fil de l'eau

Pas de mémoire pour l'instant : chaque message est un aller-retour indépendant.

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

## Configuration

Tout est dans `backend/src/main/resources/application.yaml` :

| Propriété | Rôle |
| --- | --- |
| `spring.ai.anthropic.api-key` | Clé API, lue depuis `ANTHROPIC_API_KEY` |
| `spring.ai.anthropic.chat.model` | Modèle Claude (`claude-opus-5-5` par défaut) |
| `spring.ai.anthropic.chat.max-tokens` | Plafond de tokens de sortie par réponse |
| `agent.system-prompt` | Prompt système de l'agent |

## API

`POST /api/chat/stream` avec `{"message": "..."}` répond en Server-Sent Events :

```
data: {"text":"Bon"}

data: {"text":"jour"}
```

Une erreur en cours de réponse arrive sous la forme d'un événement `event: error`
avec `{"message": "..."}`.

## Tests

```bash
cd backend && ./mvnw test
cd frontend && npm test -- --watch=false
```
