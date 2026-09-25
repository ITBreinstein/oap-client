/**
 * Hand the user a file. The object URL lives only as long as the click that
 * uses it, so there is nothing to revoke later and nothing to leak.
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
  // Revoked on the next turn: the click has started the download by then.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
