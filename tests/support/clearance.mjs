// A cleared staff member's `principal.clearance` (the `vitally_my_clearance`
// answer), for view tests that draw the normal staff screens. An uncleared or
// missing clearance draws the setup screen instead.
export const cleared = ({ isAdmin = false, capabilities = [] } = {}) => ({
  cleared: true,
  missing: [],
  capabilities: [...capabilities],
  isAdmin,
  siteCoordinatorName: null,
});
