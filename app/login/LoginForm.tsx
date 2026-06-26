"use client";

import { useActionState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { loginAction, type LoginActionResult } from "../actions/auth";
import { Button } from "../components/ui/button";

const initialState: LoginActionResult = {};

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  useEffect(() => {
    if (!state.ok) return;
    const next = searchParams.get("next");
    router.push(next && next.startsWith("/") ? next : "/helper");
  }, [router, searchParams, state.ok]);

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-2">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="grid gap-2">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {state.error ? (
        <p className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error === "invalid_credentials"
            ? "帳號或密碼不正確。"
            : "登入服務暫時無法使用，請稍後再試。"}
        </p>
      ) : null}
      <Button disabled={pending} type="submit">
        {pending ? "登入中..." : "登入"}
      </Button>
    </form>
  );
}
