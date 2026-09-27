import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/** `undefined` until the first effect runs (no `window` to measure yet, e.g. during SSR); a caller
 * that would otherwise render one layout and then flash into the other once this resolves should
 * use this instead of `useIsMobile` and render nothing (or a neutral placeholder) while unknown. */
export function useIsMobileState(): boolean | undefined {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

export function useIsMobile(): boolean {
  return !!useIsMobileState();
}
