interface ScoreRingProps {
  score: number | null;
  size?: 'sm' | 'md';
}

function getScoreColor(score: number): string {
  if (score >= 8) return '#00E87A';
  if (score >= 5) return '#FFB020';
  return '#FF4757';
}

export function ScoreRing({ score, size = 'sm' }: ScoreRingProps) {
  const dim = size === 'sm' ? 40 : 52;
  const fontSize = size === 'sm' ? '11px' : '14px';
  const strokeWidth = size === 'sm' ? 3 : 3.5;

  if (score === null) {
    return (
      <div className="relative shrink-0" style={{ width: dim, height: dim }}>
        <svg width={dim} height={dim} viewBox="0 0 40 40" aria-hidden="true">
          <circle
            cx="20"
            cy="20"
            r="15.9155"
            fill="none"
            stroke="#1C2333"
            strokeWidth={strokeWidth}
          />
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center font-mono"
          style={{ fontSize, color: '#3D4558' }}
          aria-label="Score pending"
        >
          —
        </span>
      </div>
    );
  }

  const color = getScoreColor(score);
  const offset = (1 - score / 10) * 100;

  return (
    <div
      className="relative shrink-0"
      style={{ width: dim, height: dim }}
      role="img"
      aria-label={`Score: ${score} out of 10`}
    >
      <svg
        width={dim}
        height={dim}
        viewBox="0 0 40 40"
        style={{ transform: 'rotate(-90deg)' }}
        aria-hidden="true"
      >
        {/* Background track */}
        <circle
          cx="20"
          cy="20"
          r="15.9155"
          fill="none"
          stroke="#1C2333"
          strokeWidth={strokeWidth}
        />
        {/* Score arc — animates from empty (dashoffset=100) to the score value */}
        <circle
          cx="20"
          cy="20"
          r="15.9155"
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray="100"
          style={{ strokeDashoffset: offset }}
          className="ring-arc"
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center font-mono font-semibold"
        style={{ fontSize, color }}
      >
        {score}
      </span>
    </div>
  );
}
