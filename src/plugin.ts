import type { QueryFilter, Model, Schema } from 'mongoose';
import { PaginateQuery } from './paginate-query.js';
import type { PaginateOptions } from './types.js';

/**
 * Adds a chainable `paginate()` static to every model compiled from the
 * schema. TypeScript sees the static through a global `Model` augmentation,
 * so models whose schema does not register this plugin still compile but
 * fail at runtime. Use `asPaginateModel()` for a runtime-checked handle.
 */
export function mongoosePaginate(schema: Schema): void {
  schema.static('paginate', function paginate(
    this: Model<unknown>,
    filter: QueryFilter<unknown>,
    options: PaginateOptions
  ) {
    return new PaginateQuery(this, filter, options);
  });
}
