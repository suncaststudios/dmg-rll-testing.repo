CUSTOM MUSIC
============

Two subfolders here:

    main menu/    — tracks to play on the main menu / non-combat screens
    combat/       — tracks to play during a battle

Drop any audio files you want (mp3, ogg, wav, opus, m4a, flac — anything
your browser can play) into either folder. No renaming, no manifest, no
config file — the game reads whatever's actually in these folders.

If a folder has more than one file, the game picks one at random each
time that context's music starts, so you can drop in a whole playlist
per folder if you want variety instead of one fixed track.

HOW TO TURN IT ON
------------------
1. In-game: Settings → Audio → "Custom Music".
2. The first time, the game will ask you to pick this "custom music"
   folder using your browser's normal file picker — this is a one-time,
   explicit permission grant your browser requires for any web page to
   read local files; there's no way for a game running in a browser tab
   to read your files without you choosing them yourself first. Pick
   THIS folder (the one this README is in).
3. After that, the game remembers your choice and won't ask again next
   time you launch it, unless you clear site data or pick a different
   folder.

ABOUT THE "SHOW IN EXPLORER" BUTTON
-------------------------------------
If you're playing the desktop (Electron) build, this opens your real,
native file manager (Explorer/Finder) right at this folder — same as
right-click → Show in Folder.

If you're playing in a regular web browser tab, there's genuinely no
way for a web page to open your OS's file manager — browsers don't
allow that, for the same security reasons they don't allow reading
files without you picking them. In the browser, that button instead
re-opens the folder picker described above, which is the closest real
equivalent.
