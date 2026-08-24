import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { Schema, type Connection, type Model } from 'mongoose';
import { mongoosePaginate } from '../src/plugin.js';
import { asPaginateModel, MissingPaginatePluginError } from '../src/typed-model.js';
import { InvalidPaginationOptionsError, InvalidPaginationSortError } from '../src/errors.js';
import '../src/augment.js';
import { startTestDb, type TestDb } from './setup.js';

describe('Model.paginate() validation', function() {
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

  it('rejects an unknown mode', async function() {
    // Arrange
    const { Event } = await createTestContext();

    // Act + Assert
    assert.throws(
      () => Event.paginate({}, { mode: 'pages' } as never),
      InvalidPaginationOptionsError
    );
  });

  it('rejects after and before together', async function() {
    // Arrange
    const { Event } = await createTestContext();

    // Act + Assert
    assert.throws(
      () => Event.paginate({}, { mode: 'cursor', after: 'x', before: 'y' } as never),
      InvalidPaginationOptionsError
    );
  });

  it('rejects the page option in cursor mode', async function() {
    // Arrange
    const { Event } = await createTestContext();

    // Act + Assert
    assert.throws(
      () => Event.paginate({}, { mode: 'cursor', page: 2 } as never),
      InvalidPaginationOptionsError
    );
  });

  it('rejects cursor options in offset mode', async function() {
    // Arrange
    const { Event } = await createTestContext();

    // Act + Assert
    assert.throws(
      () => Event.paginate({}, { mode: 'offset', after: 'x' } as never),
      InvalidPaginationOptionsError
    );
  });

  it('rejects lookahead and count with pageInfo false', async function() {
    // Arrange
    const { Event } = await createTestContext();

    // Act + Assert
    assert.throws(
      () => Event.paginate({}, { mode: 'cursor', pageInfo: false, lookahead: true } as never),
      InvalidPaginationOptionsError
    );
    assert.throws(
      () => Event.paginate({}, { mode: 'cursor', pageInfo: false, count: 'exact' } as never),
      InvalidPaginationOptionsError
    );
  });

  it('rejects chained .skip() in cursor mode', async function() {
    // Arrange
    const { Event } = await createTestContext();

    // Act + Assert
    assert.throws(
      () => Event.paginate({}, { mode: 'cursor', sort: { startsAt: 1 } }).skip(5),
      InvalidPaginationOptionsError
    );
  });

  it('rejects chained .skip() in offset mode because page owns the offset', async function() {
    // Arrange
    const { Event } = await createTestContext();

    // Act + Assert
    assert.throws(
      () => Event.paginate({}, { mode: 'offset', page: 2, sort: { startsAt: 1 } }).skip(5),
      InvalidPaginationOptionsError
    );
  });

  it('rejects a skip smuggled through setOptions in cursor mode', async function() {
    // Arrange
    const { Event } = await createTestContext();

    // Act + Assert
    await assert.rejects(
      Event.paginate({}, { mode: 'cursor', sort: { startsAt: 1 } }).setOptions({ skip: 5 }).exec(),
      InvalidPaginationOptionsError
    );
  });

  it('rejects invalid limits from options and from chaining', async function() {
    // Arrange
    const { Event } = await createTestContext();

    // Act + Assert
    for (const badLimit of [0, -1, 1.5]) {
      await assert.rejects(
        Event.paginate({}, { mode: 'cursor', sort: { startsAt: 1 }, limit: badLimit }).exec(),
        InvalidPaginationOptionsError
      );
      await assert.rejects(
        Event.paginate({}, { mode: 'cursor', sort: { startsAt: 1 } }).limit(badLimit).exec(),
        InvalidPaginationOptionsError
      );
    }
  });

  it('rejects invalid page numbers', async function() {
    // Arrange
    const { Event } = await createTestContext();

    // Act + Assert
    for (const badPage of [0, -1, 2.5]) {
      await assert.rejects(
        Event.paginate({}, { mode: 'offset', page: badPage, sort: { startsAt: 1 } }).exec(),
        InvalidPaginationOptionsError
      );
    }
  });

  it('rejects array, Mixed, unknown, alias, and $meta sorts at execution', async function() {
    // Arrange
    const { Event } = await createTestContext();
    const badSorts: Record<string, unknown>[] = [
      { attendees: 1 },
      { details: 1 },
      { doesNotExist: 1 },
      { location: 1 },
      { score: { $meta: 'textScore' } }
    ];

    // Act + Assert
    for (const badSort of badSorts) {
      await assert.rejects(
        Event.paginate({}, { mode: 'cursor', sort: badSort as never, limit: 2 }).exec(),
        InvalidPaginationSortError,
        `expected sort ${JSON.stringify(badSort)} to be rejected`
      );
    }
  });

  it('rejects an exclusion projection that hides a sort path', async function() {
    // Arrange
    const { Event } = await createTestContext();

    // Act + Assert
    await assert.rejects(
      Event.paginate({}, { mode: 'cursor', sort: { startsAt: 1 } }).select('-startsAt').exec(),
      InvalidPaginationOptionsError
    );
  });

  it('asPaginateModel returns a typed handle for a plugin-enabled model', async function() {
    // Arrange
    const { Event } = await createTestContext();

    // Act
    const paginateModel = asPaginateModel(Event);
    const page = await paginateModel.paginate({}, { mode: 'cursor', sort: { startsAt: 1 }, limit: 2 });

    // Assert
    assert.deepStrictEqual(page.docs, []);
  });

  it('asPaginateModel throws for a model without the plugin', async function() {
    // Arrange
    modelCount += 1;
    const bareSchema = new Schema({ name: String });
    const Bare = connection.model(`Bare${modelCount}`, bareSchema);

    // Act + Assert
    assert.throws(() => asPaginateModel(Bare), MissingPaginatePluginError);
  });

  interface EventDoc {
    name: string;
    startsAt?: Date;
    score?: number;
    attendees?: string[];
    details?: unknown;
    venue?: string;
  }

  async function createTestContext() {
    modelCount += 1;
    const eventSchema = new Schema<EventDoc>({
      name: String,
      startsAt: Date,
      score: Number,
      attendees: [String],
      details: Schema.Types.Mixed,
      venue: { type: String, alias: 'location' }
    });
    eventSchema.plugin(mongoosePaginate);
    const Event = connection.model<EventDoc>(`Event${modelCount}`, eventSchema);
    return { Event };
  }
});

void ((_Model: Model<unknown>) => undefined);
