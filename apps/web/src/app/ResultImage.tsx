/**
 * An image result. STYLE TRIAL (updated Instrument, #29): one smaller than
 * {@link SMALL_IMAGE} pixels each way is shown at that size at least, its
 * pixels kept sharp, and a press opens it as large as the window allows, in
 * a dialog of its own. Instrument as it is shows every image at its own
 * size, scaled down to the panel and never up.
 */

import { useEffect, useRef, useState } from "react";
import { useUpdated } from "./variant.js";

/** Under this many pixels each way, an image is shown larger. */
export const SMALL_IMAGE = 128;

/** The CSS size that brings an image's longer side to {@link SMALL_IMAGE}, keeping its shape. */
export function enlargedSize(
  width: number,
  height: number,
): { readonly width: number; readonly height: number } | undefined {
  if (width <= 0 || height <= 0 || Math.max(width, height) >= SMALL_IMAGE) return undefined;
  const scale = SMALL_IMAGE / Math.max(width, height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function FullSize({
  src,
  alt,
  referrerPolicy,
  onClose,
}: {
  readonly src: string;
  readonly alt: string;
  readonly referrerPolicy?: "no-referrer" | undefined;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Modal: the page behind is inert, Escape closes it, and the focus goes
  // back to the image's button, all by the browser's own <dialog>.
  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
  }, []);
  return (
    <dialog ref={dialog} className="image-dialog" aria-label={alt} onClose={onClose}>
      <img className="image-dialog-picture" src={src} alt={alt} referrerPolicy={referrerPolicy} />
      <p className="actions">
        <button
          type="button"
          onClick={() => {
            dialog.current?.close();
          }}
        >
          Close
        </button>
      </p>
    </dialog>
  );
}

export function ResultImage({
  src,
  outputId,
  referrerPolicy,
  onError,
}: {
  readonly src: string;
  readonly outputId: string;
  readonly referrerPolicy?: "no-referrer" | undefined;
  readonly onError?: (() => void) | undefined;
}) {
  const updated = useUpdated();
  const [natural, setNatural] = useState<{ width: number; height: number } | undefined>();
  const [open, setOpen] = useState(false);
  const alt = `The image result “${outputId}”`;
  const enlarged =
    updated && natural !== undefined ? enlargedSize(natural.width, natural.height) : undefined;
  const image = (
    <img
      className="result-image"
      src={src}
      alt={alt}
      referrerPolicy={referrerPolicy}
      data-enlarged={enlarged === undefined ? undefined : true}
      style={enlarged === undefined ? undefined : enlarged}
      onLoad={(event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        setNatural({ width: naturalWidth, height: naturalHeight });
      }}
      onError={onError}
    />
  );
  if (enlarged === undefined) return image;
  return (
    <>
      <button
        type="button"
        className="image-open"
        aria-haspopup="dialog"
        aria-label={`Open “${outputId}” full size`}
        onClick={() => {
          setOpen(true);
        }}
      >
        {image}
      </button>
      {open && (
        <FullSize
          src={src}
          alt={alt}
          referrerPolicy={referrerPolicy}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
