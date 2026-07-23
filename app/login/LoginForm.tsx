"use client";

import { useActionState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { loginAction, type LoginActionResult } from "../actions/auth";
import { Button } from "../components/ui/button";
import { clearClientResourceCache } from "../../src/lib/client-resource-cache";

const initialState: LoginActionResult = {};

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  useEffect(() => {
    if (!state.ok) return;
    clearClientResourceCache();
    const next = searchParams.get("next");
    router.push(next && next.startsWith("/") && !next.startsWith("//") ? next : "/helper");
  }, [router, searchParams, state.ok]);

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-2">
        <label htmlFor="email">電子郵件</label>
        <input
          autoCapitalize="none"
          autoComplete="email"
          id="email"
          inputMode="email"
          name="email"
          placeholder="name@example.com"
          spellCheck={false}
          type="email"
          required
        />
      </div>
      <div className="grid gap-2">
        <label htmlFor="password">密碼</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {state.error ? (
        <p
          className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          id="login-error"
          role="alert"
        >
          {state.error === "invalid_credentials"
            ? "帳號或密碼不正確。"
            : "登入服務暫時無法使用，請稍後再試。"}
        </p>
      ) : null}
      <Button
        aria-describedby={state.error ? "login-error" : undefined}
        disabled={pending}
        size="lg"
        type="submit"
      >
        {pending ? "正在登入…" : "登入工作台"}
      </Button>
    </form>
  );
}
