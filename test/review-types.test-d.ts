import { Schema, model, type HydratedDocument } from 'mongoose';
import { asPaginateModel } from '../src/typed-model.js';
import type { CursorPageInfo, Page, PageWithoutInfo } from '../src/types.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;

interface Article {
  title: string;
  views: number;
}

const articleSchema = new Schema<Article>({
  title: String,
  views: Number
});
const Article = model<Article>('ReviewArticle', articleSchema);

async function keepsTheModelSurface() {
  const modelWithPaginate = asPaginateModel(Article);
  modelWithPaginate.find({ title: 'test' });
  modelWithPaginate.create({ title: 'test', views: 1 });
}

async function keepsDynamicPageInfoSound() {
  const pageInfo = Math.random() > 0.5;
  const page = await Article.paginate({}, {
    mode: 'cursor',
    sort: { views: 1 },
    pageInfo
  });

  type Actual = typeof page;
  type Expected =
    | Page<HydratedDocument<Article>, CursorPageInfo>
    | PageWithoutInfo<HydratedDocument<Article>>;
  const exact: Equal<Actual, Expected> = true;
  void exact;
}

async function keepsLeanOptions() {
  await Article.paginate({}, {
    mode: 'cursor',
    sort: { views: 1 }
  }).lean({ getters: true });
}

void keepsTheModelSurface;
void keepsDynamicPageInfoSound;
void keepsLeanOptions;
