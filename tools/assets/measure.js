// In-page: sizes of the asset files the game actually fetched (needs PRELOAD to enlarge the resource buffer).
window.measureAssets = () => {
  const res = performance.getEntriesByType("resource").filter((r) => /\.(glb|gltf|jpe?g|png|hdr|env|m4a|ogg|ktx2|webp|bin)(\?|$)/.test(r.name));
  const rows = res.map((r) => [r.name.replace(location.origin, ""), r.decodedBodySize || r.transferSize]);
  const total = rows.reduce((a, b) => a + b[1], 0);
  return { files: rows.length, totalMB: +(total / 1e6).toFixed(2), top: rows.sort((a, b) => b[1] - a[1]).slice(0, 15).map((x) => [x[0], +(x[1] / 1e6).toFixed(2)]) };
};
