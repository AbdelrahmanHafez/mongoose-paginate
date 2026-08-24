import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { Schema, type Connection, type Model } from 'mongoose';
import { mongoosePaginate } from '../src/plugin.js';
import { InvalidPaginationOptionsError } from '../src/errors.js';
import '../src/augment.js';
import { startTestDb, type TestDb } from './setup.js';

describe('Model.paginate() offset mode', function() {
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

  it('returns the requested page in a stable order', async function() {
    // Arrange
    const { Product } = await createTestContext();
    await seedProducts(Product, [
      { name: 'a', price: 10 }, { name: 'b', price: 10 }, { name: 'c', price: 10 },
      { name: 'd', price: 20 }, { name: 'e', price: 20 }
    ]);
    const expected = (await Product.find().sort({ price: 1, _id: 1 })).map(doc => doc.name);

    // Act
    const pageOne = await Product.paginate({}, { mode: 'offset', page: 1, sort: { price: 1 }, limit: 2 });
    const pageTwo = await Product.paginate({}, { mode: 'offset', page: 2, sort: { price: 1 }, limit: 2 });
    const pageThree = await Product.paginate({}, { mode: 'offset', page: 3, sort: { price: 1 }, limit: 2 });

    // Assert: the _id tie-breaker keeps duplicate prices stable across pages.
    const seen = [...pageOne.docs, ...pageTwo.docs, ...pageThree.docs].map(doc => doc.name);
    assert.deepStrictEqual(seen, expected);
  });

  it('defaults to page 1', async function() {
    // Arrange
    const { Product } = await createTestContext();
    await seedProducts(Product, [{ name: 'a', price: 10 }, { name: 'b', price: 20 }]);

    // Act
    const page = await Product.paginate({}, { mode: 'offset', sort: { price: 1 }, limit: 1 });

    // Assert
    assert.deepStrictEqual(page.docs.map(doc => doc.name), ['a']);
    assert.strictEqual(page.pageInfo.page, 1);
    assert.strictEqual(page.pageInfo.hasPreviousPage, false);
  });

  it('reports exact metadata with count exact', async function() {
    // Arrange
    const { Product } = await createTestContext();
    await seedProducts(Product, [
      { name: 'a', price: 10 }, { name: 'b', price: 20 }, { name: 'c', price: 30 },
      { name: 'd', price: 40 }, { name: 'e', price: 50 }
    ]);

    // Act
    const page = await Product.paginate({}, {
      mode: 'offset', page: 2, sort: { price: 1 }, limit: 2, count: 'exact'
    });

    // Assert
    assert.deepStrictEqual(page.docs.map(doc => doc.name), ['c', 'd']);
    assert.strictEqual(page.pageInfo.totalDocs, 5);
    assert.strictEqual(page.pageInfo.totalPages, 3);
    assert.strictEqual(page.pageInfo.hasNextPage, true);
    assert.strictEqual(page.pageInfo.hasPreviousPage, true);
  });

  it('counts the caller filter, not the current page', async function() {
    // Arrange
    const { Product } = await createTestContext();
    await seedProducts(Product, [
      { name: 'a', price: 10, inStock: true }, { name: 'b', price: 20, inStock: true },
      { name: 'c', price: 30, inStock: true }, { name: 'd', price: 40, inStock: false }
    ]);

    // Act
    const page = await Product.paginate({ inStock: true }, {
      mode: 'offset', page: 1, sort: { price: 1 }, limit: 2, count: 'exact'
    });

    // Assert
    assert.strictEqual(page.pageInfo.totalDocs, 3);
    assert.strictEqual(page.pageInfo.totalPages, 2);
  });

  it('reports zero totalPages for an empty result', async function() {
    // Arrange
    const { Product } = await createTestContext();

    // Act
    const page = await Product.paginate({}, { mode: 'offset', sort: { price: 1 }, limit: 2, count: 'exact' });

    // Assert
    assert.deepStrictEqual(page.docs, []);
    assert.strictEqual(page.pageInfo.totalDocs, 0);
    assert.strictEqual(page.pageInfo.totalPages, 0);
    assert.strictEqual(page.pageInfo.hasNextPage, false);
  });

  it('reports tri-state hasNextPage without count or lookahead', async function() {
    // Arrange
    const { Product } = await createTestContext();
    await seedProducts(Product, [
      { name: 'a', price: 10 }, { name: 'b', price: 20 }, { name: 'c', price: 30 }
    ]);

    // Act
    const fullPage = await Product.paginate({}, { mode: 'offset', page: 1, sort: { price: 1 }, limit: 2 });
    const shortPage = await Product.paginate({}, { mode: 'offset', page: 2, sort: { price: 1 }, limit: 2 });

    // Assert
    assert.strictEqual(fullPage.pageInfo.hasNextPage, null);
    assert.strictEqual(shortPage.pageInfo.hasNextPage, false);
  });

  it('proves hasNextPage with lookahead and hides the extra document', async function() {
    // Arrange
    const { Product } = await createTestContext();
    await seedProducts(Product, [
      { name: 'a', price: 10 }, { name: 'b', price: 20 }, { name: 'c', price: 30 }, { name: 'd', price: 40 }
    ]);

    // Act
    const middle = await Product.paginate({}, {
      mode: 'offset', page: 1, sort: { price: 1 }, limit: 2, lookahead: true
    });
    const exactEnd = await Product.paginate({}, {
      mode: 'offset', page: 2, sort: { price: 1 }, limit: 2, lookahead: true
    });

    // Assert
    assert.deepStrictEqual(middle.docs.map(doc => doc.name), ['a', 'b']);
    assert.strictEqual(middle.pageInfo.hasNextPage, true);
    assert.deepStrictEqual(exactEnd.docs.map(doc => doc.name), ['c', 'd']);
    assert.strictEqual(exactEnd.pageInfo.hasNextPage, false);
  });

  it('supports estimated counts for an empty filter', async function() {
    // Arrange
    const { Product } = await createTestContext();
    await seedProducts(Product, [{ name: 'a', price: 10 }, { name: 'b', price: 20 }]);

    // Act
    const page = await Product.paginate({}, {
      mode: 'offset', sort: { price: 1 }, limit: 1, count: 'estimated'
    });

    // Assert
    assert.strictEqual(page.pageInfo.totalDocs, 2);
  });

  it('rejects estimated counts with a non-empty filter', async function() {
    // Arrange
    const { Product } = await createTestContext();

    // Act + Assert
    await assert.rejects(
      Product.paginate({ inStock: true }, {
        mode: 'offset', sort: { price: 1 }, limit: 1, count: 'estimated'
      }).exec(),
      InvalidPaginationOptionsError
    );
  });

  it('returns { docs } only with pageInfo false', async function() {
    // Arrange
    const { Product } = await createTestContext();
    await seedProducts(Product, [{ name: 'a', price: 10 }]);

    // Act
    const page = await Product.paginate({}, { mode: 'offset', sort: { price: 1 }, limit: 5, pageInfo: false });

    // Assert
    assert.deepStrictEqual(Object.keys(page), ['docs']);
  });

  it('supports lean offset pages', async function() {
    // Arrange
    const { Product } = await createTestContext();
    await seedProducts(Product, [{ name: 'a', price: 10 }]);

    // Act
    const page = await Product.paginate({}, { mode: 'offset', sort: { price: 1 }, limit: 5 }).lean();

    // Assert
    assert.strictEqual(page.docs[0]!.name, 'a');
    assert.strictEqual(typeof (page.docs[0] as { save?: unknown }).save, 'undefined');
  });

  interface ProductDoc {
    name: string;
    price: number;
    inStock?: boolean;
  }

  async function seedProducts(Product: Model<ProductDoc>, products: Partial<ProductDoc>[]) {
    for (const product of products) {
      await Product.create(product);
    }
  }

  async function createTestContext() {
    modelCount += 1;
    const productSchema = new Schema<ProductDoc>({
      name: { type: String, required: true },
      price: Number,
      inStock: Boolean
    });
    productSchema.plugin(mongoosePaginate);
    const Product = connection.model<ProductDoc>(`Product${modelCount}`, productSchema);
    return { Product };
  }
});
