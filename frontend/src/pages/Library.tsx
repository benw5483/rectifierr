import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search, ScanLine, FileVideo, ChevronDown, ChevronUp,
  Loader2, AlertTriangle, CheckCircle, Clock, Scissors,
  ArrowLeft, Tv,
} from "lucide-react";
import { api, MediaFile, Issue, SeriesEntry, ScanJob } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import TrimEditor from "../components/TrimEditor";

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatDuration(s?: number): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function formatBytes(b?: number): string {
  if (!b) return "—";
  if (b > 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  return `${(b / 1e6).toFixed(0)} MB`;
}

function formatTimestamp(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// ── Issue row ─────────────────────────────────────────────────────────────────

function IssueRow({ issue, mediaId, media }: { issue: Issue; mediaId: number; media: MediaFile }) {
  const qc = useQueryClient();
  const [showTrimEditor, setShowTrimEditor] = useState(false);

  const resolveMut = useMutation({
    mutationFn: (method: string) => api.resolveIssue(mediaId, issue.id, method),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["media", mediaId] }),
  });

  return (
    <>
      <div className={`rounded-lg p-3 ${issue.resolved ? "bg-slate-800/30 opacity-60" : "bg-surface-900 border border-slate-700"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge status={issue.issue_type} />
              <span className="text-xs text-slate-400">
                {formatTimestamp(issue.start_seconds)} → {formatTimestamp(issue.end_seconds)}
                {" "}({issue.duration.toFixed(1)}s)
              </span>
              <span className="text-xs text-slate-500">{Math.round(issue.confidence * 100)}% confident</span>
            </div>
            {issue.description && <p className="text-sm text-slate-300">{issue.description}</p>}
          </div>
          {!issue.resolved && (
            <div className="flex gap-2 shrink-0">
              {issue.issue_type === "bumper" && (
                <button onClick={() => setShowTrimEditor(true)} className="btn-danger text-xs py-1 px-2.5 gap-1.5">
                  <Scissors size={12} /> Trim…
                </button>
              )}
              <button onClick={() => resolveMut.mutate("ignored")} disabled={resolveMut.isPending} className="btn-secondary text-xs py-1 px-2">
                Ignore
              </button>
            </div>
          )}
          {issue.resolved && (
            <span className="text-xs text-slate-500 shrink-0 capitalize">{issue.resolution_method}</span>
          )}
        </div>
      </div>
      {showTrimEditor && <TrimEditor media={media} issue={issue} onClose={() => setShowTrimEditor(false)} />}
    </>
  );
}

// ── Media row (episode / movie list item) ─────────────────────────────────────

function MediaRow({ media, showSeriesTitle = false }: { media: MediaFile; showSeriesTitle?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [scanJobId, setScanJobId] = useState<number | null>(null);
  const qc = useQueryClient();

  const { data: fullMedia } = useQuery({
    queryKey: ["media", media.id],
    queryFn: () => api.getMedia(media.id),
    enabled: expanded,
  });

  // Poll the scan job until it finishes, then refresh this row's data
  const { data: scanJob } = useQuery({
    queryKey: ["scan-job", scanJobId],
    queryFn: () => api.getJob(scanJobId!),
    enabled: scanJobId !== null,
    refetchInterval: (query) => {
      const j = query.state.data as ScanJob | undefined;
      return !j || j.status === "pending" || j.status === "running" ? 2000 : false;
    },
  });

  useEffect(() => {
    if (!scanJob) return;
    if (scanJob.status === "completed" || scanJob.status === "failed" || scanJob.status === "cancelled") {
      qc.invalidateQueries({ queryKey: ["media", media.id] });
      qc.invalidateQueries({ queryKey: ["media-list"] });
      setScanJobId(null);
    }
  }, [scanJob?.status]);

  const scanMut = useMutation({
    mutationFn: () => api.scanMedia(media.id),
    onSuccess: (data) => {
      setScanJobId(data.job_id);
      qc.invalidateQueries({ queryKey: ["active-jobs"] }); // wake ScanToast
    },
  });

  const isScanning = scanJobId !== null;
  const hasIssues = media.unresolved_issues > 0;

  const displayTitle = showSeriesTitle && media.series_title
    ? media.title
    : media.series_title
      ? `${media.series_title} S${String(media.season_number ?? 0).padStart(2, "0")}E${String(media.episode_number ?? 0).padStart(2, "0")}`
      : media.title;

  return (
    <div className="card p-0 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-surface-700/30 transition-colors"
      >
        <div className={`w-1 self-stretch rounded-full shrink-0 ${!media.last_scanned ? "bg-slate-600" : hasIssues ? "bg-amber-500" : "bg-emerald-500"}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-slate-100 truncate">{displayTitle}</p>
            {hasIssues && (
              <span className="flex items-center gap-1 text-xs text-amber-400 shrink-0">
                <AlertTriangle size={12} />{media.unresolved_issues}
              </span>
            )}
            {media.last_scanned && !hasIssues && <CheckCircle size={13} className="text-emerald-500 shrink-0" />}
          </div>
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            {media.resolution} · {media.codec?.toUpperCase()} · {formatDuration(media.duration_seconds)} · {formatBytes(media.file_size_bytes)}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {!media.last_scanned && (
            <span className="flex items-center gap-1 text-xs text-slate-500"><Clock size={12} /> Not scanned</span>
          )}
          <button onClick={(e) => { e.stopPropagation(); scanMut.mutate(); }} disabled={scanMut.isPending || isScanning} className="btn-secondary text-xs py-1 px-2">
            {scanMut.isPending || isScanning ? <Loader2 size={12} className="animate-spin" /> : <ScanLine size={12} />}
          </button>
          {expanded ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
        </div>
      </button>
      {expanded && (
        <div className="border-t border-slate-700 p-4 space-y-2">
          <p className="text-xs text-slate-500 font-mono truncate">{media.path}</p>
          {fullMedia?.issues && fullMedia.issues.length > 0 ? (
            <div className="space-y-2">
              {fullMedia.issues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} mediaId={media.id} media={fullMedia} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">{media.last_scanned ? "No issues detected." : "Not yet scanned."}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Series poster grid ────────────────────────────────────────────────────────

function titleHue(title: string): number {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return h % 360;
}

function SeriesCard({ entry, onClick }: { entry: SeriesEntry; onClick: () => void }) {
  const hue = titleHue(entry.series_title);
  return (
    <button onClick={onClick} className="group text-left w-full">
      <div
        className="relative rounded-xl overflow-hidden mb-2 group-hover:ring-2 group-hover:ring-brand-500 transition-all"
        style={{ aspectRatio: "2/3", backgroundColor: `hsl(${hue}, 40%, 18%)` }}
      >
        {/* Initial letter */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="text-6xl font-bold select-none"
            style={{ color: `hsl(${hue}, 45%, 50%)` }}
          >
            {entry.series_title[0].toUpperCase()}
          </span>
        </div>
        {/* Issue badge */}
        {entry.unresolved_issues > 0 && (
          <div className="absolute top-2 right-2 bg-amber-500 text-black text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
            {entry.unresolved_issues}
          </div>
        )}
      </div>
      <p className="text-sm font-medium text-slate-200 truncate leading-tight group-hover:text-white transition-colors">
        {entry.series_title}
      </p>
      <p className="text-xs text-slate-500 mt-0.5">
        {entry.episode_count} ep{entry.episode_count !== 1 ? "s" : ""}
      </p>
    </button>
  );
}

function SeriesGrid({
  plexLibrary,
  search,
  onSelect,
}: {
  plexLibrary?: string;
  search: string;
  onSelect: (title: string) => void;
}) {
  const { data: series, isLoading } = useQuery({
    queryKey: ["series-list", plexLibrary, search],
    queryFn: () => api.listSeries({ plex_library: plexLibrary, search: search || undefined }),
    placeholderData: (prev) => prev,
  });

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 text-brand-400 animate-spin" /></div>;
  }

  if (!series || series.length === 0) {
    return (
      <div className="card text-center py-12">
        <Tv size={40} className="text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400">No series found.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-4">
      {series.map((s) => (
        <SeriesCard key={s.series_title} entry={s} onClick={() => onSelect(s.series_title)} />
      ))}
    </div>
  );
}

// ── Library icons ─────────────────────────────────────────────────────────────

const LIBRARY_ICONS: Record<string, string> = {
  movie: "🎬",
  show: "📺",
  artist: "🎵",
  photo: "🖼️",
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Library() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "issues" | "clean">("all");
  const [page, setPage] = useState(0);
  const [activeLibrary, setActiveLibrary] = useState<string | null>(null);
  const [activeSeries, setActiveSeries] = useState<string | null>(null);
  const limit = 50;

  const { data: libraries } = useQuery({
    queryKey: ["plex-libraries"],
    queryFn: api.plexLibraries,
  });
  const selectedLibraries = libraries?.filter((l) => l.selected) ?? [];

  // Auto-select first library on load
  useEffect(() => {
    if (selectedLibraries.length > 0 && activeLibrary === null) {
      setActiveLibrary(selectedLibraries[0].title);
    }
  }, [selectedLibraries.length]);

  const activeLib = selectedLibraries.find((l) => l.title === activeLibrary);
  const isShowLibrary = activeLib?.type === "show";

  // Grid mode: show library, all filter, no active series
  const showGrid = isShowLibrary && filter === "all" && activeSeries === null;

  // When switching away from "all" filter clear the active series
  const handleFilterChange = (f: typeof filter) => {
    setFilter(f);
    setActiveSeries(null);
    setPage(0);
    setSearch("");
  };

  // When switching library, reset drill-down state
  const handleLibraryChange = (name: string) => {
    setActiveLibrary(name);
    setActiveSeries(null);
    setPage(0);
    setSearch("");
  };

  const listParams = {
    skip: page * limit,
    limit,
    search: search || undefined,
    series: activeSeries ?? undefined,
    plex_library: activeLibrary ?? undefined,
    has_issues: filter === "issues" ? true : filter === "clean" ? false : undefined,
  };

  const { data, isLoading } = useQuery({
    queryKey: ["media-list", listParams],
    queryFn: () => api.listMedia(listParams),
    placeholderData: (prev) => prev,
    enabled: !showGrid,
  });

  // Used to display total file count when in grid mode.
  // Same query key as SeriesGrid so TanStack Query deduplicates the request.
  const { data: seriesList } = useQuery({
    queryKey: ["series-list", activeLibrary ?? undefined, search],
    queryFn: () => api.listSeries({ plex_library: activeLibrary ?? undefined, search: search || undefined }),
    enabled: showGrid,
    placeholderData: (prev) => prev,
  });
  const seriesFileTotal = seriesList?.reduce((acc, s) => acc + s.episode_count, 0) ?? 0;

  const qc = useQueryClient();
  const scanAllMut = useMutation({
    mutationFn: () => api.startScan({ scan_type: "full_library" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["active-jobs"] }),
  });

  const searchPlaceholder = activeSeries
    ? `Search episodes in ${activeSeries}…`
    : isShowLibrary && filter === "all"
      ? `Search ${activeLib?.title ?? "shows"}…`
      : `Search ${activeLib?.title ?? "library"}…`;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          {activeSeries ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setActiveSeries(null); setSearch(""); setPage(0); }}
                className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition-colors text-sm"
              >
                <ArrowLeft size={15} />
                {activeLib?.title}
              </button>
              <span className="text-slate-600">/</span>
              <h1 className="text-lg font-bold text-white truncate max-w-xs">{activeSeries}</h1>
            </div>
          ) : (
            <h1 className="text-2xl font-bold text-white">Library</h1>
          )}
          <p className="text-sm text-slate-400 mt-0.5">
            {showGrid ? seriesFileTotal : (data?.total ?? 0)} file{(showGrid ? seriesFileTotal : (data?.total ?? 0)) !== 1 ? "s" : ""}
          </p>
        </div>
        <button onClick={() => scanAllMut.mutate()} disabled={scanAllMut.isPending} className="btn-primary">
          {scanAllMut.isPending
            ? <><Loader2 size={15} className="animate-spin" /> Starting…</>
            : <><ScanLine size={15} /> Scan All</>
          }
        </button>
      </div>

      {/* Library toggles */}
      {selectedLibraries.length > 1 && (
        <div className="flex gap-2">
          {selectedLibraries.map((lib) => (
            <button
              key={lib.key}
              onClick={() => handleLibraryChange(lib.title)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                activeLibrary === lib.title
                  ? "bg-brand-700 border-brand-600 text-white"
                  : "bg-surface-800 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500"
              }`}
            >
              <span>{LIBRARY_ICONS[lib.type] ?? "📁"}</span>
              {lib.title}
            </button>
          ))}
        </div>
      )}

      {/* Search + status filter — hidden in grid mode unless searching */}
      {(!showGrid || activeSeries !== null) && (
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="input pl-9"
            />
          </div>
          <div className="flex rounded-lg overflow-hidden border border-slate-700">
            {(["all", "issues", "clean"] as const).map((f) => (
              <button
                key={f}
                onClick={() => handleFilterChange(f)}
                className={`px-3 py-2 text-sm capitalize transition-colors ${
                  filter === f
                    ? "bg-brand-700 text-white"
                    : "bg-surface-800 text-slate-400 hover:text-slate-200"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Grid mode: search bar + filter tabs stay, but results are grid */}
      {showGrid && (
        <>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input pl-9"
              />
            </div>
            <div className="flex rounded-lg overflow-hidden border border-slate-700">
              {(["all", "issues", "clean"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => handleFilterChange(f)}
                  className={`px-3 py-2 text-sm capitalize transition-colors ${
                    filter === f
                      ? "bg-brand-700 text-white"
                      : "bg-surface-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <SeriesGrid
            plexLibrary={activeLibrary ?? undefined}
            search={search}
            onSelect={(title) => { setActiveSeries(title); setSearch(""); setPage(0); }}
          />
        </>
      )}

      {/* Flat list mode */}
      {!showGrid && (
        <>
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
            </div>
          ) : data?.items.length === 0 ? (
            <div className="card text-center py-12">
              <FileVideo size={40} className="text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No media found.</p>
              <p className="text-sm text-slate-600 mt-1">
                {selectedLibraries.length === 0
                  ? "Select libraries to sync in Settings."
                  : "Sync your Plex library in Settings or start a scan."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {data?.items.map((m) => (
                <MediaRow key={m.id} media={m} showSeriesTitle={activeSeries !== null} />
              ))}
            </div>
          )}

          {data && data.total > limit && (
            <div className="flex items-center justify-between pt-2">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="btn-secondary disabled:opacity-40">
                Previous
              </button>
              <span className="text-sm text-slate-400">
                Page {page + 1} of {Math.ceil(data.total / limit)}
              </span>
              <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * limit >= data.total} className="btn-secondary disabled:opacity-40">
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
