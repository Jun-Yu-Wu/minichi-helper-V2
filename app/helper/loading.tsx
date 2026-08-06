export default function HelperLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="小幫手工作台載入中"
      className="grid gap-4"
      role="status"
    >
      <div className="skeleton-block h-32 rounded-xl border" />
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1].map((item) => (
          <div className="skeleton-block h-24 rounded-xl border" key={item} />
        ))}
      </div>
      <div className="skeleton-block h-48 rounded-xl border" />
      <p className="text-center text-sm text-muted-foreground">正在載入你的工作狀態…</p>
    </div>
  );
}
