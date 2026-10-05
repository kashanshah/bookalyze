"use client";

import { DOCUMENT_KINDS, daysBetween } from "@bookalyze/core";
import { ExternalLink, FileText, Pencil, Plus, Trash2, UploadCloud } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { ATTACHMENT_ACCEPT, formatBytes } from "@/lib/attachments";
import { formatDate } from "@/lib/dates";
import { uploadAttachment } from "@/lib/upload";
import { createDocumentAction, deleteDocumentAction, updateDocumentAction } from "../actions";

export type VaultDocument = {
  id: string;
  title: string;
  kind: string;
  expiresOn: string | null;
  fileName: string;
  sizeBytes: number;
  url: string;
};

const kindLabel = (key: string) => DOCUMENT_KINDS.find((k) => k.key === key)?.label ?? "Other";

/** "Expired", "Expires in 12 days" (amber within 30 days), or the date. */
function ExpiryBadge({
  expiresOn,
  today,
  locale,
}: {
  expiresOn: string;
  today: string;
  locale: string;
}) {
  const left = daysBetween(today, expiresOn);
  if (left < 0) return <Badge variant="warning">Expired {formatDate(expiresOn, locale)}</Badge>;
  if (left <= 30) {
    return (
      <Badge variant="warning">
        {left === 0 ? "Expires today" : `Expires in ${left} ${left === 1 ? "day" : "days"}`}
      </Badge>
    );
  }
  return <Badge variant="outline">Expires {formatDate(expiresOn, locale)}</Badge>;
}

export function DocumentVault({
  slug,
  locale,
  today,
  canUpload,
  documents,
}: {
  slug: string;
  locale: string;
  today: string;
  canUpload: boolean;
  documents: VaultDocument[];
}) {
  const [editing, setEditing] = useState<VaultDocument | "new" | null>(null);
  const [key, setKey] = useState(0);
  const open = (value: VaultDocument | "new") => {
    setKey((k) => k + 1);
    setEditing(value);
  };

  return (
    <div className="grid gap-5">
      {documents.length === 0 ? (
        <div className="relative overflow-hidden rounded-2xl border bg-card px-6 py-14 text-center shadow-xs">
          <div className="pointer-events-none absolute inset-0 bg-dots text-primary opacity-[0.06]" />
          <div className="relative mx-auto flex max-w-md flex-col items-center gap-4">
            <span className="zoom-in-75 flex size-14 animate-in items-center justify-center rounded-2xl bg-primary/10 text-primary duration-500">
              <FileText className="size-7" />
            </span>
            <div>
              <h2 className="font-semibold text-lg tracking-tight">Keep the paperwork together</h2>
              <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
                Upload the certificate of incorporation, trade license, tax registrations and annual
                filings, so they're a click away when a bank or marketplace asks.
              </p>
            </div>
            <Button onClick={() => open("new")} disabled={!canUpload}>
              <Plus />
              Add a document
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex justify-end">
            <Button onClick={() => open("new")} disabled={!canUpload}>
              <Plus />
              Add a document
            </Button>
          </div>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-xs">
            {documents.map((doc, i) => (
              <li
                key={doc.id}
                className="fade-in-0 flex animate-in flex-wrap items-center gap-x-4 gap-y-2 fill-mode-both px-4 py-3.5 sm:px-5"
                style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <FileText className="size-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{doc.title}</p>
                  <p className="truncate text-muted-foreground text-xs">
                    {kindLabel(doc.kind)} · {doc.fileName} · {formatBytes(doc.sizeBytes)}
                  </p>
                </div>
                {doc.expiresOn ? (
                  <ExpiryBadge expiresOn={doc.expiresOn} today={today} locale={locale} />
                ) : null}
                <div className="flex shrink-0 items-center gap-1">
                  <Button asChild variant="ghost" size="icon" aria-label={`Open ${doc.title}`}>
                    <a href={doc.url} target="_blank" rel="noreferrer">
                      <ExternalLink />
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => open(doc)}
                    aria-label={`Edit ${doc.title}`}
                  >
                    <Pencil />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => (o ? null : setEditing(null))}>
        <DialogContent>
          {editing ? (
            <DocumentForm
              key={key}
              slug={slug}
              document={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DocumentForm({
  slug,
  document,
  onDone,
}: {
  slug: string;
  document: VaultDocument | null;
  onDone: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(document?.title ?? "");
  const [kind, setKind] = useState(document?.kind ?? "license");
  const [expiresOn, setExpiresOn] = useState(document?.expiresOn ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      if (!document && !file) return void setErrors({ file: "Choose the file to upload." });
      let result: Awaited<ReturnType<typeof updateDocumentAction>>;
      if (document) {
        result = await updateDocumentAction(slug, { id: document.id, title, kind, expiresOn });
      } else {
        try {
          setProgress(0);
          const uploaded = await uploadAttachment(slug, file as File, setProgress);
          result = await createDocumentAction(slug, {
            attachmentId: uploaded.id,
            title,
            kind,
            expiresOn,
          });
        } catch (error) {
          setProgress(null);
          return void toast.error((error as Error).message);
        }
      }
      setProgress(null);
      if (!result.ok) {
        setErrors(result.errors ?? {});
        if (result.message) toast.error(result.message);
        return;
      }
      toast.success(document ? "Document saved" : "Document added", {
        description: expiresOn ? "Its expiry is on the compliance calendar." : undefined,
      });
      onDone();
    });

  const remove = () =>
    start(async () => {
      if (!document) return;
      if (!confirmDelete) return setConfirmDelete(true);
      const result = await deleteDocumentAction(slug, document.id);
      if (!result.ok) return void toast.error(result.message);
      toast.success("Document deleted");
      onDone();
    });

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{document ? document.title : "Add a document"}</DialogTitle>
        <DialogDescription>
          {document
            ? `${document.fileName} · ${formatBytes(document.sizeBytes)}`
            : "A PDF or photo of the document."}
        </DialogDescription>
      </DialogHeader>
      {document ? null : (
        <Field label="File" htmlFor="document-file" error={errors.file}>
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex items-center gap-3 rounded-xl border-2 border-dashed px-4 py-4 text-start transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <UploadCloud className="size-5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate text-sm">
              {file ? file.name : "Choose a PDF or photo"}
            </span>
          </button>
          <input
            ref={input}
            id="document-file"
            type="file"
            accept={ATTACHMENT_ACCEPT}
            className="sr-only"
            aria-label="Document file"
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              setFile(picked);
              if (picked && !title) setTitle(picked.name.replace(/\.[^.]+$/, ""));
            }}
          />
        </Field>
      )}
      <Field label="Name" htmlFor="document-title" error={errors.title}>
        <Input
          id="document-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Trade license 2026"
        />
      </Field>
      <Field label="What is it?" htmlFor="document-kind" error={errors.kind}>
        <Combobox
          id="document-kind"
          value={kind}
          onChange={setKind}
          options={DOCUMENT_KINDS.map((k) => ({ value: k.key, label: k.label }))}
        />
      </Field>
      <Field
        label="Expires on (optional)"
        htmlFor="document-expires"
        error={errors.expiresOn}
        hint="You'll get a reminder 30 days, 7 days and 1 day before."
      >
        <Input
          id="document-expires"
          type="date"
          value={expiresOn}
          onChange={(e) => setExpiresOn(e.target.value)}
        />
      </Field>
      {progress !== null ? (
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      ) : null}
      <DialogFooter className="sm:justify-between">
        {document ? (
          <Button
            type="button"
            variant={confirmDelete ? "destructive" : "ghost"}
            onClick={remove}
            disabled={pending}
          >
            <Trash2 />
            {confirmDelete ? "Click again to delete" : "Delete"}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            {document ? "Save" : "Add document"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
