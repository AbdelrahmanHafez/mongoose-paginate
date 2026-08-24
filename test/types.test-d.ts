/**
 * Compile-time assertions. This file never runs. `npm run test:types` fails
 * when any assertion stops compiling.
 */
import mongoose, { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import '../src/augment.js';
import { asPaginateModel } from '../src/typed-model.js';
import { PaginateQuery } from '../src/paginate-query.js';
import type {
  CursorPageInfo,
  CursorPaginateOptions,
  OffsetPageInfo,
  Page,
  PageWithoutInfo,
  PaginateOptions
} from '../src/types.js';
import {
  InvalidCursorError,
  InvalidPaginationOptionsError,
  InvalidPaginationSortError,
  PaginationError
} from '../src/errors.js';

declare function expectType<T>(value: T): void;

interface Article {
  title: string;
  views: number;
  publishedAt?: Date;
  author?: Types.ObjectId;
}

const articleSchema = new Schema<Article>({
  title: String,
  views: Number,
  publishedAt: Date,
  author: { type: Schema.Types.ObjectId, ref: 'Writer' }
});
const Article = model<Article>('Article', articleSchema);

async function cursorModeTypes() {
  const page = await Article.paginate({ views: { $gt: 0 } }, {
    mode: 'cursor',
    sort: { publishedAt: -1 },
    limit: 20
  });
  expectType<Page<HydratedDocument<Article>, CursorPageInfo>>(page);
  expectType<HydratedDocument<Article>>(page.docs[0]!);
  expectType<string | null>(page.pageInfo.nextCursor);
  expectType<boolean | null>(page.pageInfo.hasNextPage);
  expectType<'cursor'>(page.pageInfo.mode);
  // @ts-expect-error cursor mode never exposes totalPages
  page.pageInfo.totalPages;
}

async function offsetModeTypes() {
  const page = await Article.paginate({}, {
    mode: 'offset',
    page: 2,
    sort: 'title',
    limit: 10,
    count: 'exact'
  });
  expectType<Page<HydratedDocument<Article>, OffsetPageInfo>>(page);
  expectType<number | undefined>(page.pageInfo.totalPages);
  expectType<boolean | null>(page.pageInfo.hasPreviousPage);
}

async function pageInfoFalseTypes() {
  const page = await Article.paginate({}, {
    mode: 'cursor',
    sort: { publishedAt: -1 },
    pageInfo: false
  });
  expectType<PageWithoutInfo<HydratedDocument<Article>>>(page);
  // @ts-expect-error pageInfo does not exist on the opt-out envelope
  page.pageInfo;
}

async function chainingTypes() {
  const leanPage = await Article
    .paginate({}, { mode: 'cursor', sort: { publishedAt: -1 } })
    .lean();
  expectType<string>(leanPage.docs[0]!.title);
  // @ts-expect-error lean documents have no save()
  leanPage.docs[0]!.save;

  const populated = await Article
    .paginate({}, { mode: 'cursor', sort: { publishedAt: -1 } })
    .populate<{ author: { name: string } }>('author');
  expectType<string>(populated.docs[0]!.author.name);

  const chained = Article
    .paginate({}, { mode: 'offset', page: 1 })
    .sort({ views: -1 })
    .limit(5)
    .select('title views');
  expectType<PaginateQuery<Article, HydratedDocument<Article>, OffsetPageInfo>>(chained);
}

async function variableInputTypes() {
  // Non-literal option values must also type-check. Excess property checks
  // do not apply here, so this catches different gaps than literals do.
  const cursorOptions: CursorPaginateOptions = {
    mode: 'cursor',
    sort: { publishedAt: -1 },
    limit: 20,
    lookahead: true
  };
  // The variable's type permits pageInfo: false, so the sound result is the
  // union of both envelopes.
  const page = await Article.paginate({}, cursorOptions);
  expectType<Page<HydratedDocument<Article>, CursorPageInfo> | PageWithoutInfo<HydratedDocument<Article>>>(page);

  const dynamicOptions: PaginateOptions = Math.random() > 0.5
    ? { mode: 'cursor', sort: { publishedAt: -1 } }
    : { mode: 'offset', page: 3 };
  const dynamicPage = await Article.paginate({}, dynamicOptions);
  expectType<HydratedDocument<Article>>(dynamicPage.docs[0]!);
}

function invalidInputTypes() {
  // @ts-expect-error unknown mode
  Article.paginate({}, { mode: 'pages' });
  // @ts-expect-error page belongs to offset mode
  Article.paginate({}, { mode: 'cursor', page: 3 });
  // @ts-expect-error after belongs to cursor mode
  Article.paginate({}, { mode: 'offset', after: 'cursor' });
  // @ts-expect-error sort values use Mongoose SortOrder, not arbitrary numbers
  Article.paginate({}, { mode: 'cursor', sort: { views: 2 } });
  // @ts-expect-error cursors are opaque strings
  Article.paginate({}, { mode: 'cursor', after: { _id: 'raw' } });
}

function typedModelHelper() {
  const paginateArticle = asPaginateModel(Article);
  const query = paginateArticle.paginate({}, { mode: 'cursor', sort: { publishedAt: -1 } });
  expectType<PaginateQuery<Article, HydratedDocument<Article>, CursorPageInfo>>(query);
}

function errorTypes() {
  expectType<PaginationError>(new InvalidCursorError('x'));
  expectType<PaginationError>(new InvalidPaginationOptionsError('x'));
  expectType<PaginationError>(new InvalidPaginationSortError('x'));
  expectType<string>(new InvalidCursorError('x').code);
}

void cursorModeTypes;
void offsetModeTypes;
void pageInfoFalseTypes;
void chainingTypes;
void variableInputTypes;
void invalidInputTypes;
void typedModelHelper;
void errorTypes;
void mongoose;
