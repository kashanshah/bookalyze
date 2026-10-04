import { Building2, Landmark, ShoppingBag } from "lucide-react";

const FEATURES = [
  {
    icon: Landmark,
    title: "Bookkeeping that keeps itself tidy",
    body: "Bank feeds, receipts and categories in one place, with reports your accountant will love.",
  },
  {
    icon: ShoppingBag,
    title: "Marketplace sales, reconciled",
    body: "Amazon settlements, fees and stock flow straight into your profit and loss.",
  },
  {
    icon: Building2,
    title: "Every company, one login",
    body: "Switch between businesses and currencies in a click. Each keeps its own books.",
  },
];

/** Decorative product preview: a small profit chart card. */
function PreviewCard() {
  const bars = [38, 52, 44, 61, 57, 72, 68, 84, 79, 92, 88, 100];
  return (
    <div className="fade-in-0 slide-in-from-bottom-4 w-full max-w-sm animate-in rounded-2xl border border-white/15 bg-white/10 fill-mode-both p-5 shadow-2xl shadow-black/20 backdrop-blur-md delay-150 duration-700">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-white/70 text-xs">Net profit · this year</p>
          <p className="tabular mt-1 font-semibold text-2xl text-white">$48,920.40</p>
        </div>
        <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 font-medium text-emerald-200 text-xs">
          +18.2%
        </span>
      </div>
      <div className="mt-5 flex h-24 items-end gap-1.5">
        {bars.map((h, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: static decorative bars
            key={i}
            className="zoom-in-0 flex-1 origin-bottom animate-in rounded-t-sm bg-gradient-to-t from-white/30 to-white/80 fill-mode-both duration-700"
            style={{ height: `${h}%`, animationDelay: `${300 + i * 45}ms` }}
          />
        ))}
      </div>
      <div className="mt-3 flex justify-between text-[10px] text-white/50">
        <span>Jan</span>
        <span>Jun</span>
        <span>Dec</span>
      </div>
    </div>
  );
}

export function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-[oklch(0.36_0.15_275)] lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_80%_10%,oklch(0.6_0.2_300/0.55),transparent),radial-gradient(50%_60%_at_10%_90%,oklch(0.55_0.18_240/0.5),transparent)]" />
      <div className="pointer-events-none absolute inset-0 bg-dots text-white opacity-[0.15]" />
      <div className="relative">
        <h2 className="max-w-md font-semibold text-3xl text-white leading-tight tracking-tight">
          Your books, your stores and every company you run. One calm place.
        </h2>
        <ul className="mt-10 grid max-w-md gap-6">
          {FEATURES.map((f, i) => (
            <li
              key={f.title}
              className="fade-in-0 slide-in-from-left-2 flex animate-in gap-4 fill-mode-both duration-500"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-white/15">
                <f.icon className="size-5" />
              </span>
              <span>
                <span className="block font-medium text-white">{f.title}</span>
                <span className="mt-0.5 block text-sm text-white/70 leading-relaxed">{f.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="relative">
        <PreviewCard />
      </div>
    </div>
  );
}
