/**
 * PlexConnect — full OAuth connection flow inside the Settings page.
 *
 * State machine:
 *   idle           No credentials stored. "Connect with Plex" CTA.
 *   starting       Requesting a PIN from plex.tv.
 *   awaiting_auth  PIN received; user must visit plex.tv to authorise.
 *                  Polls /auth/poll every 2 s in the background.
 *   picking_server Auth succeeded; user picks which server to use.
 *   connecting     Saving chosen server (quick connectivity check).
 *   connected      Token + server stored. Shows account info + sync controls.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen, CheckCircle2, ChevronRight, ExternalLink, Loader2,
  LogOut, RefreshCw, Server, Tv, User, Wifi, WifiOff, XCircle,
} from "lucide-react";
import clsx from "clsx";
import { api, PlexServer, PlexStatus } from "../api/client";

// ── helpers ──────────────────────────────────────────────────────────────────


// ── Sub-views ─────────────────────────────────────────────────────────────────

function PinDisplay({ code, authUrl }: { code: string; authUrl: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-slate-300 mb-1">
          1. Open Plex and sign in:
        </p>
        <a
          href={authUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 btn-primary"
        >
          <ExternalLink size={14} />
          Open plex.tv/link
        </a>
      </div>

      <div>
        <p className="text-sm text-slate-300 mb-2">
          2. Enter this code when prompted:
        </p>
        <button
          onClick={copy}
          title="Click to copy"
          className={clsx(
            "flex items-center gap-3 px-5 py-3 rounded-xl border-2 font-mono text-3xl font-bold tracking-[0.25em] transition-colors",
            copied
              ? "border-emerald-500 text-emerald-400 bg-emerald-900/20"
              : "border-brand-600 text-brand-300 bg-brand-900/20 hover:bg-brand-900/40"
          )}
        >
          {code}
          {copied && <CheckCircle2 size={20} className="text-emerald-400 ml-1" />}
        </button>
        <p className="text-xs text-slate-500 mt-1.5">Click to copy</p>
      </div>

      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Loader2 size={14} className="animate-spin text-brand-400 shrink-0" />
        Waiting for you to authorise in Plex…
      </div>
    </div>
  );
}

function ServerPicker({
  servers,
  onSelect,
  loading,
}: {
  servers: PlexServer[];
  onSelect: (s: PlexServer) => void;
  loading: boolean;
}) {
  const [selected, setSelected] = useState<PlexServer | null>(null);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-300">Choose which Plex server to use:</p>
      <div className="space-y-2">
        {servers.map((s) => (
          <button
            key={s.machine_id}
            onClick={() => setSelected(s)}
            className={clsx(
              "w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-colors",
              selected?.machine_id === s.machine_id
                ? "border-brand-500 bg-brand-900/30"
                : "border-slate-700 bg-surface-900 hover:border-slate-500"
            )}
          >
            <div
              className={clsx(
                "w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center",
                selected?.machine_id === s.machine_id
                  ? "border-brand-400"
                  : "border-slate-600"
              )}
            >
              {selected?.machine_id === s.machine_id && (
                <div className="w-2 h-2 rounded-full bg-brand-400" />
              )}
            </div>
            <Server size={16} className="text-slate-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-100">{s.name}</p>
              <p className="text-xs text-slate-500 truncate">{s.best_url}</p>
            </div>
            {s.owned && (
              <span className="text-xs text-brand-400 shrink-0">owned</span>
            )}
            {s.connections[0]?.local && (
              <span className="text-xs text-emerald-400 shrink-0">local</span>
            )}
          </button>
        ))}
      </div>

      <button
        onClick={() => selected && onSelect(selected)}
        disabled={!selected || loading}
        className="btn-primary w-full justify-center disabled:opacity-50"
      >
        {loading ? (
          <><Loader2 size={14} className="animate-spin" /> Connecting…</>
        ) : (
          <>Connect<ChevronRight size={14} /></>
        )}
      </button>
    </div>
  );
}

function LibraryPicker({
  onSave,
  loading,
}: {
  onSave: (keys: string[]) => void;
  loading: boolean;
}) {
  const { data: libs, isLoading } = useQuery({
    queryKey: ["plex-libraries"],
    queryFn: api.plexLibraries,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Pre-select movie + show types (skip music/photo) once loaded
  useEffect(() => {
    if (!libs) return;
    const defaultKeys = libs
      .filter((l) => l.type === "movie" || l.type === "show")
      .map((l) => l.key);
    setSelected(new Set(libs.some((l) => l.selected) ? libs.filter((l) => l.selected).map((l) => l.key) : defaultKeys));
  }, [libs]);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const typeLabel: Record<string, string> = {
    movie: "Movies",
    show: "TV Shows",
    artist: "Music",
    photo: "Photos",
  };

  const typeIcon: Record<string, string> = {
    movie: "🎬",
    show: "📺",
    artist: "🎵",
    photo: "🖼️",
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Loader2 size={14} className="animate-spin text-brand-400" />
        Loading libraries…
      </div>
    );
  }

  if (!libs || libs.length === 0) {
    return <p className="text-sm text-slate-400">No libraries found on this server.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-300">
        Choose which libraries to sync and scan:
      </p>
      <div className="space-y-2">
        {libs.map((lib) => (
          <button
            key={lib.key}
            onClick={() => toggle(lib.key)}
            className={clsx(
              "w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-colors",
              selected.has(lib.key)
                ? "border-brand-500 bg-brand-900/30"
                : "border-slate-700 bg-surface-900 hover:border-slate-500"
            )}
          >
            <div
              className={clsx(
                "w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center",
                selected.has(lib.key)
                  ? "border-brand-400 bg-brand-500"
                  : "border-slate-600"
              )}
            >
              {selected.has(lib.key) && (
                <CheckCircle2 size={10} className="text-white" />
              )}
            </div>
            <span className="text-base shrink-0">{typeIcon[lib.type] ?? "📁"}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-100">{lib.title}</p>
              <p className="text-xs text-slate-500">{typeLabel[lib.type] ?? lib.type}</p>
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={() => onSave(Array.from(selected))}
        disabled={selected.size === 0 || loading}
        className="btn-primary w-full justify-center disabled:opacity-50"
      >
        {loading ? (
          <><Loader2 size={14} className="animate-spin" /> Saving…</>
        ) : (
          <>Save & Sync</>
        )}
      </button>
    </div>
  );
}

function ConnectedView({
  status,
  onDisconnect,
  onSync,
  syncing,
  onChangeLibraries,
}: {
  status: PlexStatus;
  onDisconnect: () => void;
  onSync: () => void;
  syncing: boolean;
  onChangeLibraries: () => void;
}) {
  const { account, server } = status;

  return (
    <div className="space-y-4">
      {/* Account + server row */}
      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-48">
          {account.thumb ? (
            <img
              src={account.thumb}
              alt={account.username}
              className="w-9 h-9 rounded-full ring-2 ring-brand-600"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-brand-800 flex items-center justify-center">
              <User size={16} className="text-brand-300" />
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-white">
              {account.username || "Plex user"}
            </p>
            <p className="text-xs text-slate-500">plex.tv account</p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-1 min-w-48">
          <div className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center shrink-0">
            <Server size={16} className="text-slate-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">
              {server.name || "Server"}
            </p>
            <p className="text-xs text-slate-500 truncate">{server.url}</p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onSync}
          disabled={syncing}
          className="btn-primary disabled:opacity-50"
        >
          {syncing ? (
            <><Loader2 size={14} className="animate-spin" /> Syncing…</>
          ) : (
            <><RefreshCw size={14} /> Sync Library</>
          )}
        </button>
        <button onClick={onChangeLibraries} className="btn-secondary">
          <BookOpen size={14} />
          Libraries
        </button>
        <button onClick={onDisconnect} className="btn-secondary">
          <LogOut size={14} />
          Disconnect
        </button>
      </div>
    </div>
  );
}

// ── Path prefix section ───────────────────────────────────────────────────────

function PathPrefixRow({ status }: { status: PlexStatus }) {
  const qc = useQueryClient();
  const [plexPrefix, setPlexPrefix] = useState(status.path_prefix.plex);
  const [localPrefix, setLocalPrefix] = useState(status.path_prefix.local);

  const saveMut = useMutation({
    mutationFn: () =>
      api.plexSetPathPrefix({ plex_prefix: plexPrefix, local_prefix: localPrefix }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plex-status"] }),
  });

  const dirty =
    plexPrefix !== status.path_prefix.plex || localPrefix !== status.path_prefix.local;

  return (
    <div className="border-t border-slate-700 pt-4 mt-4">
      <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
        Path prefix mapping{" "}
        <span className="normal-case font-normal text-slate-600">
          (optional — only needed if Plex and Rectifierr mount media at different paths)
        </span>
      </p>
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 mt-2">
        <div>
          <label className="label">Plex sees</label>
          <input
            type="text"
            value={plexPrefix}
            onChange={(e) => setPlexPrefix(e.target.value)}
            placeholder="/data/media"
            className="input font-mono text-xs"
          />
        </div>
        <div>
          <label className="label">Rectifierr sees</label>
          <input
            type="text"
            value={localPrefix}
            onChange={(e) => setLocalPrefix(e.target.value)}
            placeholder="/media"
            className="input font-mono text-xs"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={() => saveMut.mutate()}
            disabled={!dirty || saveMut.isPending}
            className="btn-secondary disabled:opacity-40"
          >
            {saveMut.isPending ? <Loader2 size={13} className="animate-spin" /> : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Phase =
  | "loading"
  | "idle"
  | "starting"
  | "awaiting_auth"
  | "picking_server"
  | "connecting"
  | "picking_libraries"
  | "connected";

export default function PlexConnect({ onConnected }: { onConnected?: () => void } = {}) {
  const qc = useQueryClient();

  // ── Load current status ───────────────────────────────────────────────────
  const { data: status, isLoading } = useQuery({
    queryKey: ["plex-status"],
    queryFn: api.plexStatus,
    staleTime: Infinity,
  });

  const [phase, setPhase] = useState<Phase>("loading");
  const [pinCode, setPinCode] = useState("");
  const [authUrl, setAuthUrl] = useState("");
  const [servers, setServers] = useState<PlexServer[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Derive phase from server status when it loads
  useEffect(() => {
    if (!status) return;
    if (status.connected) {
      if (phase === "loading") {
        // On initial load: go straight to connected (libraries already chosen before)
        setPhase("connected");
      }
      // If already in connected phase, stay there
    } else if (phase === "loading") {
      setPhase("idle");
    }
  }, [status]);

  // ── Poll for PIN auth ─────────────────────────────────────────────────────
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPolling(), []); // cleanup on unmount

  const startPolling = (id: number) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.plexAuthPoll(id);
        if (res.authenticated) {
          stopPolling();
          // Fetch servers to pick from
          setPhase("picking_server");
          const srvList = await api.plexServers();
          setServers(srvList);
          qc.invalidateQueries({ queryKey: ["plex-status"] });
        }
      } catch {
        // Network blip — keep polling
      }
    }, 2000);
  };

  // ── Mutations ─────────────────────────────────────────────────────────────
  const startAuthMut = useMutation({
    mutationFn: api.plexAuthStart,
    onMutate: () => { setPhase("starting"); setError(null); },
    onSuccess: (data) => {
      setPinCode(data.pin_code);
      setAuthUrl(data.auth_url);
      setPhase("awaiting_auth");
      startPolling(data.pin_id);
    },
    onError: (e: Error) => { setError(e.message); setPhase("idle"); },
  });

  const selectServerMut = useMutation({
    mutationFn: (s: PlexServer) =>
      api.plexSelectServer({ name: s.name, machine_id: s.machine_id, url: s.best_url }),
    onMutate: () => { setPhase("connecting"); setError(null); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plex-status"] });
      setPhase("picking_libraries");
    },
    onError: (e: Error) => { setError(e.message); setPhase("picking_server"); },
  });

  const disconnectMut = useMutation({
    mutationFn: api.plexDisconnect,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plex-status"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["media-list"] });
      setPhase("idle");
      setError(null);
    },
  });

  const syncMut = useMutation({
    mutationFn: api.plexSync,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plex-status"] }),
  });

  const saveLibrariesMut = useMutation({
    mutationFn: (keys: string[]) => api.plexSaveLibraries(keys),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plex-status"] });
      setPhase("connected");
      api.plexSync().catch(() => {});
      onConnected?.();
    },
    onError: (e: Error) => { setError(e.message); },
  });

  const cancel = () => {
    stopPolling();
    setPhase("idle");
    setPinCode("");
    setError(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLoading || phase === "loading") {
    return (
      <div className="flex items-center gap-2 text-slate-500 text-sm py-2">
        <Loader2 size={14} className="animate-spin" />
        Checking Plex connection…
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {phase === "connected" ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
              <Wifi size={13} /> Connected
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <WifiOff size={13} /> Not connected
            </span>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">
          <XCircle size={14} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Phase content */}
      {phase === "idle" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-400">
            Connect your Plex account to automatically import your media library into Rectifierr.
          </p>
          <div>
            <button
              onClick={() => startAuthMut.mutate()}
              className="btn-primary"
            >
              <Tv size={15} />
              Connect with Plex
            </button>
          </div>
        </div>
      )}

      {phase === "starting" && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={14} className="animate-spin text-brand-400" />
          Requesting authorisation code…
        </div>
      )}

      {phase === "awaiting_auth" && (
        <div>
          <PinDisplay code={pinCode} authUrl={authUrl} />
          <button onClick={cancel} className="btn-secondary mt-5 text-sm">
            Cancel
          </button>
        </div>
      )}

      {(phase === "picking_server" || phase === "connecting") && (
        <div>
          <div className="flex items-center gap-2 mb-4 text-sm text-emerald-400">
            <CheckCircle2 size={14} />
            Signed in successfully
          </div>
          {servers.length === 0 ? (
            <p className="text-sm text-slate-400">No Plex servers found for this account.</p>
          ) : (
            <ServerPicker
              servers={servers}
              onSelect={(s) => selectServerMut.mutate(s)}
              loading={phase === "connecting"}
            />
          )}
          {phase === "picking_server" && (
            <button onClick={cancel} className="btn-secondary mt-3 text-sm">
              Cancel
            </button>
          )}
        </div>
      )}

      {phase === "picking_libraries" && (
        <div>
          <div className="flex items-center gap-2 mb-4 text-sm text-emerald-400">
            <CheckCircle2 size={14} />
            Server connected
          </div>
          <LibraryPicker
            onSave={(keys) => saveLibrariesMut.mutate(keys)}
            loading={saveLibrariesMut.isPending}
          />
        </div>
      )}

      {phase === "connected" && status && (
        <div>
          <ConnectedView
            status={status}
            onDisconnect={() => disconnectMut.mutate()}
            onSync={() => syncMut.mutate()}
            syncing={status.sync?.status === "running" || syncMut.isPending}
            onChangeLibraries={() => setPhase("picking_libraries")}
          />
          <PathPrefixRow status={status} />
        </div>
      )}
    </div>
  );
}
