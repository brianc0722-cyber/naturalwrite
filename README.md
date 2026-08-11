# NaturalWrite

Write like you — not like a model. Upload writing samples, NaturalWrite learns your
voice (sentence rhythm, formality, contractions, vocabulary, signature phrases), then
rewrites any draft in your style.

## Features

- Upload writing samples (.txt / .md) or paste text
- Automatic style-profile analysis (sentence length, formality, contractions, tone notes, signature phrases)
- Rewrite any draft in your learned voice — no character limit
- AI Content Scanner: upload a document (.txt, .md, .docx, .pdf, .html, .rtf) or paste text and get a stylistic AI score with per-signal explanations, cross-checked against your own writing style
- Scan history with per-document verdicts
- Sample library with view/delete
- Database tables auto-create on first run, with real Drizzle migrations in `./drizzle`
- PWA manifest and icons included (see the install caveat in DEPLOY-GUIDE.md)

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- PostgreSQL + Drizzle ORM
- Tailwind CSS 4
- Vitest for unit tests

Requires **Node 22+** (`unpdf` and Next 16 both need it).

## Run locally

```bash
npm install
cp .env.example .env   # set DATABASE_URL
npm run db:migrate     # apply migrations from ./drizzle
npm run dev            # http://localhost:3000
```

Tables also auto-create on first request via `src/lib/bootstrap.ts`, so the
migrate step is optional locally. Set `SKIP_DB_BOOTSTRAP=1` in production if
migrations are applied as a deploy step.

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | Vitest unit tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |

## Optional: generative-AI second opinion

Set `OPENAI_API_KEY` to have each scan cross-checked by a language model.

> **Privacy:** with the key set, up to ~14 KB of the scanned text is sent to
> the configured endpoint. Leave it unset to keep every scan on your own
> infrastructure — the app falls back to local heuristics automatically.

`OPENAI_BASE_URL` and `OPENAI_MODEL` override the endpoint and model.

## API

| Route | Methods | Purpose |
|---|---|---|
| `/api/health` | GET | Liveness probe |
| `/api/samples` | GET, POST | List and add writing samples |
| `/api/samples/[id]` | DELETE | Remove a sample, rebuild the profile |
| `/api/style` | GET | Current style profile and summary |
| `/api/rewrite` | POST | Rewrite text in the learned voice |
| `/api/scan` | GET, POST | Scan a document; list recent scans |
| `/api/scan/[id]` | DELETE | Delete a scan from history |

Write routes are rate limited per client IP (see `src/lib/rate-limit.ts`).

> **Note:** the app currently has **no authentication** — every visitor shares
> one sample library, style profile, and scan history. Do not expose it
> publicly with data you would not want anyone to read or delete.

## About the AI score

The scanner measures *stylistic* markers associated with LLM output. It cannot
establish authorship: formal human writing (academic, legal, corporate) tends
to score high, and lightly edited AI tends to score low. Treat the number as a
prompt to look closer, never as evidence of misconduct.

## Deploy permanently (free, URL never changes)

### Option A — Vercel (recommended)

1. Push this repo to GitHub:
   ```bash
   git init && git add -A && git commit -m "NaturalWrite"
   git remote add origin https://github.com/YOUR_USERNAME/naturalwrite.git
   git branch -M main && git push -u origin main
   ```
2. Go to https://vercel.com → **Add New Project** → import your GitHub repo
3. Add environment variable in Vercel → Settings → Environment Variables:
   - `DATABASE_URL` = your PostgreSQL connection string
   - (free Postgres: https://neon.tech or https://supabase.com — create a database and copy the connection string)
4. Click **Deploy**. Vercel gives you `https://naturalwrite-xxxx.vercel.app` — **permanent**.

### Option B — Railway

1. Push to GitHub (steps above)
2. Go to https://railway.app → New Project → Deploy from GitHub repo
3. Add a PostgreSQL plugin (Railway hosts the DB for you)
4. Railway auto-sets `DATABASE_URL`; deploy and get a permanent URL

### Option C — Netlify

1. Push to GitHub
2. https://app.netlify.com → Add new site → Import from Git
3. Build command: `npm run build` — publish directory: `.next`
4. Set `DATABASE_URL` env var → Deploy

## Database schema

- `writing_samples` — uploaded/pasted samples
- `style_profiles` — analyzed style (JSONB metrics + summary)
- `rewrite_jobs` — history of rewrites

## API

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/samples` | GET/POST | List / add writing samples (file upload or JSON) |
| `/api/samples/[id]` | DELETE | Remove a sample |
| `/api/style` | GET/POST | Fetch / rebuild style profile |
| `/api/rewrite` | POST | Rewrite text in the learned style |
| `/api/health` | GET | Health check |
