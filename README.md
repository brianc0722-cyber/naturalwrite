# NaturalWrite

Write like you — not like a model. Upload writing samples, NaturalWrite learns your
voice (sentence rhythm, formality, contractions, vocabulary, signature phrases), then
rewrites any draft in your style.

## Features

- Upload writing samples (.txt / .md) or paste text
- Automatic style-profile analysis (sentence length, formality, contractions, tone notes, signature phrases)
- Rewrite any draft in your learned voice — no character limit
- Sample library with view/delete
- PWA: installable to home screen / taskbar with app icon

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- PostgreSQL + Drizzle ORM
- Tailwind CSS 4

## Run locally

```bash
npm install
cp .env.example .env   # set DATABASE_URL
npx drizzle-kit push   # create tables
npm run dev            # http://localhost:3000
```

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
