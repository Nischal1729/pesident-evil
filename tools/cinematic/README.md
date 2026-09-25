# Cinematic capture (showcase video)

Deterministic, frame-by-frame capture of the game for trailers. `cine.js` drives the real game loop with a fake
30 fps clock, flies keyframed cameras (`shots.js`), composites titles, and logs sim events for the sound mix.

1. `npx vite build --outDir /tmp/pe-dist` and copy `cine.js` + `shots.js` into `/tmp/pe-dist/`.
2. `npx vite preview --outDir /tmp/pe-dist --port 5180` and `python3 upload_server.py <frames-dir> 5197`
   (frames) and `python3 upload_server.py <misc-dir> 5198` (stills, events, soundtrack).
3. Open the page at a 1280×720 CSS viewport (pixel ratio 1.5 → 1920×1080) and in the console:
   `const cine = await import('/cine.js'); await cine.setup(); const SH = await import('/shots.js');`
   then `let f = 0; while (f < C.totalFrames || !C.plan) f = await cine.run(SH.SHOTS, SH.titles, f, 600);`
4. Soundtrack: render the game's `Music` in an `OfflineAudioContext` with an intensity curve that follows the edit,
   and place the SFX buffers (`game.audio.audio.buffers`) at the logged event times (`C.audio`).
5. `ffmpeg -framerate 30 -i f%05d.jpg -i soundtrack.wav -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac
   -af loudnorm=I=-15:TP=-1.5 -movflags +faststart out.mp4`

Rendered videos go in `media/` (gitignored).
