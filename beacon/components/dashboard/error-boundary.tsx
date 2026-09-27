"use client";

import { Component, type ReactNode } from "react";

/** One module that throws shows so; the rest of the dashboard keeps working. */
export class ModuleErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("dashboard module failed", error);
  }

  render() {
    if (this.state.failed) {
      return <p className="p-4 text-sm text-muted-foreground">This module failed. Reload the page to try again.</p>;
    }
    return this.props.children;
  }
}
