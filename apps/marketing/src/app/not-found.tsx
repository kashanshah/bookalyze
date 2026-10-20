import { ButtonLink } from "@/components/button";

export default function NotFound() {
  return (
    <section className="mx-auto grid max-w-xl justify-items-center gap-4 px-4 py-28 text-center">
      <p className="font-medium text-primary text-sm">Page not found</p>
      <h1 className="font-semibold text-3xl tracking-tight">There's nothing at this address</h1>
      <p className="text-muted-foreground">It may have moved. The home page has everything else.</p>
      <ButtonLink href="/" className="mt-2">
        Go to the home page
      </ButtonLink>
    </section>
  );
}
