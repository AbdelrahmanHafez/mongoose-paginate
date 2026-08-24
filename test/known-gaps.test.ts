import { describe, it } from 'node:test';

/**
 * Gaps that this proof of concept does not implement. Each skipped test
 * documents missing behavior instead of claiming coverage.
 */
describe('known gaps', function() {
  it.skip('supports .transform() on the pagination query', function() {
    // Mongoose Query.transform() rewrites the raw result array. Inside the
    // pagination envelope, an arbitrary transform can break cursor encoding
    // and the docs type. The PoC does not expose .transform(). A real
    // implementation needs a per-document transform whose return type flows
    // into docs.
  });

  it.skip('applies pre("find") filter changes to count queries', function() {
    // A pre('find') hook that narrows the filter does not reach the
    // countDocuments query, so totalDocs can disagree with the visible
    // documents. Model.findAndCount() in Mongoose core has the same
    // behavior. Soft-delete plugins depend on this, so the final design
    // needs an answer, not just documentation.
  });

  it.skip('supports mixed BSON types in one sort key', function() {
    // MongoDB orders values of different BSON types by type bracket. The
    // generated range filters assume one comparable type per path, plus the
    // null bucket. Heterogeneous values can be skipped or repeated.
  });

  it.skip('enforces a maximum limit', function() {
    // The PoC validates that the limit is a positive integer but has no
    // upper bound. A production API needs a maxLimit option so a client
    // cannot request an unbounded page.
  });
});
