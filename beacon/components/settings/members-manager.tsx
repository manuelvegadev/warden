"use client";

import { Avatar, AvatarFallback } from "@warden/ui/components/avatar";
import { Badge } from "@warden/ui/components/badge";
import { Button } from "@warden/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@warden/ui/components/dialog";
import { Input } from "@warden/ui/components/input";
import { Label } from "@warden/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@warden/ui/components/select";
import { KeyRound, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { CopyButton, SectionCard, SettingRow } from "@/components/instance/section-card";
import {
  ALL_INSTANCES,
  describeInstanceRole,
  INSTANCE_ROLES,
  type InstanceRole,
  labelForInstanceRole,
  labelForOrgRole,
} from "@/lib/access";
import { api } from "@/lib/api";
import type { InvitationView, MemberView } from "@/lib/org";
import { formatDate } from "@/lib/utils";

type Instance = { id: string; name: string };

const NO_ACCESS = "none";
type Choice = InstanceRole | typeof NO_ACCESS;

/** Beacon's own routes answer the same `{error:{code,message}}` envelope as the wardend BFF. */
const call = <T,>(path: string, init: RequestInit) => api<T>(path, { ...init, own: true });

/** Absolute link for the guest. Built in the browser so one image serves every deployment. */
const inviteUrl = (id: string) =>
  typeof window === "undefined" ? `/invite/${id}` : `${window.location.origin}/invite/${id}`;

const nameOf = (instances: Instance[], id: string) => instances.find((i) => i.id === id)?.name ?? id;

/** "survival · operator, creative · viewer", or the blanket grant when there is one. */
function describeAccess(member: MemberView, instances: Instance[]): string {
  const parts = member.grants.map((g) => `${nameOf(instances, g.instanceId)} · ${labelForInstanceRole[g.role]}`);
  if (member.blanket) parts.unshift(`Every server · ${labelForInstanceRole[member.blanket]}`);
  return parts.length > 0 ? parts.join(", ") : "No server yet";
}

export function MembersManager({
  members,
  invitations,
  instances,
  currentUserId,
}: {
  members: MemberView[];
  invitations: InvitationView[];
  instances: Instance[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<MemberView | null>(null);

  const act = async (run: () => Promise<unknown>, ok: string, fallback: string) => {
    try {
      await run();
      toast.success(ok);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : fallback);
    }
  };

  return (
    <div className="mt-6 grid gap-8">
      <SectionCard
        title="People"
        subtitle="Owners and admins reach every server; members only reach what they are given."
        action={
          <Button size="sm" onClick={() => setInviting(true)} disabled={instances.length === 0}>
            <UserPlus /> Invite
          </Button>
        }
      >
        {members.map((member) => (
          <div key={member.userId} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <Avatar className="size-8 rounded-md">
              <AvatarFallback className="rounded-md">{member.name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{member.name}</span>
                <Badge variant="outline">{labelForOrgRole[member.orgRole]}</Badge>
                {member.userId === currentUserId && <span className="text-xs text-muted-foreground">you</span>}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {member.email} · {describeAccess(member, instances)}
              </p>
            </div>
            {member.orgRole === "member" && (
              <Button variant="outline" size="sm" onClick={() => setEditing(member)}>
                <KeyRound /> Access
              </Button>
            )}
            {member.orgRole !== "owner" && member.userId !== currentUserId && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${member.name}`}
                onClick={() =>
                  act(
                    () => call(`/api/members/${member.userId}`, { method: "DELETE" }),
                    `${member.name} no longer has access`,
                    "Could not remove the member",
                  )
                }
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        ))}
      </SectionCard>

      {invitations.length > 0 && (
        <SectionCard title="Pending invitations" subtitle="Each link works once and expires after seven days.">
          {invitations.map((invitation) => (
            <div key={invitation.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{invitation.email}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {invitation.instanceId ? nameOf(instances, invitation.instanceId) : "no server"} ·{" "}
                  {invitation.instanceRole ? labelForInstanceRole[invitation.instanceRole] : "no role"} · expires{" "}
                  {formatDate(invitation.expiresAt)}
                </p>
              </div>
              <CopyButton value={inviteUrl(invitation.id)} label="Copy invitation link" showLabel />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Cancel the invitation for ${invitation.email}`}
                onClick={() =>
                  act(
                    () =>
                      call(`/api/members/invitations?id=${encodeURIComponent(invitation.id)}`, { method: "DELETE" }),
                    "Invitation cancelled",
                    "Could not cancel the invitation",
                  )
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </SectionCard>
      )}

      <InviteDialog open={inviting} onOpenChange={setInviting} instances={instances} />
      <AccessDialog member={editing} onClose={() => setEditing(null)} instances={instances} />
    </div>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  instances,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instances: Instance[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");
  const [role, setRole] = useState<InstanceRole>("operator");

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setLink(null);
      router.refresh();
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email"));
    setPending(true);
    try {
      const { id } = await call<{ id: string }>("/api/members/invitations", {
        method: "POST",
        body: JSON.stringify({ email, instanceId, instanceRole: role }),
      });
      setLink(inviteUrl(id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the invitation");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite someone</DialogTitle>
          <DialogDescription>
            {link
              ? "Send them this link. It works once and expires in seven days."
              : "They get an account and access to the server you pick — nothing else."}
          </DialogDescription>
        </DialogHeader>

        {link ? (
          <div className="grid gap-3">
            <div className="flex items-center gap-2">
              <Input value={link} readOnly className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <CopyButton value={link} label="Copy invitation link" />
            </div>
            <DialogFooter>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" name="email" type="email" required autoFocus autoComplete="off" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="invite-instance">Server</Label>
              <Select
                items={Object.fromEntries(instances.map((i) => [i.id, i.name]))}
                value={instanceId}
                onValueChange={(v) => v && setInstanceId(v)}
              >
                <SelectTrigger id="invite-instance" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {instances.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <RoleSelect id="invite-role" value={role} onChange={setRole} />
            <DialogFooter>
              <Button type="submit" disabled={pending || !instanceId}>
                {pending ? "Creating…" : "Create invitation"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Per-instance access for one member. A blanket grant (every server, e.g. the one a pre-ADR-017
 * operator was migrated with) gets its own row, so it is visible and can be lowered or dropped.
 * Edits apply as they are made; the page refreshes once, on close.
 */
function AccessDialog({
  member,
  onClose,
  instances,
}: {
  member: MemberView | null;
  onClose: () => void;
  instances: Instance[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Choice>>({});
  const [dirty, setDirty] = useState(false);

  function close() {
    onClose();
    setEdits({});
    if (dirty) {
      setDirty(false);
      router.refresh();
    }
  }

  const saved = (instanceId: string): Choice => {
    if (!member) return NO_ACCESS;
    if (instanceId === ALL_INSTANCES) return member.blanket ?? NO_ACCESS;
    return member.grants.find((g) => g.instanceId === instanceId)?.role ?? NO_ACCESS;
  };
  const current = (instanceId: string): Choice => edits[instanceId] ?? saved(instanceId);

  async function change(userId: string, instanceId: string, value: Choice) {
    setPending(instanceId);
    try {
      await call(`/api/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ instanceId, role: value === NO_ACCESS ? null : value }),
      });
      setEdits((e) => ({ ...e, [instanceId]: value }));
      setDirty(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the access");
    } finally {
      setPending(null);
    }
  }

  // Rows: the blanket grant (only while it exists) and then one per instance.
  const rows = [
    ...(member?.blanket ? [{ id: ALL_INSTANCES, name: "Every server" }] : []),
    ...instances.map((i) => ({ id: i.id, name: i.name })),
  ];

  return (
    <Dialog open={member !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{member ? `${member.name}'s access` : "Access"}</DialogTitle>
          <DialogDescription>Changes apply immediately and close any console this person has open.</DialogDescription>
        </DialogHeader>
        {member && (
          <div className="-mx-6 divide-y border-y">
            {rows.map((row) => (
              <SettingRow
                key={row.id}
                id={`access-${row.id}`}
                label={row.name}
                description={
                  row.id === ALL_INSTANCES
                    ? "Covers every server on this node, including ones created later."
                    : undefined
                }
              >
                <RoleSelect
                  id={`access-${row.id}`}
                  value={current(row.id)}
                  onChange={(v) => change(member.userId, row.id, v)}
                  disabled={pending === row.id}
                  allowNone
                />
              </SettingRow>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoleSelect<T extends Choice>({
  id,
  value,
  onChange,
  disabled,
  allowNone,
}: {
  id: string;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  allowNone?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      {!allowNone && <Label htmlFor={id}>Role</Label>}
      <Select
        items={allowNone ? { [NO_ACCESS]: "No access", ...labelForInstanceRole } : labelForInstanceRole}
        value={value}
        onValueChange={(v) => v && onChange(v as T)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value={NO_ACCESS}>No access</SelectItem>}
          {INSTANCE_ROLES.map((r) => (
            <SelectItem key={r} value={r}>
              {labelForInstanceRole[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value !== NO_ACCESS && (
        <p className="text-xs text-muted-foreground">{describeInstanceRole[value as InstanceRole]}</p>
      )}
    </div>
  );
}
