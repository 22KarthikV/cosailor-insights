/** Skeleton shown instantly while the lead detail Server Component fetches data. */
export default function LeadDetailLoading() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 animate-pulse">
      {/* Back link */}
      <div className="h-4 w-36 bg-gray-200 rounded mb-6" />

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="space-y-2 flex-1">
          <div className="h-7 w-64 bg-gray-200 rounded" />
          <div className="h-4 w-32 bg-gray-100 rounded" />
          <div className="h-4 w-28 bg-gray-100 rounded" />
        </div>
        {/* Score chips */}
        <div className="flex gap-4 shrink-0">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <div className="h-3 w-12 bg-gray-100 rounded" />
              <div className="h-12 w-12 bg-gray-200 rounded-full" />
              <div className="h-1.5 w-16 bg-gray-100 rounded-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Badge row */}
      <div className="flex gap-2 mb-6">
        <div className="h-5 w-40 bg-gray-100 rounded-full" />
        <div className="h-5 w-28 bg-gray-100 rounded-full" />
      </div>

      {/* Cards */}
      <div className="space-y-4">
        {[80, 120, 100, 90].map((h, i) => (
          <div key={i} className="rounded-lg border border-gray-100 p-4 space-y-2">
            <div className="h-4 w-32 bg-gray-200 rounded" />
            <div className={`h-${h === 80 ? '12' : h === 120 ? '20' : h === 100 ? '16' : '14'} bg-gray-100 rounded`} />
          </div>
        ))}
      </div>
    </div>
  );
}
