# SherLock Icon Assets

`SherLock.icon/` is the editable Apple Icon Composer source supplied for the SherLock brand. `SherLock-brand.png` is its 1024×1024 default-appearance export. The flattened Default, Dark, Clear, and Tinted exports are kept in `appearances/`; light/dark UI images are copied into `public/brand/`.

## Generated icons

- `src-tauri/icons/` — Tauri app PNG, ICNS, and ICO icons.
- `browser-extension/icons/` — Chrome and Firefox extension icons at 16, 48, and 128 pixels.
- `public/brand/` — desktop app UI marks that follow the light/dark app and system theme.

## How to regenerate icons

After editing `Untitled.icon` in Icon Composer, run:

```bash
npm run icons:compile
```

This exports all variants from the `.icon` bundle and regenerates:
- Tauri app icons (ICNS, ICO, PNG sizes)
- Browser extension icons (16, 48, 128px)
- Brand marks in `public/brand/` and `assets/icons/appearances/`

The script validates all outputs and reports any errors or stale files.
