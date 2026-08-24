import { Schema, model } from 'mongoose';
import { mongoosePaginate, PaginateQuery } from '@abdelrahmanhafez/mongoose-paginate';

interface Receipt {
  reference: string;
  paidAt: Date;
}

const receiptSchema = new Schema<Receipt>({ reference: String, paidAt: Date });
receiptSchema.plugin(mongoosePaginate);
const Receipt = model<Receipt>('Receipt', receiptSchema);

export function buildQuery(): PaginateQuery<Receipt, unknown, null> {
  return Receipt.paginate({}, {
    mode: 'cursor',
    sort: { paidAt: -1 },
    pageInfo: false
  }) as PaginateQuery<Receipt, unknown, null>;
}
