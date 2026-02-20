import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Loader2 } from "lucide-react";
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
