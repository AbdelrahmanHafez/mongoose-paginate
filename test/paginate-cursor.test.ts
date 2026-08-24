import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import mongoose, { Schema, Types, type Connection } from 'mongoose';
import { mongoosePaginate } from '../src/plugin.js';
import { encodeCursor } from '../src/cursor-codec.js';
import { InvalidCursorError } from '../src/errors.js';
import type { CursorPageInfo, Page } from '../src/types.js';
import '../src/augment.js';
import { startTestDb, type TestDb } from './setup.js';

describe('Model.paginate() cursor mode', function() {
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

  it('walks forward over duplicate sort values without skips or duplicates', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [
      { title: 'a', score: 1 }, { title: 'b', score: 1 }, { title: 'c', score: 1 },
      { title: 'd', score: 2 }, { title: 'e', score: 2 }, { title: 'f', score: 3 },
      { title: 'g', score: 3 }
    ]);
    const expected = (await Post.find().sort({ score: 1, _id: 1 })).map(doc => doc.title);

    // Act
    const seen = await walkForward(Post, { sort: { score: 1 }, limit: 2 });

    // Assert
    assert.deepStrictEqual(seen, expected);
  });

  it('walks forward over a descending compound sort', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [
      { title: 'a', score: 3, category: 'x' }, { title: 'b', score: 3, category: 'y' },
      { title: 'c', score: 2, category: 'x' }, { title: 'd', score: 2, category: 'y' },
      { title: 'e', score: 1, category: 'x' }
    ]);
    const expected = (await Post.find().sort({ score: -1, category: 1, _id: -1 })).map(doc => doc.title);

    // Act
    const seen = await walkForward(Post, { sort: { score: -1, category: 1 }, limit: 2 });

    // Assert
    assert.deepStrictEqual(seen, expected);
  });

  it('traverses null and missing sort values exactly once in ascending order', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [
      { title: 'a', score: 2 }, { title: 'b', score: null }, { title: 'c' },
      { title: 'd', score: 1 }, { title: 'e', score: null }, { title: 'f', score: 3 }
    ]);

    // Act
    const seen = await walkForward(Post, { sort: { score: 1 }, limit: 2 });

    // Assert
    assert.strictEqual(seen.length, 6);
    assert.deepStrictEqual([...seen].sort(), ['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('traverses null and missing sort values exactly once in descending order', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [
      { title: 'a', score: 2 }, { title: 'b', score: null }, { title: 'c' },
      { title: 'd', score: 1 }, { title: 'e', score: null }, { title: 'f', score: 3 }
    ]);

    // Act
    const seen = await walkForward(Post, { sort: { score: -1 }, limit: 2 });

    // Assert
    assert.strictEqual(seen.length, 6);
    assert.deepStrictEqual([...seen].sort(), ['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('returns backward pages in the canonical public order', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [
      { title: 'a', score: 1 }, { title: 'b', score: 2 }, { title: 'c', score: 3 },
      { title: 'd', score: 4 }, { title: 'e', score: 5 }, { title: 'f', score: 6 }
    ]);
    const firstTwoPages = await Post.paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 4 });
    assert.deepStrictEqual(firstTwoPages.docs.map(doc => doc.title), ['a', 'b', 'c', 'd']);

    // Act: move backward from the position of 'd', the last returned document.
    const backward = await Post.paginate({}, {
      mode: 'cursor',
      sort: { score: 1 },
      limit: 2,
      before: firstTwoPages.pageInfo.nextCursor!
    });

    // Assert: the two documents directly before that position, in canonical
    // order. The boundary document itself is excluded in both directions.
    assert.deepStrictEqual(backward.docs.map(doc => doc.title), ['b', 'c']);
  });

  it('walks backward to the start and reports hasPreviousPage false on a short page', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [
      { title: 'a', score: 1 }, { title: 'b', score: 2 }, { title: 'c', score: 3 },
      { title: 'd', score: 4 }, { title: 'e', score: 5 }
    ]);
    const fullPage = await Post.paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 5 });

    // Act: page backward from the position of 'e', the last document.
    const middle = await Post.paginate({}, {
      mode: 'cursor', sort: { score: 1 }, limit: 2, before: fullPage.pageInfo.nextCursor!
    });
    const start = await Post.paginate({}, {
      mode: 'cursor', sort: { score: 1 }, limit: 2, before: middle.pageInfo.previousCursor!
    });

    // Assert
    assert.deepStrictEqual(middle.docs.map(doc => doc.title), ['c', 'd']);
    // Only 'a' and 'b' remain before the position of 'c'. The short page
    // proves there is no page before it.
    assert.deepStrictEqual(start.docs.map(doc => doc.title), ['a', 'b']);
    assert.strictEqual(start.pageInfo.hasPreviousPage, null);
    const beyond = await Post.paginate({}, {
      mode: 'cursor', sort: { score: 1 }, limit: 2, before: start.pageInfo.previousCursor!
    });
    assert.deepStrictEqual(beyond.docs, []);
    assert.strictEqual(beyond.pageInfo.hasPreviousPage, false);
  });

  it('reports tri-state page existence without lookahead', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [
      { title: 'a', score: 1 }, { title: 'b', score: 2 }, { title: 'c', score: 3 }, { title: 'd', score: 4 }
    ]);

    // Act
    const fullPage = await Post.paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 2 });
    const lastPage = await Post.paginate({}, {
      mode: 'cursor', sort: { score: 1 }, limit: 3, after: fullPage.pageInfo.nextCursor!
    });

    // Assert: a full page proves nothing about the next page without lookahead.
    assert.strictEqual(fullPage.pageInfo.hasNextPage, null);
    assert.strictEqual(fullPage.pageInfo.hasPreviousPage, false);
    // A short page proves the next page does not exist. A cursor request
    // leaves the previous page unproven.
    assert.strictEqual(lastPage.pageInfo.hasNextPage, false);
    assert.strictEqual(lastPage.pageInfo.hasPreviousPage, null);
  });

  it('proves page existence with explicit lookahead and hides the extra document', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [
      { title: 'a', score: 1 }, { title: 'b', score: 2 }, { title: 'c', score: 3 }, { title: 'd', score: 4 }
    ]);

    // Act
    const middle = await Post.paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 2, lookahead: true });
    const exactEnd = await Post.paginate({}, {
      mode: 'cursor', sort: { score: 1 }, limit: 2, lookahead: true, after: middle.pageInfo.nextCursor!
    });

    // Assert
    assert.deepStrictEqual(middle.docs.map(doc => doc.title), ['a', 'b']);
    assert.strictEqual(middle.pageInfo.hasNextPage, true);
    // The last page is exactly full. Lookahead still proves the answer.
    assert.deepStrictEqual(exactEnd.docs.map(doc => doc.title), ['c', 'd']);
    assert.strictEqual(exactEnd.pageInfo.hasNextPage, false);
  });

  it('returns null cursors for an empty page', async function() {
    // Arrange
    const { Post } = await createTestContext();

    // Act
    const page = await Post.paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 2 });

    // Assert
    assert.deepStrictEqual(page.docs, []);
    assert.strictEqual(page.pageInfo.nextCursor, null);
    assert.strictEqual(page.pageInfo.previousCursor, null);
    assert.strictEqual(page.pageInfo.hasNextPage, false);
  });

  it('returns { docs } only and skips metadata work with pageInfo false', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [{ title: 'a', score: 1 }, { title: 'b', score: 2 }]);

    // Act
    const page = await Post.paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 5, pageInfo: false });

    // Assert
    assert.deepStrictEqual(Object.keys(page), ['docs']);
    assert.deepStrictEqual(page.docs.map(doc => doc.title), ['a', 'b']);
  });

  it('supports an explicit tie-breaker opt-out for a caller-proven unique sort', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [
      { title: 'a', score: 1 }, { title: 'b', score: 2 }, { title: 'c', score: 3 }
    ]);

    // Act
    const page = await Post.paginate({}, { mode: 'cursor', sort: { title: 1 }, limit: 2, tieBreaker: false });
    const nextPage = await Post.paginate({}, {
      mode: 'cursor', sort: { title: 1 }, limit: 2, tieBreaker: false, after: page.pageInfo.nextCursor!
    });

    // Assert: the effective sort has no _id field.
    assert.deepStrictEqual(page.docs.map(doc => doc.title), ['a', 'b']);
    assert.deepStrictEqual(nextPage.docs.map(doc => doc.title), ['c']);
  });

  it('rejects a tampered cursor', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [{ title: 'a', score: 1 }, { title: 'b', score: 2 }]);
    const page = await Post.paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 1 });
    const tampered = `${page.pageInfo.nextCursor!.slice(0, -2)}zz`;

    // Act + Assert
    await assert.rejects(
      Post.paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 1, after: tampered }).exec(),
      InvalidCursorError
    );
  });

  it('rejects a cursor issued for a different sort', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [{ title: 'a', score: 1 }, { title: 'b', score: 2 }]);
    const page = await Post.paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 1 });

    // Act + Assert
    await assert.rejects(
      Post.paginate({}, { mode: 'cursor', sort: { title: -1 }, limit: 1, after: page.pageInfo.nextCursor! }).exec(),
      InvalidCursorError
    );
  });

  it('rejects a cursor issued under a different collation', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [{ title: 'a', score: 1 }, { title: 'b', score: 2 }]);
    const page = await Post
      .paginate({}, { mode: 'cursor', sort: { title: 1 }, limit: 1 })
      .collation({ locale: 'en', strength: 2 });

    // Act + Assert
    await assert.rejects(
      Post.paginate({}, { mode: 'cursor', sort: { title: 1 }, limit: 1, after: page.pageInfo.nextCursor! }).exec(),
      InvalidCursorError
    );
  });

  it('casts decoded cursor values through the schema', async function() {
    // Arrange: hand-build a cursor whose values are strings instead of
    // native Date and ObjectId values.
    const { Post } = await createTestContext();
    const posts = await seedPosts(Post, [
      { title: 'a', publishedAt: new Date('2026-01-01') },
      { title: 'b', publishedAt: new Date('2026-01-02') },
      { title: 'c', publishedAt: new Date('2026-01-03') }
    ]);
    const boundary = posts.find(post => post.title === 'a')!;
    const cursor = encodeCursor({
      sort: [{ path: 'publishedAt', direction: 1 }, { path: '_id', direction: 1 }],
      collation: null,
      values: [boundary.publishedAt!.toISOString(), String(boundary._id)]
    });

    // Act
    const page = await Post.paginate({}, { mode: 'cursor', sort: { publishedAt: 1 }, limit: 5, after: cursor });

    // Assert
    assert.deepStrictEqual(page.docs.map(doc => doc.title), ['b', 'c']);
  });

  it('rejects an operator-shaped cursor value before it reaches MongoDB', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [{ title: 'a', score: 1 }]);
    const raw = JSON.stringify({
      v: 1,
      sort: [['score', 1], ['_id', 1]],
      collation: null,
      values: [{ $ne: null }, String(new Types.ObjectId())]
    });
    const cursor = Buffer.from(raw, 'utf8').toString('base64url');

    // Act + Assert
    await assert.rejects(
      Post.paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 1, after: cursor }).exec(),
      InvalidCursorError
    );
  });

  it('composes the caller filter and the cursor filter with $and', async function() {
    // Arrange: a caller filter that already uses $or. A plain merge would
    // corrupt either the caller filter or the cursor filter.
    const { Post } = await createTestContext();
    await seedPosts(Post, [
      { title: 'a', score: 1, category: 'news' }, { title: 'b', score: 2, category: 'sports' },
      { title: 'c', score: 3, category: 'news' }, { title: 'd', score: 4, category: 'weather' },
      { title: 'e', score: 5, category: 'sports' }
    ]);
    const filter = { $or: [{ category: 'news' }, { category: 'sports' }] };

    // Act
    const firstPage = await Post.paginate(filter, { mode: 'cursor', sort: { score: 1 }, limit: 2 });
    const secondPage = await Post.paginate(filter, {
      mode: 'cursor', sort: { score: 1 }, limit: 2, after: firstPage.pageInfo.nextCursor!
    });

    // Assert
    assert.deepStrictEqual(firstPage.docs.map(doc => doc.title), ['a', 'b']);
    assert.deepStrictEqual(secondPage.docs.map(doc => doc.title), ['c', 'e']);
  });

  it('keeps generated range operators working under sanitizeFilter', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [
      { title: 'a', score: 1 }, { title: 'b', score: 2 }, { title: 'c', score: 3 }
    ]);
    const firstPage = await Post.paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 1 });

    // Act
    const secondPage = await Post
      .paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 1, after: firstPage.pageInfo.nextCursor! })
      .setOptions({ sanitizeFilter: true });

    // Assert
    assert.deepStrictEqual(secondPage.docs.map(doc => doc.title), ['b']);
  });

  it('still sanitizes caller-controlled operator shapes under sanitizeFilter', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [{ title: 'a', score: 1 }, { title: 'b', score: 2 }]);
    const maliciousFilter = { title: { $ne: 'nothing' } } as Record<string, unknown>;

    // Act + Assert: sanitizeFilter wraps the caller value in $eq, so the
    // operator never executes. Casting the literal object to a string then
    // fails, which matches plain Model.find() behavior under sanitizeFilter.
    await assert.rejects(
      Post
        .paginate(maliciousFilter, { mode: 'cursor', sort: { score: 1 }, limit: 5 })
        .setOptions({ sanitizeFilter: true })
        .exec(),
      (error: Error) => error.name === 'CastError'
    );
  });

  it('lets a chained .sort() call override the options sort for cursor and order', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [
      { title: 'a', score: 1 }, { title: 'b', score: 2 }, { title: 'c', score: 3 }
    ]);

    // Act: the chained sort replaces the options sort entirely.
    const firstPage = await Post
      .paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 2 })
      .sort({ score: -1 });
    const secondPage = await Post.paginate({}, {
      mode: 'cursor', sort: { score: -1 }, limit: 2, after: firstPage.pageInfo.nextCursor!
    });

    // Assert
    assert.deepStrictEqual(firstPage.docs.map(doc => doc.title), ['c', 'b']);
    assert.deepStrictEqual(secondPage.docs.map(doc => doc.title), ['a']);
  });

  it('lets a chained .limit() call override the options limit', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [
      { title: 'a', score: 1 }, { title: 'b', score: 2 }, { title: 'c', score: 3 }
    ]);

    // Act
    const page = await Post
      .paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 1 })
      .limit(2);

    // Assert
    assert.deepStrictEqual(page.docs.map(doc => doc.title), ['a', 'b']);
    assert.strictEqual(page.pageInfo.limit, 2);
  });

  it('supports lean results inside the envelope', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [{ title: 'a', score: 1 }]);

    // Act
    const page = await Post.paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 5 }).lean();

    // Assert
    assert.strictEqual(page.docs.length, 1);
    assert.ok(!(page.docs[0] instanceof mongoose.Document));
    assert.strictEqual(page.docs[0]!.title, 'a');
  });

  it('keeps cursors correct when a projection excludes a sort path', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [
      { title: 'a', score: 1 }, { title: 'b', score: 2 }, { title: 'c', score: 3 }
    ]);

    // Act: the projection selects only the title. The paginator needs the
    // score to encode the cursor, so it adds the sort paths back.
    const firstPage = await Post
      .paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 1 })
      .select('title');
    const secondPage = await Post.paginate({}, {
      mode: 'cursor', sort: { score: 1 }, limit: 1, after: firstPage.pageInfo.nextCursor!
    });

    // Assert
    assert.deepStrictEqual(firstPage.docs.map(doc => doc.title), ['a']);
    assert.deepStrictEqual(secondPage.docs.map(doc => doc.title), ['b']);
  });

  it('supports populate inside the envelope', async function() {
    // Arrange
    const { Post, Author } = await createTestContext();
    const author = await Author.create({ name: 'Dana' });
    await seedPosts(Post, [{ title: 'a', score: 1, author: author._id }]);

    // Act
    const page = await Post
      .paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 5 })
      .populate<{ author: { name: string } }>('author');

    // Assert
    assert.strictEqual(page.docs[0]!.author.name, 'Dana');
  });

  it('forwards a session to the paginated find', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [{ title: 'a', score: 1 }]);
    const session = await connection.startSession();

    // Act
    try {
      const page = await Post
        .paginate({}, { mode: 'cursor', sort: { score: 1 }, limit: 5 })
        .session(session);

      // Assert
      assert.strictEqual(page.docs.length, 1);
    } finally {
      await session.endSession();
    }
  });

  it('reports totalDocs with an explicit exact count and never exposes totalPages', async function() {
    // Arrange
    const { Post } = await createTestContext();
    await seedPosts(Post, [
      { title: 'a', score: 1, category: 'news' }, { title: 'b', score: 2, category: 'news' },
      { title: 'c', score: 3, category: 'sports' }
    ]);

    // Act
    const page = await Post.paginate({ category: 'news' }, {
      mode: 'cursor', sort: { score: 1 }, limit: 1, count: 'exact'
    });

    // Assert
    assert.strictEqual(page.pageInfo.totalDocs, 2);
    assert.ok(!('totalPages' in page.pageInfo));
  });

  async function walkForward(
    Post: mongoose.Model<PostDoc>,
    { sort, limit }: { sort: Record<string, 1 | -1>; limit: number }
  ): Promise<string[]> {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; ++i) {
      const options = cursor == null
        ? { mode: 'cursor' as const, sort, limit }
        : { mode: 'cursor' as const, sort, limit, after: cursor };
      const page: Page<mongoose.HydratedDocument<PostDoc>, CursorPageInfo> =
        await Post.paginate({}, options);
      seen.push(...page.docs.map(doc => doc.title));
      if (page.docs.length < limit || page.pageInfo.nextCursor == null) {
        break;
      }
      cursor = page.pageInfo.nextCursor;
    }
    return seen;
  }

  interface PostDoc {
    title: string;
    score?: number | null;
    category?: string;
    publishedAt?: Date;
    author?: Types.ObjectId;
  }

  async function seedPosts(Post: mongoose.Model<PostDoc>, posts: Partial<PostDoc>[]) {
    const created = [];
    for (const post of posts) {
      created.push(await Post.create(post));
    }
    return created;
  }

  async function createTestContext() {
    modelCount += 1;
    const authorSchema = new Schema({ name: String });
    const Author = connection.model(`Author${modelCount}`, authorSchema);

    const postSchema = new Schema<PostDoc>({
      title: { type: String, required: true },
      score: Number,
      category: String,
      publishedAt: Date,
      author: { type: Schema.Types.ObjectId, ref: `Author${modelCount}` }
    });
    postSchema.plugin(mongoosePaginate);
    const Post = connection.model<PostDoc>(`Post${modelCount}`, postSchema);
    await Post.init();
    return { Post, Author };
  }
});
