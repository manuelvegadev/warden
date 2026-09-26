"use client";

import { Badge } from "@warden/ui/components/badge";
import { Button } from "@warden/ui/components/button";
import { badgeTone } from "@warden/ui/lib/badge-tone";
import { AlertTriangle, Download, ExternalLink, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LodSettings } from "@/components/instance/distant-view/lod-settings";
import { PregenList } from "@/components/instance/distant-view/pregen-list";
import { useInstance } from "@/components/instance/instance-context";
import { SectionCard, SettingRow } from "@/components/instance/section-card";
import { useAction } from "@/hooks/use-action";
import { can } from "@/lib/access";
import { formatBytes, isStopped, type LodInfo, type LodProvider, lod, plugins } from "@/lib/api";
import { diskTotal } from "@/lib/lod";
import { mono } from "@/lib/utils";

/** A LOD plugin family: install it, or its compatibility, disk use, backups, pre-generation and settings. */
export function ProviderCard({
  info,
  provider: p,
  onChange,
}: {
  info: LodInfo;
  provider: LodProvider;
  onChange: () => void;
}) {
  const { manifest, status, role } = useInstance();
  const id = manifest.id;
  const act = useAction(onChange);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const running = status.state === "running";
  const brand = p.installed?.brand ?? p.brands[0];

  const compat = (
    <SettingRow label="Players need" description={p.client}>
      <span className="text-right text-sm">
        {p.compat.verified ? p.compat.clients : "Not verified for this version"}{" "}
        <a
          href={p.compat.link}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center text-muted-foreground"
        >
          <ExternalLink className="size-3.5" aria-label="Plugin page" />
        </a>
      </span>
    </SettingRow>
  );
  const warning = p.compat.warning && (
    <div className="flex items-start gap-2 px-5 py-3 text-sm text-amber-600 dark:text-amber-400">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      {p.compat.warning}
    </div>
  );

  if (!p.installed) {
    return (
      <SectionCard
        title={brand.title}
        subtitle={p.pregen ? "Builds LODs ahead of time with pre-generation." : "Builds LODs as players move."}
        action={
          can(role, "plugins.write") && (
            <Button
              size="sm"
              onClick={() =>
                act(
                  () =>
                    plugins
                      .install(id, brand.project.source, brand.project.id, "latest")
                      .then(() => `Installing ${brand.title}…`),
                  false,
                )
              }
            >
              <Download className="size-4" /> Install
            </Button>
          )
        }
      >
        {compat}
        {warning}
      </SectionCard>
    );
  }

  const bytes = diskTotal(p);
  return (
    <SectionCard
      title={`${brand.title} ${p.installed.version}`}
      status={
        !p.installed.enabled ? (
          <Badge className={badgeTone.muted}>disabled</Badge>
        ) : running ? (
          <Badge className={badgeTone.emerald}>running</Badge>
        ) : null
      }
    >
      {compat}
      {warning}
      <SettingRow
        label="Disk"
        description={p.disk.map((d) => d.path).join(", ") || "Nothing stored yet"}
        trailing={
          can(role, "files") &&
          bytes > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={!isStopped(status.state)}
              title={isStopped(status.state) ? undefined : "Stop the server first"}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-4" /> Delete LOD data
            </Button>
          )
        }
      >
        <span className={mono}>{formatBytes(bytes)}</span>
      </SettingRow>
      {p.storeStatus && (
        <SettingRow label="Store" description="As the plugin reports it">
          <span className={`${mono} text-xs`}>{p.storeStatus.replace(/^LOD store: /, "")}</span>
        </SettingRow>
      )}
      {!p.pregen && (
        <p className="px-5 py-3 text-xs text-muted-foreground">
          Voxy builds LODs as players move. Pre-generating the world itself (for example with Chunky) makes that cheap.
        </p>
      )}
      {p.pregen && <PregenList info={info} onChange={onChange} />}
      <LodSettings kind={p.kind} configPath={`plugins/${brand.folder}/${brand.config}`} />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete the LOD data?"
        description={`Removes ${formatBytes(bytes)} of LODs. They are rebuilt as players explore${p.pregen ? " or by pre-generation" : ""}.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          setConfirmDelete(false);
          act(() => lod.deleteData(id, p.kind).then(() => "LOD data deleted"));
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </SectionCard>
  );
}
