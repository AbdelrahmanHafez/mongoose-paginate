import assert from 'node:assert';
import { describe, it } from 'node:test';
import mongoose from 'mongoose';
import { buildBoundaryFilter } from '../src/boundary-filter.js';

const trustedSymbol = Object.getOwnPropertySymbols(mongoose.trusted({}))[0]!;

describe('buildBoundaryFilter', function() {
  it('builds prefix-equality clauses for a compound descending sort moving forward', function() {
    // Arrange
    const { sort } = createTestContext();

    // Act
    const filter = buildBoundaryFilter(sort, [5, 'abc'], 'forward') as any;

    // Assert
    assert.deepStrictEqual(JSON.parse(JSON.stringify(filter)), {
      $or: [
        { $or: [{ score: { $lt: 5 } }, { score: { $eq: null } }] },
        { score: { $eq: 5 }, _id: { $gt: 'abc' } }
      ]
    });
  });

  it('flips strict operators when moving backward', function() {
    // Arrange
    const { sort } = createTestContext();

    // Act
    const filter = buildBoundaryFilter(sort, [5, 'abc'], 'backward') as any;

    // Assert
    assert.deepStrictEqual(JSON.parse(JSON.stringify(filter)), {
      $or: [
        { score: { $gt: 5 } },
        { score: { $eq: 5 }, _id: { $lt: 'abc' } }
      ]
    });
  });

  it('uses a non-null filter when the boundary value is null on an ascending key', function() {
    // Arrange
    const sort = [
      { path: 'score', direction: 1 as const },
      { path: '_id', direction: 1 as const }
    ];

    // Act
    const filter = buildBoundaryFilter(sort, [null, 'abc'], 'forward') as any;

    // Assert
    assert.deepStrictEqual(JSON.parse(JSON.stringify(filter)), {
      $or: [
        { score: { $ne: null } },
        { score: { $eq: null }, _id: { $gt: 'abc' } }
      ]
    });
  });

  it('skips the strict clause when a descending key has a null boundary moving forward', function() {
    // Arrange
    const { sort } = createTestContext();

    // Act
    const filter = buildBoundaryFilter(sort, [null, 'abc'], 'forward') as any;

    // Assert
    assert.deepStrictEqual(JSON.parse(JSON.stringify(filter)), {
      $or: [
        { score: { $eq: null }, _id: { $gt: 'abc' } }
      ]
    });
  });

  it('marks every generated operator object as trusted', function() {
    // Arrange
    const { sort } = createTestContext();

    // Act
    const filter = buildBoundaryFilter(sort, [5, 'abc'], 'forward') as any;

    // Assert: every non-$or operator object carries the mongoose trusted symbol.
    const clauses = filter.$or;
    const nullBranch = clauses[0].$or;
    assert.ok(nullBranch[0].score[trustedSymbol]);
    assert.ok(nullBranch[1].score[trustedSymbol]);
    assert.ok(clauses[1].score[trustedSymbol]);
    assert.ok(clauses[1]._id[trustedSymbol]);
  });

  function createTestContext() {
    const sort = [
      { path: 'score', direction: -1 as const },
      { path: '_id', direction: 1 as const }
    ];
    return { sort };
  }
});
