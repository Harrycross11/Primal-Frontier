// Small drawn icons for every item, used in the hotbar, inventory and crafting menu.

import type { ItemId } from '../../shared/items.ts';
import { gunIconBody } from './guns.ts';
import { itemIconUrl } from './itemIcons.ts';

const wood = '#9a6b3f';
const woodDark = '#6e4a2a';
const stone = '#9a958c';
const stoneDark = '#6c6862';
const metal = '#a9adb2';
const rust = '#a35d32';

const sulfur = '#d9c24a';
const hqm = '#8fa3b5';
const brass = '#c9a24a';

/** Hand-drawn icons; guns are drawn from their model proportions in guns.ts. */
export const ICONS: Partial<Record<ItemId, string>> = {
  wood: `<rect x="5" y="20" width="30" height="9" rx="4" fill="${wood}" transform="rotate(-18 20 24)"/><rect x="6" y="11" width="28" height="9" rx="4" fill="${woodDark}" transform="rotate(10 20 15)"/><circle cx="31" cy="14" r="3" fill="#c49a6a"/>`,
  stone: `<path d="M7 28 L12 15 L22 10 L32 15 L34 27 L24 32 Z" fill="${stone}"/><path d="M12 15 L22 10 L24 20 Z" fill="#b8b3aa"/><path d="M24 20 L34 27 L24 32 Z" fill="${stoneDark}"/>`,
  scrap: `<path d="M6 26 L14 12 L28 14 L34 26 L20 32 Z" fill="#6b6f75"/><path d="M14 12 L28 14 L22 21 Z" fill="${rust}"/><circle cx="24" cy="25" r="3" fill="${rust}"/>`,
  metalOre: `<path d="M7 28 L12 14 L22 9 L33 15 L34 28 L22 33 Z" fill="${stoneDark}"/><circle cx="16" cy="19" r="3.5" fill="#c9883e"/><circle cx="25" cy="25" r="3" fill="#d9a35a"/><circle cx="26" cy="15" r="2" fill="#c9883e"/>`,
  metal: `<rect x="7" y="20" width="12" height="8" rx="1" fill="${metal}"/><rect x="18" y="13" width="14" height="8" rx="1" fill="#c5c9ce"/><rect x="17" y="24" width="15" height="7" rx="1" fill="#8e9298"/>`,
  cloth: `<path d="M8 10 H32 V28 Q26 24 20 28 Q14 32 8 28 Z" fill="#c9bb94"/><path d="M8 16 H32 M8 22 H32" stroke="#a89a74" stroke-width="1.5"/>`,
  rock: `<path d="M9 27 Q8 16 18 12 Q30 10 32 21 Q33 30 22 31 Q12 32 9 27 Z" fill="${stone}"/><path d="M14 17 Q20 13 26 15" stroke="#c4bfb6" stroke-width="2" fill="none"/>`,
  buildingPlan: `<rect x="8" y="9" width="24" height="22" rx="2" fill="#3f78b8"/><path d="M12 14 H28 M12 19 H24 M12 24 H28" stroke="#cfe3ff" stroke-width="1.6"/><rect x="26" y="7" width="6" height="26" rx="3" fill="#2c5a8c"/>`,
  stoneHatchet: `<path d="M12 34 L26 10" stroke="${wood}" stroke-width="4" stroke-linecap="round"/><path d="M22 8 Q34 8 34 18 L26 16 Z" fill="${stone}"/><path d="M20 14 L28 12" stroke="#5a4634" stroke-width="3"/>`,
  stonePickaxe: `<path d="M20 34 L20 12" stroke="${wood}" stroke-width="4" stroke-linecap="round"/><path d="M6 14 Q20 4 34 14 L30 15 Q20 10 10 15 Z" fill="${stone}"/>`,
  salvagedAxe: `<path d="M12 34 L26 10" stroke="#5c5f63" stroke-width="4" stroke-linecap="round"/><circle cx="28" cy="13" r="8" fill="${metal}"/><circle cx="28" cy="13" r="2.5" fill="#5c5f63"/><path d="M22 7 L24 9 M34 9 L32 11 M34 19 L32 17" stroke="#7e8288" stroke-width="2"/>`,
  salvagedPickaxe: `<path d="M20 34 L20 12" stroke="#5c5f63" stroke-width="4" stroke-linecap="round"/><path d="M5 15 Q20 3 35 15 L31 16 Q20 9 9 16 Z" fill="${metal}"/><rect x="17" y="9" width="6" height="7" fill="${rust}"/>`,
  workbench: `<rect x="5" y="14" width="30" height="5" rx="1" fill="${wood}"/><path d="M8 19 V32 M32 19 V32 M8 26 H32" stroke="${woodDark}" stroke-width="3"/><rect x="23" y="9" width="8" height="5" fill="${metal}"/>`,
  furnace: `<path d="M9 33 V16 Q9 8 20 8 Q31 8 31 16 V33 Z" fill="${stoneDark}"/><rect x="14" y="22" width="12" height="8" rx="2" fill="#ff8a2f"/><rect x="17" y="3" width="6" height="7" fill="${stone}"/>`,
  storageBox: `<rect x="6" y="13" width="28" height="18" rx="1.5" fill="${wood}"/><path d="M6 19 H34 M6 25 H34" stroke="${woodDark}" stroke-width="1.5"/><rect x="18" y="16" width="4" height="5" fill="${metal}"/>`,
  sulfurOre: `<path d="M7 28 L12 14 L22 9 L33 15 L34 28 L22 33 Z" fill="${stoneDark}"/><path d="M12 14 L22 9 L26 16 L16 21 Z" fill="${sulfur}"/><circle cx="26" cy="25" r="3" fill="${sulfur}"/>`,
  sulfur: `<path d="M8 30 Q10 18 20 14 Q30 18 32 30 Z" fill="${sulfur}"/><path d="M14 22 Q20 18 26 22" stroke="#f1df7a" stroke-width="2" fill="none"/>`,
  hqmOre: `<path d="M7 28 L12 14 L22 9 L33 15 L34 28 L22 33 Z" fill="#55585e"/><path d="M15 15 L24 12 L27 20 L18 23 Z" fill="${hqm}"/><circle cx="14" cy="26" r="2.5" fill="${hqm}"/>`,
  hqm: `<path d="M6 24 L20 17 L34 24 L20 31 Z" fill="#b8c6d2"/><path d="M6 24 L20 31 L20 34 L6 27 Z" fill="${hqm}"/><path d="M34 24 L20 31 L20 34 L34 27 Z" fill="#6f8294"/>`,
  charcoal: `<rect x="7" y="18" width="24" height="9" rx="4" fill="#2b2826" transform="rotate(-15 20 22)"/><rect x="11" y="12" width="20" height="8" rx="3.5" fill="#3b3734" transform="rotate(12 20 16)"/><circle cx="28" cy="15" r="2" fill="#5a5450"/>`,
  gunpowder: `<path d="M10 14 L30 14 L32 32 L8 32 Z" fill="#8a7a5a"/><path d="M10 14 Q20 8 30 14" fill="#6a5d44"/><circle cx="20" cy="24" r="5" fill="#2e2d2c"/>`,
  workbench2: `<rect x="5" y="14" width="30" height="5" rx="1" fill="#6f7378"/><path d="M8 19 V32 M32 19 V32 M8 26 H32" stroke="#4a4d52" stroke-width="3"/><rect x="10" y="8" width="9" height="6" fill="${rust}"/><text x="30" y="11" font-size="9" font-weight="700" fill="#e8dcc2" text-anchor="middle">2</text>`,
  workbench3: `<rect x="4" y="14" width="32" height="6" rx="1" fill="#3e4247"/><path d="M7 20 V32 M33 20 V32 M7 26 H33" stroke="#2c2f33" stroke-width="3"/><rect x="9" y="8" width="11" height="6" fill="${hqm}"/><text x="30" y="11" font-size="9" font-weight="700" fill="#e8dcc2" text-anchor="middle">3</text>`,
  woodenSpear: `<path d="M8 34 L32 8" stroke="${wood}" stroke-width="3" stroke-linecap="round"/><path d="M32 8 L35 4 L29 9 Z" fill="#c49a6a"/>`,
  stoneSpear: `<path d="M8 34 L30 10" stroke="${wood}" stroke-width="3" stroke-linecap="round"/><path d="M28 9 L36 3 L32 12 Z" fill="${stone}"/><path d="M27 13 L30 10" stroke="#5a4634" stroke-width="4"/>`,
  torch: `<path d="M12 35 L24 15" stroke="${wood}" stroke-width="4" stroke-linecap="round"/><rect x="21" y="11" width="8" height="8" rx="2" fill="#3a2a1c" transform="rotate(30 25 15)"/><path d="M27 13 Q22 6 28 2 Q27 7 33 8 Q34 13 27 13 Z" fill="#ff8a2f"/><path d="M27 12 Q25 8 28 6 Q29 9 31 10 Q30 12 27 12 Z" fill="#ffd27a"/>`,
  machete: `<path d="M9 33 L15 27" stroke="#2c2c2c" stroke-width="5" stroke-linecap="round"/><path d="M14 27 L32 8 Q36 8 34 13 L17 30 Z" fill="${metal}"/>`,
  salvagedSword: `<path d="M8 34 L13 29" stroke="#8a7a5a" stroke-width="5" stroke-linecap="round"/><path d="M10 25 L17 32" stroke="#6b6f75" stroke-width="3"/><path d="M14 28 L33 6 L35 8 L16 30 Z" fill="${rust}"/>`,
  huntingBow: `<path d="M12 5 Q34 20 12 35" stroke="${wood}" stroke-width="3" fill="none"/><path d="M12 5 L12 35" stroke="#d8d0bc" stroke-width="1"/><rect x="19" y="17" width="4" height="6" fill="#8a7a5a"/>`,
  crossbow: `<path d="M6 14 Q20 5 34 14" stroke="#7d7a74" stroke-width="3" fill="none"/><path d="M6 14 L20 18 L34 14" stroke="#d8d0bc" stroke-width="1" fill="none"/><rect x="18" y="10" width="4" height="25" fill="${wood}"/><rect x="16" y="26" width="4" height="7" fill="${woodDark}"/>`,
  arrow: `<path d="M7 33 L31 9" stroke="${wood}" stroke-width="2"/><path d="M31 9 L34 6 L29 8 Z" fill="${stone}"/><path d="M7 33 L5 29 M7 33 L11 35 M10 30 L8 26 M10 30 L14 32" stroke="#d8d0bc" stroke-width="1.5"/>`,
  handmadeShell: `<rect x="12" y="10" width="10" height="22" rx="2" fill="#b89a6a"/><rect x="12" y="28" width="10" height="4" fill="${stoneDark}"/><rect x="22" y="14" width="8" height="18" rx="2" fill="#a88a5a"/>`,
  shotgunShell: `<rect x="11" y="9" width="10" height="20" rx="1.5" fill="#a83a2e"/><rect x="11" y="27" width="10" height="5" fill="${brass}"/><rect x="22" y="13" width="9" height="16" rx="1.5" fill="#8f2f25"/><rect x="22" y="27" width="9" height="5" fill="${brass}"/>`,
  pistolAmmo: `<path d="M10 32 V18 Q10 12 13.5 10 Q17 12 17 18 V32 Z" fill="${brass}"/><path d="M10 18 Q10 12 13.5 10 Q17 12 17 18 Z" fill="#9b6b3e"/><path d="M21 32 V20 Q21 14 24.5 12 Q28 14 28 20 V32 Z" fill="${brass}"/><path d="M21 20 Q21 14 24.5 12 Q28 14 28 20 Z" fill="#9b6b3e"/>`,
  rifleAmmo: `<path d="M11 34 V16 L13 13 V9 Q14.5 5 16 9 V13 L18 16 V34 Z" fill="${brass}"/><path d="M13 13 V9 Q14.5 5 16 9 V13 Z" fill="#9b6b3e"/><path d="M22 34 V16 L24 13 V9 Q25.5 5 27 9 V13 L29 16 V34 Z" fill="${brass}"/><path d="M24 13 V9 Q25.5 5 27 9 V13 Z" fill="#9b6b3e"/>`,
  bandage: `<ellipse cx="17" cy="22" rx="10" ry="10" fill="#e6dccb"/><ellipse cx="17" cy="22" rx="4" ry="4" fill="#c9bb9e"/><path d="M27 22 L35 30" stroke="#e6dccb" stroke-width="6"/><path d="M14 22 H20 M17 19 V25" stroke="#b03a2e" stroke-width="2"/>`,
  syringe: `<path d="M9 31 L25 15" stroke="#cfe0e8" stroke-width="7" stroke-linecap="round"/><path d="M11 29 L21 19" stroke="#b03a2e" stroke-width="4"/><path d="M25 15 L33 7" stroke="#a9adb2" stroke-width="1.5"/><path d="M5 31 L9 35 M7 33 L10 30" stroke="#6b6f75" stroke-width="2"/>`,
  cannedBeans: `<rect x="11" y="8" width="18" height="25" rx="2" fill="#b0b2b0"/><rect x="11" y="13" width="18" height="14" fill="#a8462c"/><rect x="11" y="19" width="18" height="3" fill="#d8c27a"/>`,
  bottledWater: `<path d="M15 7 H25 V10 L28 14 V33 Q28 35 26 35 H14 Q12 35 12 33 V14 L15 10 Z" fill="#8ec4dc" opacity=".8"/><rect x="12" y="20" width="16" height="7" fill="#2f6aa8"/><rect x="16" y="5" width="8" height="3" fill="#2a5a9a"/>`,
  antiRadPills: `<rect x="13" y="12" width="14" height="22" rx="2" fill="#d8742a"/><rect x="13" y="18" width="14" height="9" fill="#e0c040"/><rect x="12" y="7" width="16" height="6" rx="1.5" fill="#ece8e0"/>`,
  feedSack: `<path d="M11 14 Q10 30 12 34 H28 Q30 30 29 14 Z" fill="#b59a6a"/><path d="M11 14 Q20 9 29 14 L27 11 Q20 7 13 11 Z" fill="#8f7648"/><path d="M14 13 Q20 16 26 13" stroke="#5a4426" stroke-width="2" fill="none"/><path d="M14 22 H26 M14 27 H26" stroke="#8f7648" stroke-width="1.2"/>`,
  mushroom: `<path d="M18 20 V33 H23 V20 Z" fill="#d8cdb4"/><path d="M8 21 Q8 9 20 8 Q32 9 32 21 Z" fill="#8a5a36"/>`,
  burlapHeadwrap: `<path d="M9 30 Q8 8 20 7 Q32 8 31 30 L25 30 Q26 16 20 16 Q14 16 15 30 Z" fill="#a08c62"/><path d="M10 14 Q20 10 30 14" stroke="#8a7550" stroke-width="2.5" fill="none"/>`,
  burlapShirt: `<path d="M12 8 L28 8 L36 16 L31 20 L29 18 L29 34 L11 34 L11 18 L9 20 L4 16 Z" fill="#a08c62"/><path d="M11 29 H29" stroke="#8a7550" stroke-width="2.5"/>`,
  burlapTrousers: `<path d="M11 6 H29 L31 35 H23 L20 16 L17 35 H9 Z" fill="#a08c62"/><rect x="10" y="23" width="6" height="5" fill="#6f5f40"/><rect x="24" y="23" width="6" height="5" fill="#6f5f40"/>`,
  coffeeCanHelmet: `<rect x="9" y="8" width="22" height="20" rx="2" fill="#4f5d4a"/><rect x="8" y="27" width="24" height="3" rx="1.5" fill="#8c877c"/><path d="M11 30 Q20 38 29 30" stroke="#4e3b2a" stroke-width="2" fill="none"/>`,
  roadsignJacket: `<path d="M12 7 L28 7 L36 15 L31 19 L29 17 L29 34 L11 34 L11 17 L9 19 L4 15 Z" fill="#4e3b2a"/><rect x="12" y="11" width="16" height="13" fill="#c99a24"/><path d="M14 11 L18 17.5 L14 24 M20 11 L24 17.5 L20 24" stroke="#1d1b18" stroke-width="2.5" fill="none"/>`,
  roadsignKilt: `<rect x="8" y="8" width="24" height="4" rx="1" fill="#4e3b2a"/><rect x="7" y="12" width="9" height="20" fill="#c99a24"/><rect x="15.5" y="12" width="9" height="21" fill="#9e2a22"/><rect x="24" y="12" width="9" height="20" fill="#c99a24"/>`,
  metalFacemask: `<path d="M10 9 Q20 4 30 9 L29 30 Q20 36 11 30 Z" fill="#6f716e"/><rect x="13" y="15" width="14" height="3" fill="#1c1b1a"/><circle cx="17" cy="25" r="1.2" fill="#1c1b1a"/><circle cx="20" cy="25" r="1.2" fill="#1c1b1a"/><circle cx="23" cy="25" r="1.2" fill="#1c1b1a"/>`,
  metalChestplate: `<path d="M9 8 L31 8 Q33 22 29 34 L11 34 Q7 22 9 8 Z" fill="#6f716e"/><path d="M20 9 V33" stroke="#8c877c" stroke-width="2"/><circle cx="13" cy="12" r="1.3" fill="#8c877c"/><circle cx="27" cy="12" r="1.3" fill="#8c877c"/>`,
  metalLegPlates: `<path d="M8 6 H17 L16 34 H9 Z" fill="#6f716e"/><path d="M23 6 H32 L31 34 H24 Z" fill="#6f716e"/><path d="M8 13 H17 M8 27 H16 M23 13 H32 M24 27 H31" stroke="#4e3b2a" stroke-width="2"/>`,
};

/** The item's rendered 3D icon, falling back to the drawn one where WebGL isn't available. */
export function iconSvg(item: ItemId): string {
  const url = itemIconUrl(item);
  if (url) return `<img class="icon" src="${url}" alt="" draggable="false">`;
  return `<svg viewBox="0 0 40 40" aria-hidden="true">${ICONS[item] ?? gunIconBody(item) ?? ''}</svg>`;
}
