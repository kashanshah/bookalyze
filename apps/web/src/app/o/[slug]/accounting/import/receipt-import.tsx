"use client";

import { CheckCircle2, Inbox, Link2, Receipt, SkipForward } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_BYTES } from "@/lib/attachments";
import { uploadAttachment } from "@/lib/upload";
import { attachToEntryAction } from "../receipts/actions";
import { matchReceiptsAction, type ReceiptMatch } from "./actions";

type Planned = ReceiptMatch & { file: File };
const PARALLEL = 3;

/**
 * Receipt files exported from other software, named by date and merchant. Each is attached to the
 * transaction it belongs to; files that can't be placed go to the Receipts inbox.
 */
export function ReceiptImport({ slug }: { slug: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [planned, setPlanned] = useState<Planned[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [finished, setFinished] = useState<{
    attached: number;
    inbox: number;
    failed: number;
  } | null>(null);

  async function choose(files: FileList | null) {
    const picked = Array.from(files ?? []);
    if (!picked.length) return;
    setFinished(null);
    const tooBig = picked.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (tooBig.length) toast.error(`${tooBig.length} files are over 20 MB and were left out.`);
    const usable = picked.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
    setChecking(true);
    try {
      const result = await matchReceiptsAction(
        slug,
        usable.map((f) => f.name),
      );
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setPlanned(usable.map((file, i) => ({ ...(result.matches[i] as ReceiptMatch), file })));
    } finally {
      setChecking(false);
    }
  }

  async function upload() {
    if (!planned) return;
    const queue = planned.filter((p) => !p.alreadyThere);
    let done = 0;
    let attached = 0;
    let inbox = 0;
    let failed = 0;
    setProgress({ done: 0, total: queue.length });
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        try {
          const summary = await uploadAttachment(slug, item.file);
          if (item.entryId) {
            const linked = await attachToEntryAction(slug, item.entryId, [summary.id]);
            if (linked.ok) attached++;
            else inbox++;
          } else inbox++;
        } catch {
          failed++;
        }
        done++;
        setProgress((p) => (p ? { ...p, done } : p));
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    setProgress(null);
    setPlanned(null);
    setFinished({ attached, inbox, failed });
    toast.success(`${attached + inbox} receipts uploaded`);
    router.refresh();
  }

  const toAttach = planned?.filter((p) => p.entryId && !p.alreadyThere) ?? [];
  const toInbox = planned?.filter((p) => !p.entryId && !p.alreadyThere) ?? [];
  const skipped = planned?.filter((p) => p.alreadyThere) ?? [];

  return (
    <section className="grid gap-4 rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
      <div className="flex gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Receipt className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold tracking-tight">Receipts from your old software</h2>
          <p className="mt-1 max-w-2xl text-muted-foreground text-sm leading-relaxed">
            Import your transactions first, then add the receipt files (Wave names them like
            2025-02-01-Sizzler_Kabab.jpg). Each is attached to the transaction with that date and
            name. Any we can't place go to your Receipts inbox to attach by hand.
          </p>
        </div>
      </div>

      {progress ? (
        <div className="grid gap-2">
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Receipt upload progress"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{
                width: `${Math.max(4, (progress.done / Math.max(progress.total, 1)) * 100)}%`,
              }}
            />
          </div>
          <p className="tabular text-muted-foreground text-sm">
            {progress.done.toLocaleString()} of {progress.total.toLocaleString()} files uploaded.
            Keep this page open.
          </p>
        </div>
      ) : planned ? (
        <div className="fade-in-0 grid animate-in gap-4">
          <dl className="grid gap-2 sm:grid-cols-3">
            {[
              { icon: Link2, label: "Attach to transactions", value: toAttach.length },
              { icon: Inbox, label: "Go to the inbox", value: toInbox.length },
              { icon: SkipForward, label: "Already uploaded", value: skipped.length },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
                <s.icon className="size-4 text-muted-foreground" />
                <div>
                  <dt className="text-muted-foreground text-xs">{s.label}</dt>
                  <dd className="tabular font-semibold">{s.value.toLocaleString()}</dd>
                </div>
              </div>
            ))}
          </dl>
          {toAttach.length ? (
            <ul className="grid max-h-64 gap-1 overflow-y-auto rounded-xl border p-2 text-sm">
              {toAttach.slice(0, 300).map((p) => (
                <li key={p.fileName} className="flex min-w-0 items-baseline gap-2 px-1 py-0.5">
                  <span className="min-w-0 shrink truncate">{p.fileName}</span>
                  <span className="shrink-0 text-muted-foreground">→</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {p.entryLabel}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={upload}
              disabled={toAttach.length + toInbox.length === 0}
            >
              Upload {(toAttach.length + toInbox.length).toLocaleString()} receipts
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPlanned(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => input.current?.click()}
            disabled={checking}
          >
            {checking ? <Spinner /> : <Receipt />}
            Choose receipt files
          </Button>
          {finished ? (
            <span className="fade-in-0 inline-flex animate-in items-center gap-1.5 text-sm">
              <CheckCircle2 className="size-4 text-success" />
              {finished.attached.toLocaleString()} attached, {finished.inbox.toLocaleString()} in
              your inbox
              {finished.failed ? `, ${finished.failed} couldn't be uploaded` : ""}.
            </span>
          ) : null}
        </div>
      )}
      <input
        ref={input}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        aria-label="Receipt files to import"
        onChange={(e) => {
          choose(e.target.files);
          e.target.value = "";
        }}
      />
    </section>
  );
}
