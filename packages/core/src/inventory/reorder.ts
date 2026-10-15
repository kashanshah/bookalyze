import { addDaysIso } from "../entity/compliance";

/**
 * The reorder planner (inventory forecast): from a product's daily sales, how fast it sells, when
 * it runs out, and how many to order by when. Units are whole numbers of the product (a 2-pack
 * sold is 2); rates are units a day. Nothing here is money.
 *
 *   velocity      v = 0.5·(last 7 days) + 0.3·(last 30) + 0.2·(last 90), units a day
 *   safety stock    = z · σ(daily units, last 90) · √lead time      (z = 1.65, about 95%)
 *   reorder point   = v · lead time + safety stock
 *   position        = in stock + on order
 *   order           = v · (lead time + cover) + safety stock − position, at least the minimum
 *                     order, rounded up to the case pack
 *   runs out        = today + in stock / v
 *   order by        = the day position falls to the reorder point
 */

export const REORDER_HISTORY_DAYS = 90;
/** About a 95% chance of not running out while an order is on its way. */
const SERVICE_Z = 1.65;
/** "Order soon" within this many days of the order-by date. */
export const REORDER_SOON_DAYS = 14;

export const DEFAULT_REORDER_SETTINGS = { leadTimeDays: 45, coverDays: 60 } as const;

export type ReorderStatus = "order_now" | "order_soon" | "ok" | "no_sales";

export type ReorderInput = {
  /** YYYY-MM-DD, the company's today. */
  today: string;
  /** Units sold each day, oldest first, ending yesterday (up to 90 days). */
  dailyUnits: readonly number[];
  inStock: number;
  onOrder: number;
  leadTimeDays: number;
  coverDays: number;
  minimumOrder?: number | null;
  casePack?: number | null;
};

export type ReorderPlan = {
  /** Units a day. */
  velocity: number;
  safetyStock: number;
  reorderPoint: number;
  /** Whole days of stock left at this pace; null when it isn't selling. */
  daysLeft: number | null;
  runsOutOn: string | null;
  /** The last day to order so it arrives before stock runs low; null when not selling. */
  orderBy: string | null;
  /** Units to order now (0 if none needed). */
  orderQuantity: number;
  status: ReorderStatus;
};

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** The weighted daily rate: recent weeks count most, the quarter steadies it. */
export function salesVelocity(dailyUnits: readonly number[]): number {
  const last = (n: number) => dailyUnits.slice(-n);
  if (!dailyUnits.length) return 0;
  return 0.5 * mean(last(7)) + 0.3 * mean(last(30)) + 0.2 * mean(last(REORDER_HISTORY_DAYS));
}

function stdDev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((t, x) => t + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Rounds an order up to the minimum and the case pack. */
export function roundOrder(units: number, minimumOrder?: number | null, casePack?: number | null) {
  if (units <= 0) return 0;
  let q = Math.ceil(units);
  if (minimumOrder && q < minimumOrder) q = minimumOrder;
  if (casePack && casePack > 1) q = Math.ceil(q / casePack) * casePack;
  return q;
}

export function planReorder(input: ReorderInput): ReorderPlan {
  const history = input.dailyUnits.slice(-REORDER_HISTORY_DAYS);
  const velocity = salesVelocity(history);
  const inStock = Math.max(0, input.inStock);
  const position = inStock + Math.max(0, input.onOrder);
  if (velocity <= 0) {
    return {
      velocity: 0,
      safetyStock: 0,
      reorderPoint: 0,
      daysLeft: null,
      runsOutOn: null,
      orderBy: null,
      orderQuantity: 0,
      status: "no_sales",
    };
  }
  const lead = Math.max(0, input.leadTimeDays);
  const safetyStock = Math.ceil(SERVICE_Z * stdDev(history) * Math.sqrt(lead));
  const reorderPoint = Math.ceil(velocity * lead + safetyStock);
  const target = velocity * (lead + Math.max(0, input.coverDays)) + safetyStock;
  const orderQuantity = roundOrder(target - position, input.minimumOrder, input.casePack);
  const daysLeft = Math.floor(inStock / velocity);
  const daysToOrder = Math.floor((position - reorderPoint) / velocity);
  const status: ReorderStatus =
    position <= reorderPoint ? "order_now" : daysToOrder <= REORDER_SOON_DAYS ? "order_soon" : "ok";
  return {
    velocity,
    safetyStock,
    reorderPoint,
    daysLeft,
    runsOutOn: addDaysIso(input.today, daysLeft),
    orderBy: addDaysIso(input.today, Math.max(0, daysToOrder)),
    // Nothing to order yet when stock is comfortably above the reorder point.
    orderQuantity: status === "ok" ? 0 : orderQuantity,
    status,
  };
}
