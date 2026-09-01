import { Home } from "@/components/home";
import { currentAccess } from "@/lib/members";
import { getSession } from "@/lib/session";

export default async function HomePage() {
  const [session, access] = await Promise.all([getSession(), currentAccess()]);
  return (
    <Home isAdmin={session?.user.role === "admin"} canCreate={access?.caps.includes("instances.create") ?? false} />
  );
}
