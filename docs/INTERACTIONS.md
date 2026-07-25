# Interaction plans

Renderprove interaction plans describe a small, deterministic sequence of browser actions. They are intended for project-owned review recipes and agent-generated proposals that can be validated before execution.

The interaction API is currently standalone. It does not change manifest v1 or receipt v1. A later integration can attach plan results and capture artifacts to a new evidence contract without silently widening the existing receipt schema.

## Use the API

```js
import { normalizeInteractionPlan, runInteractionPlan } from 'renderprove/interaction';

const plan = normalizeInteractionPlan({
  version: 1,
  name: 'open-and-capture',
  steps: [
    {
      id: 'open',
      type: 'click',
      target: { by: 'role', role: 'button', name: 'Open' }
    },
    {
      id: 'ready',
      type: 'waitFor',
      target: { by: 'text', value: 'Ready' },
      state: 'visible'
    },
    {
      id: 'after',
      type: 'capture',
      name: 'after-open'
    }
  ]
});

const result = await runInteractionPlan(page, plan, {
  capture: async ({ page, name, fullPage, timeoutMs }) => {
    await page.screenshot({ path: `${name}.png`, fullPage, timeout: timeoutMs });
  }
});
```

Editors can validate plan files with `schema/interaction-plan-v1.schema.json`.

## Step vocabulary

- `pointerMove`: move to a viewport-relative or target-relative point.
- `click`: click a locator or a declared point.
- `drag`: press at one declared point, move, and release at another.
- `fill`: replace or append text in a located control.
- `select`: choose one or more declared option values.
- `waitFor`: wait for an element to become attached, detached, visible, or hidden.
- `wait`: pause for a bounded duration.
- `capture`: request page or element evidence through the caller-supplied capture handler.

Locators support `testId`, `role`, `label`, `text`, and `css`. Prefer test IDs, roles, and labels. CSS exists for canvas surfaces and project-specific controls that lack a better semantic locator.

Points use normalised coordinates between `0` and `1`:

```json
{
  "space": "target",
  "target": { "by": "css", "value": "canvas" },
  "x": 0.25,
  "y": 0.5
}
```

This keeps pointer recipes usable across viewport sizes and responsive layouts.

## Bounds and privacy

The validator enforces:

- at most 100 steps
- a declared execution budget of at most 120 seconds
- per-step time and movement limits
- unique step IDs and capture names
- bounded locator and text lengths
- finite normalised pointer coordinates
- strict known-field checking

Results include step IDs, types, timing, status, and coarse action metadata. Filled text, selectors, labels, option values, locator names, and raw failure messages are excluded from successful result details and bounded failure metadata.

Cancellation propagates through waits, movement, drag cleanup, and capture callbacks. A failed or cancelled drag attempts to release the left mouse button. Capture handlers receive a signal combining caller cancellation and the step timeout.

## Deliberate exclusions

Interaction plan v1 has no JavaScript evaluation, arbitrary keyboard shortcuts, file upload, download handling, clipboard access, authentication storage, shell execution, new-tab traversal, unrestricted Playwright calls, or raw Chrome debugging.

Those capabilities need separate threat models and evidence contracts rather than additions to this vocabulary.
