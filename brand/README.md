# Brand

The mark is the verifiability scale, not decoration.

Four squares, each fainter than the last — **V0 ASSERTED**, **V1 OBSERVABLE**,
**V2 RECONCILED**, **V3 FALSIFIED**. Opacity falls as a claim gets harder for a
stranger to establish for themselves, which is the one idea the whole project
turns on. The corner ticks are the register frame the pages already use to mark
a block as evidence rather than copy.

The same mark appears in the site header (`.mark` in `packages/design/src/index.ts`),
so the logo and the product are the same object rather than two designs that
happen to share a name.

| File | Use |
|---|---|
| `logo.svg` | source of truth, scales to any size |
| `logo-512.png` | 512×512, for BUIDL / DoraHacks / anywhere that wants a raster |

## Regenerating the PNG

`render.html` exists so the raster is *rendered from* the SVG rather than
redrawn beside it — the same reason every figure on the site is read from the
register that produced it.

```sh
python -m http.server 8901 --directory brand
# screenshot http://127.0.0.1:8901/render.html at exactly 512×512
```

## Palette

Taken from the live site's tokens, unchanged.

| Token | Value |
|---|---|
| paper | `#FAF9F5` |
| ink | `#1F1E1D` |
