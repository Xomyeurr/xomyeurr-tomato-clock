# Split trigger handling between the Chrome extension and a local Companion Process

The extension itself needs to stay a plain Manifest V3 extension: no persistent background execution while the browser is closed, no webhook listener, no OS-level cron. But the product goal is for AI schedule reviews to eventually be triggerable from multiple sources — chat tools, PM software, a fixed daily schedule — not just a manual click.

We decided the extension owns only data capture and a manual "review now" Trigger. Every other Trigger source is the responsibility of a separate, independently-running local Companion Process (introduced in Phase 2+), which reads and writes the same `./data` files as the extension. This keeps the extension simple and installable with zero OS-level setup, at the cost of Phase 2+ requiring the user to also run a small local process for anything beyond manual triggering.
