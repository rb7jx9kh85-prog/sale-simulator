# Alpinia Sales Simulator

MVP vocal pour entraîner Noé aux cold calls d'Alpinia Web Craft, avec un prospect suisse romand piloté par l'OpenAI Realtime API.

## Lancer le projet

```bash
npm install
cp .env.example .env.local
# Ajoute ta vraie clé dans .env.local
npm run dev
```

Ouvre ensuite [http://localhost:3000/sales-simulator](http://localhost:3000/sales-simulator).

## Variables d'environnement

```env
OPENAI_API_KEY=sk-proj-...
OPENAI_REALTIME_MODEL=gpt-realtime-2.1
OPENAI_FEEDBACK_MODEL=gpt-4.1-mini
```

`OPENAI_API_KEY` n'est utilisée que dans les route handlers serveur (`/api/realtime` et `/api/feedback`). Elle n'est jamais envoyée au navigateur. `OPENAI_REALTIME_MODEL` est configurable pour permettre d'utiliser un modèle compatible et économique disponible sur ton compte.

## Architecture minimale

- `src/app/sales-simulator/page.tsx` : page du simulateur.
- `src/components/SalesSimulatorClient.tsx` : micro, WebRTC, transcription et interface.
- `src/app/api/realtime/route.ts` : proxy serveur SDP vers OpenAI, avec la clé côté serveur.
- `src/app/api/feedback/route.ts` : feedback JSON structuré après l'appel.
- `src/lib/sales-simulator.ts` : scénarios, difficultés et prompts prospect.

## Checklist de test

- [ ] Ajouter les variables dans `.env.local`.
- [ ] Ouvrir `/sales-simulator` avec HTTPS en production (ou `localhost` en développement).
- [ ] Cliquer **Démarrer l'appel** et autoriser le micro.
- [ ] Vérifier que le statut passe à **En appel**.
- [ ] Dire une ouverture de cold call et vérifier que le prospect répond oralement.
- [ ] Vérifier que les deux voix s'ajoutent à la transcription.
- [ ] Cliquer **Terminer l'appel** et vérifier que le micro s'arrête.
- [ ] Vérifier que le feedback score /100 et la scorecard apparaissent.

## Notes OpenAI

Le flux implémente l'interface WebRTC unifiée actuelle : le navigateur crée une offre SDP, l'envoie à la route serveur, puis cette route appelle `POST /v1/realtime/calls` avec la clé standard. Consulte la [documentation Realtime WebRTC officielle](https://developers.openai.com/api/docs/guides/realtime-webrtc) avant de remplacer le modèle configuré.
