const STATUS_STYLES: Record<string, { text: string; ring: string; dot: string; pulse?: boolean }> = {
  DRAFT: { text: "text-muted", ring: "border-border bg-white/5", dot: "bg-muted" },
  AWAITING_PAYMENT: {
    text: "text-amber-300",
    ring: "border-amber-500/30 bg-amber-500/10",
    dot: "bg-amber-400",
  },
  PAID: {
    text: "text-accent",
    ring: "border-accent/30 bg-accent-soft",
    dot: "bg-accent",
  },
  QUEUED: {
    text: "text-sky-300",
    ring: "border-sky-500/30 bg-sky-500/10",
    dot: "bg-sky-400",
    pulse: true,
  },
  PRINTING: {
    text: "text-orange-300",
    ring: "border-orange-500/30 bg-orange-500/10",
    dot: "bg-orange-400",
    pulse: true,
  },
  READY: {
    text: "text-teal-300",
    ring: "border-teal-500/30 bg-teal-500/10",
    dot: "bg-teal-400",
  },
  SHIPPED: {
    text: "text-violet-300",
    ring: "border-violet-500/30 bg-violet-500/10",
    dot: "bg-violet-400",
  },
  CANCELLED: {
    text: "text-danger",
    ring: "border-danger/30 bg-danger/10",
    dot: "bg-danger",
  },
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.DRAFT;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide ${style.ring} ${style.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot} ${style.pulse ? "badge-dot" : ""}`} />
      {label}
    </span>
  );
}
