import React from "react";
import { BrowserRouter, Navigate, Routes, Route, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Zap } from "lucide-react";
import { api } from "./api/client";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Library from "./pages/Library";
import Activity from "./pages/Activity";
import Settings from "./pages/Settings";
import Setup from "./pages/Setup";

// ── Plex connection gate ──────────────────────────────────────────────────────
//
// Fetches /api/plex/status once on mount (no background polling).
// • Not connected → redirect to /setup (no further queries are made)
// • Connected     → render the full app
// • Backend down  → show an error screen

function RequirePlex({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["plex-status"],
    queryFn: api.plexStatus,
    // Fetch once; re-use the cached result until explicitly invalidated
    // (PlexConnect invalidates it after connecting/disconnecting).
    staleTime: Infinity,
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-surface-900">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-9 h-9 bg-brand-600 rounded-lg">
            <Zap size={18} className="text-white" />
          </div>
          <span className="text-xl font-bold text-white tracking-tight">Rectifierr</span>
        </div>
        <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-surface-900 text-center px-6">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="flex items-center justify-center w-9 h-9 bg-brand-600 rounded-lg">
            <Zap size={18} className="text-white" />
          </div>
          <span className="text-xl font-bold text-white tracking-tight">Rectifierr</span>
        </div>
        <p className="text-slate-300 font-medium">Cannot reach the Rectifierr backend.</p>
        <p className="text-slate-500 text-sm">Make sure the backend is running on port 8000.</p>
        <button
          onClick={() => window.location.reload()}
          className="btn-secondary mt-2"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data?.connected) {
    return <Navigate to="/setup" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Standalone setup page — no Layout, no polling, no gate */}
        <Route path="/setup" element={<Setup />} />

        {/* All main routes are gated behind a Plex connection */}
        <Route
          path="/"
          element={
            <RequirePlex>
              <Layout />
            </RequirePlex>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="library" element={<Library />} />
          <Route path="activity" element={<Activity />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
