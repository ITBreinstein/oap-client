# Changelog

Changes to `@breinstein/oap-client` that a consumer has to know about. Started
at 0.5.0; earlier versions are recorded only in the git history.

## 0.5.0

### Breaking for exhaustive switches

- `KnownRelation` gains `"items"`, the OGC API - Features relation from a
  collection to its features, matched in its short form and as
  `http://www.opengis.net/def/rel/ogc/1.0/items`. Code that switches over every
  member of `KnownRelation` with an exhaustiveness check (`satisfies never`, or
  a `default` that assigns to `never`) stops compiling until it handles
  `"items"`. Nothing else about relation matching changes.

### Added

- `resolveHref(href, base)`: resolves one href against the URL its document was
  served from, returning `undefined` when it cannot be made absolute. For an
  href outside a `links` array, such as an output given by reference in a
  results document, which may carry no `rel`. `resolveBodyLinks` is unchanged
  and still skips an entry without one.
