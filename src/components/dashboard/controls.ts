/**
 * One set of control primitives. Every control in the filter row uses these so the row aligns on
 * a single baseline and nothing reads as static text.
 */
const CONTROL_HEIGHT = 'h-8'

/**
 * Text colour comes from the theme token, not a slate shade: a select's colour is inherited by
 * its native option list, which paints its own background, so anything that can drift from the
 * page background eventually renders invisible text in one theme.
 */
const CONTROL_BASE =
  `${CONTROL_HEIGHT} rounded-md border border-slate-400/60 dark:border-slate-500/50 bg-transparent px-2 text-sm ` +
  'text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50'

export const CONTROL_SELECT = `${CONTROL_BASE} cursor-pointer`

/** An opaque floating surface, painted from the theme so it never mismatches the page. */
export const POPOVER_SURFACE =
  'rounded-md border border-slate-400/60 bg-background shadow-lg dark:border-slate-600'

/** Shared interaction feedback, so hover strength is consistent rather than per-component. */
const SURFACE_HOVER = 'hover:bg-slate-500/10'
export const ROW_HOVER = 'hover:bg-slate-500/5'

export const CONTROL_BUTTON = `${CONTROL_BASE} inline-flex items-center gap-1.5 ${SURFACE_HOVER}`

/** Toggle pills: a visible resting boundary, a hover state, and an active state that is not colour alone. */
export const PILL_BASE =
  'h-8 inline-flex items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50'

export const PILL_RESTING =
  `border-slate-400/60 dark:border-slate-500/50 text-slate-700 dark:text-slate-300 ${SURFACE_HOVER}`

export const PILL_ACTIVE =
  'border-slate-900 dark:border-slate-100 bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'

/**
 * Semantic surfaces and text. Every colour in the app comes from here or from state-styles.ts,
 * so a theme change is one file and nothing drifts. All of these meet WCAG AA in the theme they
 * are used in.
 */
export const DANGER_SURFACE = 'border-red-500/50 bg-red-500/5'
export const DANGER_LABEL_TEXT = 'text-red-700 dark:text-red-300'
export const WARNING_SURFACE = 'border-amber-500/50 bg-amber-500/5'
export const WARNING_TEXT = 'text-amber-800 dark:text-amber-200'
export const CAUTION_TEXT = 'text-amber-700 dark:text-amber-300'
export const CHIP_WARN = 'border-amber-500/60 text-amber-700 dark:text-amber-300'
export const CHIP_INFO = 'border-blue-500/60 text-blue-700 dark:text-blue-300'

/** Period-over-period movement. Red is a rise in errors, green a fall — not the usual polarity. */
export const DELTA_WORSE_TEXT = 'text-red-700 dark:text-red-300'
export const DELTA_BETTER_TEXT = 'text-emerald-700 dark:text-emerald-300'

/** Secondary text that still meets contrast at small sizes. */
export const MUTED_TEXT = 'text-slate-600 dark:text-slate-300'
export const FAINT_TEXT = 'text-slate-500 dark:text-slate-400'

/**
 * The problem table's grid, shared by the header and every row so they cannot drift apart.
 * Columns are disclosed progressively: the identity and the headline number survive on a phone,
 * and the supporting columns appear as there is room for them.
 */
export const ROW_GRID =
  'grid items-center gap-x-3 px-3 ' +
  'grid-cols-[4.5rem_minmax(0,1fr)_5rem] ' +
  'sm:grid-cols-[5rem_minmax(0,1fr)_5rem_5.5rem] ' +
  'lg:grid-cols-[5rem_minmax(0,1fr)_5rem_5.5rem_5rem] ' +
  'xl:grid-cols-[5rem_minmax(0,1fr)_5rem_5.5rem_5rem_8rem_5.5rem]'

/** Cells that drop out as the viewport narrows, in the order they are sacrificed. */
export const CELL_USERS = 'hidden sm:block'
export const CELL_RATE = 'hidden lg:block'
export const CELL_WIDE = 'hidden xl:block'

export const NUMERIC_CELL = 'text-right tabular-nums'
