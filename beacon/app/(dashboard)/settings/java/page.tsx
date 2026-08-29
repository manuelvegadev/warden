import { JavaRuntimes } from "@/components/settings/java-runtimes";

export default function JavaSettingsPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Java runtimes</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Eclipse Temurin (OpenJDK) builds are downloaded from Adoptium into wardend&apos;s data directory and used
        directly — nothing is installed system-wide.
      </p>
      <JavaRuntimes />
    </>
  );
}
