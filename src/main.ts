import './ui/style.css';
import { Game } from './core/Game';

const game = new Game();
game.boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f66;position:fixed;top:0;left:0;z-index:9;white-space:pre-wrap;padding:12px">${String(e?.stack ?? e)}</pre>`);
});
