# Render Live Translation WebSocket

The Next.js app can run on Vercel, but live translation uses a separate WebSocket
bridge. Deploy `server/transcribe-live-server.js` to Render using `render.yaml`.

## Render

Create a Blueprint from this repository and branch, then set:

```bash
API_KEY=<sarvam_api_key>
```

Render supplies `PORT` automatically. The service exposes:

```text
GET /healthz
```

After deploy, copy the service URL and convert it to `wss://`, for example:

```bash
wss://ecompounder-live-translation-ws.onrender.com
```

## Vercel

Set this environment variable on the Vercel frontend:

```bash
NEXT_PUBLIC_LIVE_WS_URL=wss://ecompounder-live-translation-ws.onrender.com
```

Local development still falls back to:

```bash
ws://localhost:3001
```
