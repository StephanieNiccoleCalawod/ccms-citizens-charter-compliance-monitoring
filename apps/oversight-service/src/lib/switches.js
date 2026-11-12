import { createSwitchGate, requireSwitchForStaff } from 'ccms-shared';

// CC056: what Office Staff may read here (reports: switch STAFF_VIEW_REPORTS, complaints: STAFF_VIEW_COMPLAINTS) is decided by the
// Super Admin's switches, asked of Identity and remembered for 10 seconds. Unreachable Identity = off. Other roles are not decided by a switch.
let gate = null;
export const getSwitchGate = () => (gate ??= createSwitchGate());
/** Tests only: replace the gate (null = the real one). */
export const setSwitchGate = (replacement) => { gate = replacement; };
export const requireStaffSwitch = (user, key) => requireSwitchForStaff(user, key, getSwitchGate());
