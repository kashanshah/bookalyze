import "server-only";
import {
  type AmountFix,
  addDaysIso,
  matchStatementAmounts,
  type StatementLine,
} from "@bookalyze/core";
import {
  connectionSecretContext,
  fxRateOn,
  getDb,
  misrecordedLines,
  openSecret,
  schema,
} from "@bookalyze/db";
import { and, eq } from "drizzle-orm";
import { type AccountingContext, inOrg } from "./accounting";
import { ensureRates } from "./banking";
import { env } from "./env";
import { WiseError, wiseStatement } from "./wise";

/**
 * "Correct from Wise": reads the account's Wise statement over the misrecorded lines' dates
 * (nothing is posted) and matches each line to its real transaction. See core
 * `matchStatementAmounts` and db `applyAmountCorrections`.
 */

const DAY = 86_400_000;
const WINDOW_DAYS = 180;

export type AmountFixPreview = {
  account: { id: string; name: string; currency: string };
  feedId: string;
  lines: {
    lineId: string;
    entryNumber: number;
    date: string;
    /** As recorded now, in the main currency. */
    recorded: string;
    text: string;
    fix: AmountFix;
  }[];
};

export class AmountFixError extends Error {}

export async function previewAmountFix(
  ctx: AccountingContext,
  accountId: string,
): Promise<AmountFixPreview> {
  const setup = await inOrg(ctx, async (tx) => {
    const [account] = await tx
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId));
    const [feed] = await tx
      .select({ feed: schema.bankFeeds, connection: schema.connections })
      .from(schema.bankFeeds)
      .innerJoin(schema.connections, eq(schema.connections.id, schema.bankFeeds.connectionId))
      .where(
        and(eq(schema.bankFeeds.accountId, accountId), eq(schema.connections.provider, "wise")),
      )
      .limit(1);
    return { account, feed, lines: await misrecordedLines(tx, accountId) };
  });
  const { account, feed, lines } = setup;
  if (!account?.currency) throw new AmountFixError("This account doesn't hold a foreign currency.");
  const currency = account.currency;
  if (!feed?.connection.secret || feed.connection.status === "disconnected") {
    throw new AmountFixError(
      `Connect Wise and link its ${currency} balance to ${account.name} first (Banking → Bank accounts).`,
    );
  }
  const base = {
    account: { id: account.id, name: account.name, currency },
    feedId: feed.feed.id,
  };
  if (!lines.length) return { ...base, lines: [] };

  // The Wise statement around those dates, read in windows Wise allows.
  const first = lines[0]?.date as string;
  const last = lines.at(-1)?.date as string;
  const statement: StatementLine[] = [];
  try {
    const token = openSecret(
      feed.connection.secret,
      connectionSecretContext(ctx.org.id, feed.connection.id),
      env().APP_ENCRYPTION_KEY,
    );
    let start = new Date(`${addDaysIso(first, -6)}T00:00:00Z`).getTime();
    const end = new Date(`${addDaysIso(last, 6)}T00:00:00Z`).getTime();
    while (start < end) {
      const stop = Math.min(start + WINDOW_DAYS * DAY, end);
      const part = await wiseStatement(token, {
        profileId: Number(feed.connection.settings.profileId),
        balanceId: Number(feed.feed.externalId),
        currency,
        start: new Date(start),
        end: new Date(stop),
        timeZone: ctx.profile.timezone,
      });
      for (const t of part) {
        statement.push({
          externalId: t.externalId,
          date: t.date,
          amount: t.amount,
          text: [t.description, t.counterparty, t.reference].filter(Boolean).join(" "),
        });
      }
      start = stop;
    }
  } catch (error) {
    if (error instanceof WiseError) throw new AmountFixError(error.message);
    throw error;
  }

  // Exchange rates only judge which statement line fits; their amounts are what's used.
  await ensureRates(ctx.profile.baseCurrency, [
    { currency, date: first },
    { currency, date: last },
  ]);
  const rates = new Map<string, string | null>();
  for (const date of new Set(lines.map((l) => l.date))) {
    const quote = await fxRateOn(getDb(), {
      base: ctx.profile.baseCurrency,
      quote: currency,
      date,
    });
    rates.set(date, quote?.rate ?? null);
  }
  const unique = [...new Map(statement.map((s) => [s.externalId, s])).values()];
  const fixes = matchStatementAmounts(
    lines.map((l) => ({
      lineId: l.lineId,
      date: l.date,
      baseAmount: l.baseAmount,
      text: [l.memo, l.description].filter(Boolean).join(" "),
    })),
    unique,
    (date) => rates.get(date) ?? null,
    currency,
  );
  const fixOf = new Map(fixes.map((f) => [f.lineId, f]));
  return {
    ...base,
    lines: lines.map((l) => ({
      lineId: l.lineId,
      entryNumber: l.entryNumber,
      date: l.date,
      recorded: l.baseAmount,
      text: [l.memo, l.description].filter(Boolean).join(" · "),
      fix: fixOf.get(l.lineId) as AmountFix,
    })),
  };
}
