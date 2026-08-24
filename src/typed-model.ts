import type { HydratedDocument, Model, QueryFilter } from 'mongoose';
import type { PaginateQuery } from './paginate-query.js';
import type {
  CursorPageInfo,
  CursorPaginateOptions,
  OffsetPageInfo,
  OffsetPaginateOptions,
  PageInfo
} from './types.js';
import { PaginationError } from './errors.js';

export class MissingPaginatePluginError extends PaginationError {
  constructor(modelName: string) {
    super(
      `Model "${modelName}" does not have the paginate static. ` +
      'Register the mongoosePaginate plugin on its schema before it compiles.',
      'MISSING_PAGINATE_PLUGIN'
    );
  }
}

/**
 * The `paginate()` call surface. Literal `pageInfo: false` narrows to the
 * docs-only envelope, literal `true` or an omitted option narrows to the
 * full envelope, and a dynamic boolean widens to the union of both.
 */
export interface PaginateMethod<TRawDocType, THydratedDocumentType> {
  (
    filter: QueryFilter<TRawDocType>,
    options: CursorPaginateOptions & { pageInfo: false }
  ): PaginateQuery<TRawDocType, THydratedDocumentType, null>;
  (
    filter: QueryFilter<TRawDocType>,
    options: OffsetPaginateOptions & { pageInfo: false }
  ): PaginateQuery<TRawDocType, THydratedDocumentType, null>;
  (
    filter: QueryFilter<TRawDocType>,
    options: CursorPaginateOptions & { pageInfo?: true }
  ): PaginateQuery<TRawDocType, THydratedDocumentType, CursorPageInfo>;
  (
    filter: QueryFilter<TRawDocType>,
    options: OffsetPaginateOptions & { pageInfo?: true }
  ): PaginateQuery<TRawDocType, THydratedDocumentType, OffsetPageInfo>;
  (
    filter: QueryFilter<TRawDocType>,
    options: CursorPaginateOptions
  ): PaginateQuery<TRawDocType, THydratedDocumentType, CursorPageInfo | null>;
  (
    filter: QueryFilter<TRawDocType>,
    options: OffsetPaginateOptions
  ): PaginateQuery<TRawDocType, THydratedDocumentType, OffsetPageInfo | null>;
  (
    filter: QueryFilter<TRawDocType>,
    options: CursorPaginateOptions | OffsetPaginateOptions
  ): PaginateQuery<TRawDocType, THydratedDocumentType, PageInfo | null>;
}

/**
 * Schema-local pagination surface for consumers who do not want to rely on
 * the global `Model` augmentation.
 */
export interface PaginateModel<TRawDocType, THydratedDocumentType = HydratedDocument<TRawDocType>> {
  paginate: PaginateMethod<TRawDocType, THydratedDocumentType>;
}

type PaginateSurfaceOf<TModel> =
  TModel extends Model<infer TRawDocType, any, any, any, infer THydratedDocumentType, any, any>
    ? PaginateModel<TRawDocType, THydratedDocumentType>
    : never;

/**
 * Returns the model with the pagination surface added, after verifying the
 * plugin actually installed the static at runtime. The full Mongoose model
 * type is preserved.
 */
export function asPaginateModel<TModel extends Model<any, any, any, any, any, any, any>>(
  model: TModel
): TModel & PaginateSurfaceOf<TModel> {
  if (typeof (model as unknown as { paginate?: unknown }).paginate !== 'function') {
    throw new MissingPaginatePluginError(model.modelName);
  }
  return model as TModel & PaginateSurfaceOf<TModel>;
}
