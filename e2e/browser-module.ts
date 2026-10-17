/** Resolve the application's existing module after Vite adds an HMR timestamp.
 * Importing the bare path again creates a second store/runtime in the browser.
 * This helper is used only by tests that inspect the running protocol console.
 */
export function browserModuleUrl(path: string): string {
  return performance.getEntriesByType("resource")
    .filter(entry => { const url = new URL(entry.name); return url.origin === location.origin && url.pathname === path; })
    .at(-1)?.name ?? path;
}
