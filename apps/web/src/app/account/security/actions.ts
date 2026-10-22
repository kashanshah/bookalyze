"use server";

import { PASSWORD_MAX_LENGTH } from "@bookalyze/core";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { getAuth } from "@/server/auth";
import { logWarn } from "@/server/log";
import { passwordRefusal } from "@/server/password-policy";
import { requireSession } from "@/server/session";

export type SetPasswordState = { error?: string; done?: boolean };

const schema = z
  .object({
    password: z.string().max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords don't match", path: ["confirm"] });

/**
 * Adds an email + password login to an account created with Google, so the user can sign in
 * either way. Better Auth only allows this when the account has no password yet.
 */
export async function setPasswordAction(
  _prev: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const session = await requireSession("/account/security");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid password" };
  // The rules (length, common, personal, breached), as for every other way to set a password.
  const refusal = await passwordRefusal(parsed.data.password, {
    email: session.user.email,
    name: session.user.name,
  });
  if (refusal) return { error: refusal };
  try {
    await getAuth().api.setPassword({
      body: { newPassword: parsed.data.password },
      headers: await headers(),
    });
  } catch (error) {
    logWarn("account.set_password_failed", {}, error);
    return { error: error instanceof Error ? error.message : "Could not set the password." };
  }
  revalidatePath("/account/security");
  return { done: true };
}
