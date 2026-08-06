import { AuthRequired } from "../components/AuthRequired";
import { SessionBar } from "../components/SessionBar";
import { AdminWorkspaceNavigation } from "../components/WorkspaceNavigation";
import { getCurrentAdmin } from "../../src/server/current-session";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let admin;
  try {
    admin = await getCurrentAdmin();
  } catch {
    return <AuthRequired next="/admin" roleLabel="管理工作台" />;
  }

  return (
    <>
      <SessionBar email={admin.email} role="管理員" title="管理工作台" />
      <main className="app-main admin-main mx-auto grid w-full gap-6 px-4 py-6 sm:px-5 sm:py-8">
        <AdminWorkspaceNavigation />
        {children}
      </main>
    </>
  );
}
