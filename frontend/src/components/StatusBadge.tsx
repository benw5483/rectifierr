import React from "react";
import clsx from "clsx";

interface Props {
  status: string;
  className?: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending:   "bg-yellow-900/60 text-yellow-300 border-yellow-700/50",
  running:   "bg-brand-900/60 text-brand-300 border-brand-700/50",
  completed: "bg-emerald-900/60 text-emerald-300 border-emerald-700/50",
  failed:    "bg-red-900/60 text-red-300 border-red-700/50",
  cancelled: "bg-slate-700/60 text-slate-400 border-slate-600/50",
  bumper:    "bg-orange-900/60 text-orange-300 border-orange-700/50",
  channel_logo: "bg-purple-900/60 text-purple-300 border-purple-700/50",
  commercial:   "bg-red-900/60 text-red-300 border-red-700/50",
};

export default function StatusBadge({ status, className }: Props) {
  const style = STATUS_STYLES[status] ?? "bg-slate-700/60 text-slate-400 border-slate-600/50";
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
        style,
        className
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
