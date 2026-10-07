// The belt (hotbar), resource counters, crafting progress, and the Tab screen with the
// inventory grid, an open furnace or box, and the crafting menu. Items move by dragging
// between slots, or by right-clicking to send a stack to the other side.

import { DEPLOYABLE_INFO, FURNACE_FUEL, FURNACE_ORE_SLOTS, slotAccepts, type Deployable } from '../../shared/deployables.ts';
import {
  ARMOUR_SLOTS,
  BELT_SIZE,
  ITEMS,
  RECIPES,
  RECIPE_CATEGORIES,
  canAfford,
  countItem,
  maxDurability,
  type ItemId,
  type Recipe,
  type Slots,
  type Stack,
} from '../../shared/items.ts';
import type { CraftJob, SlotRef } from '../../shared/protocol.ts';
import { iconSvg } from './icons.ts';

const $ = (id: string) => document.getElementById(id)!;
const SHOWN_RESOURCES: ItemId[] = ['wood', 'stone', 'scrap', 'metalOre', 'metal', 'sulfurOre', 'sulfur', 'hqmOre', 'hqm', 'charcoal', 'gunpowder', 'cloth'];
const FURNACE_LABELS = ['Wood', 'Ore', 'Ore', 'Out', 'Out', 'Out'];

export interface InventoryActions {
  move(from: SlotRef, to: SlotRef, count?: number): void;
  craft(item: ItemId, count: number): void;
  cancel(index: number): void;
  furnace(id: number, on: boolean): void;
}

export class InventoryUi {
  slots: Slots = [];
  /** Armour worn on the head, chest and legs. */
  wear: Slots = [null, null, null];
  active = 0;
  container: Deployable | null = null;
  /** Level of the best workbench in reach, or 0. */
  workbench = 0;
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
      if (d.kind === 'furnace') {
        el.classList.add('label-slot');
        el.dataset.label = FURNACE_LABELS[i];
      }
      grid.appendChild(el);
    });
    grid.classList.toggle('furnace-row', d.kind === 'furnace');
    $('furnace-controls').hidden = d.kind !== 'furnace';
    if (d.kind === 'furnace') {
      $('furnace-toggle').textContent = d.on ? 'Put out' : 'Light';
      const fuel = d.slots[FURNACE_FUEL]?.count ?? 0;
      const ore = FURNACE_ORE_SLOTS.reduce((n, i) => n + (d.slots[i]?.count ?? 0), 0);
      $('furnace-status').textContent = d.on
        ? ore > 0
          ? `Smelting and cooking: ${ore} left, ${fuel} wood left`
          : `Burning wood into charcoal (${fuel} wood left)`
        : 'Add wood as fuel and metal, sulfur or high quality ore (or raw meat to cook), then light it.';
    }
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
      const ok = canAfford(this.slots, r) && (r.workbench ?? 0) <= this.workbench;
      const row = document.createElement('div');
      row.className = `recipe${ok ? '' : ' cant'}${r.item === this.selected ? ' on' : ''}`;
      const tag = r.workbench ? `<span class="tag${r.workbench > this.workbench ? ' locked' : ''}">Workbench ${r.workbench}</span>` : '';
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
    const benchOk = (r.workbench ?? 0) <= this.workbench;
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
      benchOk ? '' : `<div class="need">Stand near a level ${r.workbench} workbench to craft this.</div>`
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
      el.innerHTML = iconSvg(stack.item);
      if (stack.count > 1) el.insertAdjacentHTML('beforeend', `<span class="count">${stack.count}</span>`);
      if (info.weapon?.mag) el.insertAdjacentHTML('beforeend', `<span class="count ammo">${stack.ammo ?? 0}/${info.weapon.mag}</span>`);
      const max = maxDurability(stack.item);
      if (max && stack.hp !== undefined) {
        el.insertAdjacentHTML('beforeend', `<span class="wear"><i style="width:${Math.round((stack.hp / max) * 100)}%"></i></span>`);
      }
    }
    if (!interactive) return el;
    el.addEventListener('pointerenter', () => {
      const tip = $('tooltip');
      if (!stack || this.drag) return;
      const info = ITEMS[stack.item];
      const max = maxDurability(stack.item);
      const wear = max && stack.hp !== undefined ? `<br/>Condition ${stack.hp} / ${max}` : '';
      tip.innerHTML = `<b>${info.name}</b>${info.description}${statsText(stack.item)}${wear}`;
      tip.hidden = false;
    });
    el.addEventListener('pointerleave', () => ($('tooltip').hidden = true));
    el.addEventListener('pointerdown', (e) => {
      if (!stack) return;
      e.preventDefault();
      if (e.button === 2) return this.quickMove(ref, stack);
      this.drag = { from: ref, stack };
      const ghost = $('drag');
      ghost.innerHTML = iconSvg(stack.item);
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY}px`;
      ghost.hidden = false;
      $('tooltip').hidden = true;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return el;
  }

  /**
   * Right click: send a stack to the open container, put armour on or take it off, or move
   * between belt and backpack.
   */
  private quickMove(from: SlotRef, stack: Stack) {
    const d = this.container && this.container.slots.length > 0 ? this.container : null;
    const armour = ITEMS[stack.item].armour;
    let to: SlotRef | null = null;
    if (from.c === 'me' && !d && armour) {
      to = { c: 'wear', i: ARMOUR_SLOTS.indexOf(armour.slot) };
    } else if (from.c === 'wear') {
      const i = this.bestSlot(this.slots, stack, (n) => n >= BELT_SIZE);
      const j = i >= 0 ? i : this.bestSlot(this.slots, stack, () => true);
      if (j >= 0) to = { c: 'me', i: j };
    } else if (from.c === 'me' && d) {
      const i = this.bestSlot(d.slots, stack, (n) => slotAccepts(d, n, stack.item));
      if (i >= 0) to = { c: d.id, i };
    } else {
      const range: [number, number] =
        from.c !== 'me' ? [0, this.slots.length] : from.i < BELT_SIZE ? [BELT_SIZE, this.slots.length] : [0, BELT_SIZE];
      const i = this.bestSlot(this.slots, stack, (n) => n >= range[0] && n < range[1]);
      if (i >= 0) to = { c: 'me', i };
    }
    if (to) this.actions.move(from, to);
  }

  /** A slot with the same item and room, else the first empty one. */
  private bestSlot(slots: Slots, stack: Stack, allowed: (i: number) => boolean): number {
    const max = ITEMS[stack.item].stack;
    const same = slots.findIndex((s, i) => allowed(i) && s?.item === stack.item && s.count < max);
    if (same >= 0 && max > 1) return same;
    return slots.findIndex((s, i) => allowed(i) && !s);
  }
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
