# AI changes reach the extension only through a proposal inbox

The `./data` JSON files are a one-way export from the extension (ADR 0002). We considered two-way sync, letting AI agents edit the data files directly with last-write-wins per record, but that risks the AI and the user silently overwriting each other's edits to the same record, and it would let an AI change the user's schedule without the user deciding.

Instead, in Phase 1 AI agents only read `./data`. From Phase 2, an AI that wants to change anything writes a proposal into a dedicated inbox file; the extension imports it and applies it only after the user approves. The extension remains the only writer of real data.
