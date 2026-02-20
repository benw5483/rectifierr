import React from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, Library, Activity, Settings, Zap } from "lucide-react";
import clsx from "clsx";
import SyncToast from "./SyncToast";
import ScanToast from "./ScanToast";

const nav = [
  { to: "/",        label: "Dashboard", icon: LayoutDashboard },
  { to: "/library", label: "Library",   icon: Library },
  { to: "/activity",label: "Activity",  icon: Activity },
  { to: "/settings",label: "Settings",  icon: Settings },
];

export default function Sidebar() {
  return (
    <aside className="flex flex-col w-72 bg-surface-950 border-r border-slate-800 shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-slate-800">
        <div className="flex items-center justify-center w-8 h-8 bg-brand-600 rounded-lg">
          <Zap className="w-4.5 h-4.5 text-white" size={18} />
        </div>
        <span className="text-lg font-bold text-white tracking-tight">Rectifierr</span>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 p-3 flex-1">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-brand-600/20 text-brand-400"
                  : "text-slate-400 hover:text-slate-100 hover:bg-surface-800"
              )
            }
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Scan + sync progress */}
      <div className="px-3 pb-2 space-y-2">
        <ScanToast />
        <SyncToast />
      </div>

      {/* Version footer */}
      <div className="px-5 py-3 border-t border-slate-800">
        <p className="text-xs text-slate-600">v0.1.0</p>
      </div>
    </aside>
  );
}
