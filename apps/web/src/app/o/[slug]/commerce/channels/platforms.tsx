import { ShoppingBag, Store, Tag } from "lucide-react";

/** The platforms a channel can be on, as the Channels pages name and picture them. */
export type Platform = "amazon" | "ebay" | "noon";

export const PLATFORMS: Record<
  Platform,
  { label: string; icon: React.ReactNode; description: string }
> = {
  amazon: {
    label: "Amazon",
    icon: <ShoppingBag />,
    description:
      "Connect a Seller Central account. Its marketplaces, such as Amazon.ca and Amazon.com, become channels, and orders come in by themselves.",
  },
  ebay: {
    label: "eBay",
    icon: <Tag />,
    description: "Add the eBay sites you sell on, such as eBay US or eBay Canada.",
  },
  noon: {
    label: "Noon",
    icon: <Store />,
    description: "Add the countries you sell in on Noon: the UAE, Saudi Arabia or Egypt.",
  },
};
