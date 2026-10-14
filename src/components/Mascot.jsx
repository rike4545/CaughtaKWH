import React from 'react';

// "Volt" — a tiny pixel-art charger plug that reflects how trustworthy a price is.
// Pixel art is an accent only (empty states, hero, status); the rest of the UI stays clean.
// Colours come from CSS custom properties so the sprite follows light/dark themes.

const HEAD = [
  '.....YY.....',
  '....YY......',
  '...YYYY.....',
  '..BBBBBBBB..',
  '.BBBBBBBBBB.'
];
const FEET = [
  '..BBBBBBBB..',
  '...P....P...',
  '...P....P...'
];
const FACES = {
  idle: ['.BBDBBBBDBB.', '.BBBBBBBBBB.', '.BBDBBBBDBB.', '.BBBDDDDBBB.'],
  happy: ['.BBDBBBBDBB.', '.BBBDBBDBBB.', '.BBBBBBBBBB.', '.BBDDDDDDBB.'],
  sleepy: ['.BBBBBBBBBB.', '.BBDDBBDDBB.', '.BBBBBBBBBB.', '.BBBBDDBBBB.'],
  thirsty: ['.BBDBBBBDBB.', '.BBBBBBBBBB.', '.BBBBBBBBBB.', '.BBBDDDDBBB.'],
  searching: ['.BBBDBBBDBB.', '.BBBDBBBDBB.', '.BBBBBBBBBB.', '.BBBBDDBBBB.']
};
const CLASS = { B: 'mascotBody', D: 'mascotInk', Y: 'mascotBolt', P: 'mascotInk', S: 'mascotDrop' };

function buildRows(mood) {
  const face = FACES[mood] || FACES.idle;
  const rows = [...HEAD, ...face, ...FEET].map(row => row.split(''));
  if (mood === 'thirsty') { rows[4][10] = 'S'; rows[5][10] = 'S'; }
  if (mood === 'happy') { rows[1][8] = 'Y'; rows[0][9] = 'Y'; rows[2][10] = 'Y'; }
  return rows;
}

export function Mascot({ mood = 'idle', size = 72, label, className = '' }) {
  const rows = buildRows(mood);
  const cells = [];
  rows.forEach((row, y) => row.forEach((ch, x) => {
    if (ch !== '.') cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" className={CLASS[ch]} />);
  }));
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  return <svg className={`mascot mascot-${mood} ${className}`} width={size} height={size * rows.length / 12} viewBox={`0 0 12 ${rows.length}`} shapeRendering="crispEdges" {...a11y}>{cells}</svg>;
}

// Maps the dashboard's pricing tone to a mascot mood.
export function moodFor({ fresh, hasHistory, checked, blocked } = {}) {
  if (fresh) return 'happy';
  if (blocked) return 'thirsty';
  if (hasHistory) return 'sleepy';
  if (checked) return 'thirsty';
  return 'searching';
}
