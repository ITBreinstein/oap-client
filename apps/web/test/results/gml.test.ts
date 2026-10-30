/**
 * #F4: GML read for the map. The axis-order table row by row; both GML shapes
 * that exist — GML 2 as ZOO-Project's OGR services write it (the census
 * captures) and GML 3.2 from `breinstein-formats` — and what is refused, with
 * why.
 */

import { describe, expect, it } from "vitest";
import { GML_AXIS_ORDER, gmlAxisRule, placeGml, readGml } from "../../src/results/gml.js";
import { parseXml, rootKind } from "../../src/results/xml.js";
import { readLabelledXml } from "../../src/results/sniff.js";
import { plotStatus } from "../../src/results/plottable.js";
import { toRenderable, type RenderableResult } from "../../src/results/renderable.js";
import { placementWords } from "../../src/app/placement-words.js";
import { resultObservations } from "../../src/observations.js";
import { envelopeOf, httpFixture } from "./http-fixtures.js";

const GML2 = 'xmlns:gml="http://www.opengis.net/gml"';
const GML32 = 'xmlns:gml="http://www.opengis.net/gml/3.2"';

/** One feature with one geometry, in an OGR-style collection. */
function collection(geometry: string, namespace = GML2): string {
  return `<ogr:FeatureCollection xmlns:ogr="http://ogr.maptools.org/" ${namespace}>
  <gml:featureMember><ogr:f fid="f.0"><ogr:geometryProperty>${geometry}</ogr:geometryProperty>
  <ogr:name>A &lt;b&gt;name&lt;/b&gt;</ogr:name></ogr:f></gml:featureMember>
</ogr:FeatureCollection>`;
}

function root(text: string): Element {
  const parsed = parseXml(text);
  if (!parsed.ok) throw new Error(`not XML: ${parsed.reason}`);
  return parsed.root;
}

async function placedFirst(text: string): Promise<number[]> {
  const read = readGml(root(text));
  if (!read.ok) throw new Error(read.reason);
  const placement = await placeGml(read);
  if (!("value" in placement)) throw new Error(`not placed: ${placement.kind}`);
  const value = placement.value as { features: { geometry: { coordinates: number[] } }[] };
  const first = value.features[0]?.geometry.coordinates;
  if (first === undefined) throw new Error("no position");
  return first;
}

/** Utrecht, as each row writes it: longitude and latitude, or RD New's easting and northing. */
const UTRECHT: Readonly<Record<string, string>> = {
  "longitude-first": "5.123094 52.091062",
  "latitude-first": "52.091062 5.123094",
  "easting-first": "136900 455900",
};

describe("the axis-order table, every row", () => {
  it.each(GML_AXIS_ORDER.map((row) => [row.form, row] as const))("%s", async (_, row) => {
    expect(gmlAxisRule(row.example)).toBe(row);
    const [lon = 0, lat = 0] = await placedFirst(
      collection(
        `<gml:Point srsName="${row.example}"><gml:pos>${UTRECHT[row.order] ?? ""}</gml:pos></gml:Point>`,
      ),
    );
    // Wherever it is written, and however, it lands in Utrecht.
    expect(lon).toBeCloseTo(5.1231, 4);
    expect(lat).toBeCloseTo(52.0911, 4);
  });

  it("covers each spelling the census and the standards use", () => {
    expect(gmlAxisRule("https://www.opengis.net/def/crs/EPSG/0/4326")?.order).toBe(
      "latitude-first",
    );
    expect(gmlAxisRule("urn:ogc:def:crs:EPSG:6.6:4326")?.order).toBe("latitude-first");
    expect(gmlAxisRule("EPSG:28992")?.order).toBe("easting-first");
    expect(gmlAxisRule("http://www.opengis.net/def/crs/EPSG/0/28992")?.order).toBe("easting-first");
    expect(gmlAxisRule("urn:ogc:def:crs:OGC:1.3:CRS84")?.order).toBe("longitude-first");
    expect(gmlAxisRule("http://www.opengis.net/def/crs/EPSG/0/4258")).toBeUndefined();
  });

  it("does not place a system it does not know, and says which", async () => {
    const read = readGml(
      root(
        collection(
          '<gml:Point srsName="http://www.opengis.net/def/crs/EPSG/0/4258"><gml:pos>52 5</gml:pos></gml:Point>',
        ),
      ),
    );
    if (!read.ok) throw new Error(read.reason);
    expect(await placeGml(read)).toEqual({
      kind: "other",
      uri: "http://www.opengis.net/def/crs/EPSG/0/4258",
      from: "gml-srsname",
    });
  });

  it("does not place GML with no srsName at all, whatever its numbers", async () => {
    const read = readGml(root(collection("<gml:Point><gml:pos>5.12 52.09</gml:pos></gml:Point>")));
    if (!read.ok) throw new Error(read.reason);
    expect(read.srs).toEqual({ kind: "none" });
    expect(await placeGml(read)).toEqual({ kind: "unstated", from: "gml-srsname" });
  });
});

describe("simple features, and nothing else", () => {
  it("reads every geometry type, with interiors, in every position form", () => {
    const read = readGml(
      root(
        `<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" ${GML32} xmlns:b="urn:b">
        <wfs:member><b:f gml:id="a"><b:g>
          <gml:Polygon srsName="EPSG:28992"><gml:exterior><gml:LinearRing>
            <gml:posList srsDimension="3">0 0 1 10 0 1 10 10 1 0 10 1 0 0 1</gml:posList>
          </gml:LinearRing></gml:exterior><gml:interior><gml:LinearRing>
            <gml:pos>2 2</gml:pos><gml:pos>3 2</gml:pos><gml:pos>3 3</gml:pos><gml:pos>2 2</gml:pos>
          </gml:LinearRing></gml:interior></gml:Polygon></b:g></b:f></wfs:member>
        <wfs:member><b:f gml:id="b"><b:g><gml:MultiSurface srsName="EPSG:28992"><gml:surfaceMember>
          <gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>0 0 1 0 1 1 0 0</gml:posList>
          </gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember></gml:MultiSurface></b:g></b:f></wfs:member>
        <wfs:member><b:f gml:id="c"><b:g><gml:MultiCurve srsName="EPSG:28992"><gml:curveMember>
          <gml:LineString><gml:posList>0 0 5 5</gml:posList></gml:LineString></gml:curveMember>
          </gml:MultiCurve></b:g></b:f></wfs:member>
        <wfs:member><b:f gml:id="d"><b:g><gml:MultiPoint srsName="EPSG:28992"><gml:pointMembers>
          <gml:Point><gml:pos>1 1</gml:pos></gml:Point><gml:Point><gml:pos>2 2</gml:pos></gml:Point>
          </gml:pointMembers></gml:MultiPoint></b:g></b:f></wfs:member>
        </wfs:FeatureCollection>`,
      ),
    );
    if (!read.ok) throw new Error(read.reason);
    expect(read.srs).toEqual({ kind: "one", srsName: "EPSG:28992" });
    expect(read.heightsDropped).toBe(true);
    expect(read.geojson.features.map((feature) => [feature.id, feature.geometry?.type])).toEqual([
      ["a", "Polygon"],
      ["b", "MultiPolygon"],
      ["c", "MultiLineString"],
      ["d", "MultiPoint"],
    ]);
    expect(read.geojson.features[0]?.geometry).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [2, 2],
          [3, 2],
          [3, 3],
          [2, 2],
        ],
      ],
    });
  });

  it("reads GML 2's coordinates with its own separators, and coord", () => {
    const read = readGml(
      root(
        collection(
          `<gml:MultiLineString srsName="EPSG:4326"><gml:lineStringMember><gml:LineString>
          <gml:coordinates cs=";" ts="|" decimal=",">5,1;52,1|5,2;52,2</gml:coordinates>
          </gml:LineString></gml:lineStringMember><gml:lineStringMember><gml:LineString>
          <gml:coord><gml:X>5.3</gml:X><gml:Y>52.3</gml:Y></gml:coord>
          <gml:coord><gml:X>5.4</gml:X><gml:Y>52.4</gml:Y></gml:coord>
          </gml:LineString></gml:lineStringMember></gml:MultiLineString>`,
        ),
      ),
    );
    if (!read.ok) throw new Error(read.reason);
    expect(read.geojson.features[0]?.geometry).toEqual({
      type: "MultiLineString",
      coordinates: [
        [
          [5.1, 52.1],
          [5.2, 52.2],
        ],
        [
          [5.3, 52.3],
          [5.4, 52.4],
        ],
      ],
    });
  });

  it("keeps a feature's simple children as text, by local name, and its fid", () => {
    const read = readGml(
      root(collection('<gml:Point srsName="EPSG:4326"><gml:pos>5 52</gml:pos></gml:Point>')),
    );
    if (!read.ok) throw new Error(read.reason);
    expect(read.geojson.features[0]).toMatchObject({
      id: "f.0",
      properties: { name: "A <b>name</b>" },
    });
  });

  it.each([
    [
      "a curve with arcs",
      '<gml:Curve srsName="EPSG:4326"><gml:segments/></gml:Curve>',
      "It holds a gml:Curve, which this page does not draw.",
    ],
    [
      "a surface of patches in a MultiSurface",
      '<gml:MultiSurface srsName="EPSG:4326"><gml:surfaceMember><gml:Surface/></gml:surfaceMember></gml:MultiSurface>',
      "It holds a gml:Surface, which this page does not draw.",
    ],
    [
      "a coordinate that is not a number",
      '<gml:Point srsName="EPSG:4326"><gml:pos>5 north</gml:pos></gml:Point>',
      "One of its coordinates is not a number.",
    ],
    [
      "a position list that does not divide",
      '<gml:LineString srsName="EPSG:4326"><gml:posList>1 2 3</gml:posList></gml:LineString>',
      "One of its position lists does not divide into whole positions.",
    ],
  ])("refuses %s, with why", (_, geometry, reason) => {
    expect(readGml(root(collection(geometry)))).toEqual({ ok: false, reason });
  });

  it("refuses geometries that name more than one coordinate system", () => {
    const text = `<ogr:FeatureCollection xmlns:ogr="http://ogr.maptools.org/" ${GML2}>
      <gml:featureMember><ogr:f><ogr:g><gml:Point srsName="EPSG:4326"><gml:pos>5 52</gml:pos></gml:Point></ogr:g></ogr:f></gml:featureMember>
      <gml:featureMember><ogr:f><ogr:g><gml:Point srsName="EPSG:28992"><gml:pos>1 1</gml:pos></gml:Point></ogr:g></ogr:f></gml:featureMember>
    </ogr:FeatureCollection>`;
    expect(readGml(root(text))).toEqual({
      ok: false,
      reason: "Its geometries name more than one coordinate system (EPSG:4326 and EPSG:28992).",
    });
  });

  it("refuses a DOCTYPE before parsing, and says so for a body labelled GML", async () => {
    const text = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]>${collection("")}`;
    expect(parseXml(text)).toEqual({ ok: false, reason: "doctype" });
    expect(await readLabelledXml(text, "application/gml+xml")).toEqual({
      ok: false,
      parsedAs: "gml",
      reason: "It declares a DOCTYPE, which this page does not read.",
    });
  });

  it("refuses a body labelled GML that is not a feature collection", async () => {
    expect(
      await readLabelledXml(
        "<gml:Point xmlns:gml='http://www.opengis.net/gml'/>",
        "application/gml+xml",
      ),
    ).toEqual({
      ok: false,
      parsedAs: "gml",
      reason: "Labelled GML, but it is not a GML feature collection.",
    });
  });

  it("leaves plain XML as text: no claim, no reason", async () => {
    expect(await readLabelledXml("<config><a>1</a></config>", "text/xml")).toBeUndefined();
    expect(rootKind(root("<config/>"))).toBe("other");
    expect(parseXml("<html xmlns='http://www.w3.org/1999/xhtml'/>")).toEqual({
      ok: false,
      reason: "html",
    });
    expect(parseXml("<!DOCTYPE html><html><body/></html>")).toEqual({ ok: false, reason: "html" });
  });
});

const RUN = {
  runId: "r",
  endpoint: "http://localhost:5090/ogc-api",
  processId: "Buffer",
  declaredTransmission: ["value"],
  linkOutputs: [],
};

async function rendered(key: string, url = "http://localhost:5090/ogc-api/processes/p/execution") {
  const [result] = await toRenderable(envelopeOf(key, url), {
    outputIds: ["Result"],
    processId: "Buffer",
  });
  if (result === undefined) throw new Error("no result");
  return result;
}

function firstPosition(result: RenderableResult): readonly number[] {
  const status = plotStatus(result);
  if (status.kind !== "plotted") throw new Error(`not plotted: ${status.kind}`);
  const [shape] = status.shapes;
  if (shape === undefined) throw new Error("no shape");
  if (shape.type === "Point") return shape.coordinates;
  if (shape.type === "LineString") return shape.coordinates[0] ?? [];
  return shape.coordinates[0]?.[0] ?? [];
}

describe("ZOO-Project's GML 2, labelled JSON (the census captures)", () => {
  it("bare EPSG:4326 is longitude first: plotted as sent, sniffed, said and recorded", async () => {
    const result = await rendered("zoo-project/execution/buffer-raw-gml.http");
    expect(result).toMatchObject({
      kind: "text",
      mediaType: "application/gml+xml",
      sniffed: { kind: "gml", declaredMediaType: "application/json;charset=UTF-8" },
      geo: { ok: true, parsedAs: "gml" },
    });
    expect(firstPosition(result)).toEqual([3.3, 52]);
    expect(
      placementWords(plotStatus(result), {
        kind: "crs84",
        crs: "EPSG:4326",
        uri: "EPSG:4326",
        from: "gml-srsname",
        value: null,
      }),
    ).toBe("Its srsName is EPSG:4326, which GML writes longitude first: shown as sent.");
    const [record] = resultObservations(RUN, [result]);
    expect(record).toMatchObject({
      mediaType: "application/json;charset=UTF-8",
      declaredMediaType: "application/json;charset=UTF-8",
      parsedAs: "gml",
      sniffed: true,
      sourceCrs: "EPSG:4326",
      crsFrom: "gml-srsname",
      contentCrs: undefined,
    });
    expect(record).not.toHaveProperty("reprojected");
  });

  it("EPSG:28992 is reprojected and lands in Utrecht, where its input was", async () => {
    const result = await rendered("zoo-project/execution/buffer-raw-gml-epsg28992.http");
    const [lon = 0, lat = 0] = firstPosition(result);
    // The input was 136600–137000, 455700–456100: Utrecht, about 5.115 E, 52.085 N.
    expect(lon).toBeGreaterThan(5.1);
    expect(lon).toBeLessThan(5.13);
    expect(lat).toBeGreaterThan(52.08);
    expect(lat).toBeLessThan(52.1);
    const [record] = resultObservations(RUN, [result]);
    expect(record).toMatchObject({
      sourceCrs: "EPSG:28992",
      crsFrom: "gml-srsname",
      reprojected: true,
    });
  });

  it("an input written latitude first comes back as bare EPSG:4326, longitude first", async () => {
    // ZOO was sent urn:ogc:def:crs:EPSG::4326 with 52.089 5.118; OGR answers EPSG:4326, 5.117,52.089.
    const result = await rendered("zoo-project/execution/buffer-raw-gml-from-urn4326.http");
    expect(firstPosition(result)).toEqual([5.117, 52.089]);
  });

  it("Centroid's GML has no srsName: not plotted, and says the service didn't say", async () => {
    const result = await rendered("zoo-project/execution/centroid-raw-gml-no-srsname.http");
    const status = plotStatus(result);
    expect(status.kind).toBe("crs-unstated");
    expect(placementWords(status, { kind: "unstated", from: "gml-srsname" })).toBe(
      "The service didn't say which coordinate system these coordinates are in, so they are not shown on the map.",
    );
    const [record] = resultObservations(RUN, [result]);
    expect(record).toMatchObject({ parsedAs: "gml", sniffed: true, crsFrom: "gml-srsname" });
    expect(record).not.toHaveProperty("sourceCrs");
  });

  it("SAGA's fractal has no srsName and three dimensions: read, heights dropped, not placed", async () => {
    const result = await rendered("zoo-project/execution/saga-fractals-raw-gml.http");
    expect(result).toMatchObject({ geo: { ok: true, heightsDropped: true } });
    expect(plotStatus(result).kind).toBe("crs-unstated");
  });

  it("the WFS 1.0 GetFeature behind its reference, text/xml with an srsName on each line", async () => {
    const { body } = httpFixture("zoo-project/execution/saga-fractals-wfs-getfeature.http");
    const read = await readLabelledXml(body, "text/xml; charset=UTF-8");
    expect(read).toMatchObject({
      ok: true,
      parsedAs: "gml",
      placement: { kind: "crs84", crs: "EPSG:4326" },
    });
  });
});

describe("GML 3.2 from breinstein-formats, labelled as such", () => {
  it("a WFS 2.0 member with a posList in CRS84: plotted on the area given", async () => {
    const [result] = await toRenderable(
      envelopeOf("pygeoapi/execution/breinstein-formats-gml32.http", "http://localhost:5080/x"),
      { outputIds: ["features"], processId: "breinstein-formats" },
    );
    if (result === undefined) throw new Error("no result");
    expect(result).toMatchObject({ kind: "text", geo: { ok: true, parsedAs: "gml" } });
    expect(result).not.toHaveProperty("sniffed");
    expect(firstPosition(result)).toEqual([5.118, 52.089]);
    expect(
      placementWords(plotStatus(result), {
        kind: "crs84",
        crs: "CRS84",
        uri: "x",
        from: "gml-srsname",
        value: null,
      }),
    ).toBe("Its srsName is x: longitude and latitude, shown as sent.");
  });
});

describe("breinstein-gml: the same area in EPSG:4326 and in RD New (#F1's second test)", () => {
  async function positions(key: string): Promise<number[][]> {
    const [result] = await toRenderable(envelopeOf(key, "http://localhost:5080/x"), {
      outputIds: ["features"],
      processId: "breinstein-gml",
    });
    if (result === undefined) throw new Error("no result");
    const status = plotStatus(result);
    if (status.kind !== "plotted") throw new Error(`not plotted: ${status.kind}`);
    return status.shapes.flatMap((shape) =>
      shape.type === "Point"
        ? [[...shape.coordinates]]
        : shape.type === "LineString"
          ? shape.coordinates.map((p) => [...p])
          : shape.coordinates.flat().map((p) => [...p]),
    );
  }

  it("lands where the EPSG:4326 variant does, within 2 mm (RD New is written to the millimetre)", async () => {
    const wgs = await positions("pygeoapi/execution/breinstein-gml-epsg4326.http");
    const rd = await positions("pygeoapi/execution/breinstein-gml-epsg28992.http");
    expect(rd).toHaveLength(wgs.length);
    rd.forEach(([lon = 0, lat = 0], index) => {
      const [lon2 = 0, lat2 = 0] = wgs[index] ?? [];
      const metres = Math.hypot(
        (lon - lon2) * 111_320 * Math.cos((lat * Math.PI) / 180),
        (lat - lat2) * 110_574,
      );
      expect(metres).toBeLessThan(0.002);
    });
  });
});
