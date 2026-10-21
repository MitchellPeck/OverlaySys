# NIV via API.Bible — design

Date: 2026-10-21
Status: approved in chat, awaiting spec review

## Goal

Operators can import scripture in the **NIV** using the church's own API.Bible
key, through the existing scripture import flow (including mid-verse slide
splitting), while complying with API.Bible's terms: usage reporting (FUMS),
refreshing stored text, and not modifying content.

Scope: NIV only, one key per install (not per customer). Other API.Bible
translations, a Bible picker, and per-customer keys are out of scope.

## Verified API facts (live calls with the user's key, 2026-10-21)

- Base URL `https://rest.api.bible/v1`, auth header `api-key: <key>`.
- `GET /bibles?abbreviation=NIV` → one Bible: id `78a9f6124f344018-01`,
  `abbreviation: "NIV11"`, `abbreviationLocal: "NIV"`, language `eng`.
  → Match on `abbreviationLocal === "NIV"` (fallback: `abbreviation` starts with `NIV`).
- `GET /bibles/{id}/passages/{JHN.3.16-JHN.3.21}?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false&fums-version=3`
  returns `{ data: { content, copyright, reference, ... }, meta: { fumsToken } }`.
  - `content` marks verses as `[16] text  [17] text`. Leading whitespace and
    newlines (poetry) occur.
  - Cross-chapter passages (`JHN.3.36-JHN.4.2`) restart numbering: `[36] … [1] … [2]`.
  - Psalms include a heading before the first marker even with titles off
    (`"Psalm 23\n [1] …"`) — text before the first marker is ignored.
  - `copyright`: "The Holy Bible, New International Version® NIV® Copyright ©
    1973, 1978, 1984, 2011 by Biblica, Inc.® Used by Permission of Biblica,
    Inc.® All rights reserved worldwide."
- FUMS (docs.api.bible/guides/fair-use): report a view with
  `GET https://fums.api.bible/f3?t=<fumsToken>&dId=<deviceId>&sId=<sessionId>`
  (repeat `t` for several tokens). `uId` only for logged-in users (not used).
- Terms: cached content must be refreshed at least every 30 days (a guide
  recommends ≤ 14); content may not be modified.

## Design

### 1. Key and setup

- Server module `server/src/apiBible/config.ts`:
  - Key source, in priority order: env `OVERLAYSYS_API_BIBLE_KEY`, else
    `<dataRoot>/settings/api-bible.json` (`{ "apiKey": "..." }`, written with
    mode `0600`).
  - On startup and whenever the key changes: call `GET /bibles?abbreviation=NIV`,
    pick the NIV, cache `{ bibleId }` in memory, register/unregister the NIV
    provider.
  - Status: `{ configured, source: "env" | "file" | null, state: "ok" | "no_key" | "rejected" | "no_niv" | "offline", bibleId? }`.
- Routes:
  - `GET /api/scripture/api-bible` → status (never returns the key).
  - `PUT /api/scripture/api-bible` `{ apiKey }` → validates, saves to file, returns status. 400 with the status if rejected (file not written).
  - `DELETE /api/scripture/api-bible` → deletes the file, unregisters NIV.
    When the key comes from env, PUT/DELETE return 409 ("set by environment").
- `ProviderRegistry` gains `unregister(provider)`.
- Operator Settings page gains an **API.Bible** panel: password-type key field,
  Save / Remove, status line ("NIV found ✓", "Key rejected", "Key works but no
  NIV", "Can't reach API.Bible", "Set by environment").
- Removing the key removes NIV from the translation list; existing NIV rows keep
  their stored text (and are no longer refreshed).

### 2. Provider — `packages/scripture/src/providers/apiBible.ts`

```ts
export interface ApiBibleOptions {
  apiKey: string;
  bibleId: string;
  translation: TranslationMeta;      // id "NIV", abbreviation "NIV", isPublicDomain false
  fetch?: typeof fetch;              // injectable for tests
  baseUrl?: string;                  // default https://rest.api.bible/v1
}
export class ApiBibleProvider implements ScriptureProvider { ... }
export function parseApiBibleText(content: string, book: string, startChapter: number): ScriptureVerse[];
export async function findNivBible(apiKey: string, fetchImpl?: typeof fetch): Promise<{ bibleId: string } | null>;
```

- One request per `RefRange` (passage id `BOOK.c.v-BOOK.c2.v2`), max 200 verses
  per request (API limit) — longer ranges are rejected with an out-of-range hint.
- `parseApiBibleText`: ignore text before the first `[n]`; each `[n]` starts a
  verse; when `n` ≤ previous `n`, chapter += 1; verse text = the text up to
  the next marker, with whitespace runs collapsed to one space and trimmed
  (display normalization, not content modification).
- `ScripturePassage` gains optional `usageTokens?: string[]` — one `meta.fumsToken`
  per request (a multi-range reference makes several requests).
- `attribution` = `data.copyright`.
- Errors (thrown as typed `ScriptureProviderError` with `code`):
  `offline` (fetch threw), `rejected` (401/403), `out_of_range` (404/400),
  `upstream` (other). The passage route maps them to 503 / 502 / 400 / 502
  with operator-facing hints ("Couldn't reach API.Bible", "API.Bible key
  rejected — check Settings").

### 3. Row data

`ScriptureRowSchema` (packages/core/src/show.ts) gains an optional field:

```ts
source: z.object({
  provider: z.literal("api.bible"),
  bibleId: z.string(),
  fetchedAt: z.string(),            // ISO timestamp
  usageTokens: z.array(z.string()).default([]),
}).optional(),
```

- The passage API response includes `source` for API.Bible translations; the
  operator copies it onto the row at save (`shows/edit/page.tsx` save path).
- Slides unchanged (mid-verse breaks work as for KJV/WEB). Stored text is
  exactly the provider's normalized output.

### 4. Background refresh — `server/src/apiBible/refresh.ts`

- Runs at server startup (after scripture init) and every 24 h.
- For each saved show, each scripture row with `source.provider === "api.bible"`
  and `fetchedAt` older than 14 days: re-fetch `row.reference` via the provider.
  - Same words (token sequence equal): update `fetchedAt` + `usageTokens` only.
  - Different words: rebuild slides with `breaksToSlides(newVerses, tokenize(newVerses), oldBreaks ∩ valid range)`
    where `oldBreaks` come from `slidesToBreaks(row.slides)`; update `source`; log
    `scripture row <id> in show <id>: NIV text changed on refresh`.
  - Fetch fails (offline / no key / rejected): leave the row untouched; retry next run.
- Writes through the existing show storage/save path and broadcasts the
  normal show-updated event so open operators see the change.
- A row is refreshed at most once per run; the job never runs concurrently.

### 5. Usage reporting (FUMS) — `server/src/apiBible/fums.ts`

- `reportViews(tokens: string[])` → `GET https://fums.api.bible/f3?t=..&t=..&dId=<deviceId>&sId=<sessionId>`.
  - `deviceId`: random UUID persisted at `<dataRoot>/settings/api-bible-device.json`.
  - `sessionId`: random UUID per server process.
  - Fire-and-forget; errors logged at debug and swallowed. Never delays a take.
- Reported when:
  - the passage route serves an API.Bible passage (operator sees it in the editor), and
  - a slide of an API.Bible row is taken: `ScriptureTakeStrip` sends
    `POST /api/scripture/usage { tokens }` after the take (fire-and-forget).

### 6. Testing

- `apiBible.test.ts` (scripture package, fake fetch with recorded fixtures from the
  live responses above): John 3:16-21 parse, cross-chapter 3:36–4:2, Psalm 23
  heading skipped, poetry newlines collapsed, 401 → `rejected`, fetch throws →
  `offline`, `findNivBible` matches `abbreviationLocal`, request URL/headers/params.
- `refresh.test.ts` (server, fake clock + fake provider + temp data dir): stale row
  refreshed; fresh row skipped; identical text keeps slides/ids; changed text
  re-maps breaks; failure leaves row untouched; non-API.Bible rows ignored.
- `fums.test.ts`: URL shape with repeated `t`, device id persisted across calls,
  network error swallowed.
- `config.test.ts`: env beats file, PUT rejected key doesn't write file, DELETE
  under env → 409, status never contains the key.
- Live e2e (`apiBible.e2e.test.ts`), skipped unless `OVERLAYSYS_API_BIBLE_KEY` is
  set: John 3:16 contains "For God so loved the world".
- Manual: Settings panel states; import John 3:16-21 NIV; split mid-verse; take
  a slide; server log shows the FUMS report.

## Dependencies

Builds on branch `feat/scripture-slide-splitting` (uses `slidesToBreaks`,
`breaksToSlides`, `tokenize` and mid-verse slides). Implement on a branch cut
from it, or after it merges.

## Non-goals

- Other API.Bible translations or a Bible picker.
- Per-customer keys or hosted key.
- Offline pre-caching of whole books (would violate storage/refresh terms).
