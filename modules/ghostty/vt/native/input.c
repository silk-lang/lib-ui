// Input for a terminal: key, paste and mouse encoding, pointer selection gestures, and a
// bounded queue of the replies the terminal generates for the program. All of this state is
// owned by one `SilkInput` per terminal; no Silk callback crosses into Ghostty.
#include <ghostty/vt.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

static void *take(size_t length) { return length ? ghostty_alloc(NULL, length) : NULL; }
static void give(void *bytes, size_t length) { if (bytes) ghostty_free(NULL, bytes, length); }

#define REPLY_LIMIT 1048576

typedef struct {
    GhosttyKeyEncoder keys;
    GhosttyKeyEvent key;
    GhosttyMouseEncoder mice;
    GhosttyMouseEvent mouse;
    GhosttySelectionGesture gesture;
    GhosttySelectionGestureEvent press, drag, release, tick;
    uint8_t *replies;
    size_t length, capacity;
    GhosttyResult error;
} SilkInput;

static void reply(GhosttyTerminal terminal, void *userdata, const uint8_t *data, size_t length) {
    (void)terminal;
    SilkInput *io = userdata;
    if (io->error || !length) return;
    if (length > REPLY_LIMIT - io->length) { io->error = GHOSTTY_LIMIT_EXCEEDED; return; }
    size_t needed = io->length + length;
    if (needed > io->capacity) {
        size_t capacity = needed > io->capacity * 2 ? needed : io->capacity * 2;
        uint8_t *buffer = take(capacity);
        if (!buffer) { io->error = GHOSTTY_OUT_OF_MEMORY; return; }
        if (io->length) __builtin_memcpy(buffer, io->replies, io->length);
        give(io->replies, io->capacity);
        io->replies = buffer;
        io->capacity = capacity;
    }
    __builtin_memcpy(io->replies + io->length, data, length);
    io->length = needed;
}

void silk_ghostty_input_free(GhosttyTerminal terminal, SilkInput *io) {
    if (!io) return;
    ghostty_key_encoder_free(io->keys);
    ghostty_key_event_free(io->key);
    ghostty_mouse_encoder_free(io->mice);
    ghostty_mouse_event_free(io->mouse);
    ghostty_selection_gesture_event_free(io->press);
    ghostty_selection_gesture_event_free(io->drag);
    ghostty_selection_gesture_event_free(io->release);
    ghostty_selection_gesture_event_free(io->tick);
    if (io->gesture) ghostty_selection_gesture_free(io->gesture, terminal);
    give(io->replies, io->capacity);
    give(io, sizeof(*io));
}

int32_t silk_ghostty_input_new(GhosttyTerminal terminal, SilkInput **out) {
    *out = NULL;
    SilkInput *io = take(sizeof(*io));
    if (!io) return GHOSTTY_OUT_OF_MEMORY;
    __builtin_memset(io, 0, sizeof(*io));
    GhosttyResult result = ghostty_key_encoder_new(NULL, &io->keys);
    if (!result) result = ghostty_key_event_new(NULL, &io->key);
    if (!result) result = ghostty_mouse_encoder_new(NULL, &io->mice);
    if (!result) result = ghostty_mouse_event_new(NULL, &io->mouse);
    if (!result) result = ghostty_selection_gesture_new(NULL, &io->gesture);
    if (!result) result = ghostty_selection_gesture_event_new(NULL, &io->press, GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_PRESS);
    if (!result) result = ghostty_selection_gesture_event_new(NULL, &io->drag, GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_DRAG);
    if (!result) result = ghostty_selection_gesture_event_new(NULL, &io->release, GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_RELEASE);
    if (!result) result = ghostty_selection_gesture_event_new(NULL, &io->tick, GHOSTTY_SELECTION_GESTURE_EVENT_TYPE_AUTOSCROLL_TICK);
    if (!result) {
        // Repeat clicks within half a second and a few pixels count, as on most desktops.
        double distance = 8.0;
        uint64_t interval = 500000000;
        result = ghostty_selection_gesture_event_set(io->press, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REPEAT_DISTANCE, &distance);
        if (!result) result = ghostty_selection_gesture_event_set(io->press, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REPEAT_INTERVAL_NS, &interval);
    }
    if (!result) result = ghostty_terminal_set(terminal, GHOSTTY_TERMINAL_OPT_USERDATA, io);
    if (!result) result = ghostty_terminal_set(terminal, GHOSTTY_TERMINAL_OPT_WRITE_PTY, (const void *)reply);
    if (result) { silk_ghostty_input_free(terminal, io); return result; }
    *out = io;
    return GHOSTTY_SUCCESS;
}

int32_t silk_ghostty_replies(SilkInput *io, uint8_t *output, size_t capacity, size_t *written) {
    *written = 0;
    if (io->error) return io->error;
    size_t count = io->length < capacity ? io->length : capacity;
    if (count) {
        __builtin_memcpy(output, io->replies, count);
        io->length -= count;
        if (io->length) __builtin_memmove(io->replies, io->replies + count, io->length);
    }
    *written = count;
    return GHOSTTY_SUCCESS;
}

// Keys.

static bool same(const uint8_t *a, size_t length, const char *b) {
    size_t i = 0;
    for (; i < length; ++i) if (!b[i] || (uint8_t)b[i] != a[i]) return false;
    return b[i] == 0;
}

static GhosttyKey keycode(const uint8_t *name, size_t length) {
#define KEY(text, code) if (same(name, length, text)) return GHOSTTY_KEY_##code
    KEY("Enter", ENTER); KEY("Tab", TAB); KEY("Backspace", BACKSPACE);
    KEY("Escape", ESCAPE); KEY("Delete", DELETE); KEY("Insert", INSERT);
    KEY("Home", HOME); KEY("End", END); KEY("PageUp", PAGE_UP); KEY("PageDown", PAGE_DOWN);
    KEY("ArrowUp", ARROW_UP); KEY("ArrowDown", ARROW_DOWN);
    KEY("ArrowLeft", ARROW_LEFT); KEY("ArrowRight", ARROW_RIGHT);
    KEY(" ", SPACE); KEY("[", BRACKET_LEFT); KEY("]", BRACKET_RIGHT);
    KEY("\\", BACKSLASH); KEY("/", SLASH); KEY("-", MINUS); KEY("=", EQUAL);
    KEY("`", BACKQUOTE); KEY(";", SEMICOLON); KEY("'", QUOTE);
    KEY(",", COMMA); KEY(".", PERIOD);
#undef KEY
    if (length == 1) {
        uint8_t c = name[0];
        if (c >= 'A' && c <= 'Z') c += 'a' - 'A';
        if (c >= 'a' && c <= 'z') return GHOSTTY_KEY_A + c - 'a';
        if (c >= '0' && c <= '9') return GHOSTTY_KEY_DIGIT_0 + c - '0';
    }
    if (length >= 2 && length <= 3 && name[0] == 'F') {
        unsigned n = 0;
        for (size_t i = 1; i < length; ++i) {
            if (name[i] < '0' || name[i] > '9') return GHOSTTY_KEY_UNIDENTIFIED;
            n = n * 10 + name[i] - '0';
        }
        if (n >= 1 && n <= 25) return GHOSTTY_KEY_F1 + n - 1;
    }
    return GHOSTTY_KEY_UNIDENTIFIED;
}

int32_t silk_ghostty_key(GhosttyTerminal terminal, SilkInput *io,
        const uint8_t *name, size_t length, uint32_t mods,
        uint8_t *output, size_t capacity, size_t *written) {
    *written = 0;
    GhosttyResult result = ghostty_key_encoder_set_from_terminal(io->keys, terminal);
    if (result) return result;
    GhosttyKey key = keycode(name, length);
    bool text = length == 1 || key == GHOSTTY_KEY_UNIDENTIFIED;
    ghostty_key_event_set_action(io->key, GHOSTTY_KEY_ACTION_PRESS);
    ghostty_key_event_set_key(io->key, key);
    ghostty_key_event_set_mods(io->key, (GhosttyMods)(mods & 31));
    ghostty_key_event_set_consumed_mods(io->key, 0);
    ghostty_key_event_set_unshifted_codepoint(io->key,
        length == 1 ? (name[0] >= 'A' && name[0] <= 'Z' ? name[0] + 32 : name[0]) : 0);
    ghostty_key_event_set_utf8(io->key, text ? (GhosttyString){.ptr = name, .len = length} : (GhosttyString){0});
    result = ghostty_key_encoder_encode(io->keys, io->key, output, capacity, written);
    // The event borrows the caller's text only for this call.
    ghostty_key_event_set_utf8(io->key, (GhosttyString){0});
    return result;
}

int32_t silk_ghostty_paste(GhosttyTerminal terminal, const uint8_t *text, size_t length,
        uint8_t *output, size_t capacity, size_t *written) {
    *written = 0;
    GhosttyTerminalModeConfig mode = {.mode = GHOSTTY_MODE_BRACKETED_PASTE};
    GhosttyResult result = ghostty_terminal_get(terminal, GHOSTTY_TERMINAL_DATA_MODE, &mode);
    if (result) return result;
    // The encoder sanitizes in place, so it works on a copy of the caller's text.
    char *scratch = take(length);
    if (length && !scratch) return GHOSTTY_OUT_OF_MEMORY;
    if (length) __builtin_memcpy(scratch, text, length);
    result = ghostty_paste_encode(scratch, length, mode.value, output, capacity, written);
    give(scratch, length);
    return result;
}

// Mouse reports, for programs that turned mouse tracking on. `action` is 0 press, 1 release,
// 2 motion; `button` is 0 none, 1 left, 2 right, 3 middle, 4 and 5 wheel up and down.
int32_t silk_ghostty_mouse(GhosttyTerminal terminal, SilkInput *io,
        uint32_t action, uint32_t button, uint32_t mods, uint8_t pressed,
        float x, float y, uint32_t width, uint32_t height, uint32_t cellWidth, uint32_t cellHeight,
        uint8_t *output, size_t capacity, size_t *written) {
    *written = 0;
    GhosttyResult result = ghostty_mouse_encoder_set_from_terminal(io->mice, terminal);
    if (result) return result;
    GhosttyMouseEncoderSize size = GHOSTTY_INIT_SIZED(GhosttyMouseEncoderSize);
    size.screen_width = width;
    size.screen_height = height;
    size.cell_width = cellWidth ? cellWidth : 1;
    size.cell_height = cellHeight ? cellHeight : 1;
    bool any = pressed != 0, track = true;
    ghostty_mouse_encoder_set(io->mice, GHOSTTY_MOUSE_ENCODER_OPT_SIZE, &size);
    ghostty_mouse_encoder_set(io->mice, GHOSTTY_MOUSE_ENCODER_OPT_ANY_BUTTON_PRESSED, &any);
    ghostty_mouse_encoder_set(io->mice, GHOSTTY_MOUSE_ENCODER_OPT_TRACK_LAST_CELL, &track);
    ghostty_mouse_event_set_action(io->mouse,
        action == 0 ? GHOSTTY_MOUSE_ACTION_PRESS : action == 1 ? GHOSTTY_MOUSE_ACTION_RELEASE : GHOSTTY_MOUSE_ACTION_MOTION);
    if (button) ghostty_mouse_event_set_button(io->mouse, (GhosttyMouseButton)button);
    else ghostty_mouse_event_clear_button(io->mouse);
    ghostty_mouse_event_set_mods(io->mouse, (GhosttyMods)(mods & 31));
    ghostty_mouse_event_set_position(io->mouse, (GhosttyMousePosition){.x = x, .y = y});
    return ghostty_mouse_encoder_encode(io->mice, io->mouse, output, capacity, written);
}

// Selection gestures. Coordinates are viewport cells; `x` and `y` are pixels from the top
// left of the cell grid. Each call installs what the gesture selects as the terminal's
// selection, so snapshots and `silk_ghostty_format` see it.

static GhosttyResult viewportRef(GhosttyTerminal terminal, uint32_t column, uint32_t row, GhosttyGridRef *ref) {
    GhosttyPoint point = {.tag = GHOSTTY_POINT_TAG_VIEWPORT};
    point.value.coordinate.x = (uint16_t)column;
    point.value.coordinate.y = row;
    return ghostty_terminal_grid_ref(terminal, point, ref);
}

static int32_t apply(GhosttyTerminal terminal, SilkInput *io, GhosttySelectionGestureEvent event, uint8_t clearOnNone) {
    GhosttySelection selection = {0};
    GhosttyResult result = ghostty_selection_gesture_event(io->gesture, terminal, event, &selection);
    if (result == GHOSTTY_SUCCESS) return ghostty_terminal_set(terminal, GHOSTTY_TERMINAL_OPT_SELECTION, &selection);
    if (result == GHOSTTY_NO_VALUE) {
        return clearOnNone ? ghostty_terminal_set(terminal, GHOSTTY_TERMINAL_OPT_SELECTION, NULL) : GHOSTTY_SUCCESS;
    }
    return result;
}

static void geometry(SilkInput *io, GhosttySelectionGestureEvent event, uint32_t columns, uint32_t cellWidth, uint32_t height, uint8_t rectangle) {
    GhosttySelectionGestureGeometry shape = {.columns = columns, .cell_width = cellWidth ? cellWidth : 1, .padding_left = 0, .screen_height = height};
    bool block = rectangle != 0;
    (void)io;
    ghostty_selection_gesture_event_set(event, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_GEOMETRY, &shape);
    ghostty_selection_gesture_event_set(event, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_RECTANGLE, &block);
}

int32_t silk_ghostty_select_press(GhosttyTerminal terminal, SilkInput *io,
        uint32_t column, uint32_t row, double x, double y, uint64_t timeNs) {
    GhosttyGridRef ref = {0};
    GhosttyResult result = viewportRef(terminal, column, row, &ref);
    if (result) return result;
    GhosttySurfacePosition position = {.x = x, .y = y};
    ghostty_selection_gesture_event_set(io->press, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REF, &ref);
    ghostty_selection_gesture_event_set(io->press, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_POSITION, &position);
    ghostty_selection_gesture_event_set(io->press, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_TIME_NS, &timeNs);
    return apply(terminal, io, io->press, 1);
}

int32_t silk_ghostty_select_drag(GhosttyTerminal terminal, SilkInput *io,
        uint32_t column, uint32_t row, double x, double y,
        uint32_t columns, uint32_t cellWidth, uint32_t height, uint8_t rectangle) {
    GhosttyGridRef ref = {0};
    GhosttyResult result = viewportRef(terminal, column, row, &ref);
    if (result) return result;
    GhosttySurfacePosition position = {.x = x, .y = y};
    ghostty_selection_gesture_event_set(io->drag, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REF, &ref);
    ghostty_selection_gesture_event_set(io->drag, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_POSITION, &position);
    geometry(io, io->drag, columns, cellWidth, height, rectangle);
    return apply(terminal, io, io->drag, 0);
}

int32_t silk_ghostty_select_release(GhosttyTerminal terminal, SilkInput *io) {
    ghostty_selection_gesture_event_set(io->release, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_REF, NULL);
    GhosttySelection selection = {0};
    GhosttyResult result = ghostty_selection_gesture_event(io->gesture, terminal, io->release, &selection);
    return result == GHOSTTY_NO_VALUE ? GHOSTTY_SUCCESS : result;
}

// Which way a drag beyond the grid asks to scroll: 0 none, 1 up, 2 down.
uint32_t silk_ghostty_select_autoscroll(GhosttyTerminal terminal, SilkInput *io) {
    GhosttySelectionGestureAutoscroll autoscroll = GHOSTTY_SELECTION_GESTURE_AUTOSCROLL_NONE;
    if (ghostty_selection_gesture_get(io->gesture, terminal, GHOSTTY_SELECTION_GESTURE_DATA_AUTOSCROLL, &autoscroll)) return 0;
    return autoscroll == GHOSTTY_SELECTION_GESTURE_AUTOSCROLL_UP ? 1 : autoscroll == GHOSTTY_SELECTION_GESTURE_AUTOSCROLL_DOWN ? 2 : 0;
}

// Scrolls one row the way the drag asks and extends the selection there.
int32_t silk_ghostty_select_tick(GhosttyTerminal terminal, SilkInput *io,
        uint32_t column, uint32_t row, double x, double y,
        uint32_t columns, uint32_t cellWidth, uint32_t height, uint8_t rectangle) {
    GhosttyPointCoordinate at = {.x = (uint16_t)column, .y = row};
    GhosttySurfacePosition position = {.x = x, .y = y};
    ghostty_selection_gesture_event_set(io->tick, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_VIEWPORT, &at);
    ghostty_selection_gesture_event_set(io->tick, GHOSTTY_SELECTION_GESTURE_EVENT_OPT_POSITION, &position);
    geometry(io, io->tick, columns, cellWidth, height, rectangle);
    return apply(terminal, io, io->tick, 0);
}

// 0 clears the selection, 1 selects everything, 2 the word at the cell, 3 its line.
int32_t silk_ghostty_select(GhosttyTerminal terminal, SilkInput *io, uint32_t what, uint32_t column, uint32_t row) {
    GhosttySelection selection = {0};
    GhosttyResult result = GHOSTTY_SUCCESS;
    if (what == 0) {
        ghostty_selection_gesture_reset(io->gesture, terminal);
        return ghostty_terminal_set(terminal, GHOSTTY_TERMINAL_OPT_SELECTION, NULL);
    }
    if (what == 1) {
        result = ghostty_terminal_select_all(terminal, &selection);
    } else {
        GhosttyGridRef ref = {0};
        result = viewportRef(terminal, column, row, &ref);
        if (result) return result;
        if (what == 2) {
            GhosttyTerminalSelectWordOptions word = GHOSTTY_INIT_SIZED(GhosttyTerminalSelectWordOptions);
            word.ref = ref;
            result = ghostty_terminal_select_word(terminal, &word, &selection);
        } else {
            GhosttyTerminalSelectLineOptions line = GHOSTTY_INIT_SIZED(GhosttyTerminalSelectLineOptions);
            line.ref = ref;
            line.semantic_prompt_boundary = true;
            result = ghostty_terminal_select_line(terminal, &line, &selection);
        }
    }
    if (result == GHOSTTY_NO_VALUE) return ghostty_terminal_set(terminal, GHOSTTY_TERMINAL_OPT_SELECTION, NULL);
    if (result) return result;
    return ghostty_terminal_set(terminal, GHOSTTY_TERMINAL_OPT_SELECTION, &selection);
}

uint8_t silk_ghostty_has_selection(GhosttyTerminal terminal) {
    GhosttySelection selection = {0};
    return ghostty_terminal_get(terminal, GHOSTTY_TERMINAL_DATA_SELECTION, &selection) == GHOSTTY_SUCCESS;
}
