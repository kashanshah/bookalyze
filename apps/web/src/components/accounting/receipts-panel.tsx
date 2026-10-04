"use client";

import { FileText, ImageIcon, Paperclip, UploadCloud, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  attachToEntryAction,
  detachFromEntryAction,
} from "@/app/o/[slug]/accounting/receipts/actions";
import { Spinner } from "@/components/ui/spinner";
import {
  ATTACHMENT_ACCEPT,
  type AttachmentSummary,
  formatBytes,
  isPreviewableImage,
} from "@/lib/attachments";
import { uploadAttachment } from "@/lib/upload";
import { cn } from "@/lib/utils";

type Uploading = { key: string; name: string; progress: number };

/**
 * Receipts and files for one record. With `entryId`, uploads are attached right away; without
 * one (a transaction that isn't saved yet) the parent receives the files through `onChange` and
 * attaches them when it saves.
 */
export function ReceiptsPanel({
  slug,
  entryId,
  files,
  onChange,
  readOnly = false,
  compact = false,
}: {
  slug: string;
  entryId?: string;
  files: AttachmentSummary[];
  onChange?: (files: AttachmentSummary[]) => void;
  readOnly?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [list, setList] = useState(files);
  const [uploading, setUploading] = useState<Uploading[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();

  // Uploads finish asynchronously, so changes build on the latest list rather than a stale one.
  const latest = useRef(files);
  function update(change: (current: AttachmentSummary[]) => AttachmentSummary[]) {
    latest.current = change(latest.current);
    setList(latest.current);
    onChange?.(latest.current);
  }

  async function addFiles(fileList: FileList | File[]) {
    const picked = Array.from(fileList);
    if (!picked.length) return;
    const added: AttachmentSummary[] = [];
    await Promise.all(
      picked.map(async (file, i) => {
        const key = `${Date.now()}-${i}`;
        setUploading((u) => [...u, { key, name: file.name, progress: 0 }]);
        try {
          const summary = await uploadAttachment(slug, file, (progress) =>
            setUploading((u) => u.map((x) => (x.key === key ? { ...x, progress } : x))),
          );
          added.push(summary);
        } catch (error) {
          toast.error((error as Error).message);
        } finally {
          setUploading((u) => u.filter((x) => x.key !== key));
        }
      }),
    );
    if (!added.length) return;
    if (entryId) {
      const result = await attachToEntryAction(
        slug,
        entryId,
        added.map((a) => a.id),
      );
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      router.refresh();
    }
    update((current) => [...current, ...added]);
    toast.success(added.length === 1 ? "Receipt attached" : `${added.length} files attached`);
  }

  function remove(file: AttachmentSummary) {
    if (!entryId) {
      update((current) => current.filter((f) => f.id !== file.id));
      return;
    }
    startTransition(async () => {
      const result = await detachFromEntryAction(slug, entryId, file.id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      update((current) => current.filter((f) => f.id !== file.id));
      router.refresh();
      toast.success("Removed. The file is back in your receipts inbox.");
    });
  }

  return (
    <div className="grid gap-3">
      <ul
        className={cn(
          "grid gap-3",
          compact ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
        )}
      >
        {list.map((file) => (
          <li key={file.id} className="group zoom-in-95 fade-in-0 relative animate-in duration-200">
            <a
              href={file.url}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-xl border bg-muted/30 transition-shadow hover:shadow-md"
              title={file.fileName}
            >
              <FileThumbnail file={file} />
              <div className="px-2.5 py-2">
                <p className="truncate font-medium text-xs">{file.fileName}</p>
                <p className="text-[11px] text-muted-foreground">{formatBytes(file.sizeBytes)}</p>
              </div>
            </a>
            {readOnly ? null : (
              <button
                type="button"
                onClick={() => remove(file)}
                disabled={pending}
                aria-label={`Remove ${file.fileName}`}
                className="absolute end-1.5 top-1.5 flex size-7 items-center justify-center rounded-full border bg-card/90 text-muted-foreground opacity-100 shadow-sm backdrop-blur transition-opacity hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            )}
          </li>
        ))}
        {uploading.map((u) => (
          <li
            key={u.key}
            className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-center"
          >
            <Spinner className="text-primary" />
            <p className="w-full truncate text-xs">{u.name}</p>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${Math.round(u.progress * 100)}%` }}
              />
            </div>
          </li>
        ))}
        {readOnly ? null : (
          <li>
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
                "flex aspect-[4/3] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed p-3 text-center text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary",
                dragging && "border-primary bg-primary/5 text-primary",
              )}
            >
              {list.length || uploading.length ? (
                <Paperclip className="size-5" />
              ) : (
                <UploadCloud className="size-6" />
              )}
              <span className="font-medium text-xs">
                {list.length ? "Add another" : "Add receipt"}
              </span>
              <span className="hidden text-[11px] sm:block">Drop a photo or PDF</span>
            </button>
          </li>
        )}
      </ul>
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
    </div>
  );
}

/** A file's preview: the image itself, or an icon for PDFs and formats browsers can't show. */
export function FileThumbnail({ file }: { file: AttachmentSummary }) {
  return (
    <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted/40">
      {isPreviewableImage(file.contentType) ? (
        // biome-ignore lint/performance/noImgElement: private, signed URLs can't go through next/image.
        <img
          src={file.url}
          alt={file.fileName}
          className="size-full object-contain"
          loading="lazy"
        />
      ) : file.contentType === "application/pdf" ? (
        <FileText className="size-8 text-muted-foreground" />
      ) : (
        <ImageIcon className="size-8 text-muted-foreground" />
      )}
    </div>
  );
}
