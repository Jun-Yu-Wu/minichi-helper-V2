import { logoutAction } from "../actions/auth";
import { LogoutButton } from "./LogoutButton";
import { ShieldCheck, UserRound } from "lucide-react";

export function SessionBar({
  email,
  role,
  title,
}: {
  email?: string;
  role: "小幫手" | "管理員";
  title: string;
}) {
  const isAdmin = role === "管理員";
  return (
    <header className={`session-bar sticky top-0 z-30 border-b bg-background ${isAdmin ? "admin-main" : "helper-main"}`}>
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`session-bar__mark grid size-8 shrink-0 place-items-center rounded-lg border ${isAdmin ? "border-admin-accent text-admin-accent" : "border-primary text-primary"}`}>
            {isAdmin ? <ShieldCheck aria-hidden="true" className="size-4" /> : <UserRound aria-hidden="true" className="size-4" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-semibold tracking-wide text-foreground">MINICHI</p>
              <span className="text-xs text-muted-foreground">{role}</span>
            </div>
            <h1 className="mt-0.5 truncate text-sm font-medium text-muted-foreground sm:text-base">{title}</h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {email ? <span className="hidden max-w-64 truncate text-xs text-muted-foreground sm:inline">{email}</span> : null}
          <form action={logoutAction}>
            <LogoutButton />
          </form>
        </div>
      </div>
    </header>
  );
}
