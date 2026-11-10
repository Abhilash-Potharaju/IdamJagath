# Dev test tools
`cdp.mjs`: headless Chrome driver for scripted checks (and occasional verification screenshots).
Requires the dev server (`npm run dev`). Example:
```bash
OUT=/tmp/ij node tools/dev/cdp.mjs "http://localhost:5173/?explore" \
  "window.g=window.__game; g.ready.then(()=>'ready')" "WAIT:3000" "SHOT:view"
```
Screenshots are only for verification; delete them afterwards.
