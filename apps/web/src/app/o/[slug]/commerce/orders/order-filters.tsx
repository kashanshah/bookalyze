"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Combobox } from "@/components/ui/combobox";

/** The marketplace filter: choosing one applies it straight away (with the other filters). */
export function MarketplaceFilter({
  channels,
  value,
}: {
  channels: { id: string; name: string }[];
  value: string;
}) {
  const [channel, setChannel] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="col-span-2 sm:w-48">
      <Combobox
        name="channel"
        aria-label="Marketplace"
        value={channel}
        onChange={(v) => {
          flushSync(() => setChannel(v));
          ref.current?.closest("form")?.requestSubmit();
        }}
        options={[
          { value: "", label: "All marketplaces" },
          ...channels.map((c) => ({ value: c.id, label: c.name })),
        ]}
        searchPlaceholder="Type a marketplace"
        className="h-9"
      />
    </div>
  );
}
