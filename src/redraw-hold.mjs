// The redraw hold. Every render replaces the whole page (`root.innerHTML`),
// so a render at the wrong moment destroys what the person is doing:
// - between pointerdown and pointerup it replaces the pressed control, and
//   the click goes nowhere (#186);
// - during an IME composition it replaces the field being composed in, and
//   the half-typed text (pinyin, Cantonese, any IME) is lost.
// So while a press or a composition is in progress, on any page, a requested
// render waits. When the last of them ends, one flush is scheduled a task
// later: the press's own click (in the same task as pointerup) and the
// composition's last input are handled first, then the held render draws once.
//
// DOM-free; app.mjs drives it from its event listeners and owns the press's
// safety timer.

/**
 * @param {{ flush: () => void, schedule?: (fn: () => void) => void }} options
 */
export function createRedrawHold({ flush, schedule = (fn) => setTimeout(fn, 0) }) {
  let pressed = false;
  let composing = false;
  // null: nothing held. Otherwise the `focus` argument of the held render
  // (true if any held request asked for focus).
  let held = null;

  const holding = () => pressed || composing;

  return {
    holding,
    // A render asks: true means it is held and must not draw now.
    request(focus) {
      if (!holding()) return false;
      held = held || Boolean(focus);
      return true;
    },
    // What a flush should draw: null when nothing is held.
    pending: () => held,
    // A render drew: any held request is satisfied.
    drawn() {
      held = null;
    },
    press() {
      pressed = true;
    },
    release() {
      if (!pressed) return;
      pressed = false;
      schedule(flush);
    },
    compositionStart() {
      composing = true;
    },
    compositionEnd() {
      if (!composing) return;
      composing = false;
      schedule(flush);
    },
  };
}
