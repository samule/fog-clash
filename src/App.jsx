import { useEffect, useState } from 'react';
import {
  createGame, drop, dismiss, scout, endTurn, canDrop, pieceAt, threatCount, PLAYER, ENEMY,
} from './game/engine.js';
import { chooseEnemyAction } from './game/ai.js';
import { COLS, ROWS, HERO_HP, ACTIONS_PER_TURN, CHARGE_POWER, CHARGE_COUNTDOWN, TRAP_DAMAGE } from './game/constants.js';
import './App.css';

// Each color is a troop type with its own shape, so the board reads without color too.
const TROOPS = {
  red: { name: 'Pikemen', glyph: '▲' },
  green: { name: 'Rangers', glyph: '●' },
  blue: { name: 'Mages', glyph: '◆' },
};
const rows = [...Array(ROWS).keys()];
const cols = [...Array(COLS).keys()];

// When Claude republishes the page, keep the game in progress instead of resetting it.
const hot = typeof window !== 'undefined' ? window.claude?.hot : undefined;
const initialGame = () => hot?.data?.game ?? createGame();

export default function App() {
  const [game, setGame] = useState(initialGame);
  const [handIndex, setHandIndex] = useState(0);
  const [mode, setMode] = useState('drop'); // 'drop' | 'dismiss'

  useEffect(() => { hot?.snapshot?.(() => ({ game })); }, [game]);

  // Enemy turn: the AI plays one action at a time so you can follow it.
  useEffect(() => {
    if (game.winner || game.turn !== ENEMY) return;
    const delay = game.actionsLeft === ACTIONS_PER_TURN ? 900 : 650;
    const t = setTimeout(() => {
      const a = chooseEnemyAction(game);
      setGame(a.type === 'drop' ? drop(game, a.handIndex, a.col) : endTurn(game));
    }, delay);
    return () => clearTimeout(t);
  }, [game]);

  // Out of actions: hand the turn over after a short beat.
  useEffect(() => {
    if (game.winner || game.turn !== PLAYER || game.actionsLeft > 0) return;
    const t = setTimeout(() => setGame((g) => endTurn(g)), 900);
    return () => clearTimeout(t);
  }, [game]);

  const myTurn = game.turn === PLAYER && !game.winner && game.actionsLeft > 0;

  const onPlayerCell = (col, slot) => {
    if (!myTurn) return;
    if (mode === 'dismiss') {
      const next = dismiss(game, col, slot);
      if (next !== game) { setGame(next); setMode('drop'); }
    } else {
      setGame(drop(game, handIndex, col));
    }
  };
  const onEnemyCell = (col, slot) => { if (myTurn) setGame(scout(game, col, slot)); };
  const restart = () => { setGame(createGame()); setMode('drop'); setHandIndex(0); };

  return (
    <div className="app">
      <header className="top">
        <h1>Fog Clash</h1>
        <details className="rules">
          <summary>How to play</summary>
          <ul>
            <li><b>Tap one of your columns</b> to drop the selected troop. Troops slide toward the front line.</li>
            <li><b>3 of a kind stacked in a column</b> become an attack formation. It strikes the facing enemy column after {CHARGE_COUNTDOWN} of your turns for {CHARGE_POWER} damage.</li>
            <li><b>3+ of a kind side by side</b> (same row) become walls, which move to the front and block hits.</li>
            <li>The enemy camp is <b>hidden in fog</b>. Tap a fogged cell to scout it. Numbers count nearby threats: enemy formations and traps. A trap costs you {TRAP_DAMAGE} HP.</li>
            <li>You get {ACTIONS_PER_TURN} actions per turn. Bring the enemy warlord to 0 HP to win.</li>
          </ul>
        </details>
      </header>

      <Hero name="Morrow, the Fog Warlord" hp={game.enemy.hp} side="enemy" active={game.turn === ENEMY} />

      <main className="board" aria-label="Battlefield">
        <div className="half enemy-half">
          {[...rows].reverse().map((slot) => cols.map((col) => (
            <EnemyCell key={`e${col}-${slot}`} game={game} col={col} slot={slot}
              onClick={() => onEnemyCell(col, slot)} clickable={myTurn} />
          )))}
        </div>
        <div className="front-line" role="presentation"><span>front line</span></div>
        <div className="half player-half">
          {rows.map((slot) => cols.map((col) => (
            <PlayerCell key={`p${col}-${slot}`} game={game} col={col} slot={slot} mode={mode}
              ghost={myTurn && mode === 'drop' ? game.player.hand[handIndex] : null}
              onClick={() => onPlayerCell(col, slot)} clickable={myTurn} />
          )))}
        </div>
      </main>

      <Hero name="Captain Ardent (you)" hp={game.player.hp} side="player" active={game.turn === PLAYER} />

      <section className="controls" aria-label="Your actions">
        <div className="status">
          <span className="turn-label">
            {game.winner ? 'Battle over' : game.turn === PLAYER ? `Your turn · ${game.turnNumber}` : 'Enemy is moving…'}
          </span>
          <span className="pips" aria-label={`${game.actionsLeft} actions left`}>
            {[...Array(ACTIONS_PER_TURN).keys()].map((i) => (
              <i key={i} className={i < (game.turn === PLAYER ? game.actionsLeft : 0) ? 'pip on' : 'pip'} />
            ))}
          </span>
        </div>
        <div className="hand" role="radiogroup" aria-label="Troop to drop">
          {game.player.hand.map((color, i) => (
            <button key={i} id={`hand-${i}`} role="radio" aria-checked={i === handIndex && mode === 'drop'}
              className={`token ${color} ${i === handIndex && mode === 'drop' ? 'selected' : ''}`}
              disabled={!myTurn}
              onClick={() => { setHandIndex(i); setMode('drop'); }}>
              <span className="glyph">{TROOPS[color].glyph}</span>
              <span className="tname">{TROOPS[color].name}</span>
            </button>
          ))}
        </div>
        <div className="buttons">
          <button id="dismiss" className={`btn ${mode === 'dismiss' ? 'armed' : ''}`} disabled={!myTurn}
            onClick={() => setMode(mode === 'dismiss' ? 'drop' : 'dismiss')}>
            {mode === 'dismiss' ? 'Tap a troop to dismiss' : 'Dismiss a troop'}
          </button>
          <button id="end-turn" className="btn primary" disabled={game.turn !== PLAYER || !!game.winner}
            onClick={() => setGame(endTurn(game))}>End turn</button>
        </div>
      </section>

      <ol className="log" aria-live="polite">
        {game.log.slice(-5).reverse().map((line, i) => <li key={game.log.length - i}>{line}</li>)}
      </ol>

      {game.winner && (
        <div className="overlay" role="dialog" aria-label="Battle result">
          <div className="result">
            <h2>{game.winner === PLAYER ? 'Victory' : 'Defeat'}</h2>
            <p>{game.winner === PLAYER ? 'The fog lifts. Morrow’s camp is broken.' : 'The fog swallows your company.'}</p>
            <button id="play-again" className="btn primary" onClick={restart}>Play again</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Hero({ name, hp, side, active }) {
  return (
    <div className={`hero ${side} ${active ? 'active' : ''}`}>
      <span className="hero-name">{name}</span>
      <span className="hp-bar"><span style={{ width: `${(hp / HERO_HP) * 100}%` }} /></span>
      <span className="hp-num">{hp}<small>/{HERO_HP}</small></span>
    </div>
  );
}

/** Visual for a piece fragment occupying one cell. */
function Piece({ hit, side }) {
  if (!hit) return null;
  const { piece, offset } = hit;
  if (piece.kind === 'wall') return <span className={`piece wall hp${piece.hp}`} title="Wall" />;
  if (piece.kind === 'charge') {
    return (
      <span className={`piece charge ${piece.color} ${side} part${offset}`}>
        {offset === 0 && <b className="count" title={`Fires in ${piece.countdown}, power ${piece.power}`}>{piece.countdown}</b>}
        {offset === 1 && <span className="glyph">{TROOPS[piece.color].glyph}</span>}
        {offset === 2 && <small className="power">{piece.power}⚔</small>}
      </span>
    );
  }
  return <span className={`piece unit ${piece.color}`}><span className="glyph">{TROOPS[piece.color].glyph}</span></span>;
}

function PlayerCell({ game, col, slot, onClick, clickable, ghost, mode }) {
  const column = game.player.columns[col];
  const hit = pieceAt(column, slot);
  const used = column.reduce((n, p) => n + p.size, 0);
  const isGhost = ghost && slot === used && canDrop(game, PLAYER, col);
  const dismissable = mode === 'dismiss' && hit?.piece.kind === 'unit';
  return (
    <button className={`cell player ${clickable ? 'clickable' : ''} ${dismissable ? 'dismissable' : ''}`}
      aria-label={`Your column ${col + 1}, row ${slot + 1}`} onClick={onClick} tabIndex={slot === 0 ? 0 : -1}>
      <Piece hit={hit} side="player" />
      {isGhost && <span className={`ghost ${ghost}`}><span className="glyph">{TROOPS[ghost].glyph}</span></span>}
    </button>
  );
}

function EnemyCell({ game, col, slot, onClick, clickable }) {
  const revealed = game.fog.revealed[col][slot];
  if (!revealed) {
    return (
      <button className={`cell enemy fog ${clickable ? 'clickable' : ''}`}
        aria-label={`Fog, enemy column ${col + 1}, row ${slot + 1}. Tap to scout`} onClick={onClick}
        style={{ '--d': `${(col * 37 + slot * 53) % 9}s` }} />
    );
  }
  const hit = pieceAt(game.enemy.columns[col], slot);
  const n = threatCount(game, col, slot);
  return (
    <div className="cell enemy revealed" aria-label={`Enemy column ${col + 1}, row ${slot + 1}`}>
      <Piece hit={hit} side="enemy" />
      {n > 0 && <span className={`threat t${Math.min(n, 4)}`}>{n}</span>}
    </div>
  );
}
