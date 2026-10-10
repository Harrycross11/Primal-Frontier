// The belt (hotbar), resource counters, crafting progress, and the Tab screen with the
// inventory grid, an open furnace or box, and the crafting menu. Items move by dragging
// between slots, or by right-clicking to send a stack to the other side.

import { CROPS, PLANTER_SEED_SLOTS, ripeness } from '../../shared/farming.ts';
import { DEPLOYABLE_INFO, FURNACE_FUEL, FURNACE_ORE_SLOTS, WORKBENCH_LEVEL, burns, slotAccepts, type Deployable } from '../../shared/deployables.ts';
import {
  ARMOUR_SLOTS,
  BELT_SIZE,
  ITEMS,
  RECIPES,
  RECIPE_CATEGORIES,
  canAfford,
  countItem,
  maxDurability,
  stackName,
  type ItemId,
  type Recipe,
  type Slots,
  type Stack,
} from '../../shared/items.ts';
import type { CraftJob, SlotRef } from '../../shared/protocol.ts';
import { PAINTS } from '../../shared/paint.ts';
import { TECH, TECH_BRANCHES, learnBlock, needsLearning } from '../../shared/techTree.ts';
import { iconSvg } from './icons.ts';
import { swatch } from './paint.ts';

const $ = (id: string) => document.getElementById(id)!;
const SHOWN_RESOURCES: ItemId[] = ['wood', 'stone', 'scrap', 'metalOre', 'metal', 'sulfurOre', 'sulfur', 'hqmOre', 'hqm', 'charcoal', 'gunpowder', 'cloth'];
const FURNACE_LABELS = ['Wood', 'Ore', 'Ore', 'Out', 'Out', 'Out'];
/** Only the top row is labelled; the second row is more crop slots, and its labels would sit on the first. */
const PLANTER_LABELS = ['Seed', 'Seed', 'Seed', 'Crop', 'Crop', 'Crop'];

export interface InventoryActions {
  move(from: SlotRef, to: SlotRef, count?: number): void;
  craft(item: ItemId, count: number): void;
  cancel(index: number): void;
  furnace(id: number, on: boolean): void;
  learn(item: ItemId): void;
}

export class InventoryUi {
  slots: Slots = [];
  /** Armour worn on the head, chest and legs. */
  wear: Slots = [null, null, null];
  active = 0;
  container: Deployable | null = null;
  /** Level of the best workbench in reach, or 0. */
  workbench = 0;
  /** What you have learned at workbenches. */
  learned = new Set<ItemId>();
  private techLevel: 1 | 2 | 3 = 1;
  private techSelected: ItemId | null = null;
  private queue: CraftJob[] = [];
  private queueAt = 0;
  private category: Recipe['category'] | 'All' = 'All';
  private selected: ItemId = 'stoneHatchet';
  private listScroll = 0;
  private drag: { from: SlotRef; stack: Stack } | null = null;

  constructor(private actions: InventoryActions) {
    // Dragging items between slots.
    addEventListener('pointermove', (e) => {
      const ghost = $('drag');
      if (this.drag) {
        ghost.style.left = `${e.clientX}px`;
        ghost.style.top = `${e.clientY}px`;
      }
      const tip = $('tooltip');
      if (!tip.hidden) {
        tip.style.left = `${e.clientX + 14}px`;
        tip.style.top = `${e.clientY + 14}px`;
      }
    });
    addEventListener('pointerup', (e) => {
      if (!this.drag) return;
      const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-ref]');
      const from = this.drag.from;
      this.drag = null;
      $('drag').hidden = true;
      if (!target) return;
      const to = JSON.parse(target.dataset.ref!) as SlotRef;
      if (to.c === from.c && to.i === from.i) return;
      this.actions.move(from, to, e.shiftKey ? Math.ceil(this.stackAt(from)!.count / 2) : undefined);
    });
    $('furnace-toggle').addEventListener('click', () => {
      if (this.container) this.actions.furnace(this.container.id, !this.container.on);
    });
  }

  get open(): boolean {
    return !$('screen').hidden;
  }

  show(container: Deployable | null = null) {
    this.container = container;
    const bench = container ? WORKBENCH_LEVEL[container.kind] : undefined;
    if (bench) {
      this.techLevel = bench;
      this.techSelected = null;
    }
    $('screen').hidden = false;
    this.render();
  }

  hide() {
    $('screen').hidden = true;
    $('tooltip').hidden = true;
    this.container = null;
  }

  setQueue(queue: CraftJob[]) {
    this.queue = queue;
    this.queueAt = performance.now();
    this.render();
  }

  /** Redraws the belt and counters always, and the full screen when it is open. */
  render() {
    this.renderBelt();
    this.renderResources();
    if (!this.open) return;
    this.renderGrid($('backpack'), 'me', BELT_SIZE, this.slots.length);
    this.renderGrid($('belt-grid'), 'me', 0, BELT_SIZE);
    this.renderWear();
    this.renderContainer();
    this.renderCrafting();
    this.renderTech();
  }

  /** Called every frame to move the crafting progress bar. */
  tick() {
    const box = $('craft-progress');
    const job = this.queue[0];
    box.hidden = !job;
    if (!job) return;
    const left = Math.max(0, job.left - (performance.now() - this.queueAt) / 1000);
    const done = 1 - left / job.total;
    const more = this.queue.length > 1 ? ` (+${this.queue.length - 1} more)` : '';
    const html = `Crafting ${ITEMS[job.item].name}${more}<div class="bar"><i style="width:${Math.round(done * 100)}%"></i></div>`;
    if (box.innerHTML !== html) box.innerHTML = html;
    const qbar = document.querySelector<HTMLElement>('#queue .qbar');
    if (qbar) qbar.style.width = `${Math.round(done * 100)}%`;
  }

  private stackAt(ref: SlotRef): Stack | null {
    if (ref.c === 'me') return this.slots[ref.i] ?? null;
    if (ref.c === 'wear') return this.wear[ref.i] ?? null;
    return this.container?.id === ref.c ? (this.container.slots[ref.i] ?? null) : null;
  }

  private renderBelt() {
    const belt = $('belt');
    belt.innerHTML = '';
    for (let i = 0; i < BELT_SIZE; i++) {
      const el = this.slotElement({ c: 'me', i }, this.slots[i] ?? null, false);
      el.insertAdjacentHTML('afterbegin', `<span class="key">${i + 1}</span>`);
      el.classList.toggle('active', i === this.active);
      belt.appendChild(el);
    }
  }

  private renderResources() {
    const el = $('resources');
    el.innerHTML = SHOWN_RESOURCES.map((item) => {
      const n = countItem(this.slots, item);
      return n > 0 || item === 'wood' || item === 'stone' || item === 'scrap' ? `<div class="res" title="${ITEMS[item].name}">${iconSvg(item)}${n}</div>` : '';
    }).join('');
  }

  private renderGrid(el: HTMLElement, c: SlotRef['c'], from: number, to: number) {
    el.innerHTML = '';
    for (let i = from; i < to; i++) el.appendChild(this.slotElement({ c, i }, this.slots[i] ?? null, true));
  }

  private renderWear() {
    const grid = $('wear-grid');
    grid.innerHTML = '';
    ARMOUR_SLOTS.forEach((part, i) => {
      const el = this.slotElement({ c: 'wear', i }, this.wear[i] ?? null, true);
      el.classList.add('wear-slot');
      el.dataset.label = part;
      grid.appendChild(el);
    });
    $('armour-total').textContent = ARMOUR_SLOTS.map((part, i) => {
      const a = this.wear[i] ? ITEMS[this.wear[i]!.item].armour : undefined;
      return `${part[0].toUpperCase()}${part.slice(1)} ${Math.round((a?.protection ?? 0) * 100)}%`;
    }).join(' · ') + ' protection';
  }

  private renderContainer() {
    const panel = $('container-panel');
    const d = this.container;
    panel.hidden = !d || d.slots.length === 0;
    if (!d || panel.hidden) return;
    $('container-title').textContent = d.kind === 'lootBag' ? `${d.label ?? 'Someone'}'s loot bag` : DEPLOYABLE_INFO[d.kind].name;
    const grid = $('container-grid');
    grid.innerHTML = '';
    d.slots.forEach((s, i) => {
      const el = this.slotElement({ c: d.id, i }, s, true);
      const label = burns(d.kind) ? FURNACE_LABELS[i] : d.kind === 'planter' ? PLANTER_LABELS[i] : undefined;
      if (label) {
        el.classList.add('label-slot');
        el.dataset.label = label;
      }
      grid.appendChild(el);
    });
    grid.classList.toggle('furnace-row', burns(d.kind));
    $('furnace-controls').hidden = !burns(d.kind) && d.kind !== 'planter' && d.kind !== 'recycler';
    $('furnace-toggle').hidden = !burns(d.kind) && d.kind !== 'recycler';
    if (d.kind === 'recycler') {
      $('furnace-toggle').textContent = d.on ? 'Switch off' : 'Switch on';
      $('furnace-status').textContent = d.on
        ? 'Recycling, one item every few seconds.'
        : 'Put salvage parts, or guns, tools and gear you can craft, in the top row, then switch it on.';
    }
    if (d.kind === 'planter') $('furnace-status').textContent = planterStatus(d);
    if (burns(d.kind)) {
      $('furnace-toggle').textContent = d.on ? 'Put out' : 'Light';
      const fuel = d.slots[FURNACE_FUEL]?.count ?? 0;
      const ore = FURNACE_ORE_SLOTS.reduce((n, i) => n + (d.slots[i]?.count ?? 0), 0);
      $('furnace-status').textContent = d.on
        ? ore > 0
          ? `${d.kind === 'campfire' ? 'Cooking' : 'Smelting and cooking'}: ${ore} left, ${fuel} wood left`
          : `Burning wood into charcoal (${fuel} wood left)`
        : d.kind === 'campfire'
          ? 'Add wood as fuel and raw meat to cook, then light it.'
          : 'Add wood as fuel and metal, sulfur or high quality ore (or raw meat to cook), then light it.';
    }
  }

  /** A workbench's tech tree, in place of the crafting list while one is open. */
  private renderTech() {
    const bench = this.container ? WORKBENCH_LEVEL[this.container.kind] : undefined;
    $('tech').hidden = !bench;
    $('crafting').hidden = !!bench;
    if (!bench) return;
    const scrap = countItem(this.slots, 'scrap');
    $('tech-title').textContent = `Workbench level ${bench}`;
    $('tech-scrap').innerHTML = `${iconSvg('scrap')}<span>${scrap} scrap</span>`;
    const tabs = $('tech-tabs');
    tabs.innerHTML = '';
    for (const level of [1, 2, 3] as const) {
      const b = document.createElement('button');
      b.textContent = `Level ${level}`;
      b.classList.toggle('on', level === this.techLevel);
      b.onclick = () => {
        this.techLevel = level;
        this.techSelected = null;
        this.render();
      };
      tabs.appendChild(b);
    }
    const tree = $('tech-tree');
    const scroll = tree.scrollTop;
    tree.innerHTML = '';
    for (const branch of TECH_BRANCHES.filter((b) => b.level === this.techLevel)) {
      const row = document.createElement('div');
      row.className = 'branch';
      row.innerHTML = `<div class="branch-name">${branch.name}</div>`;
      branch.steps.forEach(([item, cost], i) => {
        const learned = this.learned.has(item);
        const ready = !learned && !learnBlock(item, this.learned, this.workbench, Infinity);
        if (i > 0) row.insertAdjacentHTML('beforeend', `<i class="link${learned ? ' done' : ''}"></i>`);
        const node = document.createElement('div');
        node.className = `tnode${learned ? ' learned' : ready ? ' ready' : ' locked'}${item === this.techSelected ? ' on' : ''}`;
        node.innerHTML = `${iconSvg(item)}<div class="tn">${ITEMS[item].name}</div><div class="tc">${learned ? 'Learned' : `${cost} scrap`}</div>`;
        node.onclick = () => {
          this.techSelected = item;
          this.render();
        };
        row.appendChild(node);
      });
      tree.appendChild(row);
    }
    tree.scrollTop = scroll;
    const detail = $('tech-detail');
    const item = this.techSelected;
    if (!item) {
      detail.innerHTML = '<div class="hint">Pick a step to see what it unlocks. Each one needs the step before it, and costs scrap to learn. What you learn stays with you until the wipe, even if you die.</div>';
      return;
    }
    const node = TECH.get(item)!;
    const block = this.learned.has(item) ? null : learnBlock(item, this.learned, this.workbench, scrap);
    const recipe = RECIPES.find((r) => r.item === item);
    const makes = recipe ? `<small>Then craft it at a level ${node.level} workbench for ${this.costText(recipe)}</small>` : '';
    detail.innerHTML = `<div class="dhead">${iconSvg(item)}<div><b>${ITEMS[item].name}</b>${makes}</div></div><div class="tdesc">${ITEMS[item].description}</div><div class="actions"></div>`;
    const actions = detail.querySelector('.actions')!;
    if (this.learned.has(item)) {
      actions.innerHTML = '<span class="can">Learned. You can craft it.</span>';
      return;
    }
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = `Learn for ${node.scrap} scrap`;
    b.disabled = !!block;
    b.onclick = () => this.actions.learn(item);
    actions.appendChild(b);
    if (block) actions.insertAdjacentHTML('beforeend', `<span class="can">${block}</span>`);
  }

  private renderCrafting() {
    const tabs = $('tabs');
    tabs.innerHTML = '';
    for (const c of ['All', ...RECIPE_CATEGORIES] as const) {
      const b = document.createElement('button');
      b.textContent = c;
      b.classList.toggle('on', c === this.category);
      b.onclick = () => {
        this.category = c;
        const first = RECIPES.find((r) => c === 'All' || r.category === c);
        if (first && c !== 'All') this.selected = first.item;
        this.render();
      };
      tabs.appendChild(b);
    }
    const list = $('recipes');
    this.listScroll = list.scrollTop;
    list.innerHTML = '';
    for (const r of RECIPES) {
      if (this.category !== 'All' && r.category !== this.category) continue;
      const known = !needsLearning(r.item) || this.learned.has(r.item);
      const ok = known && canAfford(this.slots, r) && (r.workbench ?? 0) <= this.workbench;
      const row = document.createElement('div');
      row.className = `recipe${ok ? '' : ' cant'}${r.item === this.selected ? ' on' : ''}`;
      const tag = !known
        ? '<span class="tag locked">Not learned</span>'
        : r.workbench
          ? `<span class="tag${r.workbench > this.workbench ? ' locked' : ''}">Workbench ${r.workbench}</span>`
          : '';
      const count = r.count > 1 ? ` ×${r.count}` : '';
      row.innerHTML = `${iconSvg(r.item)}<div><div class="rname">${ITEMS[r.item].name}${count}${tag}</div><div class="rcost">${this.costText(r)}</div></div>`;
      row.onclick = () => {
        this.selected = r.item;
        this.render();
      };
      list.appendChild(row);
    }
    list.scrollTop = this.listScroll;
    const r = RECIPES.find((x) => x.item === this.selected)!;
    const known = !needsLearning(r.item) || this.learned.has(r.item);
    const benchOk = (r.workbench ?? 0) <= this.workbench && known;
    const ok = canAfford(this.slots, r) && benchOk;
    const detail = $('recipe-detail');
    // What it takes, against what you carry.
    const parts = Object.entries(r.cost)
      .map(([item, n]) => {
        const have = countItem(this.slots, item as ItemId);
        return `<div class="ing${have >= n! ? '' : ' short'}">${iconSvg(item as ItemId)}<span>${ITEMS[item as ItemId].name}</span><b>${n}</b><small>${have} held</small></div>`;
      })
      .join('');
    const most = benchOk ? maxCraftable(this.slots, r) : 0;
    const yields = r.count > 1 ? ` · makes ${r.count}` : '';
    detail.innerHTML = `<div class="dhead">${iconSvg(r.item)}<div><b>${ITEMS[r.item].name}</b><small>${r.time}s each${yields}</small></div></div>${ITEMS[r.item].description}${statsText(r.item)}<div class="ings">${parts}</div>${
      !known
        ? `<div class="need">Learn this first: press E on a level ${r.workbench} workbench to open its tech tree.</div>`
        : benchOk
          ? ''
          : `<div class="need">Stand near a level ${r.workbench} workbench to craft this.</div>`
    }<div class="actions"></div>`;
    const actions = detail.querySelector('.actions')!;
    const counts: [number, string][] = [
      [1, 'Craft'],
      [5, 'Craft 5'],
    ];
    if (most > 5) counts.push([Math.min(most, 50), `Max (${Math.min(most, 50)})`]);
    for (const [n, label] of counts) {
      const b = document.createElement('button');
      b.className = n === 1 ? 'btn' : 'btn secondary';
      b.textContent = label;
      b.disabled = !ok || most < n;
      b.onclick = () => this.actions.craft(r.item, n);
      actions.appendChild(b);
    }
    if (benchOk) actions.insertAdjacentHTML('beforeend', `<span class="can">${most > 0 ? `You can make ${most * r.count}` : 'Not enough materials'}</span>`);
    const queue = $('queue');
    queue.innerHTML = this.queue.length ? '<h3>Queue</h3>' : '';
    this.queue.slice(0, 6).forEach((job, i) => {
      const row = document.createElement('div');
      row.className = 'job';
      const bar = i === 0 ? '<div class="bar"><i class="qbar"></i></div>' : '';
      row.innerHTML = `${iconSvg(job.item)}<div class="jname">${ITEMS[job.item].name}${bar}</div><span class="x" title="Cancel and refund">✕</span>`;
      (row.querySelector('.x') as HTMLElement).onclick = () => this.actions.cancel(i);
      queue.appendChild(row);
    });
    if (this.queue.length > 6) queue.insertAdjacentHTML('beforeend', `<div class="job">+${this.queue.length - 6} more</div>`);
  }

  private costText(r: Recipe): string {
    return Object.entries(r.cost)
      .map(([item, n]) => {
        const have = countItem(this.slots, item as ItemId);
        return `<span class="${have >= n! ? '' : 'need'}">${n} ${ITEMS[item as ItemId].name}</span>`;
      })
      .join(' · ');
  }

  private slotElement(ref: SlotRef, stack: Stack | null, interactive: boolean): HTMLElement {
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.ref = JSON.stringify(ref);
    if (stack) {
      const info = ITEMS[stack.item];
      // A blueprint shows what it teaches, on blueprint paper.
      if (stack.teaches) el.classList.add('bp');
      el.innerHTML = iconSvg(stack.teaches ?? stack.item);
      if (stack.count > 1) el.insertAdjacentHTML('beforeend', `<span class="count">${stack.count}</span>`);
      if (info.weapon?.mag) el.insertAdjacentHTML('beforeend', `<span class="count ammo">${stack.ammo ?? 0}/${info.weapon.mag}</span>`);
      const max = maxDurability(stack.item);
      if (max && stack.hp !== undefined) {
        el.insertAdjacentHTML('beforeend', `<span class="wear"><i style="width:${Math.round((stack.hp / max) * 100)}%"></i></span>`);
      }
      if (stack.paint) el.insertAdjacentHTML('beforeend', `<span class="paint" style="background:${swatch(stack.paint)}"></span>`);
    }
    if (!interactive) return el;
    el.addEventListener('pointerenter', () => {
      const tip = $('tooltip');
      if (!stack || this.drag) return;
      const info = ITEMS[stack.item];
      const max = maxDurability(stack.item);
      const wear = max && stack.hp !== undefined ? `<br/>Condition ${stack.hp} / ${max}` : '';
      const paint = stack.paint ? `<br/>${PAINTS[stack.paint].name} paint` : '';
      tip.innerHTML = `<b>${stackName(stack)}</b>${info.description}${statsText(stack.item)}${wear}${paint}`;
      tip.hidden = false;
    });
    el.addEventListener('pointerleave', () => ($('tooltip').hidden = true));
    el.addEventListener('pointerdown', (e) => {
      if (!stack) return;
      e.preventDefault();
      if (e.button === 2) return this.quickMove(ref, stack);
      this.drag = { from: ref, stack };
      const ghost = $('drag');
      ghost.innerHTML = iconSvg(stack.teaches ?? stack.item);
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY}px`;
      ghost.hidden = false;
      $('tooltip').hidden = true;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return el;
  }

  /**
   * Right click: send a stack to the open container (or from it into the inventory), put armour
   * on or take it off, or move between belt and backpack. A stack tops up any part stacks of the
   * same item first and the rest goes to the first empty slot.
   */
  private quickMove(from: SlotRef, stack: Stack) {
    const d = this.container && this.container.slots.length > 0 ? this.container : null;
    const armour = ITEMS[stack.item].armour;
    if (from.c === 'me' && !d && armour) return this.actions.move(from, { c: 'wear', i: ARMOUR_SLOTS.indexOf(armour.slot) });
    let into: { c: SlotRef['c']; slots: Slots; allowed: (i: number) => boolean }[];
    if (from.c === 'wear') {
      into = [
        { c: 'me', slots: this.slots, allowed: (n) => n >= BELT_SIZE },
        { c: 'me', slots: this.slots, allowed: () => true },
      ];
    } else if (from.c === 'me' && d) {
      into = [{ c: d.id, slots: d.slots, allowed: (n) => slotAccepts(d, n, stack.item) }];
    } else if (from.c !== 'me') {
      // Out of a box or bag: into the backpack first, the belt if that's full.
      into = [
        { c: 'me', slots: this.slots, allowed: (n) => n >= BELT_SIZE },
        { c: 'me', slots: this.slots, allowed: () => true },
      ];
    } else {
      const belt = from.i < BELT_SIZE;
      into = [{ c: 'me', slots: this.slots, allowed: (n) => (belt ? n >= BELT_SIZE : n < BELT_SIZE) }];
    }
    for (const { c, slots, allowed } of into) {
      const moves = this.plan(slots, stack, allowed);
      if (!moves.length) continue;
      for (const [i, count] of moves) this.actions.move(from, { c, i }, count);
      return;
    }
    flashFull(from);
  }

  /**
   * Where a stack goes in a set of slots: [slot, count] for each part stack of the same item it
   * tops up, then the first empty slot for whatever is left (with no count, so the server moves
   * all that remains). Empty when nothing fits.
   */
  private plan(slots: Slots, stack: Stack, allowed: (i: number) => boolean): [number, number | undefined][] {
    const max = ITEMS[stack.item].stack;
    const out: [number, number | undefined][] = [];
    let left = stack.count;
    if (max > 1) {
      slots.forEach((s, i) => {
        if (left <= 0 || !allowed(i) || s?.item !== stack.item || s.count >= max) return;
        const n = Math.min(left, max - s.count);
        out.push([i, n]);
        left -= n;
      });
    }
    if (left > 0) {
      const empty = slots.findIndex((s, i) => allowed(i) && !s);
      if (empty >= 0) out.push([empty, undefined]);
    }
    return out;
  }
}

/** A short red flash on a slot whose stack had nowhere to go. */
function flashFull(ref: SlotRef) {
  const el = document.querySelector<HTMLElement>(`[data-ref='${JSON.stringify(ref)}']`);
  if (!el) return;
  el.classList.remove('full');
  void el.offsetWidth;
  el.classList.add('full');
}

/** Damage, fire rate and magazine for weapons, shown in tooltips and the crafting menu. */
function statsText(item: ItemId): string {
  const a = ITEMS[item].armour;
  if (a) return `<div class="stats">Worn on the ${a.slot} · Blocks ${Math.round(a.protection * 100)}% of damage there · ${Math.round(a.radiation * 100)}% of radiation · Right click to wear</div>`;
  const c = ITEMS[item].consume;
  if (c) {
    const parts = [c.food && `Food +${c.food}`, c.water && `Water +${c.water}`, c.rads && `Radiation −${c.rads}`].filter(Boolean);
    return `<div class="stats">${parts.join(' · ')}</div>`;
  }
  const w = ITEMS[item].weapon;
  if (!w || ITEMS[item].kind !== 'weapon') return ITEMS[item].heal ? `<div class="stats">Heals ${ITEMS[item].heal}</div>` : '';
  const dmg = w.pellets ? `${w.damage} × ${w.pellets} pellets` : `${w.damage}`;
  const rate = w.auto ? `${Math.round(60 / w.delay)} rounds/min, automatic` : `${(1 / w.delay).toFixed(1)} shots/s`;
  const parts = [`Damage ${dmg}`, w.class === 'melee' ? `Reach ${w.range} m` : rate];
  if (w.ammo) parts.push(`${w.mag} × ${ITEMS[w.ammo].name}`, `Range ${w.range} m`);
  return `<div class="stats">${parts.join(' · ')}</div>`;
}

/** How many times you can craft a recipe with what you carry. */
function maxCraftable(slots: Slots, r: Recipe): number {
  let most = Infinity;
  for (const [item, n] of Object.entries(r.cost)) most = Math.min(most, Math.floor(countItem(slots, item as ItemId) / n!));
  return most === Infinity ? 0 : most;
}

/** How each of a planter's plants is coming along, or how to start one. */
export function planterStatus(d: Deployable): string {
  const growing = PLANTER_SEED_SLOTS.flatMap((slot, n) => {
    const seed = d.slots[slot];
    const crop = seed && CROPS[seed.item];
    return crop ? [`${crop.name} ${Math.floor(ripeness(seed.item, d.grow?.[n] ?? 0) * 100)}%`] : [];
  });
  return growing.length ? `Growing: ${growing.join(', ')}. Ripe crops and new seeds land in the crop slots.` : 'Put hemp, corn or pumpkin seeds in the seed slots and they grow by themselves.';
}
