"use server";

import { TAX_PACKS } from "@bookalyze/core";
import { applyTaxPack, schema } from "@bookalyze/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  type TaxRateInput,
  type TaxRegistrationInput,
  taxRateSchema,
  taxRegistrationSchema,
} from "@/lib/validation/accounting";
import { getAccountingContext, inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";

export type TaxResult =
  | { ok: true; message?: string }
  | { ok: false; message?: string; errors?: Record<string, string> };

function pgCode(error: unknown): string | undefined {
  return (error as { cause?: { code?: string } })?.cause?.code;
}

function issues(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) errors[issue.path.join(".") || "form"] ??= issue.message;
  return errors;
}

function revalidate(slug: string) {
  revalidatePath(`/o/${slug}/accounting`, "layout");
}

/** Adds a country pack's tax accounts and the chosen rates. */
export async function applyTaxPackAction(
  slug: string,
  packKey: string,
  rateKeys: string[],
): Promise<TaxResult> {
  const ctx = await getAccountingContext(slug);
  const pack = TAX_PACKS.find((p) => p.key === packKey);
  if (!pack) return { ok: false, message: "This tax setup isn't available." };
  const rates = pack.rates.filter((r) => rateKeys.includes(r.key));
  if (!rates.length) return { ok: false, message: "Choose at least one rate." };
  const result = await inOrg(ctx, async (tx) => {
    const applied = await applyTaxPack(tx, {
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
      pack,
      rates,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "tax.pack_applied",
      entityType: "tax_rate",
      after: { pack: pack.key, rates: rates.map((r) => r.key), added: applied.added },
    });
    // Start a registration too, so filing periods follow it from day one.
    const [existing] = await tx
      .select({ id: schema.taxRegistrations.id })
      .from(schema.taxRegistrations)
      .limit(1);
    if (!existing) {
      await tx.insert(schema.taxRegistrations).values({
        organizationId: ctx.org.id,
        authority: pack.authority,
        filingFrequency: "quarterly",
        createdBy: ctx.session.user.id,
      });
    }
    return applied;
  });
  revalidate(slug);
  return {
    ok: true,
    message:
      result.added === 0
        ? "These rates are already set up."
        : `${result.added} ${result.added === 1 ? "rate" : "rates"} added`,
  };
}

export async function saveTaxRateAction(slug: string, input: TaxRateInput): Promise<TaxResult> {
  const ctx = await getAccountingContext(slug);
  const parsed = taxRateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: issues(parsed.error) };
  const { id, accountId, ...values } = parsed.data;
  try {
    const outcome = await inOrg(ctx, async (tx) => {
      // Where the tax is kept: an existing sales tax account, or a new one named after the rate.
      let account = accountId;
      if (account === "new") {
        const [created] = await tx
          .insert(schema.accounts)
          .values({
            organizationId: ctx.org.id,
            name: `${values.name} payable`,
            type: "liability",
            subtype: "sales_tax",
            description: "Sales tax collected, less tax paid that can be claimed back.",
            createdBy: ctx.session.user.id,
          })
          .returning({ id: schema.accounts.id });
        if (!created) throw new Error("Could not create the tax account");
        account = created.id;
      } else {
        const [found] = await tx
          .select({ id: schema.accounts.id })
          .from(schema.accounts)
          .where(and(eq(schema.accounts.id, account), eq(schema.accounts.subtype, "sales_tax")));
        if (!found) return { error: { accountId: "Choose a sales tax account." } };
      }

      if (id) {
        const [before] = await tx.select().from(schema.taxRates).where(eq(schema.taxRates.id, id));
        if (!before) return { missing: true };
        const [after] = await tx
          .update(schema.taxRates)
          .set({ ...values, accountId: account })
          .where(eq(schema.taxRates.id, id))
          .returning();
        await audit(tx, {
          orgId: ctx.org.id,
          actorUserId: ctx.session.user.id,
          action: "tax_rate.updated",
          entityType: "tax_rate",
          entityId: id,
          before,
          after,
        });
        return {};
      }
      const [created] = await tx
        .insert(schema.taxRates)
        .values({
          ...values,
          accountId: account,
          organizationId: ctx.org.id,
          createdBy: ctx.session.user.id,
        })
        .returning();
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "tax_rate.created",
        entityType: "tax_rate",
        entityId: created?.id,
        after: created,
      });
      return {};
    });
    if ("missing" in outcome) return { ok: false, message: "This rate no longer exists." };
    if ("error" in outcome && outcome.error) return { ok: false, errors: outcome.error };
  } catch (error) {
    if (pgCode(error) === "23505") {
      return { ok: false, errors: { name: "You already have a rate with this name." } };
    }
    if (pgCode(error) === "23514") {
      return {
        ok: false,
        message:
          "Transactions already use this rate, so its percentage, account and claim-back setting are fixed. Add a new rate and archive this one instead.",
      };
    }
    throw error;
  }
  revalidate(slug);
  return { ok: true };
}

export async function setTaxRateArchivedAction(
  slug: string,
  id: string,
  archived: boolean,
): Promise<TaxResult> {
  const ctx = await getAccountingContext(slug);
  const updated = await inOrg(ctx, async (tx) => {
    const [row] = await tx
      .update(schema.taxRates)
      .set({ isArchived: archived })
      .where(eq(schema.taxRates.id, id))
      .returning({ id: schema.taxRates.id });
    if (row) {
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: archived ? "tax_rate.archived" : "tax_rate.restored",
        entityType: "tax_rate",
        entityId: id,
      });
    }
    return Boolean(row);
  });
  if (!updated) return { ok: false, message: "This rate no longer exists." };
  revalidate(slug);
  return { ok: true };
}

export async function saveTaxRegistrationAction(
  slug: string,
  input: TaxRegistrationInput,
): Promise<TaxResult> {
  const ctx = await getAccountingContext(slug);
  const parsed = taxRegistrationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: issues(parsed.error) };
  const { id, ...values } = parsed.data;
  const saved = await inOrg(ctx, async (tx) => {
    if (id) {
      const [before] = await tx
        .select()
        .from(schema.taxRegistrations)
        .where(eq(schema.taxRegistrations.id, id));
      if (!before) return false;
      const [after] = await tx
        .update(schema.taxRegistrations)
        .set(values)
        .where(eq(schema.taxRegistrations.id, id))
        .returning();
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "tax_registration.updated",
        entityType: "tax_registration",
        entityId: id,
        before,
        after,
      });
      return true;
    }
    const [created] = await tx
      .insert(schema.taxRegistrations)
      .values({ ...values, organizationId: ctx.org.id, createdBy: ctx.session.user.id })
      .returning();
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "tax_registration.created",
      entityType: "tax_registration",
      entityId: created?.id,
      after: created,
    });
    return true;
  });
  if (!saved) return { ok: false, message: "This registration no longer exists." };
  revalidate(slug);
  return { ok: true };
}

export async function deleteTaxRegistrationAction(slug: string, id: string): Promise<TaxResult> {
  const ctx = await getAccountingContext(slug);
  const removed = await inOrg(ctx, async (tx) => {
    const [row] = await tx
      .delete(schema.taxRegistrations)
      .where(eq(schema.taxRegistrations.id, id))
      .returning();
    if (row) {
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "tax_registration.deleted",
        entityType: "tax_registration",
        entityId: id,
        before: row,
      });
    }
    return Boolean(row);
  });
  if (!removed) return { ok: false, message: "This registration no longer exists." };
  revalidate(slug);
  return { ok: true };
}
