// Fog Clash rules engine.
//
// Everything here is plain JavaScript with no React, so the rules can be tested
// on their own. Every exported action takes a state and returns a NEW state
// (the old one is never changed). React relies on that to know when to re-render.
//
// Board model
// -----------
// Each side has COLS columns. A column is an array of "pieces" ordered from the
// front line (index 0, next to the middle of the board) to the back.
// A piece takes `size` slots: units and walls take 1, a charging formation 3.
// Gravity pulls pieces toward the front, so a column never has gaps.
//
// Piece = { id, kind: 'unit' | 'wall' | 'charge', color, size, hp, power, countdown }

import {
  COLS, ROWS, COLORS, HAND_SIZE, ACTIONS_PER_TURN, HERO_HP,
  CHARGE_SIZE, CHARGE_POWER, CHARGE_COUNTDOWN, WALL_HP, UNIT_HP,
  START_UNITS, TRAP_COUNT, TRAP_DAMAGE,
} from './constants.js';

export const PLAYER = 'player';
export const ENEMY = 'enemy';
export const other = (side) => (side === PLAYER ? ENEMY : PLAYER);

// ---------- Random numbers (seeded, so games and tests are reproducible) ----------

export function rand(state) {
  // mulberry32: tiny deterministic PRNG. The seed lives in the state.
  let t = (state.seed = (state.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (state, n) => Math.floor(rand(state) * n);
const randColor = (state) => COLORS[randInt(state, COLORS.length)];

// ---------- Small helpers ----------

const clone = (state) => structuredClone(state);
const newId = (state) => ++state.nextId;

export const slotsUsed = (column) => column.reduce((n, p) => n + p.size, 0);

/** Which piece covers a slot? Returns { piece, index, offset } or null. */
export function pieceAt(column, slot) {
  let start = 0;
  for (let i = 0; i < column.length; i++) {
    const p = column[i];
    if (slot < start + p.size) return { piece: p, index: i, offset: slot - start };
    start += p.size;
  }
  return null;
}

function makeUnit(state, color) {
  return { id: newId(state), kind: 'unit', color, size: 1, hp: UNIT_HP };
}

function log(state, text) {
  state.log = [...state.log.slice(-29), text];
}

// ---------- Matching ----------

/**
 * Find matches on one side without changing it.
 * Vertical: 3 same-color units in a row inside a column -> charging formation.
 * Horizontal: 3+ same-color units on the same slot in neighboring columns -> walls.
 * A unit that is part of both counts for the vertical match only.
 */
export function findMatches(columns) {
  const charges = []; // [{ col, ids: [id, id, id] }]
  const inCharge = new Set();

  columns.forEach((column, col) => {
    let run = [];
    for (const p of column) {
      if (p.kind === 'unit' && run.length && run[0].color === p.color) run.push(p);
      else run = p.kind === 'unit' ? [p] : [];
      if (run.length === CHARGE_SIZE) {
        charges.push({ col, ids: run.map((u) => u.id) });
        run.forEach((u) => inCharge.add(u.id));
        run = [];
      }
    }
  });

  const walls = new Set();
  for (let slot = 0; slot < ROWS; slot++) {
    let run = [];
    const flush = () => {
      if (run.length >= 3) run.forEach((u) => !inCharge.has(u.id) && walls.add(u.id));
      run = [];
    };
    for (let col = 0; col < COLS; col++) {
      const hit = pieceAt(columns[col], slot);
      const unit = hit && hit.piece.kind === 'unit' ? hit.piece : null;
      if (unit && run.length && run[0].color === unit.color) run.push(unit);
      else { flush(); if (unit) run = [unit]; }
    }
    flush();
  }

  return { charges, walls: [...walls] };
}

const RANK = { wall: 0, charge: 1, unit: 2 };
// Walls move to the front, then formations, then idle units (stable sort keeps order).
const sortColumn = (column) => column.sort((a, b) => RANK[a.kind] - RANK[b.kind]);

/**
 * Turn matches into formations/walls until none are left (chain reactions).
 * Mutates `side`. Returns how many formations and walls were made.
 */
function resolveMatches(state, sideKey) {
  const side = state[sideKey];
  let made = { charges: 0, walls: 0 };
  for (;;) {
    const { charges, walls } = findMatches(side.columns);
    if (!charges.length && !walls.length) break;

    for (const { col, ids } of charges) {
      const column = side.columns[col];
      const first = column.findIndex((p) => p.id === ids[0]);
      const color = column[first].color;
      column.splice(first, CHARGE_SIZE, {
        id: newId(state), kind: 'charge', color, size: CHARGE_SIZE,
        power: CHARGE_POWER, countdown: CHARGE_COUNTDOWN,
      });
    }
    const wallIds = new Set(walls);
    for (const column of side.columns) {
      for (const p of column) if (wallIds.has(p.id)) Object.assign(p, { kind: 'wall', hp: WALL_HP });
    }
    side.columns.forEach(sortColumn);
    made.charges += charges.length;
    made.walls += walls.length;
  }
  return made;
}

// ---------- Fog (Minesweeper layer over the enemy half) ----------

/** Number shown on a revealed enemy cell: adjacent traps + adjacent enemy formation cells. */
export function threatCount(state, col, slot) {
  let n = 0;
  for (let dc = -1; dc <= 1; dc++) {
    for (let ds = -1; ds <= 1; ds++) {
      if (!dc && !ds) continue;
      const c = col + dc, s = slot + ds;
      if (c < 0 || c >= COLS || s < 0 || s >= ROWS) continue;
      if (state.fog.traps[c][s]) n++;
      else if (pieceAt(state.enemy.columns[c], s)?.piece.kind === 'charge') n++;
    }
  }
  return n;
}

function reveal(state, col, slot) {
  // Classic Minesweeper flood fill: revealing a "0" also reveals its neighbors.
  const stack = [[col, slot]];
  while (stack.length) {
    const [c, s] = stack.pop();
    if (c < 0 || c >= COLS || s < 0 || s >= ROWS || state.fog.revealed[c][s]) continue;
    state.fog.revealed[c][s] = true;
    if (state.fog.traps[c][s]) continue;
    if (threatCount(state, c, s) === 0) {
      for (let dc = -1; dc <= 1; dc++) for (let ds = -1; ds <= 1; ds++) stack.push([c + dc, s + ds]);
    }
  }
}

// ---------- Damage ----------

function damageHero(state, sideKey, amount) {
  const side = state[sideKey];
  side.hp = Math.max(0, side.hp - amount);
  if (side.hp === 0 && !state.winner) {
    state.winner = other(sideKey);
    log(state, state.winner === PLAYER ? '🏆 Victory! The enemy hero falls.' : '💀 Defeat… your hero falls.');
  }
}

/** A formation fires straight across into the facing column. */
function fire(state, attackerKey, col, formation) {
  const defenderKey = other(attackerKey);
  const column = state[defenderKey].columns[col];
  let power = formation.power;
  let slot = 0;
  let hitSlots = 0;

  for (const p of column) {
    if (power <= 0) break;
    const toughness = p.kind === 'charge' ? p.power : p.hp;
    const absorbed = Math.min(power, toughness);
    power -= absorbed;
    if (p.kind === 'charge') p.power -= absorbed; else p.hp -= absorbed;
    slot += p.size;
    hitSlots = slot;
  }
  state[defenderKey].columns[col] = column.filter((p) => (p.kind === 'charge' ? p.power > 0 : p.hp > 0));

  // Your attacks light up the fog of the cells they pass through.
  if (attackerKey === PLAYER) {
    for (let s = 0; s < Math.min(ROWS, Math.max(hitSlots, 1)); s++) state.fog.revealed[col][s] = true;
  }

  const who = attackerKey === PLAYER ? 'Your' : 'Enemy';
  if (power > 0) {
    log(state, `⚔️ ${who} ${formation.color} formation breaks through column ${col + 1} for ${power} damage!`);
    damageHero(state, defenderKey, power);
  } else {
    log(state, `🛡️ ${who} ${formation.color} formation is stopped in column ${col + 1}.`);
  }
  resolveMatches(state, defenderKey); // units sliding forward can form new matches
}

/** At the start of a side's turn its formations count down; at 0 they fire. */
function tickFormations(state, sideKey) {
  const side = state[sideKey];
  for (let col = 0; col < COLS; col++) {
    for (const p of [...side.columns[col]]) {
      if (p.kind !== 'charge') continue;
      p.countdown -= 1;
      if (p.countdown <= 0) {
        side.columns[col] = side.columns[col].filter((q) => q.id !== p.id);
        fire(state, sideKey, col, p);
        if (state.winner) return;
      }
    }
  }
}

// ---------- Setup ----------

function fillSide(state, sideKey) {
  const side = state[sideKey];
  let placed = 0, tries = 0;
  while (placed < START_UNITS && tries++ < 1000) {
    const col = randInt(state, COLS);
    if (slotsUsed(side.columns[col]) >= 3) continue; // keep the back rows open
    const unit = makeUnit(state, randColor(state));
    side.columns[col].push(unit);
    const m = findMatches(side.columns);
    if (m.charges.length || m.walls.length) side.columns[col].pop(); // no free matches at start
    else placed++;
  }
}

export function createGame(seed = Date.now()) {
  const state = {
    seed: seed | 0,
    nextId: 0,
    turn: PLAYER,
    actionsLeft: ACTIONS_PER_TURN,
    turnNumber: 1,
    winner: null,
    log: [],
    player: { hp: HERO_HP, columns: Array.from({ length: COLS }, () => []), hand: [] },
    enemy: { hp: HERO_HP, columns: Array.from({ length: COLS }, () => []), hand: [] },
    fog: {
      revealed: Array.from({ length: COLS }, () => Array(ROWS).fill(false)),
      traps: Array.from({ length: COLS }, () => Array(ROWS).fill(false)),
    },
  };
  fillSide(state, PLAYER);
  fillSide(state, ENEMY);
  for (const key of [PLAYER, ENEMY]) {
    state[key].hand = Array.from({ length: HAND_SIZE }, () => randColor(state));
  }
  // Traps hide in the back rows (slot 2+) so the opening frontier is safe.
  let traps = 0;
  while (traps < TRAP_COUNT) {
    const c = randInt(state, COLS), s = 2 + randInt(state, ROWS - 2);
    if (!state.fog.traps[c][s]) { state.fog.traps[c][s] = true; traps++; }
  }
  for (let c = 0; c < COLS; c++) reveal(state, c, 0); // the enemy front line starts visible
  log(state, 'The battle begins. Drop troops, match 3 to attack, scout the fog.');
  return state;
}

// ---------- Actions ----------

export function canDrop(state, sideKey, col) {
  return slotsUsed(state[sideKey].columns[col]) < ROWS;
}

/** Drop the token in hand slot `handIndex` into column `col` (Connect-4 style). */
export function drop(prev, handIndex, col) {
  const sideKey = prev.turn;
  if (prev.winner || prev.actionsLeft <= 0 || !canDrop(prev, sideKey, col)) return prev;
  const state = clone(prev);
  const side = state[sideKey];
  const color = side.hand[handIndex];
  side.columns[col].push(makeUnit(state, color));
  side.hand[handIndex] = randColor(state);
  const made = resolveMatches(state, sideKey);
  const who = sideKey === PLAYER ? 'You' : 'Enemy';
  if (made.charges) log(state, `✨ ${who} formed a ${color} attack formation!`);
  if (made.walls) log(state, `🧱 ${who} raised ${made.walls} wall${made.walls > 1 ? 's' : ''}.`);
  state.actionsLeft -= 1;
  return state;
}

/** Dismiss one of your own idle units (frees space, may trigger matches). */
export function dismiss(prev, col, slot) {
  const sideKey = prev.turn;
  if (prev.winner || prev.actionsLeft <= 0) return prev;
  const hit = pieceAt(prev[sideKey].columns[col], slot);
  if (!hit || hit.piece.kind !== 'unit') return prev;
  const state = clone(prev);
  state[sideKey].columns[col].splice(hit.index, 1);
  const made = resolveMatches(state, sideKey);
  if (made.charges || made.walls) log(state, '✨ Dismissing a unit set off a match!');
  state.actionsLeft -= 1;
  return state;
}

/** Scout a fogged enemy cell (player only). Traps hurt your hero. */
export function scout(prev, col, slot) {
  if (prev.winner || prev.turn !== PLAYER || prev.actionsLeft <= 0) return prev;
  if (prev.fog.revealed[col][slot]) return prev;
  const state = clone(prev);
  state.actionsLeft -= 1;
  if (state.fog.traps[col][slot]) {
    state.fog.revealed[col][slot] = true;
    state.fog.traps[col][slot] = false; // disarmed
    log(state, `💥 Trap! Your scout triggers it: −${TRAP_DAMAGE} HP.`);
    damageHero(state, PLAYER, TRAP_DAMAGE);
  } else {
    reveal(state, col, slot);
    log(state, `🔍 You scout column ${col + 1}.`);
  }
  return state;
}

/** End the current turn: switch sides, then the new side's formations tick. */
export function endTurn(prev) {
  if (prev.winner) return prev;
  const state = clone(prev);
  state.turn = other(state.turn);
  state.actionsLeft = ACTIONS_PER_TURN;
  if (state.turn === PLAYER) state.turnNumber += 1;
  tickFormations(state, state.turn);
  return state;
}
