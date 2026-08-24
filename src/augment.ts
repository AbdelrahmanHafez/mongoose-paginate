import type { HydratedDocument } from 'mongoose';
import type { PaginateMethod } from './typed-model.js';

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
    paginate: PaginateMethod<TRawDocType, THydratedDocumentType>;
  }
}
