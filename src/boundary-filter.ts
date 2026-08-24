import mongoose from 'mongoose';
import type { SortField } from './effective-sort.js';

export type Movement = 'forward' | 'backward';

const { trusted } = mongoose;

/**
 * Builds the range filter that selects documents strictly after (forward) or
 * strictly before (backward) the cursor position in the effective sort order.
 *
 * Null and missing values share one bucket, which MongoDB places before all
 * non-null values in ascending order. Every generated operator object is
 * marked trusted so `sanitizeFilter` does not rewrite it.
 */
export function buildBoundaryFilter(
  sort: SortField[],
  values: unknown[],
  movement: Movement
): Record<string, unknown> {
  const clauses: Record<string, unknown>[] = [];

  for (let i = 0; i < sort.length; ++i) {
    const field = sort[i]!;
    const value = values[i] === undefined ? null : values[i];
    const towardGreater = (field.direction === 1) === (movement === 'forward');

    const strict = buildStrictClause(field.path, value, towardGreater);
    if (strict == null) {
      continue;
    }

    const clause: Record<string, unknown> = {};
    for (let j = 0; j < i; ++j) {
      const priorField = sort[j]!;
      const priorValue = values[j] === undefined ? null : values[j];
      clause[priorField.path] = trusted({ $eq: priorValue });
    }
    Object.assign(clause, strict);
    clauses.push(clause);
  }

  if (clauses.length === 0) {
    // The cursor points at the extreme end of the order. No document lies
    // strictly beyond it.
    return { _id: trusted({ $in: [] }) };
  }

  return { $or: clauses };
}

function buildStrictClause(
  path: string,
  value: unknown,
  towardGreater: boolean
): Record<string, unknown> | null {
  const nullFree = path === '_id';

  if (towardGreater) {
    if (value === null) {
      // Everything after the null bucket is every non-null value.
      return { [path]: trusted({ $ne: null }) };
    }
    return { [path]: trusted({ $gt: value }) };
  }

  if (value === null) {
    // Nothing sorts before the null bucket.
    return null;
  }
  if (nullFree) {
    return { [path]: trusted({ $lt: value }) };
  }
  // Both smaller values and the null bucket come before this position.
  return {
    $or: [
      { [path]: trusted({ $lt: value }) },
      { [path]: trusted({ $eq: null }) }
    ]
  };
}
