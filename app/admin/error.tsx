"use client";

import { WorkspaceError } from "../components/WorkspaceError";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <WorkspaceError reset={reset} roleLabel="管理工作台" />;
}
