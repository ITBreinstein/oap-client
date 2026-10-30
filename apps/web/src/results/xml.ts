/**
 * Reading an XML result with the browser's own parser, for GML (#F4) and KML
 * (#F5), and telling which of the two it is from its root element.
 *
 * A document with a `DOCTYPE` is refused before it is parsed: a DTD can
 * declare entities that expand without end, and nothing GML or KML needs is in
 * one. So is anything that turns out to be HTML: an XML reader is never a way
 * into a page's markup. What is left is parsed as `application/xml`, which
 * runs no scripts and loads nothing, and walked element by element; nothing
 * found in it is trusted to have the shape its name suggests.
 *
 * Nothing here knows a process or a server. Which root counts as what is the
 * standards' namespaces, below, and one observed shape: OGR writes GML as an
 * `ogr:FeatureCollection` in its own namespace whose members are
 * `gml:featureMember`s (ZOO-Project's OGR services, step zero 6).
 */

export const GML_NAMESPACES: ReadonlySet<string> = new Set([
  "http://www.opengis.net/gml",
  "http://www.opengis.net/gml/3.2",
]);

export const WFS_NAMESPACES: ReadonlySet<string> = new Set([
  "http://www.opengis.net/wfs",
  "http://www.opengis.net/wfs/2.0",
]);

export const KML_NAMESPACES: ReadonlySet<string> = new Set([
  "http://www.opengis.net/kml/2.2",
  "http://earth.google.com/kml/2.0",
  "http://earth.google.com/kml/2.1",
  "http://earth.google.com/kml/2.2",
]);

/** Why a text was not read as XML. */
export type XmlRefusal = "not-xml" | "doctype" | "html";

export type XmlRead =
  | { readonly ok: true; readonly root: Element }
  | { readonly ok: false; readonly reason: XmlRefusal };

/** What the root element says the document is. */
export type XmlRootKind = "gml" | "kml" | "other";

/**
 * Whether the prolog — what comes before the root element — declares a
 * DOCTYPE. Only the prolog: a `<!DOCTYPE` inside a KML description's CDATA is
 * text, not a declaration.
 */
function prologHasDoctype(text: string): boolean {
  let at = 0;
  for (;;) {
    while (at < text.length && /\s/.test(text.charAt(at))) at += 1;
    if (text.startsWith("<?", at)) {
      const end = text.indexOf("?>", at + 2);
      if (end === -1) return false;
      at = end + 2;
    } else if (text.startsWith("<!--", at)) {
      const end = text.indexOf("-->", at + 4);
      if (end === -1) return false;
      at = end + 3;
    } else {
      return /^<!DOCTYPE/i.test(text.slice(at, at + 9));
    }
  }
}

/** The text without a byte order mark and leading white space. */
function start(text: string): string {
  return text.replace(/^\uFEFF/, "").trimStart();
}

/** Whether the text begins as XML does, with `<` and not as HTML does. */
export function looksLikeXml(text: string): boolean {
  const head = start(text);
  return head.startsWith("<") && !/^<(?:!doctype\s+html|html[\s>])/i.test(head);
}

/** Parse `text` as XML, refusing a DOCTYPE and HTML. */
export function parseXml(text: string): XmlRead {
  const head = start(text);
  if (!head.startsWith("<")) return { ok: false, reason: "not-xml" };
  if (/^<(?:!doctype\s+html|html[\s>])/i.test(head)) return { ok: false, reason: "html" };
  if (prologHasDoctype(head)) return { ok: false, reason: "doctype" };
  const document = new DOMParser().parseFromString(head, "application/xml");
  // A parser that fails says so with a `parsererror` element: as the root
  // (Firefox, jsdom) or inside it (Chromium, WebKit).
  if (document.getElementsByTagName("parsererror").length > 0) {
    return { ok: false, reason: "not-xml" };
  }
  const root = document.documentElement;
  if (document.doctype !== null) return { ok: false, reason: "doctype" };
  if (root.localName.toLowerCase() === "html") return { ok: false, reason: "html" };
  return { ok: true, root };
}

/** The element children of an element, in order. */
export function childElements(element: Element): Element[] {
  return Array.from(element.children);
}

/** Whether an element is `name` in one of `namespaces`. */
export function isElement(
  element: Element,
  namespaces: ReadonlySet<string>,
  ...names: readonly string[]
): boolean {
  return namespaces.has(element.namespaceURI ?? "") && names.includes(element.localName);
}

/** The first child element named `name` in one of `namespaces`. */
export function childNamed(
  element: Element,
  namespaces: ReadonlySet<string>,
  name: string,
): Element | undefined {
  return childElements(element).find((child) => isElement(child, namespaces, name));
}

/** Every child element named `name` in one of `namespaces`. */
export function childrenNamed(
  element: Element,
  namespaces: ReadonlySet<string>,
  name: string,
): Element[] {
  return childElements(element).filter((child) => isElement(child, namespaces, name));
}

/**
 * Whether the root is a GML feature collection: a `FeatureCollection` in the
 * GML or WFS namespace, or any element named `…FeatureCollection` whose
 * children are GML or WFS feature members (an application schema's own, as
 * OGR's).
 */
function isGmlFeatureCollection(root: Element): boolean {
  if (!root.localName.endsWith("FeatureCollection")) return false;
  const namespace = root.namespaceURI ?? "";
  if (GML_NAMESPACES.has(namespace) || WFS_NAMESPACES.has(namespace)) return true;
  return childElements(root).some(
    (child) =>
      isElement(child, GML_NAMESPACES, "featureMember", "featureMembers") ||
      isElement(child, WFS_NAMESPACES, "member"),
  );
}

/** What the root element says the document is. */
export function rootKind(root: Element): XmlRootKind {
  if (root.localName === "kml" && KML_NAMESPACES.has(root.namespaceURI ?? "")) return "kml";
  if (isGmlFeatureCollection(root)) return "gml";
  return "other";
}

/** An element's text, trimmed: CDATA included, as text. */
export function textOf(element: Element): string {
  return element.textContent.trim();
}
