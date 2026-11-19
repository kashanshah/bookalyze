import { Brand } from "@/components/brand";

/** The sign-in-with-Bookalyze screens: just the brand and the question, nothing to wander off to. */
export default function OAuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-sidebar">
      <header className="border-b bg-background/85">
        <div className="mx-auto flex h-14 max-w-xl items-center px-4">
          <Brand className="h-7" />
        </div>
      </header>
      <main className="fade-in-0 slide-in-from-bottom-1 mx-auto grid max-w-xl animate-in gap-6 px-4 py-10 duration-300">
        {children}
      </main>
    </div>
  );
}
