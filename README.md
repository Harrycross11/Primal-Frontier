# Primal Frontier

A survival sandbox set in a world after a nuclear apocalypse. Players join a server, scavenge a barren map for scarce wood and scrap, and build with blocks together. The full vision is Rust-style survival with ARK-style creatures, Minecraft-style building and Fortnite-style characters on servers that wipe every 30 days.

This repository is the **browser prototype**, built step by step. The current milestone is **walk, gather, build**.

![Two survivors next to a scrap block tower](docs/screenshots/two-players.png)

## What works now

- A 160 m barren wasteland generated from a seed: ash plains, blast craters, dead trees, rusted wrecks and one small pocket of living trees.
- Up to 8 players per server, each with a bright stylized survivor and a name tag.
- Gathering: hit trees for wood and wrecks for scrap. Trees never regrow; scrap respawns after 2 minutes.
- Building: wood and scrap blocks on a 1 m grid, costing 2 materials each. Blocks must touch the ground or another block. Breaking one refunds half.
- The server checks every action (reach, cost, cooldowns, movement speed), so players can't cheat by editing the client.

## Controls

| Action | Key |
| --- | --- |
| Look around | Click the game, then move the mouse |
| Move / sprint / jump | WASD / Shift / Space |
| Gather or break | Left click or E |
| Build | Right click or F |
| Pick block type | 1 wood, 2 scrap |
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
| `client/` | The Three.js game: world, character, controls and screen layout |
| `tests/` | Unit tests for the game rules |
| `scripts/smoke.ts` | A two-player browser test that gathers, builds and checks both players see it |

Checks: `npm run typecheck`, `npm test`, and `npm run build && npm run smoke`.

## Next milestones

1. Crafting and tools (stone axe, pickaxe, workbench)
2. Survival needs: hunger, thirst, radiation zones
3. The first creature: a mutated Ashhound that can be tamed and ridden
4. Saving the world to disk and the 30-day wipe cycle
