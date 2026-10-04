/** Re-mounts on every navigation inside an organization, giving pages a soft entrance. */
export default function OrgTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div className="fade-in-0 slide-in-from-bottom-1 animate-in duration-300 ease-out">
      {children}
    </div>
  );
}
