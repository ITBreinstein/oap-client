# Interop tests

Tests here hit live topic #1 / #2 endpoints. They run only in the `interop`
workflow (`pnpm test:interop`), never in `pnpm test`, and must never block a
release — those servers change under us.
