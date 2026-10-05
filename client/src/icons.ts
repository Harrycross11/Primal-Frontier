// Small drawn icons for every item, used in the hotbar, inventory and crafting menu.

import type { ItemId } from '../../shared/items.ts';

const wood = '#9a6b3f';
const woodDark = '#6e4a2a';
const stone = '#9a958c';
const stoneDark = '#6c6862';
const metal = '#a9adb2';
const rust = '#a35d32';

export const ICONS: Record<ItemId, string> = {
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
};

export function iconSvg(item: ItemId): string {
  return `<svg viewBox="0 0 40 40" aria-hidden="true">${ICONS[item]}</svg>`;
}
