export default function HelperLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="小幫手工作台載入中"
      className="grid gap-4"
      role="status"
    >
      <div className="h-32 animate-pulse rounded-xl border bg-card" />
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1].map((item) => (
          <div className="h-24 animate-pulse rounded-xl border bg-card" key={item} />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-xl border bg-card" />
      <p className="text-center text-sm text-muted-foreground">正在載入你的工作狀態…</p>
    </div>
  );
}
