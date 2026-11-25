# SherLock Icon Assets

`SherLock.icon/` is the editable Apple Icon Composer source supplied for the SherLock brand. `SherLock-brand.png` is its 1024×1024 default-appearance export. The flattened Default, Dark, Clear, and Tinted exports are kept in `appearances/`; light/dark UI images are copied into `public/brand/`.

The repository copies of the source (`assets/icons/SherLock.icon/` and `src-tauri/icons/AppIcon.icon/`) are synced from the editable `Untitled.icon` bundle in the parent directory.

## Generated icons

- `src-tauri/icons/` — Tauri app PNG, ICNS, and ICO icons, plus the compiled `Assets.car` used for the macOS appearances.
- `browser-extension/icons/` — Chrome and Firefox extension icons at 16, 48, and 128 pixels, including the dark and clear variants.
- `public/brand/` — desktop app UI marks that follow the light/dark app and system theme.
- `assets/icons/appearances/` — the full flattened set (Default, Dark, Clear light/dark, Tinted light/dark).

## How to regenerate icons

1. Edit `../Untitled.icon` in Icon Composer.
2. Export every appearance (Default, Dark, Clear light/dark, Tinted light/dark) to `../Untitled Exports`.
3. From the repository root, run:

```bash
npm run icons:compile
```

The script reads the 2048×2048 `Untitled-macOS-*-1024@2x.png` exports and regenerates:

- Tauri app icons (ICNS, ICO, PNG sizes) and `Assets.car`
- Browser extension icons (16, 48, 128px) and the packaged extension zips
- Brand marks in `public/brand/` and `assets/icons/appearances/`
- The icon resources of local `SherLock.app` builds, when present

It also runs `tools/clean_icon_edges.py`, which removes the soft grey rim that Icon Composer bakes along the canvas edge. This keeps the white tile clean at small UI sizes. The cleanup needs Pillow (`python3 -c "import PIL"`); without it the script falls back to the raw exports and keeps the rim.

If the exports are not in `../Untitled Exports`, point the script at the right folder:

```bash
ICON_EXPORTS="/path/to/Untitled Exports" npm run icons:compile
```

The exports are working files and are not committed; only the generated icons are tracked. Rebuild `SherLock.pkg` separately after running the script (the launcher does this automatically).
