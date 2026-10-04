import type { ModuleKey } from "@bookalyze/core";
import {
  BookOpenCheck,
  Building2,
  Landmark,
  LineChart,
  type LucideIcon,
  Package,
  Star,
  Store,
} from "lucide-react";

export const MODULE_ICONS: Record<ModuleKey, LucideIcon> = {
  accounting: BookOpenCheck,
  banking: Landmark,
  commerce: Store,
  inventory: Package,
  reviews: Star,
  analytics: LineChart,
  entity: Building2,
};
