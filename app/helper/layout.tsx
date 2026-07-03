import { redirect } from "next/navigation";

import { SessionBar } from "../components/SessionBar";
import { HelperWorkspaceNavigation } from "../components/WorkspaceNavigation";
import { getCurrentUser } from "../../src/server/current-session";

export default async function HelperLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/helper");

  return (
    <>
      <SessionBar email={user.email || ""} role="小幫手" title="小幫手工作台" />
      <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-5 sm:px-5 sm:py-7">
        <HelperWorkspaceNavigation />
        {children}
      </main>
    </>
  );
}
