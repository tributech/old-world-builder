# OWR Theme Overrides

## How It Works

The upstream OWB app ships with a sandy/parchment Warhammer aesthetic. Our fork applies a clean, modern OWR brand on top using a single CSS override file loaded in `public/index.html` before the React app bundles:

```html
<link rel="stylesheet" href="%PUBLIC_URL%/owr-overrides.css" />
```

Because Create React App bundles `src/App.css` (which defines the upstream `:root` variables), and bundled CSS loads **after** static `<link>` tags in `<head>`, CSS custom property overrides in `owr-overrides.css` can be outprioritied by the app. For this reason, some overrides use direct class selectors with `!important` rather than relying on `:root` variables alone.

## File: `public/owr-overrides.css`

This is the **only file needed** for most theme changes. It uses `!important` where necessary to beat CRA bundle specificity.

### What it overrides

| Area | Upstream | OWR Override |
|------|----------|-------------|
| Font | Gideon Roman (fantasy serif) | Montserrat (clean sans-serif) |
| Background | Sandy parchment gradient | Flat `#F5F5F5` off-white |
| Header | Dark blue-grey | `#1C1C1C` black |
| Primary buttons | Gold `#DAA520` | Dark `#1C1C1C` |
| Section dividers | Sandy gradient | Neutral grey `#D5D5D5` |
| Links | Gold/brown | Black, underlined, `font-weight: 500` |
| Form inputs | Light border | Dark `#1C1C1C` border, `border-radius: 6px` (shadcn-style) |
| Checkboxes/radios | Browser default blue | Black via `accent-color` |
| Dialogs | Sandy gradient background | Flat `#F5F5F5` |
| Folders | Grey `--color-list` | Black `#1C1C1C` with white text |
| Error/warning | Orange `#d14500` | Warhammer red `#8B0000` |
| Footer nav links | About, Help, News, etc. | Hidden (covered by OWR website) |
| Focus rings | Gold | Black `#1C1C1C` |

### CSS variable load-order caveat

The upstream `src/App.css` defines `:root` variables (e.g., `--color-error: #d14500`). Since CRA injects bundled CSS after our `<link>` tag, the app's `:root` block wins for variable definitions. To work around this:

- **Prefer direct class overrides** (e.g., `.error-message { color: #8B0000 !important; }`)
- `:root` variable overrides in `owr-overrides.css` only work for variables **not redefined** in `App.css`

## Other theme-related files

- `src/App.css` — Added `@import` for Google Fonts Montserrat
- `src/App.js` — Links to `owr-overrides.css` in the public folder
- `src/components/page/Header.js` — OWR logo + "Battle Builder" brand link
- `src/assets/owr-logo-white.svg` — White logo for dark header
- `src/assets/owr-logo-black.svg` — Black logo (available for light contexts)

## Adding new overrides

1. Add CSS rules to `public/owr-overrides.css`
2. Use browser DevTools to find the upstream class name
3. Use `!important` if the upstream style has equal or higher specificity
4. **Do not modify upstream CSS files** — keep all overrides in the single override file so rebases onto upstream stay clean
