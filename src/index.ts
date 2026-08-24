import './augment.js';

export { mongoosePaginate } from './plugin.js';
export { PaginateQuery, type PaginateLean } from './paginate-query.js';
export { asPaginateModel, MissingPaginatePluginError, type PaginateModel } from './typed-model.js';
export {
  PaginationError,
  InvalidPaginationOptionsError,
  InvalidPaginationSortError,
  InvalidCursorError
} from './errors.js';
export { encodeCursor, decodeCursor, type CursorPayload } from './cursor-codec.js';
export { resolveEffectiveSort, type SortField } from './effective-sort.js';
export type {
  PaginateSort,
  PaginateBaseOptions,
  CursorPaginateOptions,
  OffsetPaginateOptions,
  PaginateOptions,
  CursorPageInfo,
  OffsetPageInfo,
  PageInfo,
  Page,
  PageWithoutInfo,
  PaginateEnvelope
} from './types.js';

export { mongoosePaginate as default } from './plugin.js';
