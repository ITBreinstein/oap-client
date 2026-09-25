/**
 * A `data:` URL for a result's bytes, so an `<img>` or the map can show them.
 *
 * Read asynchronously, and a plain string once read: nothing to revoke, so a
 * page that runs a process many times keeps only the pictures still shown.
 * (A `blob:` URL would be cheaper to make, but it lives until revoked, and
 * revoking it from an effect's cleanup breaks it under StrictMode's second
 * run.) Undefined until the read is done, and for a different blob than the
 * one read.
 */

import { useEffect, useState } from "react";

export function useDataUrl(blob: Blob | undefined): string | undefined {
  const [read, setRead] = useState<{ readonly blob: Blob; readonly url: string } | undefined>();
  useEffect(() => {
    if (blob === undefined) return;
    const reader = new FileReader();
    let live = true;
    reader.onload = () => {
      if (live && typeof reader.result === "string") setRead({ blob, url: reader.result });
    };
    reader.readAsDataURL(blob);
    return () => {
      live = false;
      if (reader.readyState === FileReader.LOADING) reader.abort();
    };
  }, [blob]);
  return blob !== undefined && read?.blob === blob ? read.url : undefined;
}
