import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { Schema, type Connection, type Model } from 'mongoose';
import { mongoosePaginate } from '../src/plugin.js';
import { InvalidPaginationOptionsError } from '../src/errors.js';
import '../src/augment.js';
import { startTestDb, type TestDb } from './setup.js';

describe('review regressions', function() {
  let db: TestDb;
  let connection: Connection;
  let modelCount = 0;

  before(async function() {
    db = await startTestDb();
    connection = db.connection;
  });

  after(async function() {
    await db.stop();
  });

  it('keeps the requested inclusive projection in lean documents', async function() {
    // Arrange
    const { Post } = createTestContext();
    await Post.create([{ title: 'projected', score: 1 }, { title: 'later', score: 2 }]);

    // Act
    const page = await Post.paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 1 })
      .select('title')
      .lean();

    // Assert: the document keeps the requested shape, and the cursor still
    // works even though it needs the hidden score value.
    assert.strictEqual(page.docs[0]!.title, 'projected');
    assert.ok(!('score' in page.docs[0]!));
    assert.notStrictEqual(page.pageInfo.nextCursor, null);
    const nextPage = await Post.paginate({}, {
      mode: 'cursor', sort: { score: 1 }, limit: 1, after: page.pageInfo.nextCursor!
    });
    assert.deepStrictEqual(nextPage.docs.map(doc => doc.title), ['later']);
  });

  it('supports an exclusion projection that hides a sort path', async function() {
    // Arrange
    const { Post } = createTestContext();
    await Post.create([
      { title: 'a', score: 1 }, { title: 'b', score: 2 }, { title: 'c', score: 3 }
    ]);

    // Act: the paginator reads the hidden boundary values separately.
    const firstPage = await Post.paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 1 })
      .select('-score');
    const secondPage = await Post.paginate({}, {
      mode: 'cursor', sort: { score: 1 }, limit: 1, after: firstPage.pageInfo.nextCursor!
    });

    // Assert
    assert.deepStrictEqual(firstPage.docs.map(doc => doc.title), ['a']);
    assert.strictEqual(firstPage.docs[0]!.score, undefined);
    assert.deepStrictEqual(secondPage.docs.map(doc => doc.title), ['b']);
  });

  it('rejects a projection that excludes _id when metadata needs cursors', async function() {
    // Arrange: two documents and limit 1, so the page must encode a cursor.
    const { Post } = createTestContext();
    await Post.create([{ title: 'a', score: 1 }, { title: 'b', score: 2 }]);

    // Act + Assert: without _id the paginator cannot identify boundary
    // documents, so it refuses instead of encoding a corrupt cursor.
    await assert.rejects(
      Post.paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 1 })
        .select({ title: 1, _id: 0 })
        .exec(),
      InvalidPaginationOptionsError
    );
  });

  it('allows excluding _id when pageInfo is off', async function() {
    // Arrange
    const { Post } = createTestContext();
    await Post.create({ title: 'a', score: 1 });

    // Act
    const page = await Post.paginate({}, { mode: 'cursor', sort: { score: 1 }, pageInfo: false })
      .select({ title: 1, _id: 0 });

    // Assert
    assert.strictEqual(page.docs[0]!.title, 'a');
    assert.strictEqual(page.docs[0]!._id, undefined);
  });

  it('nulls only the proven-empty direction when moving backward', async function() {
    // Arrange
    const { Post } = createTestContext();
    await Post.create([
      { title: 'a', score: 1 }, { title: 'b', score: 2 }, { title: 'c', score: 3 }
    ]);
    const fullPage = await Post.paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 3 });

    // Act: move backward from the position of 'c'. Only 'a' and 'b' remain,
    // so lookahead proves there is nothing before them.
    const backward = await Post.paginate({}, {
      mode: 'cursor', sort: { score: 1 }, limit: 2, lookahead: true,
      before: fullPage.pageInfo.nextCursor!
    });

    // Assert
    assert.deepStrictEqual(backward.docs.map(doc => doc.title), ['a', 'b']);
    assert.strictEqual(backward.pageInfo.hasPreviousPage, false);
    assert.strictEqual(backward.pageInfo.previousCursor, null);
    // The next direction stays unknown, so its cursor stays usable.
    assert.strictEqual(backward.pageInfo.hasNextPage, null);
    assert.notStrictEqual(backward.pageInfo.nextCursor, null);
  });

  it('reports unknown previous-page state for an empty offset page without a count', async function() {
    // Arrange
    const { Post } = createTestContext();

    // Act: page 2 of an unknown total. The query cannot tell whether page 1
    // has documents.
    const page = await Post.paginate({}, { mode: 'offset', page: 2, sort: { score: 1 } });

    // Assert
    assert.deepStrictEqual(page.docs, []);
    assert.strictEqual(page.pageInfo.hasPreviousPage, null);
  });

  it('applies the query collation to the exact count', async function() {
    // Arrange
    const { Post } = createTestContext();
    await Post.create([
      { title: 'apple', score: 1 }, { title: 'APPLE', score: 2 }, { title: 'pear', score: 3 }
    ]);

    // Act: strength 2 makes the filter case-insensitive. The count must use
    // the same collation as the find, or the two disagree.
    const page = await Post.paginate({ title: 'apple' }, {
      mode: 'cursor', sort: { score: 1 }, count: 'exact'
    }).collation({ locale: 'en', strength: 2 });

    // Assert
    assert.strictEqual(page.docs.length, 2);
    assert.strictEqual(page.pageInfo.totalDocs, 2);
  });

  it('rejects cleanly when the concurrent count query fails', async function() {
    // Arrange: a hint for an index that does not exist makes both the find
    // and the count fail. The count runs concurrently with the find, so its
    // rejection must not escape as an unhandled rejection.
    const { Post } = createTestContext();
    await Post.create({ title: 'a', score: 1 });

    // Act + Assert
    await assert.rejects(
      Post.paginate({}, { mode: 'offset', sort: { score: 1 }, count: 'exact' })
        .hint({ doesNotExist: 1 })
        .exec()
    );
  });

  function createTestContext() {
    modelCount += 1;
    const postSchema = new Schema({
      title: String,
      score: Number
    });
    postSchema.plugin(mongoosePaginate);
    const Post = connection.model(`RegressionPost${modelCount}`, postSchema);
    return { Post };
  }
});
