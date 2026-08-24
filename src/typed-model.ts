import type { QueryFilter, HydratedDocument, Model } from 'mongoose';
import type { PaginateQuery } from './paginate-query.js';
import type { CursorPageInfo, CursorPaginateOptions, OffsetPageInfo, OffsetPaginateOptions } from './types.js';
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
 * Schema-local pagination surface for consumers who do not want to rely on
 * the global `Model` augmentation.
 */
export interface PaginateModel<TRawDocType, THydratedDocumentType = HydratedDocument<TRawDocType>> {
  paginate(
    filter: QueryFilter<TRawDocType>,
    options: (CursorPaginateOptions | OffsetPaginateOptions) & { pageInfo: false }
  ): PaginateQuery<TRawDocType, THydratedDocumentType, null>;
  paginate(
    filter: QueryFilter<TRawDocType>,
    options: CursorPaginateOptions
  ): PaginateQuery<TRawDocType, THydratedDocumentType, CursorPageInfo>;
  paginate(
    filter: QueryFilter<TRawDocType>,
    options: OffsetPaginateOptions
  ): PaginateQuery<TRawDocType, THydratedDocumentType, OffsetPageInfo>;
  paginate(
    filter: QueryFilter<TRawDocType>,
    options: CursorPaginateOptions | OffsetPaginateOptions
  ): PaginateQuery<TRawDocType, THydratedDocumentType, CursorPageInfo | OffsetPageInfo>;
}

/**
 * Returns the model typed with the pagination surface after verifying the
 * plugin actually installed the static at runtime.
 */
export function asPaginateModel<
  TRawDocType,
  THydratedDocumentType extends HydratedDocument<TRawDocType> = HydratedDocument<TRawDocType>
>(
  model: Model<TRawDocType, {}, {}, {}, THydratedDocumentType>
): PaginateModel<TRawDocType, THydratedDocumentType> {
  if (typeof (model as unknown as { paginate?: unknown }).paginate !== 'function') {
    throw new MissingPaginatePluginError(model.modelName);
  }
  return model as unknown as PaginateModel<TRawDocType, THydratedDocumentType>;
}
