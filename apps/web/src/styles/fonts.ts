/**
 * The page's fonts, self-hosted: the site's content security policy allows
 * fonts from its own origin only (`font-src 'self'`). Each import is one
 * `@font-face` for the Latin subset of one weight; Vite copies the woff2 file
 * into the build. All four families are SIL OFL 1.1 (THIRD_PARTY.md).
 *
 * Imported from code rather than with CSS `@import`, so the build sees each
 * package and puts its licence in THIRD-PARTY-LICENSES.md beside the bundle:
 * the OFL asks for its text to travel with the fonts.
 *
 * The tokens (`tokens.css`) name each family with system fallbacks, so a font
 * that is slow or missing never leaves text unreadable.
 */

// Soft-precise hybrid and Precise: IBM Plex.
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";

// Instrument: Manrope and JetBrains Mono.
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-800.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
