"use client";

import { type LedgerEvent, parseInventoryLedger, parseNoonLedger } from "@bookalyze/core";
import { FileUp, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { syncLedgerAction, uploadLedgerAction } from "./actions";

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

type Source = "amazon" | "noon";
const SOURCE_NAMES: Record<Source, string> = { amazon: "Amazon", noon: "Noon" };

/** Brings in the ledger from Amazon's Reports API and Noon's export API. */
export function SyncLedgerButton({ slug, sources }: { slug: string; sources: Source[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const names = sources.map((s) => SOURCE_NAMES[s]).join(" and ");
  return (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await syncLedgerAction(slug);
          if (!result.ok) {
            toast.error("The ledger couldn't be brought in", { description: result.message });
            return;
          }
          const missing = result.countriesMissing?.length
            ? ` Noon's ledger also has ${result.countriesMissing.join(", ")}: add ${result.countriesMissing.length === 1 ? "that country" : "those countries"} on Channels to bring ${result.countriesMissing.length === 1 ? "its" : "their"} movements in.`
            : "";
          const more = result.waiting
            ? `${names} ${sources.length > 1 ? "are" : "is"} still making a report. Press again in a minute for the rest.`
            : "";
          toast.success(
            result.added ? `${plural(result.added, "movement")} brought in` : "Ledger up to date",
            more || missing ? { description: `${more}${missing}`.trim() } : {},
          );
          router.refresh();
        })
      }
    >
      {pending ? <Spinner /> : <RefreshCw />}
      {pending ? `Asking ${names}…` : `Bring in from ${names}`}
    </Button>
  );
}

/**
 * Uploads a ledger file: Amazon's (Seller Central, for one marketplace) or Noon's FBN ledger
 * (every row goes to the Noon country it's for), told apart by its columns.
 */
export function UploadLedgerButton({
  slug,
  channels,
  noon,
}: {
  slug: string;
  /** Amazon marketplaces. */
  channels: { id: string; name: string }[];
  /** Whether the company has a Noon country. */
  noon: boolean;
}) {
  const router = useRouter();
  const formId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{
    name: string;
    events: LedgerEvent[];
    from: string | null;
    noon: boolean;
  } | null>(null);
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [through, setThrough] = useState("");
  const [pending, start] = useTransition();

  const read = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    const text = await f.text();
    if (input.current) input.current.value = "";
    const isNoon = /quantity[_ ]?delta/i.test(text.slice(0, 2000).split(/\r?\n/)[0] ?? "");
    const parsed = isNoon ? parseNoonLedger(text) : parseInventoryLedger(text);
    if (!parsed.ok) return void toast.error(`${f.name}: ${parsed.error}`);
    if (isNoon && !noon) {
      return void toast.error(`${f.name} is Noon's ledger`, {
        description: "Add your Noon country on Commerce → Channels first.",
      });
    }
    if (!isNoon && !channels.length) {
      return void toast.error(`${f.name} is Amazon's ledger`, {
        description: "Connect Amazon on Commerce → Channels first.",
      });
    }
    setFile({ name: f.name, events: parsed.events, from: parsed.from, noon: isNoon });
    setThrough(parsed.to ?? "");
  };

  const submit = () =>
    start(async () => {
      if (!file) return;
      let added = 0;
      const parts = Math.max(1, Math.ceil(file.events.length / 2000));
      for (let i = 0; i < parts; i++) {
        const result = await uploadLedgerAction(slug, {
          channelId: file.noon ? "noon" : channelId,
          events: file.events.slice(i * 2000, (i + 1) * 2000),
          through: i === parts - 1 ? through || null : null,
        });
        if (!result.ok) return void toast.error(result.message);
        added += result.added;
      }
      setFile(null);
      toast.success(added ? `${plural(added, "movement")} added` : "Nothing new in that file", {
        description: added ? undefined : "Every row was already in.",
      });
      router.refresh();
    });

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
        className="hidden"
        aria-label="Inventory ledger file"
        onChange={(e) => read(e.target.files)}
      />
      <Button variant="outline" onClick={() => input.current?.click()}>
        <FileUp />
        Upload a ledger file
      </Button>
      <Dialog open={Boolean(file)} onOpenChange={(open) => !open && setFile(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {file?.name}</DialogTitle>
            <DialogDescription>
              {file ? `${plural(file.events.length, "movement")}` : ""}
              {file?.from ? ` from ${file.from}` : ""}.
              {file?.noon ? " Noon's ledger: each row goes to the Noon country it's for." : ""} Rows
              already brought in are skipped.
            </DialogDescription>
          </DialogHeader>
          <form
            id={formId}
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {!file?.noon && channels.length > 1 ? (
              <Field label="Marketplace" htmlFor={`${formId}-channel`}>
                <Combobox
                  id={`${formId}-channel`}
                  value={channelId}
                  onChange={setChannelId}
                  options={channels.map((c) => ({ value: c.id, label: c.name }))}
                />
              </Field>
            ) : null}
            <Field
              label="The report runs to"
              htmlFor={`${formId}-through`}
              hint={
                file?.noon
                  ? "The last day the file covers. Months up to it can then be posted for your Noon countries."
                  : "The last day you chose in Seller Central. Months up to it can then be posted."
              }
            >
              <Input
                id={`${formId}-through`}
                type="date"
                value={through}
                onChange={(e) => setThrough(e.target.value)}
              />
            </Field>
          </form>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFile(null)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={formId} disabled={pending || (!file?.noon && !channelId)}>
              {pending ? <Spinner /> : <FileUp />}
              Add movements
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
