import type {
  ClientSession,
  QueryFilter,
  FlattenMaps,
  Model,
  PopulateOptions,
  Query,
  QueryOptions,
  Require_id,
  SchemaType,
  SortOrder
} from 'mongoose';
import { buildBoundaryFilter, type Movement } from './boundary-filter.js';
import { decodeCursor, encodeCursor } from './cursor-codec.js';
import { resolveEffectiveSort, type SortField } from './effective-sort.js';
import { InvalidCursorError, InvalidPaginationOptionsError } from './errors.js';
import type {
  CursorPageInfo,
  CursorPaginateOptions,
  OffsetPageInfo,
  OffsetPaginateOptions,
  PageInfo,
  PaginateEnvelope,
  PaginateOptions
} from './types.js';

export type PaginateLean<TRaw> = FlattenMaps<Require_id<TRaw>>;

type MergePaths<TDoc, TPaths> = Omit<TDoc, keyof TPaths> & TPaths;

const DEFAULT_LIMIT = 20;

export class PaginateQuery<TRaw, TDoc, TPageInfo extends PageInfo | null>
implements PromiseLike<PaginateEnvelope<TDoc, TPageInfo>> {
  private readonly _model: Model<any>;
  private readonly _options: PaginateOptions;
  private readonly _query: Query<unknown[], any>;

  constructor(model: Model<any>, filter: QueryFilter<TRaw>, options: PaginateOptions) {
    validateOptions(options);
    this._model = model;
    this._options = options;
    this._query = model.find(filter ?? {});
    if (options.sort != null) {
      this._query.sort(options.sort as Record<string, SortOrder>, { override: true } as never);
    }
    if (options.limit != null) {
      this._query.limit(options.limit);
    }
  }

  sort(sort: string | Record<string, SortOrder>): this {
    this._query.sort(sort, { override: true } as never);
    return this;
  }

  limit(limit: number): this {
    this._query.limit(limit);
    return this;
  }

  skip(skip: number): never {
    throw new InvalidPaginationOptionsError(
      this._options.mode === 'cursor'
        ? 'Cannot call .skip() in cursor mode. The cursor defines the page position.'
        : 'Cannot call .skip() in offset mode. The page option defines the offset.'
    );
  }

  select(projection: string | string[] | Record<string, unknown>): this {
    this._query.select(projection as string);
    return this;
  }

  populate<TPaths = Record<string, never>>(
    path: string | string[] | PopulateOptions | (PopulateOptions | string)[]
  ): PaginateQuery<TRaw, MergePaths<TDoc, TPaths>, TPageInfo> {
    this._query.populate(path as string);
    return this as unknown as PaginateQuery<TRaw, MergePaths<TDoc, TPaths>, TPageInfo>;
  }

  lean(value: false): this;
  lean(value?: true | Record<string, unknown>): PaginateQuery<TRaw, PaginateLean<TRaw>, TPageInfo>;
  lean(value: boolean | Record<string, unknown> = true): this | PaginateQuery<TRaw, PaginateLean<TRaw>, TPageInfo> {
    this._query.lean(value as never);
    return this as unknown as PaginateQuery<TRaw, PaginateLean<TRaw>, TPageInfo>;
  }

  session(session: ClientSession | null): this {
    this._query.session(session);
    return this;
  }

  collation(collation: Record<string, unknown>): this {
    this._query.collation(collation as never);
    return this;
  }

  hint(hint: Record<string, unknown> | string): this {
    this._query.hint(hint);
    return this;
  }

  maxTimeMS(ms: number): this {
    this._query.maxTimeMS(ms);
    return this;
  }

  setOptions(options: QueryOptions<TRaw>): this {
    this._query.setOptions(options);
    return this;
  }

  getFilter(): QueryFilter<TRaw> {
    return this._query.getFilter() as QueryFilter<TRaw>;
  }

  getOptions(): Record<string, unknown> {
    return this._query.getOptions() as Record<string, unknown>;
  }

  async exec(): Promise<PaginateEnvelope<TDoc, TPageInfo>> {
    const query = this._query.clone();
    const state = resolveExecutionState(this._model, query, this._options);

    if (this._options.mode === 'cursor') {
      return await execCursor(this._model, query, this._options, state) as unknown as PaginateEnvelope<TDoc, TPageInfo>;
    }
    return await execOffset(this._model, query, this._options, state) as unknown as PaginateEnvelope<TDoc, TPageInfo>;
  }

  then<TResult1 = PaginateEnvelope<TDoc, TPageInfo>, TResult2 = never>(
    onfulfilled?: ((value: PaginateEnvelope<TDoc, TPageInfo>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
  ): Promise<PaginateEnvelope<TDoc, TPageInfo> | TResult> {
    return this.exec().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<PaginateEnvelope<TDoc, TPageInfo>> {
    return this.exec().finally(onfinally);
  }
}

interface ExecutionState {
  effectiveSort: SortField[];
  limit: number;
  wantPageInfo: boolean;
  collation: Record<string, unknown> | null;
  baseFilter: Record<string, unknown>;
  session: ClientSession | null;
  maxTimeMS: number | null;
  hint: Record<string, unknown> | string | null;
}

function validateOptions(options: PaginateOptions): void {
  if (options == null || typeof options !== 'object') {
    throw new InvalidPaginationOptionsError('Pagination options are required.');
  }
  if (options.mode !== 'cursor' && options.mode !== 'offset') {
    throw new InvalidPaginationOptionsError(
      `Unknown pagination mode ${JSON.stringify((options as { mode?: unknown }).mode)}. Use "cursor" or "offset".`
    );
  }
  if (options.count != null && options.count !== 'exact' && options.count !== 'estimated') {
    throw new InvalidPaginationOptionsError(
      `Invalid count option ${JSON.stringify(options.count)}. Use "exact" or "estimated".`
    );
  }
  if (options.pageInfo === false && options.lookahead) {
    throw new InvalidPaginationOptionsError(
      'lookahead has no effect with pageInfo: false. Remove one of the two options.'
    );
  }
  if (options.pageInfo === false && options.count != null) {
    throw new InvalidPaginationOptionsError(
      'count has no effect with pageInfo: false. Remove one of the two options.'
    );
  }
  if (options.mode === 'cursor') {
    if (options.after != null && options.before != null) {
      throw new InvalidPaginationOptionsError('Cannot combine after and before in one request.');
    }
    if ((options as { page?: unknown }).page != null) {
      throw new InvalidPaginationOptionsError('The page option belongs to offset mode.');
    }
  } else {
    const cursorKeys = options as { after?: unknown; before?: unknown };
    if (cursorKeys.after != null || cursorKeys.before != null) {
      throw new InvalidPaginationOptionsError('The after and before options belong to cursor mode.');
    }
  }
}

function resolveExecutionState(
  model: Model<any>,
  query: Query<unknown[], any>,
  options: PaginateOptions
): ExecutionState {
  const queryOptions = query.getOptions() as Record<string, unknown>;

  if (queryOptions.skip != null) {
    throw new InvalidPaginationOptionsError(
      options.mode === 'cursor'
        ? 'Cannot use skip in cursor mode. The cursor defines the page position.'
        : 'Cannot use skip in offset mode. The page option defines the offset.'
    );
  }

  const limit = (queryOptions.limit as number | undefined) ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new InvalidPaginationOptionsError(
      `Invalid limit ${JSON.stringify(limit)}. The limit must be an integer of at least 1.`
    );
  }

  const effectiveSort = resolveEffectiveSort(
    model.schema,
    queryOptions.sort as Record<string, unknown> | undefined,
    { tieBreaker: options.tieBreaker !== false }
  );

  // The query is already a clone, so its filter is independent from the
  // caller's object. Keep the reference instead of copying: a structural
  // copy would corrupt BSON values such as ObjectId and Decimal128.
  const baseFilter = query.getFilter() as Record<string, unknown>;
  if (options.count === 'estimated' && Object.keys(baseFilter).length > 0) {
    throw new InvalidPaginationOptionsError(
      'count: "estimated" needs an empty filter. Estimated counts come from collection metadata.'
    );
  }

  return {
    effectiveSort,
    limit,
    wantPageInfo: options.pageInfo !== false,
    collation: (queryOptions.collation as Record<string, unknown> | undefined) ?? null,
    baseFilter,
    session: (queryOptions.session as ClientSession | undefined) ?? null,
    maxTimeMS: (queryOptions.maxTimeMS as number | undefined) ?? null,
    hint: (queryOptions.hint as Record<string, unknown> | string | undefined) ?? null
  };
}

async function execCursor(
  model: Model<any>,
  query: Query<unknown[], any>,
  options: CursorPaginateOptions,
  state: ExecutionState
): Promise<Record<string, unknown>> {
  const movement: Movement = options.before != null ? 'backward' : 'forward';
  const cursor = options.after ?? options.before;

  if (cursor != null) {
    const payload = decodeCursor(cursor, { sort: state.effectiveSort, collation: state.collation });
    const castValues = castCursorValues(model, query, state.effectiveSort, payload.values);
    const boundaryFilter = buildBoundaryFilter(state.effectiveSort, castValues, movement);
    query.setQuery({ $and: [query.getFilter(), boundaryFilter] } as never);
  }

  const databaseSort = movement === 'backward'
    ? invertSort(state.effectiveSort)
    : state.effectiveSort;
  query.sort(sortFieldsToRecord(databaseSort), { override: true } as never);

  const useLookahead = state.wantPageInfo && options.lookahead === true;
  query.limit(state.limit + (useLookahead ? 1 : 0));

  const fetched = await query.exec();
  const overflow = fetched.length > state.limit;
  const docs = fetched.slice(0, state.limit);
  if (movement === 'backward') {
    docs.reverse();
  }

  if (!state.wantPageInfo) {
    return { docs };
  }

  const existence = resolvePageExistence(
    movement, cursor != null, fetched.length, state.limit, useLookahead, overflow
  );

  // A cursor for a direction that is proven empty would lead to an empty
  // page, so return null there. An unknown direction keeps a usable cursor.
  let nextCursor: string | null = null;
  let previousCursor: string | null = null;
  if (docs.length > 0 && (existence.hasNextPage !== false || existence.hasPreviousPage !== false)) {
    const boundaries = await resolveBoundaryValues(model, query, state, docs);
    if (existence.hasNextPage !== false) {
      nextCursor = encodeCursor({
        sort: state.effectiveSort, collation: state.collation, values: boundaries.last
      });
    }
    if (existence.hasPreviousPage !== false) {
      previousCursor = encodeCursor({
        sort: state.effectiveSort, collation: state.collation, values: boundaries.first
      });
    }
  }

  const pageInfo: CursorPageInfo = {
    mode: 'cursor',
    limit: state.limit,
    nextCursor,
    previousCursor,
    ...existence
  };

  if (options.count != null) {
    pageInfo.totalDocs = await runCount(model, options.count, state);
  }

  return { docs, pageInfo };
}

async function execOffset(
  model: Model<any>,
  query: Query<unknown[], any>,
  options: OffsetPaginateOptions,
  state: ExecutionState
): Promise<Record<string, unknown>> {
  const page = options.page ?? 1;
  if (!Number.isInteger(page) || page < 1) {
    throw new InvalidPaginationOptionsError(
      `Invalid page ${JSON.stringify(page)}. The page must be an integer of at least 1.`
    );
  }

  const skip = (page - 1) * state.limit;
  query.setOptions({ skip });
  query.sort(sortFieldsToRecord(state.effectiveSort), { override: true } as never);

  const useLookahead = state.wantPageInfo && options.lookahead === true;
  query.limit(state.limit + (useLookahead ? 1 : 0));

  const countPromise = state.wantPageInfo && options.count != null
    ? runCount(model, options.count, state)
    : null;
  // The count runs concurrently with the find. Attach a no-op handler so an
  // early count failure does not surface as an unhandled rejection while the
  // find is still pending. Awaiting the original promise below still throws.
  countPromise?.catch(() => undefined);
  const fetched = await query.exec();
  const overflow = fetched.length > state.limit;
  const docs = fetched.slice(0, state.limit);

  if (!state.wantPageInfo) {
    return { docs };
  }

  const totalDocs = countPromise == null ? undefined : await countPromise;

  let hasNextPage: boolean | null;
  if (useLookahead) {
    hasNextPage = overflow;
  } else if (options.count === 'exact' && totalDocs != null) {
    hasNextPage = skip + docs.length < totalDocs;
  } else if (fetched.length < state.limit) {
    hasNextPage = false;
  } else {
    hasNextPage = null;
  }

  // An empty page after the end of the data has no previous page unless
  // earlier pages actually hold documents. Only an exact count proves that
  // for an empty page.
  let hasPreviousPage: boolean | null;
  if (page === 1) {
    hasPreviousPage = false;
  } else if (docs.length > 0) {
    hasPreviousPage = true;
  } else if (options.count === 'exact' && totalDocs != null) {
    hasPreviousPage = totalDocs > 0;
  } else {
    hasPreviousPage = null;
  }

  const pageInfo: OffsetPageInfo = {
    mode: 'offset',
    page,
    limit: state.limit,
    hasNextPage,
    hasPreviousPage
  };
  if (totalDocs != null) {
    pageInfo.totalDocs = totalDocs;
    pageInfo.totalPages = Math.ceil(totalDocs / state.limit);
  }

  return { docs, pageInfo };
}

function resolvePageExistence(
  movement: Movement,
  hasCursor: boolean,
  fetchedCount: number,
  limit: number,
  useLookahead: boolean,
  overflow: boolean
): { hasNextPage: boolean | null; hasPreviousPage: boolean | null } {
  const provenInMovementDirection: boolean | null = useLookahead
    ? overflow
    : fetchedCount < limit ? false : null;

  if (movement === 'forward') {
    return {
      hasNextPage: provenInMovementDirection,
      // The very first page proves there is nothing before it. A cursor
      // request does not prove that a previous page still exists.
      hasPreviousPage: hasCursor ? null : false
    };
  }
  return {
    hasNextPage: null,
    hasPreviousPage: provenInMovementDirection
  };
}

interface BoundaryValues {
  first: unknown[];
  last: unknown[];
}

/**
 * Reads every effective sort value for the first and last documents of the
 * page. The caller's projection is never modified. When the projection hides
 * a sort path, the values come from one extra query by `_id`, so the
 * returned documents keep exactly the shape the caller asked for.
 */
async function resolveBoundaryValues(
  model: Model<any>,
  query: Query<unknown[], any>,
  state: ExecutionState,
  docs: unknown[]
): Promise<BoundaryValues> {
  const provides = analyzeProjection(query);
  const missing = state.effectiveSort.filter(field => !provides(field.path));
  const first = docs[0];
  const last = docs[docs.length - 1];

  if (missing.length === 0) {
    return {
      first: state.effectiveSort.map(field => readPathValue(first, field.path)),
      last: state.effectiveSort.map(field => readPathValue(last, field.path))
    };
  }

  if (!provides('_id')) {
    throw new InvalidPaginationOptionsError(
      'Cannot encode cursors because the projection excludes _id and hides a sort path. ' +
      'Include _id, include every sort path, or use pageInfo: false.'
    );
  }

  // The extra read is not snapshot consistent with the page. A concurrent
  // update between the two queries can shift the encoded position.
  const ids = [...new Set([readPathValue(first, '_id'), readPathValue(last, '_id')])];
  const selection = Object.fromEntries(missing.map(field => [field.path, 1]));
  const refetchQuery = model.find({ _id: { $in: ids } } as never).select(selection).lean();
  if (state.session != null) {
    refetchQuery.session(state.session);
  }
  const refetched = await refetchQuery.exec();
  const byId = new Map(refetched.map(doc => [String(readPathValue(doc, '_id')), doc]));

  const valuesFor = (doc: unknown): unknown[] => {
    const hidden = byId.get(String(readPathValue(doc, '_id')));
    return state.effectiveSort.map(field =>
      provides(field.path) ? readPathValue(doc, field.path) : readPathValue(hidden, field.path)
    );
  };
  return { first: valuesFor(first), last: valuesFor(last) };
}

type PathState = 'include' | 'exclude' | 'force';

/**
 * Returns a function that reports whether the query projection keeps a path
 * in the returned documents. String selects such as '-score' keep the sign
 * in the projection key, so keys are normalized first.
 */
function analyzeProjection(query: Query<unknown[], any>): (path: string) => boolean {
  const projection = query.projection() as Record<string, unknown> | null | undefined;
  if (projection == null) {
    return () => true;
  }

  const states = new Map<string, PathState>();
  for (const [rawPath, value] of Object.entries(projection)) {
    const path = rawPath.replace(/^[+-]/, '');
    if (rawPath.startsWith('+')) {
      states.set(path, 'force');
    } else if (rawPath.startsWith('-') || value === 0 || value === false) {
      states.set(path, 'exclude');
    } else if (value === 1 || value === true) {
      states.set(path, 'include');
    }
  }

  const inclusive = [...states.entries()].some(
    ([path, pathState]) => path !== '_id' && pathState === 'include'
  );

  return (path: string): boolean => {
    const selfOrAncestor = ancestorState(states, path);
    if (selfOrAncestor === 'exclude') {
      return false;
    }
    if (!inclusive) {
      return true;
    }
    if (path === '_id') {
      return true;
    }
    return selfOrAncestor != null;
  };
}

function ancestorState(states: Map<string, PathState>, path: string): PathState | undefined {
  const segments = path.split('.');
  for (let end = segments.length; end >= 1; --end) {
    const prefix = segments.slice(0, end).join('.');
    const state = states.get(prefix);
    if (state != null) {
      return state;
    }
  }
  return undefined;
}

function readPathValue(doc: unknown, path: string): unknown {
  if (doc == null) {
    return undefined;
  }
  const getter = (doc as { get?: (path: string) => unknown }).get;
  if (typeof getter === 'function') {
    return getter.call(doc, path);
  }
  let current: unknown = doc;
  for (const segment of path.split('.')) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function castCursorValues(
  model: Model<any>,
  query: Query<unknown[], any>,
  sort: SortField[],
  values: unknown[]
): unknown[] {
  return sort.map((field, index) => {
    const value = values[index];
    if (value == null) {
      return null;
    }
    const schemaType = model.schema.path(field.path) as SchemaType | undefined;
    if (schemaType == null) {
      return value;
    }
    const caster = schemaType as SchemaType & {
      castForQuery(conditional: string | null, value: unknown, context: unknown): unknown;
    };
    try {
      return caster.castForQuery(null, value, query);
    } catch {
      throw new InvalidCursorError(
        `Cursor value for path "${field.path}" cannot be cast to the schema type.`
      );
    }
  });
}

async function runCount(
  model: Model<any>,
  count: 'exact' | 'estimated',
  state: ExecutionState
): Promise<number> {
  if (count === 'estimated') {
    return await model.estimatedDocumentCount(
      state.maxTimeMS != null ? { maxTimeMS: state.maxTimeMS } : {}
    );
  }

  const countQuery = model.countDocuments(state.baseFilter as never);
  if (state.session != null) {
    countQuery.session(state.session);
  }
  if (state.collation != null) {
    countQuery.collation(state.collation as never);
  }
  if (state.maxTimeMS != null) {
    countQuery.maxTimeMS(state.maxTimeMS);
  }
  if (state.hint != null) {
    countQuery.hint(state.hint);
  }
  return await countQuery.exec();
}

function invertSort(sort: SortField[]): SortField[] {
  return sort.map(field => ({ path: field.path, direction: field.direction === 1 ? -1 : 1 }));
}

function sortFieldsToRecord(sort: SortField[]): Record<string, 1 | -1> {
  const record: Record<string, 1 | -1> = {};
  for (const field of sort) {
    record[field.path] = field.direction;
  }
  return record;
}
