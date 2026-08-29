/** Pure route helpers for instance pages (safe to import from server and client code). */
/** The root page, shared by the sidebar item and the breadcrumb root. */
export const HOME = { href: "/", label: "Home" } as const;
export const DEFAULT_SECTION = "console";
export const instanceHref = (id: string, section: string = DEFAULT_SECTION) => `/instances/${id}/${section}`;
