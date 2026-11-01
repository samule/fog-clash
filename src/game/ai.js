// Simple enemy AI: a greedy one-move lookahead.
// For every (hand token, column) pair it simulates the drop, scores the result,
// and plays the best one. Good enough to be a sparring partner for the MVP.

import { COLS, HAND_SIZE } from './constants.js';
import { drop, canDrop, rand, ENEMY, PLAYER } from './engine.js';

const count = (columns, kind) =>
  columns.reduce((n, col) => n + col.filter((p) => p.kind === kind).length, 0);

/** Score how good a resulting board is for the enemy. */
function score(before, after, col) {
  const me = after[ENEMY].columns;
  let s = 0;
  s += (count(me, 'charge') - count(before[ENEMY].columns, 'charge')) * 10;

  // Walls are worth more in columns where the player has a formation aimed at us.
  const newWalls = count(me, 'wall') - count(before[ENEMY].columns, 'wall');
  const threatened = before[PLAYER].columns[col].some((p) => p.kind === 'charge');
  s += newWalls * (threatened ? 6 : 2);

  // Small bonus for setting up a vertical pair (next drop could finish it).
  const column = me[col];
  const last = column[column.length - 1];
  const prev = column[column.length - 2];
  if (last && prev && last.kind === 'unit' && prev.kind === 'unit' && last.color === prev.color) s += 3;

  // Prefer shorter columns slightly so the AI doesn't clog itself.
  s -= column.length * 0.3;
  return s;
}

/** Returns the next action for the enemy: { type: 'drop', handIndex, col } or { type: 'end' }. */
export function chooseEnemyAction(state) {
  if (state.turn !== ENEMY || state.winner || state.actionsLeft <= 0) return { type: 'end' };
  const rng = { seed: state.seed + state.turnNumber * 7919 + state.actionsLeft };
  let best = null;
  for (let h = 0; h < HAND_SIZE; h++) {
    for (let col = 0; col < COLS; col++) {
      if (!canDrop(state, ENEMY, col)) continue;
      const s = score(state, drop(state, h, col), col) + rand(rng) * 1.5; // jitter = less predictable
      if (!best || s > best.s) best = { s, handIndex: h, col };
    }
  }
  return best ? { type: 'drop', handIndex: best.handIndex, col: best.col } : { type: 'end' };
}
