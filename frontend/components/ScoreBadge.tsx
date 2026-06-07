import { ScoreRing } from './ScoreRing';

interface ScoreBadgeProps {
  score: number | null;
  size?: 'sm' | 'lg';
}

export function ScoreBadge({ score, size = 'sm' }: ScoreBadgeProps) {
  return <ScoreRing score={score} size={size === 'lg' ? 'md' : 'sm'} />;
}
