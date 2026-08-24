import assert from 'node:assert';
import mongoose, { Schema } from 'mongoose';
import mongoosePaginateDefault, {
  mongoosePaginate,
  asPaginateModel,
  encodeCursor,
  decodeCursor,
  InvalidCursorError,
  InvalidPaginationOptionsError,
  PaginationError,
  PaginateQuery
} from '@abdelrahmanhafez/mongoose-paginate';

assert.strictEqual(typeof mongoosePaginate, 'function');
assert.strictEqual(mongoosePaginateDefault, mongoosePaginate);

const taskSchema = new Schema({ title: String, dueAt: Date });
taskSchema.plugin(mongoosePaginate);
const Task = mongoose.model('Task', taskSchema);

assert.strictEqual(typeof Task.paginate, 'function');

const query = Task.paginate({}, { mode: 'cursor', sort: { dueAt: -1 }, limit: 10 });
assert.ok(query instanceof PaginateQuery);
query.select('title').lean();

const typed = asPaginateModel(Task);
assert.strictEqual(typeof typed.paginate, 'function');

assert.throws(
  () => Task.paginate({}, { mode: 'cursor', after: 'a', before: 'b' }),
  InvalidPaginationOptionsError
);

const sort = [{ path: 'dueAt', direction: -1 }, { path: '_id', direction: -1 }];
const cursor = encodeCursor({ sort, collation: null, values: [new Date(0), 'x'] });
const payload = decodeCursor(cursor, { sort, collation: null });
assert.strictEqual(payload.values.length, 2);
assert.throws(() => decodeCursor('@@@', { sort, collation: null }), InvalidCursorError);
assert.ok(new InvalidCursorError('x') instanceof PaginationError);

console.log('ESM consumer OK');
