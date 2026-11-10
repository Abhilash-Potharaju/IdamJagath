/** CC BY 4.0 assets used in the game (attribution required). Keep in sync with art/CREDITS.md. */
const BY = "http://creativecommons.org/licenses/by/4.0/";
export const CREDITS: { title: string; author: string; url: string }[] = [
  { title: "Charminar, Hyderabad", author: "Dolores", url: "https://skfb.ly/YqOB" },
  { title: "AR-H470", author: "Frostoise", url: "https://sketchfab.com/3d-models/ar-h470-4b38c160243743d681d6fdaf3bd77ddb" },
  { title: "RL0N-25", author: "Frostoise", url: "https://sketchfab.com/3d-models/rl0n-25-c54ce41b7b854834a13ef1ed42aed6ba" },
  { title: "Autorikshaw - Indian Tuk Tuk", author: "bhagathartworks", url: "https://sketchfab.com/3d-models/autorikshaw-indian-tuk-tuk-5775d012693741008acff9dad410e92d" },
  { title: "Indian street shop", author: "nayan pachori", url: "https://sketchfab.com/3d-models/indian-street-shop-a7476a895cb841709ccbd5d9d8b96f36" },
  { title: "Thela street food stall", author: "anandmohan662", url: "https://sketchfab.com/3d-models/thela-street-food-stall-9407e18db7404bd5855707dd12ecd149" },
  { title: "Bhelpuri Shop", author: "AJAY", url: "https://sketchfab.com/3d-models/bhelpuri-shop-by-ajay-indian-local-shop-b8449c559da9434fbcdfcfcc92a5a082" },
  { title: "Indian Ricksha", author: "anandmohan662", url: "https://sketchfab.com/3d-models/indian-ricksha-fd3eb0c9390c486ebaa4d9dc231c9c29" },
  { title: "Spiderthing take 3", author: "Rasmus82", url: "https://sketchfab.com/3d-models/spiderthing-take-3-10bb4cf49d304d64afd2b829666f6caf" },
  { title: "alien monster", author: "victory_", url: "https://sketchfab.com/3d-models/alien-monster-1a28f8bd9b544b52b633591ee8b8d987" },
  { title: "Burned-out Cars", author: "kryik1023", url: "https://sketchfab.com/3d-models/burned-out-cars-701066df6b914fd08318524c7ccd96a7" },
  { title: "Crashed Abandoned Car - Game Ready", author: "rashad-brahimli", url: "https://sketchfab.com/3d-models/crashed-abandoned-car-game-ready-66ef51a84c9843dda53bf0b4b9020011" },
  { title: "Abandoned Generic Sedan 1 - Game Ready", author: "rashad-brahimli", url: "https://sketchfab.com/3d-models/abandoned-generic-sedan-1-game-ready-6a2169dafc254f399387a679305bb1bf" },
  { title: "Rubble Pile - Photoscan (Optimized)", author: "GameDevNick", url: "https://sketchfab.com/3d-models/rubble-pile-photoscan-optimized-5986d1487d9443b883d67b121c2c903c" },
  { title: "Broken concrete debris - low poly", author: "kemsui", url: "https://sketchfab.com/3d-models/broken-concrete-debris-low-poly-284ab0cef4fd4e0dbc963da2e52341b0" },
  { title: "Set of 4 Concrete rubble chunks", author: "matousekfoto", url: "https://sketchfab.com/3d-models/set-of-4-concrete-rubble-chunks-0d654a6e33624665ad20c5191f5d9d95" },
];

export function renderCredits(el: HTMLElement): void {
  el.innerHTML = CREDITS.map((c) =>
    `<li>"<a href="${c.url}" target="_blank" rel="noopener">${c.title}</a>" by ${c.author}, <a href="${BY}" target="_blank" rel="noopener">CC BY 4.0</a></li>`,
  ).join("");
}
