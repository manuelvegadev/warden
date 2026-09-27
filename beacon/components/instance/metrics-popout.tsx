"use client";

import { MetricsView } from "@/components/instance/metrics-chart";

/** The Metrics section in its own window; the popout route is a server component. */
export function MetricsPopout() {
  return <MetricsView mode="popout" />;
}
