import { AuthRequired } from "../components/AuthRequired";
import { SessionBar } from "../components/SessionBar";
import { HelperWorkspaceNavigation } from "../components/WorkspaceNavigation";
import { getCurrentUser } from "../../src/server/current-session";
import { SitePhotoUploadProvider } from "./SitePhotoUploadStore";

export default async function HelperLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) return <AuthRequired next="/helper" roleLabel="小幫手工作台" />;

  return (
    <SitePhotoUploadProvider>
      <SessionBar email={user.email || ""} role="小幫手" title="小幫手工作台" />
      <main className="app-main helper-main mx-auto grid w-full gap-6 px-4 py-6 sm:px-5 sm:py-8">
        <HelperWorkspaceNavigation />
        {children}
      </main>
    </SitePhotoUploadProvider>
  );
}
