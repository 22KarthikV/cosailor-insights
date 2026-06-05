/**
 * Shared utility functions for the Cosailor Insights frontend.
 *
 * cn() is the standard shadcn/ui class-name helper: it merges clsx conditionals
 * with tailwind-merge so conflicting Tailwind classes resolve correctly
 * (e.g. `cn('px-2', 'px-4')` → `'px-4'` rather than both classes persisting).
 */
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/** Merge and de-duplicate Tailwind class names. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
