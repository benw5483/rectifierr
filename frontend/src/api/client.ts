const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ── Media ────────────────────────────────────────────────────────────────────
export const api = {
  health: () => request<{ status: string; version: string }>("/health"),

  // Stats
  stats: () =>
    request<{
      total_files: number;
      scanned_files: number;
      unscanned_files: number;
      total_issues: number;
      unresolved_issues: number;
      bumpers_found: number;
      logos_found: number;
      files_with_issues: number;
      clean_files: number;
    }>("/media/stats"),

  // Media listing
  listMedia: (params?: {
    skip?: number;
    limit?: number;
    media_type?: string;
    search?: string;
    series?: string;
    plex_library?: string;
    has_issues?: boolean;
    unresolved_only?: boolean;
  }) => {
    const qs = new URLSearchParams();
    if (params?.skip != null) qs.set("skip", String(params.skip));
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.media_type) qs.set("media_type", params.media_type);
    if (params?.search) qs.set("search", params.search);
    if (params?.series) qs.set("series", params.series);
    if (params?.plex_library) qs.set("plex_library", params.plex_library);
    if (params?.has_issues != null) qs.set("has_issues", String(params.has_issues));
    if (params?.unresolved_only) qs.set("unresolved_only", "true");
    return request<{ total: number; items: MediaFile[] }>(`/media/?${qs}`);
  },

  listSeries: (params?: { plex_library?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.plex_library) qs.set("plex_library", params.plex_library);
    if (params?.search) qs.set("search", params.search);
    return request<SeriesEntry[]>(`/media/series?${qs}`);
  },

  getMedia: (id: number) => request<MediaFile>(`/media/${id}`),
  scanMedia: (id: number) => request<{ job_id: number }>(`/media/${id}/scan`, { method: "POST" }),
  deleteMedia: (id: number) => request<void>(`/media/${id}`, { method: "DELETE" }),
  getIssues: (mediaId: number) => request<Issue[]>(`/media/${mediaId}/issues`),
  resolveIssue: (mediaId: number, issueId: number, method: string) =>
    request<void>(`/media/${mediaId}/issues/${issueId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ method }),
    }),
  // Trim jobs
  startTrim: (
    mediaId: number,
    body: { remove_start: number; remove_end: number; issue_id?: number }
  ) =>
    request<TrimJob>(`/media/${mediaId}/trim`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getTrimJob: (mediaId: number, jobId: number) =>
    request<TrimJob>(`/media/${mediaId}/trim-jobs/${jobId}`),
  listTrimJobs: (mediaId: number) =>
    request<TrimJob[]>(`/media/${mediaId}/trim-jobs`),

  // Scans
  startScan: (body: { scan_type: string; target_path?: string; media_file_id?: number }) =>
    request<ScanJob>("/scan/", { method: "POST", body: JSON.stringify(body) }),
  getScanQueue: (status?: string) => {
    const qs = status ? `?status=${status}` : "";
    return request<ScanJob[]>(`/scan/queue${qs}`);
  },
  getActiveScan: () => request<ScanJob[]>("/scan/active"),
  getJob: (id: number) => request<ScanJob>(`/scan/${id}`),
  cancelJob: (id: number) => request<void>(`/scan/${id}`, { method: "DELETE" }),

  // Activity
  getActivity: (skip = 0, limit = 50) =>
    request<{ total: number; items: ScanJob[] }>(`/activity/?skip=${skip}&limit=${limit}`),
  getRecentIssues: (limit = 25) =>
    request<RecentIssue[]>(`/activity/recent-issues?limit=${limit}`),

  // Settings
  getSettings: () => request<Record<string, SettingValue>>("/settings/"),
  updateSetting: (key: string, value: string) =>
    request<void>(`/settings/${key}`, { method: "PUT", body: JSON.stringify({ value }) }),

  // Plex OAuth + library management
  plexStatus: () => request<PlexStatus>("/plex/status"),
  plexAuthStart: () => request<PlexPinResponse>("/plex/auth/start", { method: "POST" }),
  plexAuthPoll: (pinId: number) => request<{ authenticated: boolean }>(`/plex/auth/poll/${pinId}`),
  plexServers: () => request<PlexServer[]>("/plex/servers"),
  plexSelectServer: (body: { name: string; machine_id: string; url: string }) =>
    request<{ saved: boolean; name: string; url: string }>("/plex/server", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  plexSetPathPrefix: (body: { plex_prefix: string; local_prefix: string }) =>
    request<{ saved: boolean }>("/plex/path-prefix", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  plexSync: () => request<{ started: boolean; message?: string }>("/plex/sync", { method: "POST" }),
  plexSyncStatus: () => request<PlexSyncStatus>("/plex/sync/status"),
  plexCancelSync: () => request<{ cancelled: boolean }>("/plex/sync", { method: "DELETE" }),
  plexLibraries: () => request<PlexLibrary[]>("/plex/libraries"),
  plexSaveLibraries: (keys: string[]) =>
    request<{ saved: boolean; keys: string[] }>("/plex/library-selection", {
      method: "PUT",
      body: JSON.stringify({ keys }),
    }),
  plexDisconnect: () => request<{ disconnected: boolean }>("/plex/disconnect", { method: "DELETE" }),
  plexPathCheck: () => request<PathCheckResult>("/plex/path-check"),
};

// ── Types ────────────────────────────────────────────────────────────────────
export interface SeriesEntry {
  series_title: string;
  episode_count: number;
  unresolved_issues: number;
}

export interface MediaFile {
  id: number;
  path: string;
  title: string;
  media_type: "movie" | "episode";
  series_title?: string;
  season_number?: number;
  episode_number?: number;
  duration_seconds?: number;
  file_size_bytes?: number;
  resolution?: string;
  codec?: string;
  container?: string;
  last_scanned?: string;
  added_at: string;
  issue_count: number;
  unresolved_issues: number;
  issues?: Issue[];
}

export interface Issue {
  id: number;
  media_file_id: number;
  issue_type: "bumper" | "channel_logo" | "commercial";
  start_seconds: number;
  end_seconds: number;
  duration: number;
  confidence: number;
  description?: string;
  /** "start" | "end" — populated by bumper detector */
  position?: string;
  resolved: boolean;
  resolved_at?: string;
  resolution_method?: string;
  created_at: string;
}

export interface ScanJob {
  id: number;
  scan_type: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  target_path?: string;
  media_file_id?: number;
  total_files: number;
  processed_files: number;
  issues_found: number;
  progress_pct: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  duration_seconds?: number;
  error_message?: string;
}

export interface TrimJob {
  id: number;
  media_file_id: number;
  issue_id?: number;
  status: "pending" | "running" | "completed" | "failed";
  remove_start: number;
  remove_end: number;
  remove_duration: number;
  original_duration?: number;
  backup_path?: string;
  elapsed_seconds?: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
}

export interface RecentIssue {
  id: number;
  media_file_id: number;
  issue_type: string;
  description?: string;
  confidence: number;
  resolved: boolean;
  created_at: string;
  media_title?: string;
  series_title?: string;
}

export interface SettingValue {
  value: string;
  description: string;
  default: string;
  raw_set: boolean;
}

// ── Plex types ────────────────────────────────────────────────────────────────

export interface PlexStatus {
  connected: boolean;
  account: {
    username: string;
    id: string;
    thumb: string;
  };
  server: {
    name: string;
    machine_id: string;
    url: string;
  };
  path_prefix: {
    plex: string;
    local: string;
  };
  sync: PlexSyncStatus;
  library_keys: string[];
}

export interface PlexPinResponse {
  pin_id: number;
  pin_code: string;
  auth_url: string;
  expires_at?: string;
}

export interface PlexServer {
  name: string;
  machine_id: string;
  owned: boolean;
  best_url: string;
  connections: Array<{ uri: string; local: boolean; relay: boolean }>;
}

export interface PlexSyncStatus {
  status: "idle" | "running" | "completed" | "failed" | "cancelled";
  started_at?: string;
  completed_at?: string;
  total?: number;
  processed?: number;
  imported?: number;
  updated?: number;
  error?: string;
}

export interface PlexLibrary {
  key: string;
  title: string;
  type: "movie" | "show" | "artist" | "photo" | string;
  selected: boolean;
}

export interface PathCheckResult {
  current: { plex_prefix: string; local_prefix: string };
  samples: Array<{ path: string; exists: boolean }>;
  suggestion?: {
    plex_prefix: string;
    local_prefix: string;
    matched_stored: string;
    matched_found: string;
  };
  media_root: string;
  media_root_exists: boolean;
}
