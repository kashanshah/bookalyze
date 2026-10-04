/** Human-friendly labels for technical identifiers. Safe on server and client. */

/** "Toronto · Eastern Time (GMT-5)" instead of "America/Toronto". */
export function timezoneLabel(tz: string): string {
  const city = (tz.split("/").pop() ?? tz).replaceAll("_", " ");
  try {
    const part = (style: "longGeneric" | "shortOffset") =>
      new Intl.DateTimeFormat("en", { timeZone: tz, timeZoneName: style })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value;
    const name = part("longGeneric");
    const offset = part("shortOffset");
    return name && !name.startsWith("GMT")
      ? `${city} · ${name} (${offset})`
      : `${city} (${offset})`;
  } catch {
    return city;
  }
}

/** "English (Canada)" instead of "en-CA". */
export function localeLabel(locale: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(locale) ?? locale;
  } catch {
    return locale;
  }
}
