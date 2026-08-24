const assert = require('node:assert');
const mongoose = require('mongoose');
const {
  mongoosePaginate,
  asPaginateModel,
  encodeCursor,
  decodeCursor,
  InvalidCursorError,
  PaginateQuery
} = require('@abdelrahmanhafez/mongoose-paginate');

assert.strictEqual(typeof mongoosePaginate, 'function');
// The default export stays usable for require() consumers too.
assert.strictEqual(require('@abdelrahmanhafez/mongoose-paginate').default, mongoosePaginate);

const noteSchema = new mongoose.Schema({ body: String, pinnedAt: Date });
noteSchema.plugin(mongoosePaginate);
const Note = mongoose.model('Note', noteSchema);

assert.strictEqual(typeof Note.paginate, 'function');
const query = Note.paginate({}, { mode: 'offset', page: 2, sort: { pinnedAt: -1 }, limit: 5 });
assert.ok(query instanceof PaginateQuery);

const typed = asPaginateModel(Note);
assert.strictEqual(typeof typed.paginate, 'function');

const sort = [{ path: 'pinnedAt', direction: -1 }, { path: '_id', direction: -1 }];
const cursor = encodeCursor({ sort, collation: null, values: [new Date(0), 'x'] });
assert.strictEqual(decodeCursor(cursor, { sort, collation: null }).values.length, 2);
assert.throws(() => decodeCursor('@@@', { sort, collation: null }), InvalidCursorError);

console.log('CommonJS consumer OK');
