import Link from "next/link";
import { Brand } from "@/components/brand";

export type LegalSection = { title: string; body: React.ReactNode };

/** A public legal page (privacy policy, terms): plain sections under the logo. */
export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: string;
  sections: readonly LegalSection[];
}) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="w-fit">
            <Brand className="h-7" />
          </Link>
          <Link href="/sign-in" className="text-muted-foreground text-sm hover:text-foreground">
            Sign in
          </Link>
        </div>
      </header>
      <main className="fade-in-0 slide-in-from-bottom-2 mx-auto max-w-3xl animate-in px-4 py-10 duration-500 sm:px-6 sm:py-14">
        <h1 className="font-semibold text-3xl tracking-tight">{title}</h1>
        <p className="mt-2 text-muted-foreground text-sm">Last updated {updated}</p>
        <p className="mt-6 text-base leading-7">{intro}</p>
        <div className="mt-10 grid gap-10">
          {sections.map((s) => (
            <section key={s.title} aria-labelledby={slug(s.title)}>
              <h2 id={slug(s.title)} className="font-semibold text-lg">
                {s.title}
              </h2>
              <div className="mt-3 grid gap-3 text-muted-foreground text-sm leading-6 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_li]:ps-1 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:grid [&_ul]:list-disc [&_ul]:gap-2 [&_ul]:ps-5">
                {s.body}
              </div>
            </section>
          ))}
        </div>
      </main>
      <footer className="border-t">
        <p className="mx-auto flex max-w-3xl flex-wrap gap-x-4 px-4 py-6 text-muted-foreground text-xs sm:px-6">
          <span>© {new Date().getFullYear()} Bookalyze</span>
          <Link href="/terms" className="hover:text-foreground">
            Terms of service
          </Link>
          <Link href="/privacy-policy" className="hover:text-foreground">
            Privacy policy
          </Link>
        </p>
      </footer>
    </div>
  );
}

function slug(title: string) {
  return title.toLowerCase().replace(/[^a-z]+/g, "-");
}
