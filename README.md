# Naturalization Test (Einbürgerungstest and Leben in Deutschland) Trainer

A lightweight React + Vite web app to practice for the German naturalization exam (`Einbürgerungstest`) using a local question dataset. The app has been vibecoded using Codex.

## What this app does

- Trains with multiple-choice questions from a local JSON pool.
- Supports three scopes: `general`, `region`, or `both`.
- Lets you filter review by `all`, `incorrect`, or `skipped`.
- Shows optional English support for question text and options.
- Tracks progress (`correct`, `incorrect`, `skipped`, `unseen`) and saves it in `localStorage`.
- Works with keyboard shortcuts for fast practice.

## Keyboard shortcuts

- `1`-`4`: choose an answer option
- `ArrowRight`: next question (marks unseen current question as skipped)
- `ArrowLeft`: previous question
- `S`: skip current question
- `Esc`: close instructions modal

## Dataset

- Source file: `leben_in_deutschland_fragen.json`
- Loaded at runtime from `src/data/questions.ts`
- Current snapshot in this repo contains:
  - 460 total questions
  - 300 general questions
  - 160 region-specific questions
  - 16 represented regions

## Tech stack

- React 18
- TypeScript
- Vite 5
- Tailwind CSS 3

## Local development

Prerequisites:

- Node.js 18+ (Node.js 20 recommended)
- npm

Install and run:

```bash
npm install
npm run dev
```

The dev server URL is printed by Vite (typically `http://localhost:5173`).

## Build and preview

```bash
npm run build
npm run preview
```

## Deploy to GitHub Pages

This repository includes a workflow at `.github/workflows/deploy-pages.yml` that:

- builds the app on pushes to `main`
- uploads `dist/` as a Pages artifact
- deploys it with GitHub Pages Actions

One-time repository setup:

1. Push this repository to GitHub.
2. Open `Settings` -> `Pages`.
3. Under `Build and deployment`, set `Source` to `GitHub Actions`.
4. Push to `main` (or run the workflow manually from the Actions tab).

After a successful run, your site is available at:

- `https://<your-github-username>.github.io/<repository-name>/`

## Project structure

- `src/App.tsx`: main UI, practice flow, filters, progress and keyboard handling
- `src/data/questions.ts`: transforms raw JSON data to app question objects
- `src/lib/storage.ts`: `localStorage` persistence
- `src/types.ts`: shared TypeScript types
- `tailwind.config.ts`: design tokens and theme extensions
- `vite.config.ts`: Vite config (`base: "./"` for relative static hosting paths)

## Persistence behavior

- Progress and settings are auto-saved in browser storage key:
  - `leben-in-deutschland-trainer.v1`
- `Reset progress` clears saved progress inside the app.

## License

MIT. See `LICENSE`.
