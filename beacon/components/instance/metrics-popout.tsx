"use client";

import { useInstance } from "@/components/instance/instance-context";
import { MetricsChart } from "@/components/instance/metrics-chart";

/** Reads the live history out of the instance context; the popout route is a server component. */
export function MetricsPopout() {
  const { manifest, history } = useInstance();
  return <MetricsChart data={history} memoryMb={manifest.memoryMb} instanceId={manifest.id} popout />;
}
