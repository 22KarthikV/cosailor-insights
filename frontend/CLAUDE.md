# Frontend Rules (Next.js 15)

## Stack
Next.js 15, TypeScript, Tailwind CSS, shadcn/ui

## Component Rules
- Default: async Server Components — no 'use client'
- 'use client' ONLY for: useState, useEffect, event handlers, useRouter
- PipelineControls.tsx is the ONLY component that polls

## ScoreBadge Colors
- 1-4: bg-red-100 text-red-800 border-red-200
- 5-7: bg-yellow-100 text-yellow-800 border-yellow-200
- 8-10: bg-green-100 text-green-800 border-green-200

## API Base
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

## Dev Command
cd frontend && npm run dev
