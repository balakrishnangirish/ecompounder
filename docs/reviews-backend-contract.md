# Reviews Backend Contract

The review UI calls local Next.js routes only. Backend implementations are selected server-side by `REVIEW_BACKEND_MODE`.

## Environment

```txt
REVIEW_BACKEND_MODE=fixture | aws
REVIEW_API_BASE_URL=https://example.execute-api.region.amazonaws.com/prod
REVIEW_API_KEY=optional-api-key-or-token
REVIEW_API_AUTH_HEADER=Authorization
```

When `REVIEW_API_AUTH_HEADER=Authorization`, the adapter sends `Bearer ${REVIEW_API_KEY}`. For any other header name, it sends the raw key as that header value.

## Local Frontend Routes

These routes are stable for the frontend:

```txt
GET  /api/reviews
GET  /api/reviews/:id
GET  /api/reviews/:id/audio
POST /api/reviews/:id/submit
```

## AWS API Routes

The AWS adapter expects the same backend paths under `REVIEW_API_BASE_URL`:

```txt
GET  /reviews
GET  /reviews/:id
GET  /reviews/:id/audio
POST /reviews/:id/submit
```

`GET /reviews/:id` may include `audioUrl`. If present, `/api/reviews/:id/audio` proxies that URL. If absent, it proxies `/reviews/:id/audio`.

## Response Shapes

`GET /reviews` returns `ReviewCaseSummary[]`.

`GET /reviews/:id` returns `ReviewCase`.

`POST /reviews/:id/submit` receives `SubmitReviewPayload` and returns:

```json
{
  "success": true,
  "id": "case-id",
  "receivedAt": "2026-08-12T10:30:00.000Z"
}
```

The canonical TypeScript contract lives in `lib/reviews/types.ts`.

