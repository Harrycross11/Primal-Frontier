# Hosting PRIME so accounts and the world are kept

Render's free web service has no lasting disk: everything on it is wiped whenever it goes to
sleep (15 minutes with nobody on), restarts or is redeployed. So the server keeps accounts and the
world in a **Postgres database** named by the `DATABASE_URL` environment variable.

## Which database

| Option | Cost | Keeps data | Catch |
| --- | --- | --- | --- |
| **Neon free** (recommended) | Free | Yes, no expiry | Sleeps after 5 idle minutes and wakes by itself in a second or two on the next connection. 0.5 GB and about 100 compute-hours a month: plenty while the Render server sleeps when nobody plays. |
| Supabase free (what was set up first) | Free | Yes | **Pauses after a week with no activity**, and stays paused until someone presses Restore in the Supabase dashboard. Paused for 90 days, it can no longer be restored. |
| Render Postgres free | Free | **No: expires 30 days after it is made** | Don't use it for saves. |
| Render Postgres Basic, Neon Launch, Supabase Pro | About $6 to $25 a month | Yes | Paid. |

Whatever the database, the server now behaves safely when it can't reach it: it never writes
over a save it couldn't read, turns new accounts away (with a clear message) instead of
pretending to make them, logs `SAVE PROBLEM` lines, and picks the save back up once the database
answers.

## Moving to Neon (keeps everything that is already in Supabase)

1. Go to <https://neon.tech> and sign up (Continue with GitHub or Google is quickest).
2. Make a project: name it `prime`, leave the Postgres version as it is, and pick the region
   nearest your Render service (Render's free services default to Oregon, so **AWS US West 2
   (Oregon)**). Press **Create project**.
3. On the project's dashboard press **Connect**. Leave the branch `main` and database `neondb`,
   and copy the connection string. It looks like
   `postgresql://neondb_owner:…@ep-something.us-west-2.aws.neon.tech/neondb?sslmode=require`.
   Keep it private: it holds the database password.
4. If the old Supabase project is paused, open <https://supabase.com/dashboard>, open the project
   and press **Restore project**, then wait until it says it is healthy (a few minutes).
5. Open <https://dashboard.render.com>, click the PRIME web service, then **Environment** in the
   left menu.
6. Find the existing `DATABASE_URL` row, press its **Edit** (pencil), and change only the key's
   name to `OLD_DATABASE_URL` (keep its value). This is the Supabase one; the server only reads it,
   to copy accounts and the world across.
7. Press **Add Environment Variable**: key `DATABASE_URL`, value the Neon string from step 3.
8. Press **Save, rebuild, and deploy** (or **Save and deploy**).
9. When the deploy is live, open **Logs** and look for these lines:
   - `moving saves from database …supabase.com/postgres: N accounts and the world copied to database …neon.tech/neondb`
   - `PRIME server on … saving to database …neon.tech/neondb: ok`
10. Open `https://<your game's address>/health`. Under `saving` it should say `"state":"ok"`.
11. A few days later, once everything looks right, you can delete the `OLD_DATABASE_URL` row.
    Nothing is copied twice, so leaving it there for a while is harmless.

If step 9 says `could not copy saves from the old database`, the Supabase project is still
paused or waking up: restore it (step 4) and press **Manual Deploy > Restart service** in Render;
the copy is tried again on every start.

## Staying on Supabase

It works, as long as the project isn't paused. If accounts seem to vanish, open the Supabase
dashboard: a paused project shows a **Restore project** button. Press it, wait until it is
healthy, then restart the Render service (**Manual Deploy > Restart service**). Your saved
accounts and world come back, because the server no longer writes over a save it can't read.

Use the **Session pooler** connection string (Supabase > Connect > Session pooler): Render can't
reach Supabase's direct connection.

## Checking it is working

- **Render > Logs** at start-up: `saving to database …: ok`. `SAVE PROBLEM` lines say exactly what
  is wrong (no `DATABASE_URL`, a database that doesn't answer, a save that failed).
- **/health** shows `saving.state`:
  - `ok`: saving works and outlives restarts.
  - `down`: the database can't be reached. New accounts are turned away, the saved world is left
    alone, and the server keeps trying every 30 seconds.
  - `temporary`: no `DATABASE_URL` on Render. New accounts are turned away, because they would be
    lost the next time the server sleeps.
- The main menu shows a yellow note under **Sign in** whenever accounts can't be kept.

## Other settings

| Variable | What it does |
| --- | --- |
| `DATABASE_URL` | Postgres connection string where saves are kept. |
| `OLD_DATABASE_URL` | Optional: a database to copy saves from when moving (only read). |
| `SAVE_FILE` | Without a database, the file the world is saved to (default `data/world.json`, with `accounts.json` beside it). Fine for playing on your own computer. |
| `DURABLE_DISK=1` | Says `SAVE_FILE` is on a disk that is kept (a paid Render disk), so a file is trusted on Render. |
| `NO_SAVE=1` | Saves nothing (tests and screenshots). |
| `WIPE_DAYS` | Days a world lasts before the monthly wipe (default 30). |
