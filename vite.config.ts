import { defineConfig } from 'vite';

export default defineConfig({
  // relative base so the build works from any sub-path (GitHub Pages: /<repo>/)
  base: './',
  // agent worktrees (.claude/worktrees, each with its own builds) and captured media live inside the repo: without
  // this, a build there (a new dist/index.html) full-reloads every open dev page
  server: { port: 5173, host: '127.0.0.1', watch: { ignored: ['**/.claude/**', '**/media/**', '**/dist*/**'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
