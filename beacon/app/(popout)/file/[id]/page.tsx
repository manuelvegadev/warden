import { notFound, redirect } from "next/navigation";
import { FilePreview } from "@/components/instance/files/file-preview";
import { can } from "@/lib/access";
import { baseName, normalizePath } from "@/lib/fs-path";
import { instanceRoleOf } from "@/lib/members";
import { getSession } from "@/lib/session";
import { loadFsEntry, loadInstanceDetail } from "@/lib/wardend";

/** One file of the server directory alone, for a browser pop-up window (no sidebar, no header). */
export default async function FilePopoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ path?: string }>;
}) {
  const [{ id }, { path: rawPath }] = await Promise.all([params, searchParams]);
  const session = await getSession();
  if (!session) redirect("/login");
  const path = normalizePath(rawPath ?? "");
  if (!path) notFound();
  const [detail, role] = await Promise.all([loadInstanceDetail(id), instanceRoleOf(id)]);
  if (!can(role, "files")) notFound();
  // The listing carries what the header shows (size, modified) and whether the file is protected.
  const entry = await loadFsEntry(id, path);
  return (
    <>
      <title>{`${detail.manifest.name} \u00b7 ${baseName(path)}`}</title>
      <div className="h-svh">
        <FilePreview id={id} path={path} entry={entry} running={detail.status.state === "running"} canManage popout />
      </div>
    </>
  );
}
