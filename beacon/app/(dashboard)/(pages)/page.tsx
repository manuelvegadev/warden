import { Home } from "@/components/home";
import { getSession } from "@/lib/session";

export default async function HomePage() {
  const session = await getSession();
  return <Home isAdmin={session?.user.role === "admin"} />;
}
