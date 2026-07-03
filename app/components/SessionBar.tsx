import { logoutAction } from "../actions/auth";
import { LogoutButton } from "./LogoutButton";

export function SessionBar({
  email,
  role,
  title,
}: {
  email?: string;
  role: "小幫手" | "管理員";
  title: string;
}) {
  return (
    <header className="border-b bg-card/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              MINICHI
            </p>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
              {role}
            </span>
          </div>
          <h1 className="mt-0.5 truncate text-lg font-semibold tracking-tight sm:text-xl">
            {title}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {email ? <span className="hidden max-w-64 truncate text-sm text-muted-foreground sm:inline">{email}</span> : null}
          <form action={logoutAction}>
            <LogoutButton />
          </form>
        </div>
      </div>
    </header>
  );
}
