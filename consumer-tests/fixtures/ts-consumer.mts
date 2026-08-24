import { Schema, model, type HydratedDocument } from 'mongoose';
import {
  mongoosePaginate,
  asPaginateModel,
  type CursorPageInfo,
  type Page
} from '@abdelrahmanhafez/mongoose-paginate';

interface Invoice {
  number: string;
  issuedAt: Date;
  total: number;
}

const invoiceSchema = new Schema<Invoice>({ number: String, issuedAt: Date, total: Number });
invoiceSchema.plugin(mongoosePaginate);
const Invoice = model<Invoice>('Invoice', invoiceSchema);

export async function firstPage(): Promise<Page<HydratedDocument<Invoice>, CursorPageInfo>> {
  // The global augmentation makes the static visible on every model.
  return await Invoice.paginate({ total: { $gt: 0 } }, {
    mode: 'cursor',
    sort: { issuedAt: -1 },
    limit: 20
  });
}

export async function strictHandle(): Promise<number> {
  const typed = asPaginateModel(Invoice);
  const page = await typed.paginate({}, { mode: 'offset', page: 1, count: 'exact' });
  return page.pageInfo.totalPages ?? 0;
}

export function rejectsWrongOptions(): void {
  // @ts-expect-error page is not a cursor option
  Invoice.paginate({}, { mode: 'cursor', page: 2 });
}
