export default function Loading() {
  return (
    <main
      aria-busy="true"
      aria-label="頁面載入中"
      className="mx-auto grid min-h-[60svh] w-full max-w-7xl content-start gap-5 px-4 py-6 sm:px-5"
    >
      <div className="h-14 animate-pulse rounded-xl border bg-card" />
      <div className="grid gap-3 rounded-xl border bg-card p-5">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-8 w-2/3 max-w-md animate-pulse rounded bg-muted" />
        <div className="h-4 w-full max-w-2xl animate-pulse rounded bg-muted" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div className="h-28 animate-pulse rounded-xl border bg-card" key={item} />
        ))}
      </div>
      <p className="text-center text-sm text-muted-foreground">正在載入最新工作狀態…</p>
    </main>
  );
}
