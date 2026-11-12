import { createSwitchGate, requireSwitchForStaff } from 'ccms-shared';

// CC056: Office Staff may hold/resume a transaction and enter a start or end time after the fact only while the Super Admin has
// turned the matching switch on (default off). Identity owns the switches; the gate asks it and remembers the answer for 10 seconds.
// Office Heads and Super Admins are not decided by a switch. Identity unreachable = switch off for staff.
let gate = null;
export const getSwitchGate = () => (gate ??= createSwitchGate());
/** Tests only: replace the gate (pass null to go back to the real one). */
export const setSwitchGate = (replacement) => { gate = replacement; };

export const requireStaffSwitch = (user, key) => requireSwitchForStaff(user, key, getSwitchGate());
