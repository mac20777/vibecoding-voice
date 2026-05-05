# Design System Document: The Resonant Interface

## 1. Overview & Creative North Star
This design system is engineered for the high-precision world of voice-driven development. It moves away from the cluttered, "dashboard-heavy" look of traditional IDEs in favor of **"The Resonant Architect"**—a creative North Star that treats the UI as a silent, responsive void that reacts to human speech with luminous precision.

The system breaks the standard "grid-of-boxes" template by utilizing intentional asymmetry and tonal depth. By layering deep charcoal surfaces against vibrant, electric accents, we create a signature experience where the "active code" feels like it is floating in a structured, high-tech ether. The interface is not just a tool; it is a reactive environment that prioritizes focus and visual soul.

## 2. Colors & Surface Architecture
The palette is rooted in a deep slate and charcoal foundation (`#0c0e12`), allowing the electric blue (`primary`) and neon purple (`secondary`) accents to act as beacons of activity.

### The "No-Line" Rule
To achieve a premium, editorial feel, designers are **prohibited from using 1px solid borders** for sectioning. Structural boundaries must be defined through background color shifts. For example, a sidebar should be rendered in `surface-container-low` against the `surface` main editor area. Depth is a matter of value contrast, not outlines.

### Surface Hierarchy & Nesting
We treat the UI as a series of physical layers—like stacked sheets of obsidian and frosted glass:
*   **The Void (Base):** `surface` (`#0c0e12`) is the deepest layer.
*   **The Canvas:** `surface-container-low` (`#111318`) defines primary workspace regions.
*   **The Module:** `surface-container-high` (`#1d2025`) is used for nested elements like property panels or terminal wells.
*   **The Interaction:** `surface-container-highest` (`#23262c`) is reserved for hover states and active modular components.

### The "Glass & Gradient" Rule
Standard flat colors lack the "soul" required for a high-end IDE. 
*   **Floating Elements:** Use semi-transparent `surface-container` variants with a `backdrop-blur` of 20px–40px to create glassmorphism effects for modals and command palettes.
*   **Signature Textures:** Main Action buttons or Voice Activity Indicators should utilize a linear gradient from `primary` (`#6dddff`) to `primary-container` (`#00d2fd`) to provide a sense of luminous energy.

## 3. Typography
The typography system uses a dual-personality approach to balance technical precision with modern editorial flair.

*   **Display & Headlines (Space Grotesk):** These are the "tech-brutalist" anchors. Use `display-lg` and `headline-md` for high-impact labels and section headers. The geometric nature of Space Grotesk reflects the "IDE" heritage.
*   **UI & Information (Manrope):** All functional UI—titles, body text, and descriptions—use Manrope. Its balanced, modern sans-serif letterforms ensure maximum readability during long coding sessions.
*   **Micro-Data (Inter):** Labels and utility text use Inter for its neutral, high-legibility profile at small scales (`label-sm`).
*   **Code Areas:** While not in the primary UI scale, the system mandates a high-quality monospaced font (e.g., JetBrains Mono or Fira Code) for all syntax-related content to maintain the developer-centric identity.

## 4. Elevation & Depth
Depth is achieved through **Tonal Layering** rather than traditional structural lines or heavy shadows.

*   **The Layering Principle:** Soft, natural lift is created by "stacking." A `surface-container-lowest` card placed on a `surface-container-low` background creates a recessed "well" effect, perfect for code editors.
*   **Ambient Shadows:** For floating elements (menus, tooltips), use extra-diffused shadows.
    *   **Blur:** 32px–64px.
    *   **Opacity:** 4%–8%.
    *   **Color:** Use a tinted version of `surface-tint` to simulate ambient light bleed.
*   **The "Ghost Border" Fallback:** If a boundary is strictly required for accessibility, use a **Ghost Border**: `outline-variant` (`#46484d`) at 15% opacity. Never use 100% opaque borders.
*   **Interaction Glass:** When the voice assistant is active, the primary container should adopt a glassmorphic state, allowing the `secondary` (purple) glow to bleed through the background layers.

## 5. Components

### Voice Activity Indicator (Signature Component)
A custom component utilizing a `secondary` (`#c081ff`) to `tertiary` (`#82a3ff`) gradient. It should feature a CSS-blur pulse effect to signify the "listening" state, moving beyond static icons to a living, breathing visualization.

### Buttons
*   **Primary:** Gradient from `primary` to `primary-container`. `0.375rem` (md) radius. Text is `on_primary_fixed` (`#002c37`).
*   **Secondary/Ghost:** `surface-container-highest` background with a `Ghost Border`. Use for low-emphasis actions.
*   **Tertiary:** No background; `on_surface_variant` text, shifting to `primary` on hover.

### Input Fields
Inputs must not have a 4-sided border. Use a `surface-container-high` background with a subtle 2px bottom-accent in `outline-variant`. On focus, the bottom accent transitions to `primary` with a soft outer glow.

### Chips (Tags/Status)
Chips use the `sm` (`0.125rem`) radius for a sharper, more technical "instrumentation" look. Backgrounds should be `surface-variant` with `on_surface_variant` text.

### Cards & Lists
Forbid the use of divider lines. Separate list items using `8px` of vertical whitespace (from the Spacing Scale) or by alternating background tones between `surface-container-low` and `surface-container`.

### The Editor Well
The core code area should be the most recessed layer (`surface-container-lowest`), creating a "focused pit" feel that draws the eye inward.

## 6. Do's and Don'ts

### Do
*   **Do** use asymmetrical margins to create an editorial, "non-template" feel.
*   **Do** use `primary` and `secondary` colors exclusively for functional feedback (voice activity, active states, success).
*   **Do** leverage `backdrop-blur` to maintain context when opening command palettes over code.

### Don't
*   **Don't** use pure white (`#ffffff`) for text; use `on_surface` (`#f6f6fc`) to reduce eye strain in dark mode.
*   **Don't** use standard "Drop Shadows" with high opacity.
*   **Don't** ever use 1px solid borders to separate the sidebar from the main editor.
*   **Don't** use the `full` (9999px) roundedness for anything other than circular status indicators; stick to `md` and `lg` for a professional, "machined" look.