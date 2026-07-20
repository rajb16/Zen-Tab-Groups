# Zen Tab Groups

Folder-style tab groups for Zen Browser's vertical tab strip. Group tabs together, collapse/expand them as a unit, drag them around as a folder, and have your groups survive a browser restart.

## Features

* **Group tabs** via right-click → "Add to tab group" (auto-names the group from the domain, e.g. `Github`, `Reddit`).
* **Auto color-coding** — known domains (YouTube, GitHub, Reddit, etc.) get a preset color; unknown domains get a color sampled from the tab's favicon.
* **Collapsible groups** — click a group header to collapse/expand its tabs. Groups always start collapsed when the browser starts.
* **Drag & drop** — drag a group header to reorder the whole group, or drag tabs in/out of a group.
* **Group header menu** (right-click a header) — change color, rename, ungroup all tabs, or close the whole group.
* **Persists across restarts** — group membership and color are saved via Firefox's SessionStore, so groups come back after closing/reopening the browser.
* **Per-workspace groups** — groups are scoped to the Zen workspace they were created in, so two different workspaces can each have their own group with the same name without interfering with each other.

## Requirements

* [Sine](https://github.com/CosmoCreeper/Sine)

## Install

* Make sure you have Sine installed.
* Go to the Sine mods page in settings.
* Under "add your own repo" type `rajb16/Zen-Tab-Groups` and hit install.
* Look for "Zen Tab Groups" in the Sine mods list and enable it.

## Companion mod

[Zen AI Tabs](https://github.com/rajb16/Zen-AI-Tabs) builds on top of this mod to automatically sort your ungrouped tabs into groups using local or Gemini AI. Zen Tab Groups works fine on its own if you just want manual grouping.
