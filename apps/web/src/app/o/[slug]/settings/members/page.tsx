import { getDb, schema } from "@bookalyze/db";
import { and, asc, eq, gt } from "drizzle-orm";
import { MailPlus } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getOrgContext, isOrgAdmin } from "@/server/org";
import { cancelInvitationAction, removeMemberAction } from "./actions";
import { ConfirmButton } from "./confirm-button";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Team members" };

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };

export default async function MembersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  const db = getDb();
  const [members, invitations] = await Promise.all([
    db
      .select({
        id: schema.member.id,
        role: schema.member.role,
        name: schema.user.name,
        email: schema.user.email,
        userId: schema.user.id,
      })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.member.organizationId, ctx.org.id))
      .orderBy(asc(schema.user.name)),
    db
      .select()
      .from(schema.invitation)
      .where(
        and(
          eq(schema.invitation.organizationId, ctx.org.id),
          eq(schema.invitation.status, "pending"),
          gt(schema.invitation.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(schema.invitation.email)),
  ]);
  const admin = isOrgAdmin(ctx);

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Team members"
        description={`People who can open ${ctx.org.name}. They only see this company, never your others.`}
      />
      {admin ? <InviteForm slug={slug} /> : null}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <h2 className="font-medium text-sm">
            {members.length} {members.length === 1 ? "member" : "members"}
            {invitations.length ? ` · ${invitations.length} invited` : ""}
          </h2>
        </div>
        <ul className="divide-y">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-4 px-5 py-4">
              <Avatar name={m.name} className="size-9" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-sm">
                  {m.name}
                  {m.userId === ctx.session.user.id ? (
                    <span className="font-normal text-muted-foreground"> (you)</span>
                  ) : null}
                </p>
                <p className="truncate text-muted-foreground text-sm">{m.email}</p>
              </div>
              <Badge variant={m.role === "owner" ? "primary" : "secondary"}>
                {ROLE_LABEL[m.role] ?? m.role}
              </Badge>
              {admin && m.role !== "owner" && m.userId !== ctx.session.user.id ? (
                <ConfirmButton
                  action={removeMemberAction.bind(null, slug, m.id)}
                  confirmLabel="Remove?"
                  toastMessage={`${m.name} removed`}
                >
                  Remove
                </ConfirmButton>
              ) : null}
            </li>
          ))}
          {invitations.map((inv) => (
            <li key={inv.id} className="flex items-center gap-4 px-5 py-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground">
                <MailPlus className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-sm">{inv.email}</p>
                <p className="text-muted-foreground text-sm">Invitation sent · waiting to join</p>
              </div>
              <Badge variant="outline">{ROLE_LABEL[inv.role ?? "member"]}</Badge>
              {admin ? (
                <ConfirmButton
                  action={cancelInvitationAction.bind(null, slug, inv.id)}
                  confirmLabel="Cancel invite?"
                  toastMessage="Invitation cancelled"
                >
                  Cancel
                </ConfirmButton>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <div className="grid gap-3 rounded-2xl bg-muted/50 p-5 text-sm sm:grid-cols-3">
        <RoleHelp title="Owner" text="Full control, including billing and deleting the company." />
        <RoleHelp title="Admin" text="Can change settings, features and invite or remove people." />
        <RoleHelp title="Member" text="Can use the books and features, but not change settings." />
      </div>
    </div>
  );
}

function RoleHelp({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <p className="font-medium">{title}</p>
      <p className="mt-0.5 text-muted-foreground leading-relaxed">{text}</p>
    </div>
  );
}
