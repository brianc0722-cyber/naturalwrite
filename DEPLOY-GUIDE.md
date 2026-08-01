# NaturalWrite — Complete Step-by-Step Guide
### (Written for a complete beginner. Follow in order. Each step tells you exactly what to click or type.)

---

## What you need (all free)

| Account | Where | Why |
| --- | --- | --- |
| GitHub | https://github.com/signup | Stores your code online |
| Neon | https://neon.tech | Gives you a free database |
| Vercel | https://vercel.com/signup | Hosts your app with a permanent URL |

**Total time: about 30 minutes.** You can stop after any step and resume later —
everything saves automatically.

---

## PART 1 — Get the code files

**If you already pushed to GitHub (you said "done" earlier), skip to Part 2.**

Otherwise, download the project archive from the sandbox:

1. In the sandbox file panel, look for: `/tmp/NaturalWrite-Project.tar.gz` (or
   `/tmp/naturalwrite-project.zip`)
2. Download it to your computer (Downloads folder is fine)
3. Unzip/unpack it:
   - **Windows:** right-click → "Extract All"
   - **Mac:** double-click it
   - You'll get a folder called `naturalwrite-deploy`

**What's inside:** the complete NaturalWrite app (all code, icons, config).

---

## PART 2 — Put the code on GitHub

### Step 2.1 — Create your GitHub account
1. Go to https://github.com/signup
2. Enter your email, create a password, pick a username
3. Verify your email (they send you a code)

### Step 2.2 — Create a new repository (a "repo" = a code folder online)
1. Click the **+** icon in the top-right corner of GitHub
2. Click **New repository**
3. Repository name: type `naturalwrite`
4. Choose **Private** (or Public — your choice)
5. **IMPORTANT:** Do NOT check "Add a README file" (we already have one)
6. Click the green **Create repository** button

### Step 2.3 — Create a Personal Access Token (this is your "password" for pushing code)
1. Click your profile photo (top-right) → **Settings**
2. Scroll down the left sidebar → **Developer settings**
3. Click **Personal access tokens** → **Tokens (classic)**
4. Click **Generate new token (classic)**
5. In "Note" type: `naturalwrite`
6. Set "Expiration" to 90 days (or No expiration)
7. Tick the checkbox **repo** (this gives permission to push code)
8. Scroll to bottom → **Generate token**
9. **COPY THE TOKEN NOW** (starts with `ghp_...`). You won't see it again!
   Save it somewhere safe, like a note on your phone.

### Step 2.4 — Push the code
Open a terminal (command prompt) on your computer:

- **Windows:** press Start, type `cmd`, press Enter
- **Mac:** press Cmd+Space, type `Terminal`, press Enter

Then type these commands one at a time, pressing Enter after each.
Replace `YOUR_USERNAME` with your GitHub username:

```bash
cd Downloads/naturalwrite-deploy
git init
git add -A
git commit -m "NaturalWrite app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/naturalwrite.git
git push -u origin main
```

- When it asks for **Username**: type your GitHub username
- When it asks for **Password**: paste your token (`ghp_...`) — it won't show
  characters as you paste, that's normal

**Success looks like:** a message ending with `main -> main` and no errors.

> **Already have the code elsewhere?** If you created the repo from the sandbox,
> you can also just download the zip from GitHub afterwards. The steps above are
> the standard path.

---

## PART 3 — Create a free database (Neon)

1. Go to https://neon.tech and click **Sign up** (use your GitHub account — fastest)
2. After login you'll land on a dashboard → click **Create a project**
3. Name it: `naturalwrite` — pick any region — click **Create project**
4. You'll see a **connection string** that looks like:
   ```
   postgresql://user:password@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require
   ```
5. Click **Copy** (this is your `DATABASE_URL` — the secret key to your database)
6. Save it in the same safe place as your GitHub token

> ⚠️ This connection string is a secret. Anyone who has it can read your data.
> Don't share it or post it online.

---

## PART 4 — Deploy to Vercel (this makes your permanent URL)

### Step 4.1 — Sign in
1. Go to https://vercel.com and click **Sign Up**
2. Choose **Continue with GitHub** → authorize Vercel (green button, "Allow")

### Step 4.2 — Import your project
1. On the Vercel dashboard, click **Add New...** → **Project**
2. Find `naturalwrite` in the list (imported from GitHub) → click **Import**
3. Leave all the default settings as they are (Vercel auto-detects Next.js)
4. Scroll down — click the **Environment Variables** section

### Step 4.3 — Add the database secret
1. In "Key" type exactly: `DATABASE_URL`
2. In "Value" paste the Neon connection string you copied in Part 3
3. Click **Add**
4. Click the big **Deploy** button (blue)

### Step 4.4 — Wait for the magic
1. You'll see a progress log: "Building" → "Ready" (about 1 minute)
2. When done, Vercel shows: **Congratulations!**
3. Your permanent URL is displayed — it looks like:
   ```
   https://naturalwrite-xxxx.vercel.app
   ```
4. **BOOKMARK THIS URL. Write it down. This one NEVER changes.**

---

## PART 5 — Use it (and install the app icon)

1. Open your permanent Vercel URL
2. Click the green **Install NaturalWrite** button in the top-right corner
3. Your browser installs it — the icon appears on your taskbar/home screen
4. Open it anytime — it works forever, like a real app

**Daily use:**
- **Upload samples:** drag a `.txt` or `.md` file onto the dashed box (or click it)
- **Paste samples:** type/paste text in the "or paste text" area → Save
- **Rewrite:** paste a draft in the right box → **Rewrite with my style**

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Sandbox not found" | That's the temporary sandbox URL expiring. Use your **Vercel** URL instead. |
| Vercel build fails | Most likely the `DATABASE_URL` env var is missing or wrong. Go to Vercel → Project → Settings → Environment Variables → check `DATABASE_URL`. |
| App loads but shows errors | In Neon, check the database isn't paused (Neon free tier pauses after inactivity — just open Neon and it wakes up). |
| Can't push to GitHub | Token expired → generate a new one (Part 2.3). |
| Forgot the token | Generate a new one. Old one is gone forever. |
| URL doesn't load | Vercel apps go to sleep? No — Vercel is always on. If it fails, check https://status.vercel.com |

---

## Useful links (bookmark all of these)

- GitHub: https://github.com
- Neon: https://neon.tech
- Vercel: https://vercel.com
- Vercel project dashboard: https://vercel.com/dashboard

---

*Made with NaturalWrite. You've got this.* 🚀
