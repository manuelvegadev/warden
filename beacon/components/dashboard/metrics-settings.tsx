"use client";

import { KindPicker } from "@/components/dashboard/edit-chrome";
import type { MetricsSettings as MetricsModuleSettings } from "@/lib/dashboard-modules";
import { applicableKinds, METRIC_KINDS, METRIC_LABEL, type MetricKind } from "@/lib/metrics-kinds";

/**
 * The Metrics module's settings (ADR-026): a checkbox per applicable chart, at least one always
 * checked. Self-contained: the caller supplies the current settings and gets the next ones.
 */
export function MetricsSettings({
  settings,
  tpsAvailable,
  onSettings,
}: {
  settings: MetricsModuleSettings;
  tpsAvailable?: boolean;
  onSettings: (settings: MetricsModuleSettings) => void;
}) {
  const toggle = (kind: MetricKind, checked: boolean) => {
    const charts = checked ? [...settings.charts, kind] : settings.charts.filter((k) => k !== kind);
    if (charts.length === 0) return; // at least one chart stays checked
    onSettings({ ...settings, charts });
  };

  return (
    <KindPicker
      label="Metrics settings"
      kinds={applicableKinds(METRIC_KINDS, tpsAvailable ?? false)}
      labels={METRIC_LABEL}
      checked={settings.charts}
      disabled={(kind) => settings.charts.length === 1 && settings.charts.includes(kind)}
      onToggle={toggle}
    />
  );
}
