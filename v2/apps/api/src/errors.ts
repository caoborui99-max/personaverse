export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
export function fail(status: number, code: string, message: string, retryable = false): never {
  throw new ApiFailure(status, code, message, retryable);
}
