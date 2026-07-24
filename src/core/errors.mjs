export class RenderproveError extends Error {
  constructor(message, { code = 'RENDERPROVE_ERROR', cause, details } = {}) {
    super(message, { cause });
    this.name = 'RenderproveError';
    this.code = code;
    this.details = details;
  }
}
