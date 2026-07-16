export default function LoginLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="登入頁面載入中"
      className="mx-auto grid min-h-svh w-full max-w-md content-center gap-4 px-5 py-10"
      role="status"
    >
      <div className="h-72 animate-pulse rounded-xl border bg-card" />
      <p className="text-center text-sm text-muted-foreground">正在準備登入畫面…</p>
    </main>
  );
}
