# FormaTexto — Design System

> Source of truth for all frontend visual decisions. Follow strictly. Shadcn integration must map to these tokens — do not introduce new visual values.

---

## Design Philosophy

Warm, minimal, editorial. The palette leans earthy (sand + deep forest green) rather than cold tech-blue. White cards float on the sand background. Typography is tight and functional — Inter only, no decorative type. Interactions are subtle: color transitions, no scale or bounce animations. The UI should feel trustworthy and calm, not flashy.

---

## Color Tokens

### Brand Palette

| Token | Hex | Role |
|-------|-----|------|
| `sand` | `#F0EEE8` | Page background, input fill, icon container fill |
| `forest` | `#1A3C2E` | Brand primary — CTA buttons, avatar bg, success states |
| `forest-mid` | `#2D5A3F` | Hover state for `forest` elements |
| `forest-light` | `#3D7A57` | Accents, secondary highlights |
| `ink` | `#1A1A18` | Primary text, dark button bg |
| `muted` | `#6B6B60` | Secondary text, icons, placeholders |
| `border` | `#DDDBD3` | All borders and dividers |

### Semantic State Tokens

Not in tailwind.config yet — defined here for Shadcn CSS variable mapping and future use.

| Token | Value | Role |
|-------|-------|------|
| `error-primary` | `#dc2626` (red-600) | Error text |
| `error-surface` | `#fef2f2` (red-50) | Error message background |
| `error-edge` | `#fecaca` (red-200) | Error message border |
| `warning-primary` | `#b45309` (amber-700) | Warning/processing text |
| `warning-surface` | `#fffbeb` (amber-50) | Warning background |
| `warning-edge` | `#fde68a` (amber-200) | Warning border |
| `success-primary` | `forest` | Success text (reuse brand) |
| `success-surface` | `forest/10` | Success background (Tailwind opacity) |
| `success-edge` | `forest/20` | Success border |

### Rules

- **Always use tokens, never raw hex** — `bg-ink` not `bg-[#1A1A18]`
- Exception: Tailwind opacity modifier → `bg-forest/10`, `text-ink/90` is fine
- Never introduce new colors not listed here without updating this file

---

## Shadcn CSS Variable Mapping

When integrating Shadcn, set these CSS variables in `globals.css` to match the design system:

```css
:root {
  --background:         240 6% 94%;    /* sand #F0EEE8 */
  --foreground:         60 3% 10%;     /* ink #1A1A18 */

  --card:               0 0% 100%;     /* white */
  --card-foreground:    60 3% 10%;     /* ink */

  --popover:            0 0% 100%;
  --popover-foreground: 60 3% 10%;

  --primary:            60 3% 10%;     /* ink — dark button */
  --primary-foreground: 240 6% 94%;   /* sand — text on dark button */

  --secondary:          240 6% 94%;   /* sand */
  --secondary-foreground: 60 3% 10%; /* ink */

  --muted:              240 6% 94%;   /* sand */
  --muted-foreground:   60 3% 34%;   /* muted #6B6B60 */

  --accent:             150 37% 17%;  /* forest #1A3C2E */
  --accent-foreground:  0 0% 100%;    /* white */

  --destructive:        0 72% 51%;    /* error-primary #dc2626 */
  --destructive-foreground: 0 0% 100%;

  --border:             40 9% 84%;    /* border #DDDBD3 */
  --input:              40 9% 84%;    /* same as border */
  --ring:               150 33% 26%;  /* forest-mid #2D5A3F */

  --radius: 0.75rem;                  /* rounded-xl = 12px base */
}
```

> Note: Shadcn uses HSL space-separated (no commas). Convert hex with a tool when adding new values.

---

## Typography

### Fonts

| Font | Weights | Usage |
|------|---------|-------|
| Inter | 400, 500, 600 | All UI text — loaded via Google Fonts |
| Georgia | 400 | Serif emphasis only (rare) |

No 700 (bold) weight. Semibold (600) is the heaviest used.

### Scale

| Role | Classes | Example |
|------|---------|---------|
| Page heading | `text-2xl font-semibold text-ink` | Dashboard title |
| Hero heading | `text-4xl font-semibold text-ink` | Landing H1 |
| Section heading | `text-xl font-semibold text-ink` | Card section H2 |
| Body default | `text-sm text-ink` | Paragraph content |
| Body secondary | `text-sm text-muted` | Supporting copy |
| Section label | `text-xs font-medium text-muted uppercase tracking-widest` | "Resumo", "Pagamento" |
| Form label | `text-xs font-medium text-muted uppercase tracking-wider` | Input labels |
| Caption | `text-xs text-muted` | Timestamps, file names |
| Link inline | `text-ink font-medium hover:underline` | In-text links |
| Link subtle | `text-muted hover:text-ink transition-colors` | Nav/back links |

---

## Spacing & Layout

- **Page max-width**: `max-w-3xl mx-auto px-6` (content pages)
- **Navbar max-width**: `max-w-6xl mx-auto px-6`
- **Narrow page** (auth, checkout): `max-w-md` or `max-w-lg`
- **Page padding**: `py-12`
- **Card list gap**: `gap-3`
- **Card internal padding**: `px-6 py-5`
- **Form field gap**: `gap-4` between fields, `gap-1.5` between label and input

---

## Border Radius

| Context | Class | px |
|---------|-------|----|
| Cards, panels, modals | `rounded-2xl` | 16px |
| Buttons, inputs, badges, error boxes | `rounded-xl` | 12px |
| Icon containers | `rounded-xl` | 12px |
| Small badges, chips | `rounded-lg` | 8px |
| Logo mark | `rounded-md` | 6px |
| Avatar (circular) | `rounded-full` | — |

Shadcn `--radius` is set to `0.75rem` (12px). Shadcn components default to `rounded-md` — override with `rounded-xl` or `rounded-2xl` as needed per context above.

---

## Shadows

- Default depth: `shadow-sm` only
- No `shadow-md`, `shadow-lg`, or heavy elevation
- Cards rely on border (`border border-border`) for definition, not shadow

---

## Components

### Buttons

**Primary (dark/ink)** — default action:
```tsx
className="bg-ink text-[#F0EEE8] text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-ink/90 transition-colors"
```

**Primary (forest)** — payment/confirm CTA:
```tsx
className="bg-forest text-white text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-forest-mid transition-colors"
```

**Full-width CTA** (checkout submit, auth submit):
```tsx
className="w-full py-3 rounded-xl text-sm font-semibold bg-forest text-white hover:bg-forest-mid transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
```

**Ghost/secondary** (Google OAuth, back links):
```tsx
// Bordered ghost
className="w-full flex items-center justify-center gap-3 border border-border rounded-xl py-3 text-sm font-medium text-ink hover:bg-sand transition-colors"

// Text-only
className="text-sm text-muted hover:text-ink transition-colors"
```

**Disabled state**: always `disabled:opacity-40 disabled:cursor-not-allowed`. Never remove interactivity visually — dim it.

### Inputs

```tsx
className="w-full text-sm border border-border rounded-xl px-4 py-3 bg-[#F0EEE8] placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-forest-mid/30"
```

Label above input:
```tsx
<label className="text-xs font-medium text-muted uppercase tracking-wider">
  Label text
</label>
```

Gap between label and input: `gap-1.5`. Gap between field groups: `gap-4`.

### Cards

**Static card**:
```tsx
className="bg-white rounded-2xl border border-border px-6 py-5"
```

**Interactive/clickable card**:
```tsx
className="bg-white rounded-2xl border border-border px-6 py-5 hover:border-forest-mid/40 transition-colors group"
```

### Badges

**Status badges** (project status):
```ts
inQueue:    'bg-[#F0EEE8] text-muted border border-border'         // neutral
processing: 'bg-warning-surface text-warning-primary border border-warning-edge'
ready:      'bg-forest/10 text-forest border border-forest/20'
delivered:  'bg-forest text-white border border-forest'
```

Base badge classes:
```tsx
className="inline-flex items-center text-xs font-medium px-3 py-1.5 rounded-lg"
```

**Promo/trial badge** (pill shape):
```tsx
className="inline-flex items-center gap-1 text-xs font-semibold text-forest bg-forest/10 border border-forest/20 rounded-full px-2.5 py-1"
```

### Icon Containers

```tsx
// Standard (40px)
className="w-10 h-10 rounded-xl bg-[#F0EEE8] flex items-center justify-center"
// icon: size={18} className="text-muted"

// Large (48px)
className="w-12 h-12 rounded-xl bg-[#F0EEE8] flex items-center justify-center"
// icon: size={22} className="text-muted"

// Avatar (32px circular, forest bg)
className="w-8 h-8 rounded-full bg-forest flex items-center justify-center"
// inner: text-white text-xs font-semibold
```

### Error / Alert Messages

```tsx
// Error
className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3"

// Info / notice (forest tint)
className="flex items-start gap-3 rounded-xl bg-forest/[0.07] border border-forest/20 px-4 py-4"
// text inside: text-sm text-forest leading-relaxed
```

### Loading States

**Skeleton**:
```tsx
className="bg-white rounded-2xl border border-border h-[72px] animate-pulse"
```

**Spinner (manual CSS)**:
```tsx
className="w-6 h-6 border-2 border-forest/30 border-t-forest rounded-full animate-spin"
```

**Spinner (Lucide)**:
```tsx
<Loader2 size={32} className="text-forest animate-spin" />
```

### Navbar

```tsx
<nav className="sticky top-0 z-50 bg-[#F0EEE8]/90 backdrop-blur-sm border-b border-[#DDDBD3]">
  <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
```

Height: `h-16` (64px). Frosted glass over sand. Sticky at top.

### Divider

```tsx
<div className="flex-1 h-px bg-border" />
```

---

## Interaction & Motion

- **All transitions**: `transition-colors` only. Duration: Tailwind default (150ms).
- No scale, translate, or bounce animations on user interactions.
- `animate-spin` for loading spinners only.
- `animate-pulse` for skeleton screens only.
- Hover: color shift only (darken bg, ink text from muted).

---

## Shadcn Integration Notes

When the Shadcn migration branch begins:

1. Install Shadcn with `--style default` and set `--radius 0.75rem`
2. Paste the CSS variable block from the **Shadcn CSS Variable Mapping** section above into `globals.css`
3. Map Shadcn component variants to this system:
   - `Button` variant `default` → maps to ink (primary dark button)
   - `Button` variant `secondary` → ghost/bordered style
   - `Card` → `rounded-2xl`, keep `border border-border`
   - `Input` → `bg-sand rounded-xl`, ring color = `forest-mid`
   - `Badge` → base `rounded-lg`, apply status colors above
4. Do not use Shadcn's default color names (`zinc`, `slate`, etc.) — remap everything to the tokens here
5. Keep `lucide-react` — Shadcn uses it natively, no conflict
