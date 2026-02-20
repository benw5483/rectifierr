import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import PlexConnect from "../components/PlexConnect";

/**
 * Standalone setup page — rendered outside of Layout so nothing else
 * in the app can trigger background queries while the user is not yet
 * connected to Plex.
 */
export default function Setup() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  // If the user somehow lands here while already connected, redirect them.
  // (e.g. hitting /setup after a page refresh when already set up)
  useEffect(() => {
    qc.fetchQuery({ queryKey: ["plex-status"], queryFn: () => import("../api/client").then(m => m.api.plexStatus()) })
      .then((status) => {
        if (status?.connected) navigate("/", { replace: true });
      })
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-surface-900 flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <div className="flex items-center gap-2.5 mb-8">
        <div className="flex items-center justify-center w-10 h-10 bg-brand-600 rounded-xl">
          <Zap size={20} className="text-white" />
        </div>
        <span className="text-2xl font-bold text-white tracking-tight">Rectifierr</span>
      </div>

      {/* Card */}
      <div className="card w-full max-w-lg">
        <h1 className="text-lg font-semibold text-white mb-1">Connect your Plex account</h1>
        <p className="text-sm text-slate-400 mb-6">
          Rectifierr uses your Plex library to find and audit media files for bumpers,
          commercials, and channel logos.
        </p>

        <PlexConnect onConnected={() => navigate("/", { replace: true })} />
      </div>

      <p className="text-xs text-slate-600 mt-6">
        Your Plex token is stored locally and never sent anywhere except your own Plex server.
      </p>
    </div>
  );
}
