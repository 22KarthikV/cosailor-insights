export default function LeadDetailLoading() {
  return (
    <div className="min-h-screen" style={{ background: '#08090C' }}>
      {/* Nav bar skeleton */}
      <div
        className="sticky top-0 z-10 px-6 py-3"
        style={{ background: '#08090C', borderBottom: '1px solid #1C2333' }}
      >
        <div className="max-w-6xl mx-auto">
          <div className="shimmer-block h-4 w-36 rounded" />
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Company header */}
        <div className="mb-8 space-y-3">
          <div className="shimmer-block h-9 w-80 rounded-lg" />
          <div className="shimmer-block h-4 w-48 rounded" />
          <div className="shimmer-block h-4 w-36 rounded" />
        </div>

        {/* Two-column layout */}
        <div className="flex flex-col lg:grid lg:grid-cols-[1fr_300px] gap-6">
          {/* Left: content skeletons */}
          <div className="space-y-4 order-2 lg:order-1">
            {[120, 100, 90, 80].map((h, i) => (
              <div
                key={i}
                className="rounded-xl p-5"
                style={{ background: '#0F1117', border: '1px solid #1C2333' }}
              >
                <div className="shimmer-block h-3 w-24 rounded mb-4" />
                <div className={`shimmer-block rounded`} style={{ height: h }} />
              </div>
            ))}
          </div>

          {/* Right: score panel skeleton */}
          <div className="order-1 lg:order-2">
            <div
              className="rounded-xl p-5 space-y-5"
              style={{ background: '#0F1117', border: '1px solid #1C2333' }}
            >
              {/* Score rings */}
              <div className="flex gap-5">
                {[0, 1].map((i) => (
                  <div key={i} className="flex flex-col items-center gap-2 flex-1">
                    <div className="shimmer-block h-3 w-20 rounded" />
                    <div className="shimmer-block rounded-full" style={{ width: 52, height: 52 }} />
                    <div className="shimmer-block h-8 w-full rounded" />
                  </div>
                ))}
              </div>

              <div style={{ height: 1, background: '#1C2333' }} />

              {/* Certifications */}
              <div className="space-y-2">
                <div className="shimmer-block h-3 w-24 rounded" />
                <div className="shimmer-block h-7 rounded" />
                <div className="shimmer-block h-7 rounded" />
              </div>

              {/* Status */}
              <div style={{ borderTop: '1px solid #1C2333', paddingTop: 12 }}>
                <div className="shimmer-block h-5 w-20 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
