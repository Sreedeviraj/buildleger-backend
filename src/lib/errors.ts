export class AppError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/** The entry looks like one already saved. The frontend lets the user confirm and save anyway. */
export class DuplicateError extends AppError {
  constructor(message: string) {
    super(409, message, 'DUPLICATE');
  }
}

export class NotFoundError extends AppError {
  constructor(what = 'Record') {
    super(404, `${what} not found.`);
  }
}
