import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Loader2, Search, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { api, SettingValue } from "../api/client";
import PlexConnect from "../components/PlexConnect";

// ── Generic setting row ───────────────────────────────────────────────────────

function SettingRow({
  settingKey,
  meta,
  onSave,
}: {
  settingKey: string;
  meta: SettingValue;
  onSave: (key: string, value: string) => void;
}) {
  const [val, setVal] = useState(meta.value);
  const dirty = val !== meta.value;

  return (
    <div className="grid grid-cols-[1fr_2fr] gap-4 items-start py-4 border-b border-slate-800 last:border-0">
      <div>
        <p className="text-sm font-medium text-slate-200 font-mono">{settingKey}</p>
        <p className="text-xs text-slate-500 mt-0.5">{meta.description}</p>
        {!meta.raw_set && meta.default && (
          <p className="text-xs text-slate-600 mt-0.5">default: {meta.default}</p>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={meta.default || ""}
          className="input flex-1"
        />
        {dirty && (
          <button onClick={() => onSave(settingKey, val)} className="btn-primary shrink-0">
            <Save size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Path diagnostics ──────────────────────────────────────────────────────────

function PathDiagnostics() {
  const qc = useQueryClient();
  const [purgeConfirm, setPurgeConfirm] = useState(false);

  const { data, refetch, isFetching } = useQuery({
    queryKey: ["path-check"],
    queryFn: api.plexPathCheck,
    enabled: false,
  });

  const applyMut = useMutation({
    mutationFn: (s: { plex_prefix: string; local_prefix: string }) =>
      api.plexSetPathPrefix({ plex_prefix: s.plex_prefix, local_prefix: s.local_prefix }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["plex-status"] });
      qc.invalidateQueries({ queryKey: ["path-check"] });
    },
  });

  const purgeMut = useMutation({
    mutationFn: api.purgeMissingMedia,
    onSuccess: () => {
      setPurgeConfirm(false);
      qc.invalidateQueries({ queryKey: ["media-list"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["path-check"] });
      refetch();
    },
  });

  const allOk = data?.samples.length && data.samples.every((s) => s.exists);
  const allMissing = data?.samples.length && data.samples.every((s) => !s.exists);
  const someMissing = data?.samples.length && data.samples.some((s) => !s.exists);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Path Diagnostics</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Verify Rectifierr can reach your media files and detect prefix mismatches.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="btn-secondary shrink-0"
        >
          {isFetching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          {isFetching ? "Checking…" : "Run Diagnostic"}
        </button>
      </div>

      {data && (
        <div className="space-y-4">
          {/* Media root */}
          <div className="flex items-center gap-2 text-sm">
            {data.media_root_exists ? (
              <CheckCircle2 size={15} className="text-green-400 shrink-0" />
            ) : (
              <XCircle size={15} className="text-red-400 shrink-0" />
            )}
            <span className="text-slate-400">Media root</span>
            <span className="font-mono text-slate-200">{data.media_root}</span>
            {!data.media_root_exists && (
              <span className="text-red-400 text-xs">(not found)</span>
            )}
          </div>

          {/* Sample paths */}
          {data.samples.length === 0 ? (
            <p className="text-sm text-slate-500">No media records in database — sync from Plex first.</p>
          ) : (
            <div>
              <p className="text-xs text-slate-500 mb-2">Sample stored paths:</p>
              <div className="space-y-1">
                {data.samples.map((s) => (
                  <div key={s.path} className="flex items-start gap-2 text-xs">
                    {s.exists ? (
                      <CheckCircle2 size={13} className="text-green-400 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle size={13} className="text-red-400 shrink-0 mt-0.5" />
                    )}
                    <span className={`font-mono break-all ${s.exists ? "text-slate-300" : "text-red-300"}`}>
                      {s.path}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All good */}
          {allOk && (
            <p className="text-sm text-green-400 flex items-center gap-1.5">
              <CheckCircle2 size={14} /> All sampled files found — path mapping looks correct.
            </p>
          )}

          {/* Suggestion */}
          {allMissing && data.suggestion && (
            <div className="bg-amber-950/40 border border-amber-800/50 rounded-lg p-3 space-y-2">
              <p className="text-xs text-amber-300 flex items-center gap-1.5">
                <AlertTriangle size={13} /> Suggested prefix fix (based on matching filename in media root):
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div>
                  <span className="text-slate-500">Plex prefix</span>
                  <p className="text-slate-200 mt-0.5 break-all">{data.suggestion.plex_prefix}</p>
                </div>
                <div>
                  <span className="text-slate-500">Local prefix</span>
                  <p className="text-slate-200 mt-0.5 break-all">{data.suggestion.local_prefix}</p>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Matched <span className="font-mono">{data.suggestion.matched_stored.split("/").pop()}</span>{" "}
                at <span className="font-mono">{data.suggestion.matched_found}</span>
              </p>
              <button
                onClick={() =>
                  applyMut.mutate({
                    plex_prefix: data.suggestion!.plex_prefix,
                    local_prefix: data.suggestion!.local_prefix,
                  })
                }
                disabled={applyMut.isPending}
                className="btn-primary text-xs py-1"
              >
                {applyMut.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
                Apply Suggestion
              </button>
              {applyMut.isSuccess && (
                <p className="text-xs text-green-400">
                  Prefixes saved. Re-sync from Plex to update stored paths.
                </p>
              )}
            </div>
          )}

          {/* Missing but no suggestion */}
          {allMissing && !data.suggestion && (
            <div className="bg-red-950/40 border border-red-800/50 rounded-lg p-3">
              <p className="text-xs text-red-300 flex items-center gap-1.5">
                <AlertTriangle size={13} />
                Files not found and could not auto-detect mapping. Check that your media volume is
                mounted correctly and update the Plex / Local prefix in Settings → Library manually.
              </p>
            </div>
          )}

          {/* Purge unreachable */}
          {someMissing && (
            <div className="border-t border-slate-800 pt-3">
              {!purgeConfirm ? (
                <button
                  onClick={() => setPurgeConfirm(true)}
                  className="btn-secondary text-xs py-1 text-red-400 border-red-900 hover:bg-red-950/40"
                >
                  Remove unreachable files from library
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <p className="text-xs text-red-300">
                    This will delete all library records whose path doesn't exist on disk. Continue?
                  </p>
                  <button
                    onClick={() => purgeMut.mutate()}
                    disabled={purgeMut.isPending}
                    className="btn-primary text-xs py-1 bg-red-700 hover:bg-red-600 shrink-0"
                  >
                    {purgeMut.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
                    Confirm
                  </button>
                  <button
                    onClick={() => setPurgeConfirm(false)}
                    className="btn-secondary text-xs py-1 shrink-0"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {purgeMut.isSuccess && (
                <p className="text-xs text-green-400 mt-1.5">
                  Removed {purgeMut.data.removed} unreachable record{purgeMut.data.removed !== 1 ? "s" : ""}.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ── Page ─────────────────────────────────────────────────────────────────────

const SETTING_GROUPS: Record<string, string[]> = {
  Library: ["media_root", "plex_path_prefix", "local_path_prefix"],
  "Bumper Detection": [
    "bumper_scan_seconds",
    "bumper_max_duration",
    "bumper_min_duration",
    "scene_threshold",
    "min_confidence",
  ],
  "Logo Detection": [
    "logo_detection_enabled",
    "logo_corner_margin",
    "logo_persistence",
  ],
  Automation: ["auto_scan_enabled", "auto_scan_hour"],
};

export default function Settings() {
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: api.getSettings,
  });

  const saveMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      api.updateSetting(key, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-slate-400 mt-0.5">Configure Rectifierr</p>
      </div>

      {/* Plex Integration — uses its own component */}
      <div className="card">
        <h2 className="text-base font-semibold text-white mb-4">Plex Integration</h2>
        <PlexConnect />
      </div>

      {/* Path diagnostics */}
      <PathDiagnostics />

      {/* All other setting groups */}
      {Object.entries(SETTING_GROUPS).map(([group, keys]) => {
        const visible = keys.filter((k) => settings?.[k]);
        if (visible.length === 0) return null;
        return (
          <div key={group} className="card">
            <h2 className="text-base font-semibold text-white mb-1">{group}</h2>
            {visible.map((k) => (
              <SettingRow
                key={k}
                settingKey={k}
                meta={settings![k]}
                onSave={(key, value) => saveMut.mutate({ key, value })}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
