interface ScoreBadgeProps {
  score: number | null;
  size?: 'sm' | 'lg';
}

export function ScoreBadge({ score, size = 'sm' }: ScoreBadgeProps) {
  if (score === null) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
        Pending
      </span>
    );
  }
  const color =
    score >= 8
      ? 'bg-green-100 text-green-800 border border-green-200'
      : score >= 5
      ? 'bg-yellow-100 text-yellow-800 border border-yellow-200'
      : 'bg-red-100 text-red-800 border border-red-200';

  const sizeClass =
    size === 'lg' ? 'text-2xl font-bold px-4 py-2' : 'text-xs font-semibold px-2.5 py-1';

  return (
    <span className={`inline-flex items-center rounded-full ${color} ${sizeClass}`}>
      {size === 'lg' ? score : `${score}/10`}
    </span>
  );
}
