# Primal Frontier

A survival sandbox set in a world after a nuclear apocalypse. Players join a server, scavenge a barren map for wood, stone, scrap, ores and hemp, craft tools and guns, build, and fight. The full vision is Rust-style survival with ARK-style creatures, Minecraft-style building and Fortnite-style characters on servers that wipe every 30 days.

This repository is the **browser prototype**, built step by step. Milestones done: **walk, gather, build**, **better graphics with Fortnite-style building**, **Rust-style crafting**, **Rust-style weapons**, **armour with punchier combat sounds**, a **polish pass** and **survival: hunger, thirst and radiation**.

![A rusted car against the low sun, with light scattering through the dust](docs/screenshots/realism-car.png)

![Wood, stone and sheet steel walls](docs/screenshots/walls.png)

![A two-storey wood hut with windows and stairs in the hazy wasteland](docs/screenshots/building.png)

## What works now

- A 400 m map generated from a seed, in five lands that blend into each other. Everyone wakes in **the Ashlands** in the middle (wrecks full of scrap, ruined houses, the safest ground). Round it lie **Deadwood Forest** (the only living trees, plus hemp, mushrooms and most of the Ashhound packs), **Rust Mesa** (red rock tables with three times the metal ore and plenty of stone), **Sulfur Flats** (a bleached old lake bed with three times the sulfur, but scorching, so you get thirsty 1.7 times as fast) and **Frostpeaks** (snowy ridges with high quality metal ore all over, but freezing, so you get hungry 1.7 times as fast). Six blast craters are scattered through the wild lands. A banner names each land as you walk in, and **M** opens a map of them.
- Day and night: a full day lasts 40 minutes, with 30 of daylight. The sun rises in the east, burns red at dawn and dusk and sets in the west, then a 10-minute night falls, dark under the stars with only moonlight to see by. Craft a **torch** (30 wood, 10 cloth) to light your way; lit furnaces glow too. Ashhounds can see further in the dark. The clock is in the top corner.
- Weather to match each land: rain over the Ashlands and Deadwood Forest, dust storms on Rust Mesa and the Sulfur Flats that close the world in to a few metres, and blizzards on the Frostpeaks. Each land's storms come and go on their own, roll in gradually as you cross a border, and bring their own sound. Dust storms make you thirstier and blizzards hungrier.
- Graphics: photo-scanned ground, rock, bark, rusted metal, concrete, planks and cloth (CC0 textures from Poly Haven, credited in `client/public/textures/CREDITS.md`), a photographed cloudy sky that also lights the scene, height fog that pools in low ground and glows toward the sun, light shafts, soft 4K shadows, materials with roughness detail, dense dry grass that sways in the wind, drifting ash, ambient occlusion, bloom and a filmic grade with grain.
- Items look like the real thing: inventory icons are rendered from 3D models (logs, ore, ingots, cartridges, every tool and gun). Walls are built from weathered boards in a timber frame, coursed stone blocks with lintels, or rusty corrugated steel on steel posts. Guns have shaped stocks, curved magazines, sights and rails; tools have lashed flint heads, saw blades and taped grips. Press **O** to switch to low graphics on slower computers.
- Up to 8 players per server, each a gritty hooded survivor with goggles, a respirator, a loaded backpack and whatever tool is on their belt, in muted clothing with a faded colour on their scarf and armband so players stay easy to tell apart. Walking, sprinting and chopping each have their own animation.
- Gathering: hit trees for wood, wrecks for scrap, boulders for stone, metal ore, sulfur ore and rare high quality metal ore, and press E on hemp for cloth. Trees never regrow; the rest respawn after a few minutes. You spawn with a rock and a building plan.
- Rust-style inventory: a 6-slot belt and a 24-slot backpack. Drag stacks between slots, shift-drag to split, right click to quick-move.
- Crafting (Tab): a queue that crafts over time and refunds when cancelled. Stone hatchets and pickaxes gather much faster than the rock; salvaged tools are faster again but need a workbench nearby. Tools wear out and break.
- Deployables: workbenches (levels 1, 2 and 3), a furnace that burns wood into charcoal while smelting metal, sulfur and high quality ore, and a 12-slot storage box. Hit one to pick it back up.
- Weapons, Rust-style: spears, a machete and a salvaged sword; the hunting bow and crossbow; the Eoka, waterpipe, revolver and double barrel; the semi-auto pistol, pump shotgun, Thompson, custom SMG and semi-auto rifle (workbench 2); the MP5, assault rifle, LR-300, bolt action rifle, L96 and M249 (workbench 3). Five ammo types are crafted from gunpowder (charcoal and sulfur). Guns have magazines, reloads, recoil, spread, damage falloff and headshots; scoped rifles zoom right in.
- Armour: burlap (cloth), road sign (workbench 1) and welded metal (workbench 2) pieces for the head, chest and legs. Each blocks a share of the damage on the part it covers (10%, 30% and 45-50%), wears down as it takes hits and shows on your survivor. Wear it from the Armour row in the inventory, by right clicking it, or by left clicking it on your belt. Worn armour goes in your loot bag when you die.
- Sound: every gun has its own synthesised shot, layered from a supersonic crack, a low punch and the blast's body, with an echo that takes over at range and stereo panning. Bolt rifles cycle their bolt, the pump shotgun racks, reloads click, and hits thud, ping off helmets and clank on your own armour.
- Everything else has a sound too: axes biting wood, picks on stone and ore, clanging scrap, trees creaking and crashing down, building pieces knocking into place and breaking apart, swings, footsteps that change on wood, stone and metal floors, landings, finished crafts, inventory moves and a low wind across the wasteland. Guns are mixed loudest, so a firefight cuts through everything.
- Feedback: chips of wood, stone and metal fly off whatever you hit, new pieces settle into place and shake when hit, items you pick up show as "+6 Wood" in the corner, a red arc shows which way a hit came from, and a kill feed lists every kill with the weapon and headshots. The crafting screen lists each ingredient against what you carry and has a Max button.
- Survival: food and water drain over time (faster on the move) and hurt you when they run out; keep both above half and you slowly heal. Drink from blue rain barrels (E), pick mushrooms (E), and find cans of beans and bottled water in the glove boxes of wrecks you scrap. The six blast craters are still radioactive: yellow signs mark the edges, a Geiger counter clicks faster the hotter it gets, and radiation poisoning builds up and starts to hurt. Burlap keeps some of it out, anti-radiation pills (charcoal and mushrooms) flush it, and the craters hold the richest high quality metal ore.
- Wildlife: five packs of Ashhounds (three in Deadwood), ash-grey mutated hyenas (a scanned, animated model), roam round their dens. Come close and the pack hunts you down, snarling and biting at your legs; sprint and you can just outrun them. Kill one for raw meat and cook it in the furnace. Hold out cooked meat to a wild hound (left click when it is close) three times and it is yours: it wears a red rag collar and your name, follows you and goes for anyone who fights you. Feed it more meat to heal it. Each survivor can keep two, and tame hounds are saved with the world.
- Animals to tame and ride, one native to each land (scanned, animated models), wandering in small herds:
  - **Ash Mule** (the Ashlands): a scruffy donkey that bolts if you run at it. A steady first ride.
  - **Deadwood Elk** (Deadwood): very skittish, and the fastest thing you can ride.
  - **Mesa Buffalo** (Rust Mesa): grazes in peace, but hurt one and the whole herd charges and gores you. Slow to ride, very tough.
  - **Dune Camel** (Sulfur Flats): carries water, so while you ride one you get thirsty four times slower.
  - **Frost Bear** (Frostpeaks): hunts anyone who comes close, hits very hard, and fights for whoever tames it.
  - Taming: craft a **Feed Sack** (10 cloth, 2 mushrooms) and walk (don't run) up to a mule, elk, buffalo or camel, then hold it out (left click) until it is yours; bears take cooked meat like hounds do. A tame animal wears a saddle and your name and follows you. Look at it and press **E** to climb on: WASD to ride, **Shift** to gallop, **E** to get off. Each survivor can keep two animals to ride, besides their hounds, and they are saved with the world. Every animal gives raw meat when it dies.
- Combat: 100 health, bandages and syringes to heal. Dying drops everything in a loot bag anyone can open, and you respawn with a rock. The server traces every shot, so walls and the ground stop bullets.
- Fortnite-style building on a 3 m grid with the building plan in hand: foundations, walls, floors, stairs, ramps and roofs in wood, stone or scrap (10 each). Foundations sit level on uneven ground so a base starts flat; ramps are a smooth slope a storey high; roofs are pitched caps that go on top of walls. Walls can be edited into a window, a doorway (hang a door in it) or a half wall. Pieces must connect to the ground or another piece. Hit a piece to damage it; stone and scrap are tougher than wood.
- Bases you can protect and raid, Rust-style:
  - **Tool cupboard** (300 wood): set it down inside your base. Nobody else can build, set things down or edit walls within 18 m, and their hits barely scratch your wooden walls and do nothing to stone or scrap. Press **E** on it to let a friend build too, and **G** to clear everyone else. Without one, anyone can knock your walls down by hand.
  - **Doors**: press **G** on a wall to make a doorway, then hang a wooden door (150 wood) or a sheet metal door (150 metal, workbench 1) in it. **E** opens and closes them.
  - **Code locks** (100 metal, workbench 1): fit one to a door and pick a 4-digit code. Only you, and whoever you tell the code, can open it. A wrong code shocks you.
  - **Sleeping bags** (30 cloth): lay one down and you can wake up in it when you die, once a minute.
  - **Explosives**: beancan grenades you throw (60 gunpowder, 20 metal, workbench 1), satchel charges you stick to a wall or door (4 beancans, 10 cloth, workbench 1), and timed explosive charges, C4 (5 explosives and 5 cloth at workbench 3; explosives are 50 gunpowder, 10 sulfur and 10 metal at workbench 2). Two satchels blow open a wooden wall or door and three a stone or scrap wall; one C4 takes out any wall or a wooden door, two a metal door. Blasts hurt anyone nearby who isn't behind a wall.
- Cars: an old car is parked just outside every landmark: a rusty pickup, a saloon, a box van or a jeep. Press **E** to get in, **W** and **S** to drive and reverse, **A** and **D** to steer, and **E** again to get out. It runs on **low grade fuel** (5 from 10 charcoal and 2 cloth, or found in crates): hold it and left click a car to fill the tank, which holds 100 and goes about 30 m on each. Cars can be shot, hit and blown up; a wrecked car explodes, and a new one is parked in its place 10 minutes later. Hitting someone at speed hurts them. Cars show on the map and are saved with the world.
- Paint: press **P** to paint the car you're in or next to (and swap it for another model: the saloon is quickest, the van toughest with the biggest tank, the jeep turns tightest), the building piece you look at (or the whole base around it), or the gun or tool in your hands. 16 colours, free. With a building plan in hand, **P** also picks the paint new pieces go up in. Others see your paint.
- Teams (clans) of up to 6: look at someone and press **T** to invite them, and they press **Y** to join. Teammates can't hurt each other, and they share tool cupboards and code locks: if one of you is trusted, the whole team is. Teammates have green name tags and show on the map, and **L** leaves the team. Teams are saved with the world.
- Places worth looting:
  - **A landmark in each land**, built from scanned models on levelled ground and marked on the map (M): Smith's Garage in the Ashlands, a Logging Camp in Deadwood, a Mining Outpost on Rust Mesa, an Oil Field on the Sulfur Flats and a Radio Station up in the Frostpeaks. Nobody can build there.
  - **Crates** at every landmark: wooden crates hold the basics (scrap, metal, ammo, bandages, early guns and armour), military crates better guns, ammo, syringes and armour. Each land's crates add what it is known for. Press **E** to open one; once emptied it fills up again 8 minutes later.
  - **Air drops**: a cargo plane flies over every 20 to 30 minutes while anyone is playing and drops a crate of the best gear, which floats down on a parachute and puffs red smoke when it lands. It shows on the map, and everyone gets told which land it is over.
  - **Supply signals**, found in military crates: throw one and its red smoke calls the plane to drop right there.
- Movement handles everything you build: walk up stairs and ramps, stand on floors and foundations, walk through doors.
- The server checks every action (reach, cost, cooldowns, movement speed), so players can't cheat by editing the client.

## Controls

| Action | Key |
| --- | --- |
| Look around | Click the game, then move the mouse |
| Move / sprint / jump | WASD / Shift / Space |
| Pick a belt slot | 1 to 6 (or scroll) |
| Inventory and crafting | Tab or I (Esc closes) |
| Gather, hit, place or shoot what you hold | Left click (hold for automatic guns) |
| Aim down sights | Right click (with a gun) |
| Reload | R (with a gun) |
| Open a furnace or box, pick hemp or mushrooms, drink from a rain barrel | E |
| Eat, drink or take pills in your hands | Left click |
| Building plan: foundation, wall, floor, stairs, ramp or roof | Right click |
| Building plan: wood, stone or scrap | R |
| Edit the wall you look at (window, door, half wall, solid) | G |
| Invite who you look at to your team / join a team you were invited to / leave your team | T / Y / L |
| Get in or out of a car / drive / steer | E / W S / A D |
| Paint a car, wall or gun, or swap a car's model | P |
| Map | M |
| Graphics high or low | O |
| Hide help | H |

## Play it on your computer

Install [Node.js](https://nodejs.org) 20 or newer, then:

```bash
npm install
npm run build
npm start
```

Open http://localhost:3000. Friends on the same network can join at `http://<your computer's IP>:3000`.

For development with live reload, run `npm run dev` and open http://localhost:5173.

## Host it online for friends

The repo includes a `render.yaml`. On [Render](https://render.com), choose **New > Blueprint**, pick this repository, and it builds and runs the server. Share the URL it gives you. The free plan sleeps when nobody is playing, so the first visit can take a minute to load.

## How it is built

| Folder | What it holds |
| --- | --- |
| `shared/` | Rules both sides use: terrain generation, resources, block costs, message types |
| `server/` | The authoritative game server (`game.ts` is pure logic, `index.ts` is networking) |
| `client/` | The Three.js game: graphics, world, character, building controls and screen layout |
| `tests/` | Unit tests for the game rules |
| `scripts/smoke.ts` | A two-player browser test that gathers, builds a hut with a door and window, walks up the stairs, and checks both players see it |

Checks: `npm run typecheck`, `npm test`, and `npm run build && npm run smoke`.

## Next milestones

The first roadmap is done. Clans and cars are in too. Ideas for next: a minicopter, a Rust-style tech tree, farming, more lands and creatures, and moving to Unity if the prototype proves fun.
