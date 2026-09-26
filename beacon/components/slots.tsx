"use client";

import { createContext, useContext, useState } from "react";
import { createPortal } from "react-dom";

type Slot = { element: HTMLElement | null; setElement: (el: HTMLElement | null) => void };

/**
 * A place in the dashboard's chrome that a page fills from below. The sidebar and the site header
 * are rendered by the dashboard layout, outside the instance's provider, so an instance page
 * portals its part into an empty element the chrome leaves (ADR-021).
 */
function createSlot() {
  const Ctx = createContext<Slot | null>(null);

  function Provider({ children }: { children: React.ReactNode }) {
    const [element, setElement] = useState<HTMLElement | null>(null);
    return <Ctx.Provider value={{ element, setElement }}>{children}</Ctx.Provider>;
  }

  /** The empty element the slot's content is portalled into. */
  function Target({ className }: { className?: string }) {
    const slot = useContext(Ctx);
    return <div ref={slot?.setElement} className={className} />;
  }

  /** Renders its children in the slot, or nowhere when the page has no such chrome. */
  function Fill({ children }: { children: React.ReactNode }) {
    const element = useContext(Ctx)?.element;
    return element ? createPortal(children, element) : null;
  }

  return { Provider, Target, Fill };
}

/** The open instance's status panel, at the foot of the app sidebar. */
export const StatusSlot = createSlot();

/** The current page's own actions, in the site header to the right of the breadcrumb. */
export const PageActions = createSlot();

/** Both slots, for the dashboard layout to wrap the sidebar and the page in. */
export function SlotsProvider({ children }: { children: React.ReactNode }) {
  return (
    <StatusSlot.Provider>
      <PageActions.Provider>{children}</PageActions.Provider>
    </StatusSlot.Provider>
  );
}
