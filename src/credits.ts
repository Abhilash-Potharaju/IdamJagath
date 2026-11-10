/**
 * Start-screen credits, GENERATED from the asset manifest (data/assets.json): every entry with a `credit_order`
 * (CC BY assets that require attribution) is listed, in that order. Add/remove credits in the manifest, not here.
 */
import manifest from "../data/assets.json";

interface AssetEntry { source?: string; author?: string; license?: string; license_url?: string; credit_title?: string; credit_order?: number }

export const CREDITS = Object.values(manifest.assets as Record<string, AssetEntry>)
  .filter((a) => a.credit_order !== undefined && a.credit_title)
  .sort((a, b) => a.credit_order! - b.credit_order!)
  .map((a) => ({ title: a.credit_title!, author: a.author ?? "", url: a.source ?? "", license: a.license ?? "", licenseUrl: a.license_url ?? "" }));

export function renderCredits(el: HTMLElement): void {
  el.innerHTML = CREDITS.map((c) =>
    `<li>"<a href="${c.url}" target="_blank" rel="noopener">${c.title}</a>" by ${c.author}, <a href="${c.licenseUrl}" target="_blank" rel="noopener">${c.license}</a></li>`,
  ).join("");
}
