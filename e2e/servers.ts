/**
 * Where the browser lane's own relay and web build listen.
 *
 * Deliberately not the ports a developer's own relay (8787) or `vite preview`
 * (4173) use: a run used to pick up whatever answered there, and passed
 * against a relay started days earlier from older code (review T4). These are
 * the lane's alone, and `global-setup.ts` refuses a server on them that was
 * built from anything but this checkout.
 */
export const RELAY = "http://localhost:8797";
export const WEB = "http://localhost:4183";
