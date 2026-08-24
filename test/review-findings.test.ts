import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import mongoose, { Schema, Types, type Connection } from 'mongoose';
import { mongoosePaginate } from '../src/plugin.js';
import '../src/augment.js';
import { startTestDb, type TestDb } from './setup.js';

describe('review findings', function() {
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

  it('keeps BSON filter values intact for an exact count', async function() {
    // Arrange
    const Post = createPostModel();
    const authorId = new Types.ObjectId();
    await Post.create([
      { title: 'matching', score: 1, authorId },
      { title: 'other', score: 2, authorId: new Types.ObjectId() }
    ]);

    // Act
    const page = await Post.paginate({ authorId }, {
      mode: 'cursor',
      sort: { score: 1 },
      count: 'exact'
    });

    // Assert
    assert.strictEqual(page.pageInfo.totalDocs, 1);
  });

  it('keeps the requested inclusive projection in returned documents', async function() {
    // Arrange
    const Post = createPostModel();
    await Post.create({ title: 'projected', score: 1 });

    // Act
    const page = await Post.paginate({}, {
      mode: 'cursor',
      sort: { score: 1 }
    }).select('title');

    // Assert
    assert.strictEqual(page.docs[0]!.title, 'projected');
    assert.strictEqual(page.docs[0]!.score, undefined);
  });

  it('accepts an equivalent collation with a different object key order', async function() {
    // Arrange
    const Post = createPostModel();
    await Post.create([{ title: 'a', score: 1 }, { title: 'b', score: 2 }]);
    const first = await Post.paginate({}, {
      mode: 'cursor',
      sort: { title: 1 },
      limit: 1
    }).collation({ locale: 'en', strength: 2 });

    // Act
    const second = await Post.paginate({}, {
      mode: 'cursor',
      after: first.pageInfo.nextCursor!,
      sort: { title: 1 },
      limit: 1
    }).collation({ strength: 2, locale: 'en' });

    // Assert
    assert.strictEqual(second.docs[0]!.title, 'b');
  });

  it('returns null cursors when both directions are proven empty', async function() {
    // Arrange
    const Post = createPostModel();
    await Post.create({ title: 'only', score: 1 });

    // Act
    const page = await Post.paginate({}, {
      mode: 'cursor',
      sort: { score: 1 },
      limit: 2,
      lookahead: true
    });

    // Assert
    assert.strictEqual(page.pageInfo.hasNextPage, false);
    assert.strictEqual(page.pageInfo.hasPreviousPage, false);
    assert.strictEqual(page.pageInfo.nextCursor, null);
    assert.strictEqual(page.pageInfo.previousCursor, null);
  });

  it('does not claim an empty offset result has a previous page', async function() {
    // Arrange
    const Post = createPostModel();

    // Act
    const page = await Post.paginate({}, {
      mode: 'offset',
      page: 2,
      sort: { score: 1 },
      count: 'exact'
    });

    // Assert
    assert.strictEqual(page.pageInfo.totalDocs, 0);
    assert.strictEqual(page.pageInfo.hasPreviousPage, false);
  });

  function createPostModel() {
    modelCount += 1;
    const schema = new Schema({
      title: String,
      score: Number,
      authorId: Schema.Types.ObjectId
    });
    schema.plugin(mongoosePaginate);
    return connection.model(`ReviewPost${modelCount}`, schema);
  }
});

void mongoose;
