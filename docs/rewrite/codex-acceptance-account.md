# Codex Acceptance Account

This fixed account is for Codex browser/manual acceptance of the clean Next.js
helper system UI. It replaces the previous pattern of creating a fresh temporary
helper login for every visual walkthrough.

## Login

- Email: `codex.acceptance@minichi.test`
- Password: `MinichiCodex1224!`
- Display name: `Codex 驗收小幫手`
- Role: helper profile in `helper_app.helper_profiles`
- Region: `Tokyo`

Use this account for helper-side UI verification unless a test explicitly needs
multiple helpers, inactive helpers, or disposable isolation data.

## Maintenance

Run this command from `minichi_helper_system/` to create or repair the account:

```bash
npm run acceptance:ensure-codex-account
```

The script is idempotent:

- If the Supabase Auth user does not exist, it creates and confirms the user.
- If the user already exists, it refreshes the fixed password and metadata.
- It upserts an active helper profile bound to the Auth user id.

The account is intentionally not an automated-test fixture and should not be
deleted by acceptance cleanup scripts. Use disposable fixture scripts when tests
need isolated data, destructive cleanup, or role-conflict scenarios.

## Admin Access

Admin authorization is still controlled by `MINICHI_ADMIN_EMAILS`. Do not assume
this helper account can access `/admin` unless its email is deliberately added to
that allowlist for a local/manual acceptance session.
