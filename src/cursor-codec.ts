import mongoose from 'mongoose';
import type { SortField } from './effective-sort.js';
import { InvalidCursorError } from './errors.js';

const CURSOR_VERSION = 1;

const { EJSON } = mongoose.mongo.BSON;

export interface CursorPayload {
  sort: SortField[];
  collation: Record<string, unknown> | null;
  values: unknown[];
}

export function encodeCursor(payload: CursorPayload): string {
  const transport = {
    v: CURSOR_VERSION,
    sort: payload.sort.map(field => [field.path, field.direction]),
    collation: payload.collation,
    values: payload.values.map(value => value === undefined ? null : value)
  };
  const json = EJSON.stringify(transport, { relaxed: false });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(
  cursor: string,
  expected: { sort: SortField[]; collation: Record<string, unknown> | null }
): CursorPayload {
  const transport = parseTransport(cursor);
  validateVersion(transport);
  const sort = validateSortSignature(transport, expected.sort);
  validateCollation(transport, expected.collation);
  const values = validateValues(transport, sort);
  return { sort, collation: expected.collation, values };
}

function parseTransport(cursor: string): Record<string, unknown> {
  if (typeof cursor !== 'string' || cursor.length === 0 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new InvalidCursorError('Cursor is not a valid base64url string.');
  }
  let parsed: unknown;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    parsed = EJSON.parse(json, { relaxed: true });
  } catch {
    throw new InvalidCursorError('Cursor does not contain a valid payload.');
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InvalidCursorError('Cursor does not contain a valid payload.');
  }
  return parsed as Record<string, unknown>;
}

function validateVersion(transport: Record<string, unknown>): void {
  if (transport.v !== CURSOR_VERSION) {
    throw new InvalidCursorError(
      `Unsupported cursor version ${JSON.stringify(transport.v)}. This build supports version ${CURSOR_VERSION}.`
    );
  }
}

function validateSortSignature(transport: Record<string, unknown>, expectedSort: SortField[]): SortField[] {
  const rawSort = transport.sort;
  if (!Array.isArray(rawSort) || rawSort.length !== expectedSort.length) {
    throw new InvalidCursorError('Cursor sort does not match the effective sort.');
  }
  for (let i = 0; i < expectedSort.length; ++i) {
    const entry = rawSort[i];
    const expectedField = expectedSort[i]!;
    if (!Array.isArray(entry) || entry[0] !== expectedField.path || entry[1] !== expectedField.direction) {
      throw new InvalidCursorError(
        'Cursor sort does not match the effective sort. A cursor is only valid for the sort that created it.'
      );
    }
  }
  return expectedSort;
}

function validateCollation(
  transport: Record<string, unknown>,
  expectedCollation: Record<string, unknown> | null
): void {
  const cursorCollation = transport.collation ?? null;
  if (stableStringify(cursorCollation) !== stableStringify(expectedCollation ?? null)) {
    throw new InvalidCursorError(
      'Cursor collation does not match the query collation. A cursor is only valid for the collation that created it.'
    );
  }
}

/**
 * Serializes with sorted object keys, so two collations with the same
 * fields compare equal regardless of key order.
 */
function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : 1)
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function validateValues(transport: Record<string, unknown>, sort: SortField[]): unknown[] {
  const values = transport.values;
  if (!Array.isArray(values) || values.length !== sort.length) {
    throw new InvalidCursorError('Cursor value count does not match the effective sort.');
  }
  for (const value of values) {
    rejectOperatorShapes(value);
  }
  return values;
}

function rejectOperatorShapes(value: unknown): void {
  if (value == null || typeof value !== 'object') {
    return;
  }
  if (isBsonValue(value)) {
    return;
  }
  for (const key of Object.keys(value)) {
    if (key.startsWith('$')) {
      throw new InvalidCursorError(`Cursor values must not contain operators. Found "${key}".`);
    }
  }
}

function isBsonValue(value: object): boolean {
  return '_bsontype' in value || value instanceof Date;
}
