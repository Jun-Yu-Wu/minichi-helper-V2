export default function AdminLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="管理工作台載入中"
      className="grid gap-4"
      role="status"
    >
      <div className="skeleton-block h-28 rounded-xl border" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div className="skeleton-block h-24 rounded-xl border" key={item} />
        ))}
      </div>
      <div className="skeleton-block h-56 rounded-xl border" />
      <p className="text-center text-sm text-muted-foreground">正在載入管理工作狀態…</p>
    </div>
  );
}
