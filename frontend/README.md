# Cosailor Insights — Frontend

Next.js 15 App Router dashboard for the Cosailor B2B sales intelligence platform.

## Setup

```bash
npm install
cp .env.local.example .env.local   # set NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev                         # http://localhost:3000
```

## Environment Variables

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

For production, set `NEXT_PUBLIC_API_URL` to your deployed backend URL.

## Key Commands

```bash
npm run dev       # dev server with Turbopack
npm run build     # production build
npx tsc --noEmit  # type check only
```

## Stack

- **Next.js 15** App Router (Server + Client Components)
- **Tailwind CSS** with custom dark design system
- **TypeScript** throughout
- **Fonts**: Syne (headings), DM Sans (body), JetBrains Mono (data)

## Component Overview

| Component | Type | Purpose |
|---|---|---|
| `app/page.tsx` | Server | Dashboard layout, leads SSR |
| `app/leads/[id]/page.tsx` | Server | Lead detail two-column layout |
| `PipelineControls.tsx` | Client | Run button, status polling, modal trigger |
| `PipelineMissionModal.tsx` | Client (Portal) | Full-screen live pipeline progress overlay |
| `LeadCard.tsx` | Server | Score ring + hover card |
| `LeadsGridClient.tsx` | Client | Filter bar, grid, pagination |
| `ScoreRing.tsx` | Server | Animated SVG score arc |
| `ScoreBadge.tsx` | Server | Score tier badge |

## Architecture Notes

- Server Components by default — `'use client'` only for interactivity
- `PipelineControls` is the **only** polling component (every 3s while running)
- `PipelineMissionModal` uses `ReactDOM.createPortal` to render at `document.body` level, bypassing the sticky header's CSS stacking context
- All API calls go through `lib/api.ts`; data fetching in Server Components uses `lib/leads.ts`
