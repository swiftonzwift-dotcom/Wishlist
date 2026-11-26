# Design system: "Midnight & Neon"

Every screen is built from the parts below. To add something new, reuse a component; if none fits, add it here first. The tokens live at the top of `css/styles.css`.

The look: a near-black app, crisp white cards, one electric-blue colour for anything you can tap, and four bright accent colours for labels and tiles. Type is large, friendly and geometric. There are no icons or emojis. Every control says what it does in words.

## Foundations

### Colour

| Token | Value | Use |
| --- | --- | --- |
| `--ink` | `#0D0D10` | App background |
| `--ink-raised` | `#1A1A20` | Dark panels on the background (secret-idea box, dropdown) |
| `--ink-line` | `#2A2A33` | Dividers on dark |
| `--on-ink` | `#FFFFFF` | Text on dark |
| `--on-ink-muted` | `#9A9AA6` | Section labels and hints on dark |
| `--paper` | `#FFFFFF` | Cards, sheets, inputs |
| `--paper-sunk` | `#F1F1F5` | Input fields and placeholders on cards |
| `--on-paper` | `#121216` | Text on cards |
| `--on-paper-muted` | `#666673` | Secondary text on cards |
| `--electric` | `#2B1BF2` | **The only action colour**: buttons, links, the tab bar |
| `--electric-press` | `#1E0FC4` | Pressed state |
| `--lemon` | `#F2F55A` | Accent: **Purchased** cards and the "I'm giving" tile (both mean "bought") |
| `--mint` | `#5CF08A` | Accent: "Past years" tile and the new-year notice only. Never used to signal state. |
| `--bubblegum` | `#FF5CC0` | Accent: "Most wanted" and "Secret idea" pills |
| `--sky` | `#73D2F5` | Accent: "Really want", family labels, notices |
| `--danger` | `#C8102E` | Removing or deleting things (always labelled "Remove" or "Delete") |

Rules:
- Accents are always **backgrounds with dark (`--on-paper`) text**, never text colours.
- Electric blue means "you can tap this", and is used for nothing else.
- Yellow is reserved for **Purchased** on a list. Purchased never depends on colour, though; see Accessibility.

### Type

Font: **Outfit** (Google Fonts), falling back to the system font.

| Role | Size / weight | Example |
| --- | --- | --- |
| Display | 44px / 300 | Big numbers on tiles |
| Title XL | 32px / 700 | Person's name in the welcome header |
| Title | 24px / 700 | Page titles |
| Heading | 19px / 600 | Card titles, row names |
| Body | 17px / 400 | Paragraphs, inputs |
| Label | 15px / 300 | Section labels on dark ("Mitchell family") and the "Welcome," line |
| Caption | 13px / 500 | Pills, meta text |

The minimum is 13px, used only for pills. Body text never goes below 17px.

### Shape and spacing

- Radius: pills `999px`, buttons and inputs `14px`, tiles `18px`, cards `20px`, sheets `28px`.
- Spacing steps: 4, 8, 12, 16, 24, 32. Page side gutter: 16px.
- Tap targets are at least **48px** tall, and 44px for small pills.

## Components

| Component | Class | Description |
| --- | --- | --- |
| Welcome header | `.welcome-head` | Light "Welcome," label above the person's name in Title XL. The family dropdown sits on the right. |
| Page bar | `.pagebar` | Top of inner pages: underlined "Back" text link on the left, optional family dropdown on the right. |
| Section label | `.section-label` | Light label on dark, with an optional small underlined link on the right (the "see all" pattern). |
| Tile | `.tile` + `.tile--paper/lemon/mint/electric` | 132×116 coloured square with a label top-left and a Display number bottom-left. Tiles scroll sideways in a `.tile-row`. The first tile is always the electric action ("Add a wish"). Hide a tile when it would show nothing useful (Past years before there are any). |
| Pill | `.pill` + accent modifier | Caption-size label on an accent background: priority (Most wanted: bubblegum, Really want: sky, Nice to have: `--plain` white), "Secret idea", family name. `.pill--ink` is white on black and is only used for **Purchased**. |
| Row card | `.row-card` | White card listing a person: name (Heading), meta in electric caption, and a corner action ("See list") that sits in the card's bottom-right notch. |
| Item card | `.item-card` | White card: picture on top with a pill in its top-left corner, then the title and details, then actions. Cards sit two across in `.item-grid`. With no picture, the picture area is neutral `--paper-sunk` showing the store name (or "No photo") in light type. |
| Purchased item | `.item-card.is-bought` | Four cues, so it works without colour: a thick solid black border inside the card, black diagonal stripes over the faded picture, a full-width black **PURCHASED** band, and "Bought by …". Yellow body as a fifth, bonus cue. Never shown to the list's owner. |
| Corner action | `.corner-action` | Electric square tucked into a card's bottom-right corner ("View" or "See list"). This is the reference design's signature notch. |
| Buttons | `.btn` + `--primary/--secondary/--ghost/--danger`, `--small`, `--block` | Primary is electric with white text. Secondary is white with an electric outline. Ghost is an underlined text link. Danger is red text, or filled red inside confirmation sheets. |
| (No avatars) | | People are always shown by full name. There are no initials or picture circles. |
| Name list | `.name-list` | One white card holding a divided list of names, each a 56px tap row. |
| Notice | `.notice` + `--lemon/--mint` | Rounded strip for one-off messages (demo mode, new year). |
| Dark panel | `.panel` | `--ink-raised` box for secondary actions on a page (secret ideas, starting the new year early). |
| Tab bar | `.tabbar` | Fixed electric pill at the bottom with text tabs **Family · My list · Giving**. The current tab sits in a black inner pill. |
| Sheet | `dialog.sheet` | White sheet that slides up from the bottom, holding forms and confirmations. Actions sit at the bottom, primary on the right. |
| Field | `.field` | Label above the input, with the input on `--paper-sunk`, 14px radius and an electric focus ring. |
| Choice chips | `.chip` | Radio buttons shown as pills; the selected chip is filled electric. |
| Toast | `#toast` | Electric pill near the bottom that confirms a save. |

## Accessibility (colour blindness included)

Some family members have red-green colour blindness: greens, oranges and reds are hard to tell apart, while blues and yellows stay clear. The rules:

1. **Never use colour alone to mean something.** Every state has a word plus a shape or pattern:
   - Purchased: solid black inner border, striped picture, **PURCHASED** band, "Bought by …".
   - Secret idea: dashed black inner border and a "Secret idea" label.
   - Priority: the pill always says the priority in words.
2. **Avoid red-versus-green pairings.** Green (mint) is decoration only and never signals a state. Red is only for Remove or Delete, which always say so.
3. **Contrast (WCAG 2.1 AA):** text is at least 4.5:1, and borders and focus rings at least 3:1. Checked values:
   - white on electric: 8.3
   - electric on white: 8.3
   - muted text on the page: 7.0
   - muted text on white: 5.7
   - placeholder text: 4.7
   - danger red: 5.9
   - dark text on every accent: 6.7 to 16
   - Purchased and secret borders: 16+
4. **Focus rings** are white on the dark page and electric blue on white surfaces.
5. **Blue shapes on the dark page** (the Add-a-wish tile and the tab bar) get a thin light edge. They always contain white text, so they never depend on the blue alone.
6. **Before changing a colour,** check it in a deuteranopia/protanopia simulator, for example Chrome DevTools → Rendering → "Emulate vision deficiencies".

## Voice

- Talk like a helpful relative: "Tap your name", "Did you buy this?", "Nothing yet".
- Name the action on the button: "I bought this", "Add a wish", "See list". Avoid "OK" or "Submit".
