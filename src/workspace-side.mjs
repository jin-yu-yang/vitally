// The side a signed-in person last chose, kept per user in this browser
// (add-workspace-switch D3). Never cleared at sign-out.
export const WORKSPACE_SIDE_PREFIX = "vitally.workspace-side:";

const isSide = (value) => value === "office" || value === "cases";

export function readWorkspaceSide(userId, { storage }) {
  if (!userId) return null;
  try {
    const saved = storage?.getItem(WORKSPACE_SIDE_PREFIX + userId);
    if (isSide(saved)) return saved;
  } catch {
    // Blocked storage: no remembered side.
  }
  return null;
}

export function writeWorkspaceSide(userId, side, { storage }) {
  if (!userId || !isSide(side)) return;
  try {
    storage?.setItem(WORKSPACE_SIDE_PREFIX + userId, side);
  } catch {
    // Blocked storage: the choice lasts for this page only.
  }
}
