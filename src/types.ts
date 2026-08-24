import type { SortOrder } from 'mongoose';

export type PaginateSort = string | Record<string, SortOrder>;

export interface PaginateBaseOptions {
  /** Initial requested sort. A chained `.sort()` call replaces it. */
  sort?: PaginateSort;
  /** Initial page size. A chained `.limit()` call replaces it. Default 20. */
  limit?: number;
  /** Return `pageInfo` metadata. Default true. `false` returns `{ docs }` only. */
  pageInfo?: boolean;
  /**
   * Append `_id` to the effective sort as a tie-breaker. Default true.
   * Set to false only when the final sort is proven unique by the caller.
   */
  tieBreaker?: boolean;
  /**
   * Fetch one extra document to prove whether the next page in the direction
   * of movement exists. Default false. A page size of 20 then uses an
   * internal database limit of 21.
   */
  lookahead?: boolean;
  /**
   * Run an explicit count query and report `totalDocs`.
   * `'estimated'` uses collection metadata and needs an empty filter.
   */
  count?: 'exact' | 'estimated';
}

export interface CursorPaginateOptions extends PaginateBaseOptions {
  mode: 'cursor';
  /** Opaque cursor. Returns documents after this position in the canonical order. */
  after?: string;
  /** Opaque cursor. Returns documents before this position in the canonical order. */
  before?: string;
  page?: never;
}

export interface OffsetPaginateOptions extends PaginateBaseOptions {
  mode: 'offset';
  /** One-based page number. Default 1. */
  page?: number;
  after?: never;
  before?: never;
}

export type PaginateOptions = CursorPaginateOptions | OffsetPaginateOptions;

export interface CursorPageInfo {
  mode: 'cursor';
  limit: number;
  /** Cursor for the page after the last returned document, or null when the page is empty. */
  nextCursor: string | null;
  /** Cursor for the page before the first returned document, or null when the page is empty. */
  previousCursor: string | null;
  /** true or false when proven by this query. null when the query did not do enough work to know. */
  hasNextPage: boolean | null;
  hasPreviousPage: boolean | null;
  totalDocs?: number;
}

export interface OffsetPageInfo {
  mode: 'offset';
  page: number;
  limit: number;
  hasNextPage: boolean | null;
  hasPreviousPage: boolean;
  totalDocs?: number;
  totalPages?: number;
}

export type PageInfo = CursorPageInfo | OffsetPageInfo;

export interface Page<TDoc, TPageInfo extends PageInfo = PageInfo> {
  docs: TDoc[];
  pageInfo: TPageInfo;
}

export interface PageWithoutInfo<TDoc> {
  docs: TDoc[];
}

export type PaginateEnvelope<TDoc, TPageInfo extends PageInfo | null> =
  TPageInfo extends null ? PageWithoutInfo<TDoc> : Page<TDoc, NonNullable<TPageInfo>>;
