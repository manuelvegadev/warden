import { AccountForms } from "@/components/settings/account-forms";
import { getSession } from "@/lib/session";

export default async function AccountPage() {
  const session = await getSession();
  const user = session?.user;
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Account</h1>
      <p className="mt-1 text-sm text-muted-foreground">Your profile and password for Beacon.</p>
      <AccountForms name={user?.name ?? ""} email={user?.email ?? ""} />
    </div>
  );
}
