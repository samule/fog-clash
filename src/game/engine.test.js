// Run with: npm test  (uses Node's built-in test runner, no extra dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, drop, endTurn, scout, dismiss, findMatches, slotsUsed, PLAYER, ENEMY,
} from './engine.js';
import { chooseEnemyAction } from './ai.js';
import { COLS, ROWS, CHARGE_POWER, CHARGE_COUNTDOWN, HERO_HP, TRAP_DAMAGE, TRAP_COUNT } from './constants.js';

const unit = (id, color) => ({ id, kind: 'unit', color, size: 1, hp: 1 });
const empty = () => Array.from({ length: COLS }, () => []);

/** A blank game we can arrange by hand. */
function blankGame() {
  const g = createGame(42);
  g.player.columns = empty();
  g.enemy.columns = empty();
  g.nextId = 1000;
  return g;
}

test('new game: both sides have units, no ready-made matches, enemy front row visible', () => {
  const g = createGame(1);
  for (const side of [g.player, g.enemy]) {
    assert.ok(side.columns.some((c) => c.length > 0));
    const m = findMatches(side.columns);
    assert.equal(m.charges.length + m.walls.length, 0);
  }
  for (let c = 0; c < COLS; c++) assert.equal(g.fog.revealed[c][0], true);
  const traps = g.fog.traps.flat().filter(Boolean).length;
  assert.equal(traps, TRAP_COUNT);
});

test('vertical match of 3 becomes a charging formation', () => {
  let g = blankGame();
  g.player.columns[2] = [unit(1, 'red'), unit(2, 'red')];
  g.player.hand = ['red', 'blue', 'blue'];
  g = drop(g, 0, 2);
  const col = g.player.columns[2];
  assert.equal(col.length, 1);
  assert.equal(col[0].kind, 'charge');
  assert.equal(col[0].countdown, CHARGE_COUNTDOWN);
  assert.equal(slotsUsed(col), 3);
  assert.equal(g.actionsLeft, 2);
});

test('horizontal match of 3 becomes walls that move to the front', () => {
  let g = blankGame();
  g.player.columns[0] = [unit(1, 'green')];
  g.player.columns[1] = [unit(2, 'green')];
  g.player.columns[2] = [unit(3, 'blue')];
  g.player.hand = ['green', 'red', 'red'];
  // drop green into column 2 -> it sits at slot 1, not slot 0, so no match yet
  g = drop(g, 0, 2);
  assert.equal(g.player.columns[2][1].kind, 'unit');
  // a clean horizontal: green at slot 0 of columns 3,4,5
  g.player.columns[3] = [unit(10, 'green')];
  g.player.columns[4] = [unit(11, 'green')];
  g.player.hand = ['green', 'red', 'red'];
  g = drop(g, 0, 5);
  assert.deepEqual([3, 4, 5].map((c) => g.player.columns[c][0].kind), ['wall', 'wall', 'wall']);
});

test('cannot drop into a full column', () => {
  let g = blankGame();
  g.player.columns[0] = Array.from({ length: ROWS }, (_, i) => ({ id: i + 1, kind: 'wall', color: 'red', size: 1, hp: 2 }));
  const after = drop(g, 0, 0);
  assert.equal(after, g); // unchanged
});

test('formation fires after its countdown and damages the hero through an empty column', () => {
  let g = blankGame();
  g.player.columns[1] = [{ id: 5, kind: 'charge', color: 'red', size: 3, power: CHARGE_POWER, countdown: 1 }];
  g = endTurn(g); // enemy turn
  g = endTurn(g); // back to player: countdown 1 -> 0, fires
  assert.equal(g.enemy.hp, HERO_HP - CHARGE_POWER);
  assert.equal(g.player.columns[1].length, 0);
  assert.equal(g.fog.revealed[1][0], true);
});

test('walls and units absorb damage', () => {
  let g = blankGame();
  g.player.columns[0] = [{ id: 5, kind: 'charge', color: 'red', size: 3, power: CHARGE_POWER, countdown: 1 }];
  g.enemy.columns[0] = [{ id: 6, kind: 'wall', color: 'blue', size: 1, hp: 2 }, unit(7, 'green')];
  g = endTurn(endTurn(g));
  assert.equal(g.enemy.columns[0].length, 0);
  assert.equal(g.enemy.hp, HERO_HP - (CHARGE_POWER - 3));
});

test('scouting a trap hurts your hero; scouting a safe cell reveals it', () => {
  let g = blankGame();
  g.fog.revealed = g.fog.revealed.map((c) => c.map(() => false));
  g.fog.traps = g.fog.traps.map((c) => c.map(() => false));
  g.fog.traps[3][4] = true;
  g = scout(g, 3, 4);
  assert.equal(g.player.hp, HERO_HP - TRAP_DAMAGE);
  assert.equal(g.fog.traps[3][4], false);
  g = scout(g, 0, 0); // no threats nearby -> flood fill reveals a lot
  assert.ok(g.fog.revealed.flat().filter(Boolean).length > 5);
});

test('dismiss removes an idle unit', () => {
  let g = blankGame();
  g.player.columns[0] = [unit(1, 'red'), unit(2, 'blue')];
  g = dismiss(g, 0, 0);
  assert.deepEqual(g.player.columns[0].map((p) => p.id), [2]);
});

test('AI completes an obvious vertical match', () => {
  let g = blankGame();
  g.turn = ENEMY;
  g.enemy.columns[4] = [unit(1, 'blue'), unit(2, 'blue')];
  g.enemy.hand = ['red', 'blue', 'green'];
  const a = chooseEnemyAction(g);
  assert.deepEqual(a, { type: 'drop', handIndex: 1, col: 4 });
});

test('a full AI-vs-AI style game reaches a winner without crashing', () => {
  let g = createGame(7);
  for (let i = 0; i < 2000 && !g.winner; i++) {
    if (g.turn === PLAYER) g.turn = ENEMY; // let the AI play both turns by pretending
    const a = chooseEnemyAction(g);
    g = a.type === 'drop' ? drop(g, a.handIndex, a.col) : endTurn(g);
  }
  // Not guaranteed to finish, but it must stay a valid board
  for (const side of [g.player, g.enemy]) side.columns.forEach((c) => assert.ok(slotsUsed(c) <= ROWS));
});
