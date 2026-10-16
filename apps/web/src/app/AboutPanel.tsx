/**
 * STYLE TRIAL (instrument): what the About panel holds. What the client is,
 * which version, where requests go, and what it is built with.
 *
 * "Where your requests go" is a privacy statement: it says only what the code
 * and the deployment files show (apps/relay/README.md "Logs",
 * deploy/static/Caddyfile.snippet, jobs/job-store.ts, app/appearance.ts).
 * Change it when they change.
 */

import { VERSION } from "@breinstein/oap-client";
import { FullLogo } from "./BrandMark.js";

const REPOSITORY = "https://github.com/ITBreinstein/oap-client";
const STANDARD = "https://docs.ogc.org/is/18-062r2/18-062r2.html";

/** This build's version, then the core's: testers need to know both. */
export function versionLine(app: string, core: string): string {
  return `${app} · core ${core}`;
}

export function AboutPanel() {
  return (
    <div className="about">
      <section className="about-section about-intro">
        <FullLogo className="about-logo" />
        <p className="about-lead">
          A browser client for <strong>OGC API – Processes</strong>. Connect a processing service,
          fill in the forms built from its process descriptions, and see the results, on a map when
          they have a place.
        </p>
        <p>Made by Breinstein.</p>
      </section>

      <section className="about-section" aria-labelledby="about-version">
        <h3 id="about-version" className="label">
          This version
        </h3>
        <dl className="about-facts">
          <dt>Version</dt>
          <dd className="about-version" data-testid="app-version">
            {versionLine(__APP_VERSION__, VERSION)}
          </dd>
          <dt>Standard</dt>
          <dd>
            <a href={STANDARD}>OGC API – Processes, Part 1: Core 1.0</a>
          </dd>
          <dt>Source code</dt>
          <dd>
            <a href={REPOSITORY}>github.com/ITBreinstein/oap-client</a>
          </dd>
          <dt>Licence</dt>
          <dd>MIT</dd>
        </dl>
      </section>

      <section className="about-section" aria-labelledby="about-requests">
        <h3 id="about-requests" className="label">
          Where your requests go
        </h3>
        <p>
          Requests go from this browser straight to the service you connect. When a service doesn’t
          allow that (no CORS), they go through Breinstein’s relay, which passes them on. The relay
          keeps a short log of each request: the service, the path, the status, the size and the
          time. Never your IP address or what you sent.
        </p>
        <p>
          The web server that serves this page, and passes requests on to the relay, keeps a
          standard access log, which does include IP addresses.
        </p>
        <p>
          Your background jobs and your Appearance setting are kept in this browser only.{" "}
          <strong>Remove from list</strong> in Jobs forgets a run.
        </p>
      </section>

      <section className="about-section" aria-labelledby="about-built">
        <h3 id="about-built" className="label">
          Built with
        </h3>
        <dl className="about-facts">
          <dt>Basemap</dt>
          <dd>BRT Achtergrondkaart © Kadaster, via PDOK (CC BY 4.0)</dd>
          <dt>Map</dt>
          <dd>MapLibre GL JS (BSD-3-Clause)</dd>
          <dt>Start screen imagery</dt>
          <dd>NASA Blue Marble, Blue Marble clouds, Earth at Night 2012</dd>
          <dt>Fonts</dt>
          <dd>Manrope, JetBrains Mono (SIL Open Font License)</dd>
          <dt>Tested with</dt>
          <dd>pygeoapi, ZOO-Project</dd>
        </dl>
      </section>
    </div>
  );
}

/** Pinned to the panel's foot, under what scrolls. */
export function AboutFooter() {
  return (
    <>
      <p className="about-links">
        <a href="https://www.breinstein.nl">breinstein.nl</a>
        <a href={`${REPOSITORY}/issues`}>Report a problem</a>
      </p>
      <p className="about-copyright">© 2026 Breinstein</p>
    </>
  );
}
