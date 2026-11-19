# Idam Jagath: rules for Claude

Resume guide: [NEXT_STEPS.md](NEXT_STEPS.md). History: [PROJECT.md](PROJECT.md). Assets: [docs/ASSETS.md](docs/ASSETS.md).

## Asset licences (hard rule, set by the owner)

The repo is public and the game is served on GitHub Pages, so every asset file in it is redistributed.

- **Allowed:** CC0, CC BY (credit in `data/assets.json` with a `credit_order`, so it appears on the credits screen),
  and assets we make ourselves (Blender scripts, generated textures).
- **Never use any licence that is ambiguous or restricts redistribution**, however permissive it looks. This includes
  Sketchfab "Free Standard"/Standard, Editorial, NC (non-commercial), ND (no derivatives), "royalty-free" store
  licences, "free for personal use", custom or unclear terms, and models with no stated licence. Sketchfab Standard,
  for example, forbids making a model "available as a stand-alone file", which a public repo does.
- **Unsure? Don't use it.** Verify the licence from the source's API or licence page before downloading
  (Sketchfab: `GET https://api.sketchfab.com/v3/models/<uid>` → `license.label`). If it isn't plainly CC0 or CC BY,
  find another asset, generate one (Blender/AI), or ask the owner. Do not argue a grey area into a "yes".
- Also reject ripped/franchise models and likenesses of real people.
