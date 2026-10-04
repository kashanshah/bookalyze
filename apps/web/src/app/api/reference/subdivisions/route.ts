import { subdivisionsOf } from "@bookalyze/core/reference-data";

/** Subdivisions (states, provinces, emirates…) for a country, for dependent dropdowns. */
export function GET(request: Request) {
  const country = new URL(request.url).searchParams.get("country") ?? "";
  if (!/^[A-Z]{2}$/.test(country)) return Response.json([], { status: 400 });
  return Response.json(
    subdivisionsOf(country).map(({ code, name }) => ({ code, name })),
    { headers: { "Cache-Control": "public, max-age=86400, immutable" } },
  );
}
