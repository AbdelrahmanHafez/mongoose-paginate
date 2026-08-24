import assert from 'node:assert';
import { describe, it } from 'node:test';
import { Schema } from 'mongoose';
import { resolveEffectiveSort } from '../src/effective-sort.js';
import { InvalidPaginationSortError } from '../src/errors.js';

describe('resolveEffectiveSort', function() {
  it('appends _id ascending to an ascending sort', function() {
    // Arrange
    const { schema } = createTestContext();

    // Act
    const fields = resolveEffectiveSort(schema, { createdAt: 1 }, { tieBreaker: true });

    // Assert
    assert.deepStrictEqual(fields, [
      { path: 'createdAt', direction: 1 },
      { path: '_id', direction: 1 }
    ]);
  });

  it('appends _id with the direction of the last sort field', function() {
    // Arrange
    const { schema } = createTestContext();

    // Act
    const fields = resolveEffectiveSort(schema, { createdAt: -1 }, { tieBreaker: true });

    // Assert
    assert.deepStrictEqual(fields, [
      { path: 'createdAt', direction: -1 },
      { path: '_id', direction: -1 }
    ]);
  });

  it('does not duplicate _id when the sort already contains it', function() {
    // Arrange
    const { schema } = createTestContext();

    // Act
    const fields = resolveEffectiveSort(schema, { createdAt: -1, _id: 1 }, { tieBreaker: true });

    // Assert
    assert.deepStrictEqual(fields, [
      { path: 'createdAt', direction: -1 },
      { path: '_id', direction: 1 }
    ]);
  });

  it('defaults to _id ascending when no sort is given', function() {
    // Arrange
    const { schema } = createTestContext();

    // Act
    const fields = resolveEffectiveSort(schema, undefined, { tieBreaker: true });

    // Assert
    assert.deepStrictEqual(fields, [{ path: '_id', direction: 1 }]);
  });

  it('keeps a caller-proven unique sort unchanged when the tie-breaker is off', function() {
    // Arrange
    const { schema } = createTestContext();

    // Act
    const fields = resolveEffectiveSort(schema, { email: 1 }, { tieBreaker: false });

    // Assert
    assert.deepStrictEqual(fields, [{ path: 'email', direction: 1 }]);
  });

  it('rejects an empty sort when the tie-breaker is off', function() {
    // Arrange
    const { schema } = createTestContext();

    // Act + Assert
    assert.throws(
      () => resolveEffectiveSort(schema, undefined, { tieBreaker: false }),
      InvalidPaginationSortError
    );
  });

  it('supports dotted scalar paths on nested objects', function() {
    // Arrange
    const { schema } = createTestContext();

    // Act
    const fields = resolveEffectiveSort(schema, { 'profile.displayName': 1 }, { tieBreaker: true });

    // Assert
    assert.deepStrictEqual(fields, [
      { path: 'profile.displayName', direction: 1 },
      { path: '_id', direction: 1 }
    ]);
  });

  it('rejects unknown paths', function() {
    // Arrange
    const { schema } = createTestContext();

    // Act + Assert
    assert.throws(
      () => resolveEffectiveSort(schema, { nope: 1 }, { tieBreaker: true }),
      InvalidPaginationSortError
    );
  });

  it('rejects array paths', function() {
    // Arrange
    const { schema } = createTestContext();

    // Act + Assert
    assert.throws(
      () => resolveEffectiveSort(schema, { tags: 1 }, { tieBreaker: true }),
      InvalidPaginationSortError
    );
  });

  it('rejects paths inside document arrays', function() {
    // Arrange
    const { schema } = createTestContext();

    // Act + Assert
    assert.throws(
      () => resolveEffectiveSort(schema, { 'orders.total': -1 }, { tieBreaker: true }),
      InvalidPaginationSortError
    );
  });

  it('rejects Mixed paths', function() {
    // Arrange
    const { schema } = createTestContext();

    // Act + Assert
    assert.throws(
      () => resolveEffectiveSort(schema, { metadata: 1 }, { tieBreaker: true }),
      InvalidPaginationSortError
    );
  });

  it('rejects $meta sorts', function() {
    // Arrange
    const { schema } = createTestContext();

    // Act + Assert
    assert.throws(
      () => resolveEffectiveSort(schema, { score: { $meta: 'textScore' } }, { tieBreaker: true }),
      InvalidPaginationSortError
    );
  });

  it('rejects alias sort keys', function() {
    // Arrange
    const { schema } = createTestContext();

    // Act + Assert
    assert.throws(
      () => resolveEffectiveSort(schema, { nickname: 1 }, { tieBreaker: true }),
      InvalidPaginationSortError
    );
  });

  function createTestContext() {
    const schema = new Schema({
      name: { type: String, alias: 'nickname' },
      email: { type: String, unique: true },
      createdAt: Date,
      score: Number,
      tags: [String],
      metadata: Schema.Types.Mixed,
      profile: {
        displayName: String
      },
      orders: [new Schema({ total: Number })]
    });
    return { schema };
  }
});
