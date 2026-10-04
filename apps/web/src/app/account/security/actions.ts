"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { getAuth } from "@/server/auth";
import { requireSession } from "@/server/session";

export type SetPasswordState = { error?: string; done?: boolean };

const schema = z
  .object({
    password: z.string().min(10, "Use at least 10 characters").max(128),
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
  await requireSession("/account/security");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid password" };
  try {
    await getAuth().api.setPassword({
      body: { newPassword: parsed.data.password },
      headers: await headers(),
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not set the password." };
  }
  revalidatePath("/account/security");
  return { done: true };
}
