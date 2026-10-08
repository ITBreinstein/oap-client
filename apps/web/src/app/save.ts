/**
 * How long a download's object URL is kept. The click starts the download,
 * but WebKit is known to lose a blob download whose URL is revoked straight
 * after it (review W26), so it is kept for long enough to have been read.
 */
export const REVOKE_AFTER_MS = 30_000;

/**
 * Hand the user a file. The object URL is revoked once the download has had
 * time to read it, so nothing is left to leak.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, REVOKE_AFTER_MS);
}
