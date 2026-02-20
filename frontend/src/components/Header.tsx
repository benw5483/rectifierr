import React from "react";

export default function Header() {
  return (
    <header className="flex items-center justify-between h-14 px-6 bg-surface-950 border-b border-slate-800 shrink-0">
      <div /> {/* spacer — page titles live in each page */}

      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-xs text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Connected
        </span>
      </div>
    </header>
  );
}
