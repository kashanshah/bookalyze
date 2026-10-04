"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { useEffect } from "react";
import { Toaster } from "sonner";

/** Prints in the light theme, whatever the screen shows: dark pages waste ink and read badly. */
function PrintInLight() {
  useEffect(() => {
    const html = document.documentElement;
    let wasDark = false;
    let colorScheme = "";
    // Browsers can fire beforeprint more than once per print; only the first one may record.
    const before = () => {
      if (!html.classList.contains("dark")) return;
      wasDark = true;
      colorScheme = html.style.colorScheme;
      html.classList.remove("dark");
      // The theme sets color-scheme on <html>, which also colours the page margins.
      html.style.colorScheme = "light";
    };
    const after = () => {
      if (!wasDark) return;
      html.classList.add("dark");
      html.style.colorScheme = colorScheme;
      wasDark = false;
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
      <PrintInLight />
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{ className: "font-sans" }}
      />
    </NextThemesProvider>
  );
}
