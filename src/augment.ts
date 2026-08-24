import type { HydratedDocument } from 'mongoose';
import type { PaginateQuery } from './paginate-query.js';
import type { CursorPageInfo, CursorPaginateOptions, OffsetPageInfo, OffsetPaginateOptions } from './types.js';

/**
 * Global augmentation for plugin incubation. It makes `Model.paginate()`
 * visible on every model, including models whose schema never registered the
 * plugin. Those calls compile and then fail at runtime. Stricter consumers
 * can ignore this augmentation and use `asPaginateModel()` instead.
 */
declare module 'mongoose' {
  interface Model<
    TRawDocType,
    TQueryHelpers = {},
    TInstanceMethods = {},
    TVirtuals = {},
    THydratedDocumentType = HydratedDocument<TRawDocType, TVirtuals & TInstanceMethods, TQueryHelpers, TVirtuals>,
    TSchema = any,
    TLeanResultType = TRawDocType
  > {
    paginate(
      filter: FilterQuery<TRawDocType>,
      options: (CursorPaginateOptions | OffsetPaginateOptions) & { pageInfo: false }
    ): PaginateQuery<TRawDocType, THydratedDocumentType, null>;
    paginate(
      filter: FilterQuery<TRawDocType>,
      options: CursorPaginateOptions
    ): PaginateQuery<TRawDocType, THydratedDocumentType, CursorPageInfo>;
    paginate(
      filter: FilterQuery<TRawDocType>,
      options: OffsetPaginateOptions
    ): PaginateQuery<TRawDocType, THydratedDocumentType, OffsetPageInfo>;
  }
}
