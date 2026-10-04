import type { MetadataRoute } from "next";

/** Web app manifest: lets people add Bookalyze to their phone's home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bookalyze",
    short_name: "Bookalyze",
    description: "Bookkeeping, banking and marketplace sales for every company you run.",
    start_url: "/",
    display: "standalone",
    background_color: "#FBFCFD",
    theme_color: "#4C55CA",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
