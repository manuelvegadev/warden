"use client";

import { useEffect, useState } from "react";
import { system } from "@/lib/api";

// Fetched once per page load and shared: the daemon reports process CPU as a percentage of one
// core (like top), so 150 % is two thirds of two cores. Turning that into a share of the host
// needs the core count, and both the tiles and the Metrics chart want it.
let hostCores: number | null = null;

export function useHostCores() {
  const [cores, setCores] = useState(hostCores);
  useEffect(() => {
    if (hostCores) return;
    system.get().then(
      (s) => {
        hostCores = s.cpuCores || null;
        setCores(hostCores);
      },
      () => {},
    );
  }, []);
  return cores;
}
