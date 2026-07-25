import { RenderproveError } from '../core/errors.mjs';

export class ProjectReviewGate {
  #active = new Set();

  claim(projectRoot) {
    if (this.#active.has(projectRoot)) {
      throw new RenderproveError('A review is already running for this project.', {
        code: 'MCP_PROJECT_BUSY',
      });
    }
    this.#active.add(projectRoot);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active.delete(projectRoot);
    };
  }

  isActive(projectRoot) {
    return this.#active.has(projectRoot);
  }
}
