"use client";

import { formatMoney } from "@bookalyze/core";
import { Inbox, Link2, Paperclip, Search, Trash2, UploadCloud, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { FileThumbnail } from "@/components/accounting/receipts-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ATTACHMENT_ACCEPT, type AttachmentSummary, formatBytes } from "@/lib/attachments";
import { formatDate } from "@/lib/dates";
import { uploadAttachment } from "@/lib/upload";
import { cn } from "@/lib/utils";
import {
  attachToEntryAction,
  deleteAttachmentAction,
  deleteAttachmentsAction,
  findTransactionsAction,
  type MatchCandidate,
} from "./actions";

/** Files per delete request (the server takes up to 200). */
const DELETE_BATCH = 200;

export function ReceiptsInbox({
  slug,
  locale,
  canUpload,
  files: initial,
}: {
  slug: string;
  locale: string;
  canUpload: boolean;
  files: AttachmentSummary[];
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState(initial);
  const [uploading, setUploading] = useState<{ key: string; name: string; progress: number }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [matching, setMatching] = useState<AttachmentSummary | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [deleting, startDelete] = useTransition();

  useEffect(() => setFiles(initial), [initial]);
  // Forget ticks on files that are gone (attached, deleted, refreshed away).
  useEffect(
    () => setPicked((p) => new Set([...p].filter((id) => files.some((f) => f.id === id)))),
    [files],
  );

  const togglePicked = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allPicked = files.length > 0 && files.every((f) => picked.has(f.id));

  const deletePicked = () =>
    startDelete(async () => {
      // In batches, so a whole imported inbox can go at once.
      const ids = [...picked];
      let deleted = 0;
      let kept = 0;
      const done = new Set<string>();
      for (let i = 0; i < ids.length; i += DELETE_BATCH) {
        const batch = ids.slice(i, i + DELETE_BATCH);
        const result = await deleteAttachmentsAction(slug, batch);
        if (!result.ok) {
          toast.error(result.message, {
            description: deleted ? `${deleted} were deleted before this.` : undefined,
          });
          break;
        }
        deleted += result.data.deleted;
        kept += result.data.kept;
        for (const id of batch) done.add(id);
      }
      if (!done.size) return;
      const label = `${deleted} ${deleted === 1 ? "receipt" : "receipts"} deleted`;
      if (kept) {
        toast.warning(deleted ? label : "Nothing deleted", {
          description: `${kept} ${kept === 1 ? "is" : "are"} attached to a transaction. Remove ${kept === 1 ? "it" : "them"} from there first.`,
        });
      } else toast.success(label);
      setFiles((f) => f.filter((x) => !done.has(x.id)));
      setPicked((p) => new Set([...p].filter((id) => !done.has(id))));
      setConfirming(false);
      router.refresh();
    });

  async function addFiles(list: FileList | File[]) {
    const picked = Array.from(list);
    await Promise.all(
      picked.map(async (file, i) => {
        const key = `${Date.now()}-${i}`;
        setUploading((u) => [...u, { key, name: file.name, progress: 0 }]);
        try {
          const summary = await uploadAttachment(slug, file, (progress) =>
            setUploading((u) => u.map((x) => (x.key === key ? { ...x, progress } : x))),
          );
          setFiles((f) => [summary, ...f]);
          toast.success(`${file.name} added to your inbox`);
        } catch (error) {
          toast.error((error as Error).message);
        } finally {
          setUploading((u) => u.filter((x) => x.key !== key));
        }
      }),
    );
    router.refresh();
  }

  return (
    <div className="grid gap-5">
      {canUpload ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void addFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed bg-card px-6 py-10 text-center transition-colors hover:border-primary/40 hover:bg-primary/5",
            dragging && "border-primary bg-primary/5",
          )}
        >
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <UploadCloud className="size-6" />
          </span>
          <span className="font-medium">Upload receipts</span>
          <span className="text-muted-foreground text-sm">
            Drop photos or PDFs here, or tap to choose. On a phone you can take a picture.
          </span>
        </button>
      ) : null}
      <input
        ref={input}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        className="sr-only"
        aria-label="Upload receipts"
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {files.length === 0 && uploading.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-10 text-center">
          <Inbox className="size-6 text-muted-foreground" />
          <p className="font-medium">Your inbox is empty</p>
          <p className="text-muted-foreground text-sm">
            Every receipt you upload is attached or waiting here.
          </p>
        </div>
      ) : (
        <>
          {files.length ? (
            <div className="flex items-center gap-3 text-sm">
              <Checkbox
                checked={allPicked}
                onChange={() => setPicked(allPicked ? new Set() : new Set(files.map((f) => f.id)))}
                label={allPicked ? "Clear selection" : "Select all receipts"}
              />
              <span className="text-muted-foreground">
                {picked.size
                  ? `${picked.size} of ${files.length} selected`
                  : `Select all (${files.length})`}
              </span>
            </div>
          ) : null}
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {uploading.map((u) => (
              <li
                key={u.key}
                className="flex aspect-[4/5] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-4 text-center"
              >
                <Spinner className="text-primary" />
                <p className="w-full truncate text-xs">{u.name}</p>
                <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${Math.round(u.progress * 100)}%` }}
                  />
                </div>
              </li>
            ))}
            {files.map((file) => (
              <InboxCard
                key={file.id}
                slug={slug}
                file={file}
                locale={locale}
                picked={picked.has(file.id)}
                onPick={() => togglePicked(file.id)}
                onMatch={() => setMatching(file)}
                onDeleted={() => setFiles((f) => f.filter((x) => x.id !== file.id))}
              />
            ))}
          </ul>
        </>
      )}

      {picked.size ? (
        <div className="fade-in-0 slide-in-from-bottom-4 fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-md animate-in items-center gap-3 rounded-2xl border bg-card px-4 py-3 shadow-lg sm:px-5">
          <p className="min-w-0 flex-1 font-medium text-sm">{picked.size} selected</p>
          <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
            <Trash2 />
            Delete {picked.size}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setPicked(new Set())}
            aria-label="Clear selection"
          >
            <X />
          </Button>
        </div>
      ) : null}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {picked.size} {picked.size === 1 ? "receipt" : "receipts"}?
            </DialogTitle>
            <DialogDescription>
              The files are removed for good. Receipts already attached to a transaction aren't in
              this inbox, so they stay.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
              Keep them
            </Button>
            <Button type="button" variant="destructive" onClick={deletePicked} disabled={deleting}>
              {deleting ? <Spinner /> : <Trash2 />}
              Delete {picked.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MatchDialog
        slug={slug}
        locale={locale}
        file={matching}
        onClose={() => setMatching(null)}
        onMatched={(id) => {
          setFiles((f) => f.filter((x) => x.id !== id));
          setMatching(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function InboxCard({
  slug,
  file,
  locale,
  picked,
  onPick,
  onMatch,
  onDeleted,
}: {
  slug: string;
  file: AttachmentSummary;
  locale: string;
  picked: boolean;
  onPick: () => void;
  onMatch: () => void;
  onDeleted: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <li
      className={cn(
        "zoom-in-95 fade-in-0 relative flex animate-in flex-col overflow-hidden rounded-2xl border bg-card shadow-xs duration-200",
        picked && "border-primary ring-2 ring-primary/30",
      )}
    >
      <Checkbox
        checked={picked}
        onChange={onPick}
        label={`Select ${file.fileName}`}
        className="absolute start-2.5 top-2.5 z-10 shadow-xs"
      />
      <a href={file.url} target="_blank" rel="noreferrer" title={`Open ${file.fileName}`}>
        <FileThumbnail file={file} />
      </a>
      <div className="grid gap-0.5 px-3 pt-2.5">
        <p className="truncate font-medium text-sm">{file.fileName}</p>
        <p className="text-muted-foreground text-xs">
          {formatDate(file.createdAt.slice(0, 10), locale)} · {formatBytes(file.sizeBytes)}
        </p>
      </div>
      <div className="mt-auto flex items-center gap-1 p-2">
        <Button size="sm" className="flex-1" onClick={onMatch}>
          <Link2 />
          Attach
        </Button>
        <Button
          size="sm"
          variant={armed ? "destructive" : "ghost"}
          disabled={pending}
          aria-label={armed ? `Confirm delete ${file.fileName}` : `Delete ${file.fileName}`}
          onClick={() => {
            if (!armed) return setArmed(true);
            startTransition(async () => {
              const result = await deleteAttachmentAction(slug, file.id);
              if (result.ok) {
                toast.success("Receipt deleted");
                onDeleted();
              } else toast.error(result.message);
            });
          }}
        >
          {pending ? <Spinner /> : <Trash2 />}
          {armed ? "Delete?" : null}
        </Button>
      </div>
    </li>
  );
}

function MatchDialog({
  slug,
  locale,
  file,
  onClose,
  onMatched,
}: {
  slug: string;
  locale: string;
  file: AttachmentSummary | null;
  onClose: () => void;
  onMatched: (attachmentId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<MatchCandidate[] | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    const t = setTimeout(
      () =>
        findTransactionsAction(slug, search).then((rows) => {
          if (!cancelled) setResults(rows);
        }),
      search ? 300 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [file, search, slug]);

  return (
    <Dialog
      open={file !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setSearch("");
          setResults(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Attach to a transaction</DialogTitle>
          <DialogDescription>
            Choose the transaction{" "}
            {file ? <span className="font-medium text-foreground">{file.fileName}</span> : null}{" "}
            belongs to.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search descriptions"
            className="ps-9"
            aria-label="Search transactions"
          />
        </div>
        <div className="-mx-2 max-h-[50dvh] overflow-y-auto">
          {results === null ? (
            <div className="flex h-24 items-center justify-center">
              <Spinner className="text-muted-foreground" />
            </div>
          ) : results.length === 0 ? (
            <p className="px-2 py-8 text-center text-muted-foreground text-sm">
              No transactions found. Add the transaction first, then attach the receipt.
            </p>
          ) : (
            <ul className="grid gap-1">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        if (!file) return;
                        const result = await attachToEntryAction(slug, r.id, [file.id]);
                        if (result.ok) {
                          toast.success(`Attached to ${r.memo || r.number}`);
                          onMatched(file.id);
                        } else toast.error(result.message);
                      })
                    }
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-start transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium text-sm">{r.memo || r.number}</span>
                        {r.attachments ? (
                          <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                        ) : null}
                      </span>
                      <span className="block text-muted-foreground text-xs">
                        {formatDate(r.date, locale)} · {r.number}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "tabular whitespace-nowrap font-medium text-sm",
                        r.kind === "deposit" && "text-success",
                      )}
                    >
                      {r.kind === "deposit" ? "+" : r.kind === "withdrawal" ? "−" : ""}
                      {formatMoney(r.amount, r.currency, locale)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
