/**
 * Filenames carry commas, em dashes and '#', so they are sent twice: a plain
 * ASCII `filename` that every client understands, and RFC 5987 `filename*`
 * with the real one for those that do.
 */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
