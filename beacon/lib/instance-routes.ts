/** Pure route helpers for instance pages (safe to import from server and client code). */
export const DEFAULT_SECTION = "console";
export const instanceHref = (id: string, section: string = DEFAULT_SECTION) => `/instances/${id}/${section}`;
