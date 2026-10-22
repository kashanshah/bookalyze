/**
 * Bookalyze's password rules (docs/SECURITY.md §2), shared by every form that sets a password and
 * by the server, which enforces them whatever the form says. They follow NIST SP 800-63B: length
 * matters, composition rules ("one capital, one symbol") and forced changes don't. So: at least
 * 12 characters, at most 128, not a common or easily guessed password, nothing from the person's
 * own name or email, and (checked on the server only) not in a known data breach.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordRule = "length" | "common" | "personal";

export const PASSWORD_RULES: readonly { rule: PasswordRule; label: string }[] = [
  { rule: "length", label: `At least ${PASSWORD_MIN_LENGTH} characters` },
  { rule: "common", label: "Not a common or easy-to-guess password" },
  { rule: "personal", label: "Not your name or email address" },
];

/** What the server says for each broken rule, and for a password found in a data breach. */
export const PASSWORD_MESSAGES: Record<PasswordRule | "too_long" | "breached", string> = {
  length: `Use at least ${PASSWORD_MIN_LENGTH} characters. A few words together is easy to remember and hard to guess.`,
  too_long: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
  common: "That password is too common or easy to guess. Try a few unrelated words together.",
  personal: "Don't use your name, your email address or Bookalyze in your password.",
  breached:
    "That password has appeared in a data breach elsewhere, so attackers try it first. Choose a different one.",
};

/**
 * Passwords (and their stems, lower-cased with spaces and symbols removed) people pick most:
 * from public breach top-lists. The breach check on the server catches the long tail.
 */
const COMMON = new Set([
  "password",
  "passw0rd",
  "passwort",
  "motdepasse",
  "contrasena",
  "letmein",
  "welcome",
  "welcome1",
  "admin",
  "administrator",
  "qwerty",
  "qwertyuiop",
  "qwertyuiopasdfghjkl",
  "asdfghjkl",
  "asdfghjkl123",
  "zxcvbnm",
  "1q2w3e4r5t6y",
  "1qaz2wsx3edc",
  "qazwsxedc",
  "iloveyou",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "basketball",
  "superman",
  "batman",
  "dragon",
  "monkey",
  "shadow",
  "master",
  "michael",
  "jennifer",
  "trustno1",
  "starwars",
  "pokemon",
  "whatever",
  "freedom",
  "computer",
  "internet",
  "secret",
  "changeme",
  "default",
  "login",
  "abc123",
  "abcdefghijkl",
  "abcdefghijklmnop",
  "abcd1234",
  "aa123456",
  "a1b2c3d4e5f6",
  "pakistan",
  "canada",
  "toronto",
  "dubai",
  "amazon",
  "amazonseller",
  "seller",
  "business",
  "company",
  "accounting",
  "money",
  "summer",
  "winter",
  "spring",
  "autumn",
  "hello",
  "helloworld",
  "loveyou",
  "lovely",
  "family",
  "google",
  "facebook",
  "microsoft",
  "apple",
  "samsung",
  "charlie",
  "thomas",
  "jordan",
  "hunter",
  "killer",
  "soccer",
  "cricket",
  "chocolate",
  "flower",
  "tigger",
  "ashley",
  "daniel",
  "matthew",
  "robert",
  "andrew",
  "joshua",
  "zaq12wsx",
  "mypassword",
  "yourpassword",
  "newpassword",
  "strongpassword",
  "securepassword",
  "verysecure",
  "temppassword",
  "test",
  "testing",
  "testtest",
  "guest",
  "user",
  "username",
  "root",
  "access",
  "mustang",
  "ferrari",
  "liverpool",
  "chelsea",
  "arsenal",
  "barcelona",
  "realmadrid",
  "manchester",
  "bismillah",
  "allah",
  "jesus",
  "blessed",
]);

/** Lower-cased, letters and digits only. */
const plain = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");

/** `plain`, with common digit-for-letter swaps undone ("p4ssw0rd" → "password"). */
const unleet = (value: string) =>
  value
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t");

const SEQUENCES = [
  "abcdefghijklmnopqrstuvwxyz",
  "01234567890123456789",
  "qwertyuiopasdfghjklzxcvbnm",
  "1qaz2wsx3edc4rfv5tgb6yhn",
];

/** Whether a password is guessable: a common one (with digits or symbols added), a run of one
 * character or of a keyboard or alphabet sequence, or a short piece repeated. */
function isGuessable(password: string): boolean {
  const raw = plain(password);
  if (!raw) return true;
  // One character, or a short piece repeated ("abcabcabcabc", "121212121212").
  if (/^(.{1,4})\1+$/.test(raw)) return true;
  // An alphabet, digit or keyboard run, forwards or backwards.
  for (const seq of SEQUENCES) {
    if (seq.includes(raw) || [...seq].reverse().join("").includes(raw)) return true;
  }
  // A common password, with digits or symbols around it ("Password2026!", "!!qwerty123"), or
  // with letters swapped for digits ("P4ssw0rd").
  const core = raw.replace(/^[0-9]+|[0-9]+$/g, "");
  if ([raw, core, unleet(raw), unleet(core)].some((w) => COMMON.has(w))) return true;
  // Only digits: dates and phone numbers are guessed first.
  if (/^[0-9]+$/.test(raw)) return true;
  return false;
}

/** Parts of a person's name and email that shouldn't be in their password (4 letters or more). */
function personalParts(input: { email?: string | null; name?: string | null }): string[] {
  const parts = new Set<string>(["bookalyze"]);
  const local = input.email?.split("@")[0] ?? "";
  for (const piece of [local, ...local.split(/[^a-zA-Z0-9]+/)]) {
    const s = plain(piece);
    if (s.length >= 4) parts.add(s);
  }
  for (const piece of (input.name ?? "").split(/\s+/)) {
    const s = plain(piece);
    if (s.length >= 4) parts.add(s);
  }
  return [...parts];
}

/**
 * The rules a password breaks, in the order the forms list them (an empty list: it's fine, as
 * far as can be told without the breach check). Length counts characters, not bytes.
 */
export function passwordProblems(
  password: string,
  context: { email?: string | null; name?: string | null } = {},
): (PasswordRule | "too_long")[] {
  const problems: (PasswordRule | "too_long")[] = [];
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) problems.push("length");
  if (length > PASSWORD_MAX_LENGTH) problems.push("too_long");
  if (password && isGuessable(password)) problems.push("common");
  const raw = plain(password);
  if (
    password &&
    personalParts(context).some((part) => raw.includes(part) || unleet(raw).includes(part))
  ) {
    problems.push("personal");
  }
  return problems;
}

/** The first problem's message, or null when the password meets the rules. */
export function passwordError(
  password: string,
  context: { email?: string | null; name?: string | null } = {},
): string | null {
  const [first] = passwordProblems(password, context);
  return first ? PASSWORD_MESSAGES[first] : null;
}
