/**
 * Re-mounts on every navigation inside an organization, giving pages a soft entrance. A page's
 * outer grid lets its sections shrink to the screen (a grid item otherwise never gets narrower
 * than its widest row, which made phones scroll sideways); wide content scrolls or wraps inside.
 */
export default function OrgTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div className="fade-in-0 slide-in-from-bottom-1 animate-in duration-300 ease-out [&>.grid>*]:min-w-0">
      {children}
    </div>
  );
}
