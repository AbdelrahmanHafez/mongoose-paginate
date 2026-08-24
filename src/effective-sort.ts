import type { Schema, SchemaType } from 'mongoose';
import { InvalidPaginationSortError } from './errors.js';

export interface SortField {
  path: string;
  direction: 1 | -1;
}

export interface ResolveEffectiveSortOptions {
  tieBreaker: boolean;
}

export function resolveEffectiveSort(
  schema: Schema,
  rawSort: Record<string, unknown> | undefined,
  options: ResolveEffectiveSortOptions
): SortField[] {
  const fields: SortField[] = [];
  for (const [path, value] of Object.entries(rawSort ?? {})) {
    fields.push({ path, direction: normalizeDirection(path, value) });
    validateSortPath(schema, path);
  }

  const hasIdField = fields.some(field => field.path === '_id');
  if (!hasIdField) {
    if (options.tieBreaker) {
      const lastField = fields[fields.length - 1];
      fields.push({ path: '_id', direction: lastField?.direction ?? 1 });
    } else if (fields.length === 0) {
      throw new InvalidPaginationSortError(
        'Pagination needs a sort. Provide a sort, or enable the _id tie-breaker.'
      );
    }
  }

  return fields;
}

function normalizeDirection(path: string, value: unknown): 1 | -1 {
  if (value === 1 || value === 'asc' || value === 'ascending') {
    return 1;
  }
  if (value === -1 || value === 'desc' || value === 'descending') {
    return -1;
  }
  if (typeof value === 'object' && value !== null && '$meta' in value) {
    throw new InvalidPaginationSortError(
      `Cannot paginate a $meta sort on path "${path}". $meta scores have no cursor position.`
    );
  }
  throw new InvalidPaginationSortError(
    `Invalid sort direction ${JSON.stringify(value)} for path "${path}".`
  );
}

function validateSortPath(schema: Schema, path: string): void {
  const aliases = (schema as unknown as { aliases: Record<string, string> }).aliases;
  if (aliases[path] != null) {
    throw new InvalidPaginationSortError(
      `Cannot paginate on alias "${path}". Sort aliases are not resolved by Mongoose. Use "${aliases[path]}" instead.`
    );
  }

  const schemaType = schema.path(path) as SchemaType | undefined;
  if (schemaType == null) {
    throw new InvalidPaginationSortError(
      `Cannot paginate on unknown path "${path}". Cursor values need a known schema type.`
    );
  }
  if (isArrayType(schemaType)) {
    throw new InvalidPaginationSortError(
      `Cannot paginate on array path "${path}". Array sorting and range filters use different semantics.`
    );
  }
  if (schemaType.instance === 'Mixed') {
    throw new InvalidPaginationSortError(
      `Cannot paginate on Mixed path "${path}". Mixed values have no single comparison order.`
    );
  }

  const segments = path.split('.');
  for (let end = 1; end < segments.length; ++end) {
    const prefix = segments.slice(0, end).join('.');
    const prefixType = schema.path(prefix) as SchemaType | undefined;
    if (prefixType != null && isArrayType(prefixType)) {
      throw new InvalidPaginationSortError(
        `Cannot paginate on path "${path}" because "${prefix}" is an array.`
      );
    }
  }
}

function isArrayType(schemaType: SchemaType): boolean {
  const marker = schemaType as SchemaType & { $isMongooseArray?: boolean };
  return marker.$isMongooseArray === true || schemaType.instance === 'Array';
}
