export default function AdminLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="管理工作台載入中"
      className="grid gap-4"
      role="status"
    >
      <div className="h-28 animate-pulse rounded-xl border bg-card" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div className="h-24 animate-pulse rounded-xl border bg-card" key={item} />
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-xl border bg-card" />
      <p className="text-center text-sm text-muted-foreground">正在載入管理工作狀態…</p>
    </div>
  );
}
