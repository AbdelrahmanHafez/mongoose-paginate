import assert from 'node:assert';
import { describe, it } from 'node:test';
import { Types } from 'mongoose';
import { decodeCursor, encodeCursor } from '../src/cursor-codec.js';
import { InvalidCursorError } from '../src/errors.js';

describe('cursor codec', function() {
  it('round-trips BSON values through an opaque url-safe string', function() {
    // Arrange
    const { sort, collation } = createTestContext();
    const createdAt = new Date('2026-03-01T12:00:00.123Z');
    const id = new Types.ObjectId();

    // Act
    const cursor = encodeCursor({ sort, collation, values: [createdAt, id] });
    const payload = decodeCursor(cursor, { sort, collation });

    // Assert
    assert.match(cursor, /^[A-Za-z0-9_-]+$/);
    assert.strictEqual(payload.values.length, 2);
    assert.ok(payload.values[0] instanceof Date);
    assert.strictEqual((payload.values[0] as Date).getTime(), createdAt.getTime());
    assert.ok(payload.values[1] instanceof Types.ObjectId);
    assert.strictEqual(String(payload.values[1]), String(id));
  });

  it('preserves null values', function() {
    // Arrange
    const { sort, collation } = createTestContext();
    const id = new Types.ObjectId();

    // Act
    const cursor = encodeCursor({ sort, collation, values: [null, id] });
    const payload = decodeCursor(cursor, { sort, collation });

    // Assert
    assert.strictEqual(payload.values[0], null);
  });

  it('rejects a cursor whose sort signature does not match the effective sort', function() {
    // Arrange
    const { sort, collation } = createTestContext();
    const cursor = encodeCursor({ sort, collation, values: ['a', new Types.ObjectId()] });
    const otherSort = [
      { path: 'name', direction: 1 as const },
      { path: '_id', direction: 1 as const }
    ];

    // Act + Assert
    assert.throws(() => decodeCursor(cursor, { sort: otherSort, collation }), InvalidCursorError);
  });

  it('rejects a cursor whose sort direction does not match', function() {
    // Arrange
    const { sort, collation } = createTestContext();
    const cursor = encodeCursor({ sort, collation, values: ['a', new Types.ObjectId()] });
    const flippedSort = [
      { path: 'createdAt', direction: 1 as const },
      { path: '_id', direction: 1 as const }
    ];

    // Act + Assert
    assert.throws(() => decodeCursor(cursor, { sort: flippedSort, collation }), InvalidCursorError);
  });

  it('rejects a cursor bound to a different collation', function() {
    // Arrange
    const { sort } = createTestContext();
    const cursor = encodeCursor({ sort, collation: { locale: 'en', strength: 2 }, values: ['a', new Types.ObjectId()] });

    // Act + Assert
    assert.throws(() => decodeCursor(cursor, { sort, collation: null }), InvalidCursorError);
  });

  it('accepts a cursor with a matching collation', function() {
    // Arrange
    const { sort } = createTestContext();
    const collation = { locale: 'en', strength: 2 };
    const cursor = encodeCursor({ sort, collation, values: ['a', new Types.ObjectId()] });

    // Act
    const payload = decodeCursor(cursor, { sort, collation: { locale: 'en', strength: 2 } });

    // Assert
    assert.strictEqual(payload.values[0], 'a');
  });

  it('rejects tampered base64url input', function() {
    // Arrange
    const { sort, collation } = createTestContext();

    // Act + Assert
    assert.throws(() => decodeCursor('not!!valid@@base64', { sort, collation }), InvalidCursorError);
  });

  it('rejects valid base64url that does not contain EJSON', function() {
    // Arrange
    const { sort, collation } = createTestContext();
    const cursor = Buffer.from('hello world', 'utf8').toString('base64url');

    // Act + Assert
    assert.throws(() => decodeCursor(cursor, { sort, collation }), InvalidCursorError);
  });

  it('rejects an unsupported cursor version', function() {
    // Arrange
    const { sort, collation } = createTestContext();
    const raw = JSON.stringify({ v: 999, sort: [], collation: null, values: [] });
    const cursor = Buffer.from(raw, 'utf8').toString('base64url');

    // Act + Assert
    assert.throws(() => decodeCursor(cursor, { sort, collation }), InvalidCursorError);
  });

  it('rejects operator-shaped cursor values', function() {
    // Arrange
    const { sort, collation } = createTestContext();
    const raw = JSON.stringify({
      v: 1,
      sort: [['createdAt', -1], ['_id', -1]],
      collation: null,
      values: [{ $ne: null }, 'x']
    });
    const cursor = Buffer.from(raw, 'utf8').toString('base64url');

    // Act + Assert
    assert.throws(() => decodeCursor(cursor, { sort, collation }), InvalidCursorError);
  });

  it('rejects a cursor whose value count does not match the sort', function() {
    // Arrange
    const { sort, collation } = createTestContext();
    const raw = JSON.stringify({
      v: 1,
      sort: [['createdAt', -1], ['_id', -1]],
      collation: null,
      values: ['only-one']
    });
    const cursor = Buffer.from(raw, 'utf8').toString('base64url');

    // Act + Assert
    assert.throws(() => decodeCursor(cursor, { sort, collation }), InvalidCursorError);
  });

  function createTestContext() {
    const sort = [
      { path: 'createdAt', direction: -1 as const },
      { path: '_id', direction: -1 as const }
    ];
    return { sort, collation: null };
  }
});
