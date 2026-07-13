# Iron Path: Four Blades

## Play locally

Do **not** open `index.html` directly. The game uses browser modules and needs a tiny local web server.

On macOS, double-click `run-game.command`. It will open the game at `http://127.0.0.1:4173`.

Alternatively, in Terminal from this folder, run:

```sh
python3 serve.py
```

Keep the Terminal window open while you play. Press `Control-C` to stop the game server.

## Controls

- Click a blue unit, then a blue tile to move.
- Click a red enemy in range to attack.
- Click **End Player Turn** (or press Space) when your units have acted.
- Press `R` to restart a mission.

The first click enables optional sound; the game works normally if sound is unavailable.
