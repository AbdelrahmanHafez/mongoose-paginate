export class PaginationError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class InvalidPaginationOptionsError extends PaginationError {
  constructor(message: string) {
    super(message, 'INVALID_PAGINATION_OPTIONS');
  }
}

export class InvalidPaginationSortError extends PaginationError {
  constructor(message: string) {
    super(message, 'INVALID_PAGINATION_SORT');
  }
}

export class InvalidCursorError extends PaginationError {
  constructor(message: string) {
    super(message, 'INVALID_CURSOR');
  }
}
