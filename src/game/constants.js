// Tunable game numbers live here so balancing never means hunting through logic.
export const COLS = 6; // columns per side
export const ROWS = 6; // depth (slots) per column; slot 0 is the front line
export const COLORS = ['red', 'green', 'blue']; // 3 troop types for the MVP
export const HAND_SIZE = 3; // tokens you can choose from
export const ACTIONS_PER_TURN = 3;
export const HERO_HP = 20;

export const CHARGE_SIZE = 3; // a vertical match of 3 becomes one charging formation
export const CHARGE_POWER = 6; // damage a formation deals when it fires
export const CHARGE_COUNTDOWN = 2; // owner turns before it fires
export const WALL_HP = 2;
export const UNIT_HP = 1;

export const START_UNITS = 10; // units placed on each side at the start
export const TRAP_COUNT = 5; // hidden traps in the enemy fog
export const TRAP_DAMAGE = 3; // damage to your hero when you scout a trap
