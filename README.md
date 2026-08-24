# mongoose-paginate

An experimental proof of concept for a unified `Model.paginate()` API in Mongoose.

**Status: API discussion only.** This package explores the design from the
Mongoose pagination discussion. It has not been hard vetted. Do not use it in
production. It is not published to npm.

## What it does

The plugin adds one chainable `Model.paginate()` static. The static supports
cursor pagination and offset pagination through one options object. Both modes
return the same envelope: `{ docs, pageInfo }`.

```js
import mongoose from 'mongoose';
import { mongoosePaginate } from '@abdelrahmanhafez/mongoose-paginate';

const postSchema = new mongoose.Schema({
  title: String,
  createdAt: Date,
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'Author' }
});
postSchema.plugin(mongoosePaginate);
const Post = mongoose.model('Post', postSchema);
```

### Cursor mode

```js
const page = await Post.paginate({ status: 'published' }, {
  mode: 'cursor',
  after: req.query.cursor,
  sort: { createdAt: -1 },
  limit: 20
})
  .select('title createdAt')
  .populate('author')
  .lean();

page.docs;                    // up to 20 documents
page.pageInfo.nextCursor;     // opaque string for the next request
page.pageInfo.hasNextPage;    // true, false, or null

// A direction's cursor is null when that direction is proven empty.
// When existence is unknown, the cursor stays usable.
```

Pass `before` instead of `after` to move backward. The documents come back in
the same canonical order in both directions.

### Offset mode

```js
const page = await Post.paginate({ status: 'published' }, {
  mode: 'offset',
  page: 3,
  sort: { createdAt: -1 },
  limit: 20,
  count: 'exact'
})
  .lean();

page.pageInfo.totalDocs;      // 143
page.pageInfo.totalPages;     // 8
```

### Sort and limit

`sort` and `limit` live in the options because they define the page. Chained
`.sort()` and `.limit()` calls stay available as advanced overrides. A chained
call replaces the option value completely. The paginator reads the final
values once, when the query runs.

One effective sort controls everything: the MongoDB order, the cursor filter,
and the cursor contents. The plugin appends `_id` to the sort as a
tie-breaker. Pass `tieBreaker: false` only when your final sort is proven
unique.

```js
// The chained sort wins. The cursor is built for { score: -1, _id: -1 }.
await Post.paginate({}, { mode: 'cursor', sort: { createdAt: -1 }, limit: 20 })
  .sort({ score: -1 });
```

### Metadata is explicit

The default request runs one `find` query and nothing else. Extra database
work is opt-in:

- `lookahead: true` fetches one extra document. A page size of 20 then uses a
  database limit of 21. This proves `hasNextPage` (or `hasPreviousPage` when
  moving backward).
- `count: 'exact'` runs a separate `countDocuments` query and reports
  `totalDocs`.
- `count: 'estimated'` uses collection metadata. It needs an empty filter.
- `pageInfo: false` returns `{ docs }` only and skips all metadata work.

Without lookahead, page existence uses three states. A short page proves
`false`. A full page reports `null`, which means the query did not do enough
work to know. The API never reports a guess as a fact. This also holds in
offset mode: an empty page beyond the data reports `hasPreviousPage: null`
unless an exact count proves the answer.

Cursor mode never exposes `totalPages`. A page count needs a full count and a
stable page size, and both fight the reasons to use cursors.

### Cursors

Cursors are opaque, versioned, base64url strings. Each cursor contains every
value of the effective sort, the sort itself, and the collation. A cursor is
rejected with a typed `InvalidCursorError` when:

- the payload fails to decode, or its version is unknown
- its sort or collation does not match the current query
- a value cannot be cast through the schema type
- a value is shaped like a query operator

Decoded values are cast through the schema before they reach MongoDB. The
generated range filter joins the caller filter with `$and`, so filter shape
never depends on call order. The plugin marks only its own operators as
trusted, so `sanitizeFilter` still sanitizes caller input.

### Supported sorts

Known scalar schema paths and dotted scalar paths work, including Date,
ObjectId, Decimal128, string, and number. Null and missing values sort as one
bucket and traverse correctly in both directions.

These sorts are rejected with a typed error: array paths, unknown paths,
`Mixed` paths, `$meta` sorts, and alias keys. `.skip()` throws in both modes,
because the cursor or the `page` option owns the position.

## TypeScript

The package augments the global `Model` interface during incubation. The
static appears on every model, including models whose schema never registered
the plugin. Those calls compile and then fail at runtime. This is a known
cost of the plugin form and one of the reasons to move the API into core
later.

Strict consumers can use the runtime-checked helper instead:

```ts
import { asPaginateModel } from '@abdelrahmanhafez/mongoose-paginate';

const TypedPost = asPaginateModel(Post); // throws if the plugin is missing
// TypedPost keeps the full model surface, such as find() and create().
```

`lean()`, `populate()`, and `select()` keep their type effects inside
`docs`. Public option, result, cursor codec, and error types are exported.

## Costs and limits

- **Indexes.** Cursor pagination needs a compound index that matches the
  effective sort, for example `{ createdAt: -1, _id: -1 }`. The plugin does
  not verify your indexes. Without one, MongoDB sorts in memory.
- **The `_id` tie-breaker has a cost.** An index on `{ createdAt: -1 }` alone
  no longer covers the sort. Extend the index instead of disabling the
  tie-breaker.
- **Counts are separate reads.** The find and the count run as two queries.
  They are not snapshot consistent. Documents can change between them unless
  you supply suitable transaction semantics through `.session()`. The count
  reuses the session, collation, hint, and time limit of the find.
- **Offset pages shift.** Inserts and deletes between requests move offset
  boundaries. That is inherent to skip and limit, not to this API.
- **Projections.** Your projection is returned unchanged. When it hides a
  sort path, the paginator reads the boundary values with one extra query by
  `_id`. That extra read is small, but it is not snapshot consistent with
  the page. A projection that excludes `_id` and hides a sort path cannot
  produce cursors and throws. Use `pageInfo: false` to skip cursor work.

## Implemented here

- Chainable `Model.paginate()` with cursor and offset modes
- Shared `sort` and `limit` options plus chained overrides
- One effective sort for order, cursor filter, and cursor encoding
- `_id` tie-breaker with an explicit opt-out
- Versioned opaque cursors bound to sort and collation, with schema casting
- Projection-preserving cursor encoding for hydrated and lean results
- Null-aware traversal, forward and backward, in canonical order
- Tri-state page existence with explicit lookahead
- Explicit counts, `pageInfo: false`, and option conflict validation
- `$and` filter composition and `sanitizeFilter` safety
- Dual ESM and CommonJS builds tested from packed-tarball consumers

## Still open design questions

- The exact `pageInfo` field set, and Relay-style naming
- Default values: is `sort` required, should `limit` have a maximum
- Middleware rules for `pre('find')` filter changes and counts
- Aggregate pipelines, async iteration, and signed cursors
- Whether the stable API should move into Mongoose core

## Development

```bash
npm install
npm test              # runtime tests (in-memory MongoDB)
npm run test:types    # compile-time type assertions
npm run build         # dual ESM + CommonJS build
npm run test:consumers # packed-tarball ESM, CJS, and TS consumers
```

## License

MIT
