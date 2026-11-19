import "server-only";
import { z } from "zod";
import { getOrgContext, listUserOrgs } from "@/server/org";
import { defineOperation, keyAllowsOrg } from "../core";
import { company } from "./shared";

export const companyOperations = [
  defineOperation({
    name: "whoami",
    title: "Who am I",
    description:
      "The person this API key acts as and what the key may do: read only or read and write, and whether it reaches all of their companies or only some.",
    access: "read",
    http: "GET /me",
    input: z.object({}),
    run: async ({ principal }) => ({
      user: { id: principal.user.id, name: principal.user.name, email: principal.user.email },
      key: {
        id: principal.key.id,
        access: principal.key.access,
        companies: principal.key.organizationIds === null ? "all" : "selected",
      },
    }),
  }),

  defineOperation({
    name: "list_companies",
    title: "List companies",
    description:
      "Every company (organization) this key can reach, with its slug, your role and its main currency. Start here: every other company tool takes the slug as `company`.",
    access: "read",
    http: "GET /companies",
    input: z.object({}),
    run: async ({ principal }) => {
      const orgs = (await listUserOrgs(principal.user.id)).filter((o) =>
        keyAllowsOrg(principal, o.id),
      );
      return Promise.all(
        orgs.map(async (o) => {
          const ctx = await getOrgContext(o.slug);
          return {
            id: o.id,
            slug: o.slug,
            name: o.name,
            role: o.role,
            baseCurrency: ctx.profile?.baseCurrency ?? null,
            country: ctx.profile?.countryCode ?? null,
          };
        }),
      );
    },
  }),

  defineOperation({
    name: "get_company",
    title: "Get a company",
    description:
      "One company's settings that matter for bookkeeping: main currency, financial year end, the date the books are closed through (nothing on or before it can change), time zone, which modules are on, and which are read-only on its plan.",
    access: "read",
    http: "GET /companies/{company}",
    input: z.object({ company }),
    run: async ({ input }) => {
      const ctx = await getOrgContext(input.company);
      const p = ctx.profile;
      return {
        id: ctx.org.id,
        slug: ctx.org.slug,
        name: ctx.org.name,
        role: ctx.role,
        baseCurrency: p?.baseCurrency ?? null,
        country: p?.countryCode ?? null,
        timezone: p?.timezone ?? null,
        fiscalYearEnd: p ? { month: p.fiscalYearEndMonth, day: p.fiscalYearEndDay } : null,
        firstFiscalYearStart: p?.firstFiscalYearStart ?? null,
        booksLockedThrough: p?.booksLockedThrough ?? null,
        modules: ctx.activeModules,
        readOnlyModules: ctx.billing.readOnly,
      };
    },
  }),
];
