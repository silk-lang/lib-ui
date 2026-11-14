// The C side of ghostty-vt. Ghostty's tagged unions, sized structs and grid references stay
// here; Silk sees opaque handles, scalars and byte buffers. Nothing in this file needs a C
// library: memory comes from Ghostty's allocator, so the same file builds for wasm32.
#include "build/include/ghostty/vt.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

static void *take(size_t length) { return length ? ghostty_alloc(NULL, length) : NULL; }
static void give(void *bytes, size_t length) { if (bytes) ghostty_free(NULL, bytes, length); }
static void copy(void *to, const void *from, size_t length) { if (length) __builtin_memcpy(to, from, length); }
static void zero(void *to, size_t length) { if (length) __builtin_memset(to, 0, length); }

static uint32_t rgb(GhosttyColorRgb value) {
    return ((uint32_t)value.r << 16) | ((uint32_t)value.g << 8) | value.b;
}

#define TRY(call) do { result = (call); if (result != GHOSTTY_SUCCESS) goto done; } while (0)

// Snapshots. Every cell, its grapheme and each row's selection range are copied into memory
// the snapshot owns, so a snapshot outlives later writes and the terminal itself.

typedef struct {
    uint32_t foreground, background, flags, width;
    uint32_t text, length; // a range of the snapshot's text bytes
} SilkCell;

typedef struct {
    uint16_t cols, rows;
    GhosttyRenderStateCursor cursor;
    uint32_t foreground, background, cursorColor;
    bool hasCursorColor;
    SilkCell *cells;
    int32_t *selection; // two per row: first and last selected column, or -1, -1
    uint8_t *text;
    size_t textLength, textCapacity;
} SilkSnapshot;

void silk_ghostty_snapshot_free(SilkSnapshot *s) {
    if (!s) return;
    size_t count = (size_t)s->cols * s->rows;
    give(s->cells, count * sizeof(SilkCell));
    give(s->selection, (size_t)s->rows * 2 * sizeof(int32_t));
    give(s->text, s->textCapacity);
    give(s, sizeof(*s));
}

static bool reserve(SilkSnapshot *s, size_t extra) {
    if (s->textLength + extra <= s->textCapacity) return true;
    size_t capacity = s->textCapacity ? s->textCapacity * 2 : 4096;
    while (capacity < s->textLength + extra) capacity *= 2;
    uint8_t *bytes = take(capacity);
    if (!bytes) return false;
    copy(bytes, s->text, s->textLength);
    give(s->text, s->textCapacity);
    s->text = bytes;
    s->textCapacity = capacity;
    return true;
}

int32_t silk_ghostty_snapshot_new(GhosttyTerminal terminal, SilkSnapshot **out) {
    *out = NULL;
    GhosttyResult result = GHOSTTY_OUT_OF_MEMORY;
    GhosttyRenderState state = NULL;
    GhosttyRenderStateRowIterator rows = NULL;
    GhosttyRenderStateRowCells cells = NULL;
    SilkSnapshot *s = take(sizeof(*s));
    if (!s) return result;
    zero(s, sizeof(*s));
    TRY(ghostty_render_state_new(NULL, &state));
    TRY(ghostty_render_state_update(state, terminal));
    TRY(ghostty_render_state_get(state, GHOSTTY_RENDER_STATE_DATA_COLS, &s->cols));
    TRY(ghostty_render_state_get(state, GHOSTTY_RENDER_STATE_DATA_ROWS, &s->rows));
    s->cursor = (GhosttyRenderStateCursor)GHOSTTY_INIT_SIZED(GhosttyRenderStateCursor);
    TRY(ghostty_render_state_get(state, GHOSTTY_RENDER_STATE_DATA_CURSOR, &s->cursor));
    GhosttyRenderStateColors colors = GHOSTTY_INIT_SIZED(GhosttyRenderStateColors);
    TRY(ghostty_render_state_get(state, GHOSTTY_RENDER_STATE_DATA_COLORS, &colors));
    s->foreground = rgb(colors.foreground);
    s->background = rgb(colors.background);
    bool hasCursor = false;
    if (ghostty_render_state_get(state, GHOSTTY_RENDER_STATE_DATA_COLOR_CURSOR_HAS_VALUE, &hasCursor) == GHOSTTY_SUCCESS && hasCursor) {
        GhosttyColorRgb cursor;
        if (ghostty_render_state_get(state, GHOSTTY_RENDER_STATE_DATA_COLOR_CURSOR, &cursor) == GHOSTTY_SUCCESS) {
            s->cursorColor = rgb(cursor);
            s->hasCursorColor = true;
        }
    }
    size_t count = (size_t)s->cols * s->rows;
    s->cells = take(count * sizeof(SilkCell));
    s->selection = take((size_t)s->rows * 2 * sizeof(int32_t));
    if ((count && !s->cells) || (s->rows && !s->selection)) { result = GHOSTTY_OUT_OF_MEMORY; goto done; }
    zero(s->cells, count * sizeof(SilkCell));
    for (size_t i = 0; i < (size_t)s->rows * 2; ++i) s->selection[i] = -1;
    TRY(ghostty_render_state_row_iterator_new(NULL, &rows));
    TRY(ghostty_render_state_row_cells_new(NULL, &cells));
    TRY(ghostty_render_state_get(state, GHOSTTY_RENDER_STATE_DATA_ROW_ITERATOR, &rows));
    size_t y = 0;
    while (ghostty_render_state_row_iterator_next(rows) && y < s->rows) {
        GhosttyRenderStateRowSelection range = GHOSTTY_INIT_SIZED(GhosttyRenderStateRowSelection);
        result = ghostty_render_state_row_get(rows, GHOSTTY_RENDER_STATE_ROW_DATA_SELECTION, &range);
        if (result == GHOSTTY_SUCCESS) {
            s->selection[y * 2] = range.start_x;
            s->selection[y * 2 + 1] = range.end_x;
        } else if (result != GHOSTTY_NO_VALUE) goto done;
        TRY(ghostty_render_state_row_get(rows, GHOSTTY_RENDER_STATE_ROW_DATA_CELLS, &cells));
        size_t x = 0;
        while (ghostty_render_state_row_cells_next(cells) && x < s->cols) {
            SilkCell *cell = &s->cells[y * s->cols + x++];
            GhosttyCell raw;
            GhosttyCellWide wide;
            GhosttyStyle style;
            TRY(ghostty_render_state_row_cells_get(cells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_RAW, &raw));
            TRY(ghostty_cell_get(raw, GHOSTTY_CELL_DATA_WIDE, &wide));
            TRY(ghostty_render_state_row_cells_get(cells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_STYLE, &style));
            cell->flags = style.flags;
            cell->width = wide == GHOSTTY_CELL_WIDE_WIDE ? 2 : wide == GHOSTTY_CELL_WIDE_NARROW ? 1 : 0;
            GhosttyColorRgb fg = colors.foreground, bg = colors.background;
            result = ghostty_render_state_row_cells_get(cells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_FG_COLOR, &fg);
            if (result != GHOSTTY_SUCCESS && result != GHOSTTY_NO_VALUE) goto done;
            result = ghostty_render_state_row_cells_get(cells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_BG_COLOR, &bg);
            if (result != GHOSTTY_SUCCESS && result != GHOSTTY_NO_VALUE) goto done;
            cell->foreground = rgb(fg);
            cell->background = rgb(bg);
            GhosttyBuffer buffer = {0};
            if (!reserve(s, 16)) { result = GHOSTTY_OUT_OF_MEMORY; goto done; }
            buffer.ptr = s->text + s->textLength;
            buffer.cap = s->textCapacity - s->textLength;
            result = ghostty_render_state_row_cells_get(cells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_UTF8, &buffer);
            if (result == GHOSTTY_OUT_OF_SPACE) {
                if (!reserve(s, buffer.len)) { result = GHOSTTY_OUT_OF_MEMORY; goto done; }
                buffer.ptr = s->text + s->textLength;
                buffer.cap = s->textCapacity - s->textLength;
                TRY(ghostty_render_state_row_cells_get(cells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_UTF8, &buffer));
            } else if (result != GHOSTTY_SUCCESS) goto done;
            cell->text = (uint32_t)s->textLength;
            cell->length = (uint32_t)buffer.len;
            s->textLength += buffer.len;
        }
        ++y;
    }
    *out = s;
    s = NULL;
    result = GHOSTTY_SUCCESS;
done:
    ghostty_render_state_row_cells_free(cells);
    ghostty_render_state_row_iterator_free(rows);
    ghostty_render_state_free(state);
    silk_ghostty_snapshot_free(s);
    return result;
}

uint32_t silk_ghostty_snapshot_get(const SilkSnapshot *s, uint32_t field) {
    bool cursor = s->cursor.viewport_has_value;
    switch (field) {
        case 0: return s->cols;
        case 1: return s->rows;
        case 2: return cursor ? s->cursor.viewport_x : 0;
        case 3: return cursor ? s->cursor.viewport_y : 0;
        case 4: return cursor && s->cursor.visible;
        case 5: return s->foreground;
        case 6: return s->background;
        case 7: return s->hasCursorColor ? s->cursorColor : s->foreground;
        case 8: return (uint32_t)s->cursor.visual_style;
        case 9: return cursor && s->cursor.blinking;
        case 10: return cursor && s->cursor.wide_tail;
        default: return 0;
    }
}

uint32_t silk_ghostty_cell_get(const SilkSnapshot *s, size_t index, uint32_t field) {
    const SilkCell *c = &s->cells[index];
    switch (field) {
        case 0: return c->foreground;
        case 1: return c->background;
        case 2: return c->flags;
        case 3: return c->width;
        default: return 0;
    }
}

const uint8_t *silk_ghostty_cell_text(const SilkSnapshot *s, size_t index, size_t *length) {
    *length = s->cells[index].length;
    return s->cells[index].length ? s->text + s->cells[index].text : NULL;
}

int32_t silk_ghostty_row_selection(const SilkSnapshot *s, uint32_t row, uint32_t end) {
    return row < s->rows ? s->selection[row * 2 + (end ? 1 : 0)] : -1;
}

// Terminal state.

int32_t silk_ghostty_format(GhosttyTerminal terminal, uint8_t selected, uint8_t **out, size_t *length) {
    *out = NULL;
    *length = 0;
    GhosttySelection selection = {0};
    if (selected) {
        GhosttyResult found = ghostty_terminal_get(terminal, GHOSTTY_TERMINAL_DATA_SELECTION, &selection);
        if (found == GHOSTTY_NO_VALUE) return GHOSTTY_SUCCESS;
        if (found != GHOSTTY_SUCCESS) return found;
    }
    GhosttyFormatter formatter = NULL;
    GhosttyResult result = ghostty_formatter_terminal_new(NULL, &formatter, terminal);
    if (result != GHOSTTY_SUCCESS) return result;
    if (selected) result = ghostty_formatter_set(formatter, GHOSTTY_FORMATTER_OPT_SELECTION, &selection);
    if (result == GHOSTTY_SUCCESS) result = ghostty_formatter_format_alloc(formatter, NULL, out, length);
    ghostty_formatter_free(formatter);
    return result;
}

int32_t silk_ghostty_scroll(GhosttyTerminal terminal, int64_t delta, uint8_t mode) {
    GhosttyTerminalScrollViewport behavior = {0};
    behavior.tag = mode == 1 ? GHOSTTY_TERMINAL_SCROLL_VIEWPORT_BOTTOM
        : mode == 2 ? GHOSTTY_TERMINAL_SCROLL_VIEWPORT_TOP
        : GHOSTTY_TERMINAL_SCROLL_VIEWPORT_DELTA;
    behavior.value.delta = delta;
    return ghostty_terminal_scroll_viewport(terminal, behavior);
}

// 0 total rows, 1 offset of the viewport, 2 rows in the viewport.
uint64_t silk_ghostty_scrollbar(GhosttyTerminal terminal, uint32_t field) {
    GhosttyTerminalScrollbar bar = {0};
    if (ghostty_terminal_get(terminal, GHOSTTY_TERMINAL_DATA_SCROLLBAR, &bar) != GHOSTTY_SUCCESS) return 0;
    return field == 0 ? bar.total : field == 1 ? bar.offset : bar.len;
}

// 0 processing error, 1 mouse tracking, 2 alternate screen active, 3 bracketed paste,
// 4 focus reporting, 5 viewport at the bottom.
uint8_t silk_ghostty_flag(GhosttyTerminal terminal, uint32_t field) {
    bool value = false;
    GhosttyTerminalModeConfig mode = {0};
    switch (field) {
        case 0: ghostty_terminal_get(terminal, GHOSTTY_TERMINAL_DATA_VT_PROCESSING_ERROR, &value); break;
        case 1: ghostty_terminal_get(terminal, GHOSTTY_TERMINAL_DATA_MOUSE_TRACKING, &value); break;
        case 2: {
            GhosttyTerminalScreen screen = GHOSTTY_TERMINAL_SCREEN_PRIMARY;
            ghostty_terminal_get(terminal, GHOSTTY_TERMINAL_DATA_ACTIVE_SCREEN, &screen);
            value = screen != GHOSTTY_TERMINAL_SCREEN_PRIMARY;
            break;
        }
        case 3: mode.mode = GHOSTTY_MODE_BRACKETED_PASTE; ghostty_terminal_get(terminal, GHOSTTY_TERMINAL_DATA_MODE, &mode); value = mode.value; break;
        case 4: mode.mode = GHOSTTY_MODE_FOCUS_EVENT; ghostty_terminal_get(terminal, GHOSTTY_TERMINAL_DATA_MODE, &mode); value = mode.value; break;
        case 5: ghostty_terminal_get(terminal, GHOSTTY_TERMINAL_DATA_VIEWPORT_ACTIVE, &value); break;
        default: break;
    }
    return value;
}

// The title the program set (OSC 0 or 2), borrowed until the next write.
const uint8_t *silk_ghostty_title(GhosttyTerminal terminal, size_t *length) {
    GhosttyString title = {0};
    *length = 0;
    if (ghostty_terminal_get(terminal, GHOSTTY_TERMINAL_DATA_TITLE, &title) != GHOSTTY_SUCCESS) return NULL;
    *length = title.len;
    return title.ptr;
}

int32_t silk_ghostty_focus(GhosttyTerminal terminal, uint8_t focused, uint8_t *output, size_t capacity, size_t *written) {
    *written = 0;
    if (!silk_ghostty_flag(terminal, 4)) return GHOSTTY_SUCCESS;
    return ghostty_focus_encode(focused ? GHOSTTY_FOCUS_GAINED : GHOSTTY_FOCUS_LOST, output, capacity, written);
}
