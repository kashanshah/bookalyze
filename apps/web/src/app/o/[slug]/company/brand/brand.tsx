"use client";

import {
  BRAND_FOOTER_MAX,
  BRAND_IMAGE_TYPES,
  DEFAULT_ACCENT,
  DEFAULT_LETTERHEAD_MARGINS,
  LETTERHEAD_MARGIN_MAX,
  LETTERHEAD_TYPES,
  type LetterheadPages,
  normalizeHexColor,
} from "@bookalyze/core";
import { FileText, ImageIcon, Palette, RefreshCw, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { uploadAttachment } from "@/lib/upload";
import type { BrandInput } from "@/lib/validation/brand";
import { saveBrandAction } from "../actions";

type BrandFile = { id: string; fileName: string; contentType: string; url: string };

export type BrandView = {
  slug: string;
  canEdit: boolean;
  legalName: string;
  accentColor: string | null;
  footer: string | null;
  nameArabic: string | null;
  logo: BrandFile | null;
  letterhead: BrandFile | null;
  letterheadTop: number;
  letterheadBottom: number;
  letterheadPages: LetterheadPages;
};

/** A few accents that print well; any colour can be typed. */
const SWATCHES = ["#1F2937", "#1F6FEB", "#0F766E", "#B45309", "#9F1239", "#6D28D9", "#111111"];

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Palette;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
      <div className="flex items-start gap-3 border-b px-5 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{title}</h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
      </div>
      <div className="grid gap-5 px-5 py-5">{children}</div>
    </section>
  );
}

/** Picks a file, uploads it, and reports the stored attachment. */
function FilePicker({
  slug,
  accept,
  current,
  disabled,
  label,
  onChange,
}: {
  slug: string;
  accept: readonly string[];
  current: BrandFile | null;
  disabled: boolean;
  label: string;
  onChange: (file: BrandFile | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!accept.includes(file.type)) {
      toast.error(`${file.name} can't be used here.`);
      return;
    }
    setProgress(0);
    try {
      const uploaded = await uploadAttachment(slug, file, setProgress);
      onChange({
        id: uploaded.id,
        fileName: uploaded.fileName,
        contentType: uploaded.contentType,
        url: uploaded.url,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The file couldn't be uploaded.");
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        ref={input}
        type="file"
        accept={accept.join(",")}
        className="sr-only"
        aria-label={label}
        onChange={(event) => pick(event.target.files?.[0])}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || progress !== null}
        onClick={() => input.current?.click()}
      >
        {progress !== null ? <Spinner /> : <Upload />}
        {progress !== null
          ? `Uploading ${Math.round(progress * 100)}%`
          : current
            ? "Replace"
            : "Upload"}
      </Button>
      {current ? (
        <>
          <a
            href={current.url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 max-w-64 truncate text-sm underline-offset-4 hover:underline"
          >
            {current.fileName}
          </a>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            <Trash2 />
            Remove
          </Button>
        </>
      ) : null}
    </div>
  );
}

export function BrandScreen({ view }: { view: BrandView }) {
  const [accent, setAccent] = useState(view.accentColor ?? "");
  const [nameArabic, setNameArabic] = useState(view.nameArabic ?? "");
  const [footer, setFooter] = useState(view.footer ?? "");
  const [logo, setLogo] = useState(view.logo);
  const [letterhead, setLetterhead] = useState(view.letterhead);
  const [top, setTop] = useState(String(view.letterheadTop));
  const [bottom, setBottom] = useState(String(view.letterheadBottom));
  const [pages, setPages] = useState<LetterheadPages>(view.letterheadPages);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, startSave] = useTransition();
  const [preview, setPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const disabled = !view.canEdit;

  const input = useCallback(
    (): BrandInput => ({
      accentColor: accent,
      footer,
      nameArabic,
      logoAttachmentId: logo?.id ?? null,
      letterheadAttachmentId: letterhead?.id ?? null,
      letterheadTop: Number(top),
      letterheadBottom: Number(bottom),
      letterheadPages: pages,
    }),
    [accent, footer, nameArabic, logo, letterhead, top, bottom, pages],
  );

  // The preview redraws a moment after the last change, from the unsaved settings.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPreviewing(true);
      try {
        const response = await fetch(`/api/o/${view.slug}/brand/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input()),
          signal: controller.signal,
        });
        if (!response.ok) return;
        const url = URL.createObjectURL(await response.blob());
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
      } catch {
        // An aborted or failed preview keeps the last one on screen.
      } finally {
        if (!controller.signal.aborted) setPreviewing(false);
      }
    }, 500);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [input, view.slug]);

  const save = () =>
    startSave(async () => {
      const result = await saveBrandAction(view.slug, input());
      if (!result.ok) {
        setErrors(result.errors ?? {});
        if (result.message) toast.error(result.message);
        return;
      }
      setErrors({});
      toast.success("Brand saved. New invoices will use it.");
    });

  const swatch = normalizeHexColor(accent) ?? DEFAULT_ACCENT;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="grid gap-6">
        <Section
          icon={ImageIcon}
          title="Logo and name"
          description="Shown at the top of every invoice. With a letterhead, the letterhead's own logo is used instead."
        >
          <Field
            label="Logo"
            htmlFor="brand-logo"
            hint="A PNG or JPEG, ideally wide with a transparent or white background."
            error={errors.logo}
          >
            <FilePicker
              slug={view.slug}
              accept={BRAND_IMAGE_TYPES}
              current={logo}
              disabled={disabled}
              label="Logo file"
              onChange={setLogo}
            />
            {logo ? (
              // biome-ignore lint/performance/noImgElement: a private attachment, not an optimisable asset
              <img
                src={logo.url}
                alt="Your logo"
                className="mt-1 max-h-16 max-w-56 rounded-md border bg-white object-contain p-2"
              />
            ) : null}
          </Field>
          <Field
            label="Company name in Arabic"
            htmlFor="brand-name-ar"
            hint={`Printed under ${view.legalName}. Leave it empty if you don't need it.`}
            error={errors.nameArabic}
          >
            <Input
              id="brand-name-ar"
              dir="rtl"
              lang="ar"
              value={nameArabic}
              disabled={disabled}
              maxLength={200}
              onChange={(event) => setNameArabic(event.target.value)}
              placeholder="مثال: اسم الشركة"
            />
          </Field>
        </Section>

        <Section
          icon={Palette}
          title="Colour"
          description="Used for the title, the table header and the total."
        >
          <Field
            label="Accent colour"
            htmlFor="brand-accent"
            hint="Pick one, or type a hex code from your brand guide."
            error={errors.accentColor}
          >
            <div className="flex flex-wrap items-center gap-2">
              {SWATCHES.map((color) => (
                <button
                  key={color}
                  type="button"
                  disabled={disabled}
                  aria-label={`Use ${color}`}
                  aria-pressed={swatch === color}
                  onClick={() => setAccent(color)}
                  className="size-8 rounded-full border-2 border-transparent ring-offset-2 transition aria-pressed:ring-2 aria-pressed:ring-ring"
                  style={{ backgroundColor: color }}
                />
              ))}
              <input
                type="color"
                aria-label="Choose any colour"
                value={swatch}
                disabled={disabled}
                onChange={(event) => setAccent(event.target.value.toUpperCase())}
                className="size-8 cursor-pointer rounded-full border bg-transparent p-0"
              />
              <Input
                id="brand-accent"
                value={accent}
                disabled={disabled}
                onChange={(event) => setAccent(event.target.value)}
                placeholder={DEFAULT_ACCENT}
                className="w-28 font-mono"
              />
            </div>
          </Field>
        </Section>

        <Section
          icon={FileText}
          title="Letterhead"
          description="Already have printed stationery? Upload it and invoices are printed on it, inside the space you leave free."
        >
          <Field
            label="Letterhead file"
            htmlFor="brand-letterhead"
            hint="An A4 PDF (first page is used) or a full-page PNG or JPEG."
            error={errors.letterhead}
          >
            <FilePicker
              slug={view.slug}
              accept={LETTERHEAD_TYPES}
              current={letterhead}
              disabled={disabled}
              label="Letterhead file"
              onChange={setLetterhead}
            />
          </Field>
          {letterhead ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Space at the top"
                  htmlFor="brand-top"
                  hint={`In points (72 = 1 inch). Default ${DEFAULT_LETTERHEAD_MARGINS.top}.`}
                  error={errors.letterheadTop}
                >
                  <Input
                    id="brand-top"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={LETTERHEAD_MARGIN_MAX}
                    value={top}
                    disabled={disabled}
                    onChange={(event) => setTop(event.target.value)}
                  />
                </Field>
                <Field
                  label="Space at the bottom"
                  htmlFor="brand-bottom"
                  hint={`For the letterhead's footer. Default ${DEFAULT_LETTERHEAD_MARGINS.bottom}.`}
                  error={errors.letterheadBottom}
                >
                  <Input
                    id="brand-bottom"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={LETTERHEAD_MARGIN_MAX}
                    value={bottom}
                    disabled={disabled}
                    onChange={(event) => setBottom(event.target.value)}
                  />
                </Field>
              </div>
              <fieldset className="grid gap-2">
                <legend className="mb-1 font-medium text-sm">Which pages?</legend>
                {(
                  [
                    ["first", "First page only", "Later pages are plain, with your footer."],
                    ["all", "Every page", "For letterheads designed to repeat."],
                  ] as const
                ).map(([value, title, hint]) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 has-checked:border-primary has-checked:bg-primary/5"
                  >
                    <input
                      type="radio"
                      name="letterhead-pages"
                      value={value}
                      checked={pages === value}
                      disabled={disabled}
                      onChange={() => setPages(value)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-medium text-sm">{title}</span>
                      <span className="block text-muted-foreground text-xs">{hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </>
          ) : null}
        </Section>

        <Section
          icon={FileText}
          title="Footer"
          description="Printed at the bottom of every page: bank details, payment terms or a thank-you line."
        >
          <Field
            label="Footer text"
            htmlFor="brand-footer"
            hint="Up to three lines."
            error={errors.footer}
          >
            <Textarea
              id="brand-footer"
              rows={3}
              value={footer}
              disabled={disabled}
              maxLength={BRAND_FOOTER_MAX}
              onChange={(event) => setFooter(event.target.value)}
              placeholder={"Thank you for your order.\nBank: … · IBAN: …"}
            />
          </Field>
        </Section>

        {view.canEdit ? (
          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}>
              {saving ? <Spinner /> : null}
              Save brand
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Only owners and admins can change the brand.
          </p>
        )}
      </div>

      <aside className="grid gap-3 lg:sticky lg:top-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Preview</h2>
          <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
            {previewing ? <RefreshCw className="size-3.5 animate-spin" /> : null}A sample invoice,
            before you save
          </span>
        </div>
        <div className="aspect-[1/1.414] overflow-hidden rounded-2xl border bg-muted/40 shadow-xs">
          {preview ? (
            <iframe
              title="Invoice preview"
              src={`${preview}#toolbar=0&navpanes=0&view=FitH`}
              className="size-full bg-white"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              <Spinner />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
