import './styles.css';
import { Game } from './game/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#view');
const ui = document.querySelector<HTMLElement>('#ui');
const touch = document.querySelector<HTMLElement>('#touch');

if (!canvas || !ui || !touch) {
  throw new Error('页面结构不完整');
}

try {
  new Game(canvas, ui, touch);
} catch (error) {
  ui.textContent = '这个浏览器没有可用的 WebGL。';
  console.error(error);
}
