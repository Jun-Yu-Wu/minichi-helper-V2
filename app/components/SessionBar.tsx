import { logoutAction } from "../actions/auth";
import { Button } from "./ui/button";

export function SessionBar({ email, title }: { email?: string; title: string }) {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            MINICHI
          </p>
          <h1 className="text-xl font-semibold">{title}</h1>
        </div>
        <div className="flex items-center gap-3">
          {email ? <span className="hidden text-sm text-muted-foreground sm:inline">{email}</span> : null}
          <form action={logoutAction}>
            <Button size="sm" type="submit" variant="outline">
              登出
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
