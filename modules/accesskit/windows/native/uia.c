// The UI Automation side of AccessKit's Windows adapter in Silk.
//
// Ported from AccessKit (`accesskit_windows`), Copyright 2022 The AccessKit Authors, under the
// MIT or Apache-2.0 license. AccessKit's providers ask the tree on every call; here the Silk side
// sends one record per element (see `src/record.silk` for the layout) and these providers answer
// from the records. The Win32 and COM declarations are written out below, since no Windows SDK
// headers reach clang in Silk builds.
//
// UI Automation calls the providers from its own threads (they are server-side providers without
// COM threading, as AccessKit's are), so every adapter has a lock. Nothing that can wait on the
// window's thread, such as raising an event or asking UI Automation for the window's host
// provider, runs while the lock is held.

#include <stddef.h>
#include <stdint.h>

// ---------------------------------------------------------------------------------------------
// Win32 and COM declarations.

typedef long HRESULT;
typedef int BOOL;
typedef unsigned short WCHAR;
typedef WCHAR *BSTR;
typedef void *HWND;
typedef void *HINSTANCE;
typedef unsigned int UINT;
typedef uint64_t WPARAM;
typedef int64_t LPARAM;
typedef int64_t LRESULT;
typedef int64_t LONG_PTR;
typedef void *SAFEARRAY;
typedef unsigned short VARTYPE;
typedef LRESULT (*WNDPROC)(HWND, UINT, WPARAM, LPARAM);

typedef struct {
    uint32_t data1;
    uint16_t data2;
    uint16_t data3;
    uint8_t data4[8];
} GUID;

typedef struct {
    VARTYPE vt;
    uint16_t reserved1, reserved2, reserved3;
    union {
        int64_t llVal;
        long lVal;
        double dblVal;
        short boolVal;
        BSTR bstrVal;
        void *punkVal;
        SAFEARRAY *parray;
        struct {
            void *a, *b;
        } record;
    } u;
} VARIANT;

_Static_assert(sizeof(VARIANT) == 24, "VARIANT is 24 bytes on 64-bit Windows");

typedef struct {
    double left, top, width, height;
} UiaRect;

typedef struct {
    double x, y;
} UiaPoint;

typedef struct {
    long x, y;
} POINT;

typedef struct {
    void *ptr;
} SRWLOCK;

typedef struct {
    UINT style;
    WNDPROC proc;
    int classExtra;
    int windowExtra;
    HINSTANCE instance;
    void *icon;
    void *cursor;
    void *background;
    const WCHAR *menuName;
    const WCHAR *className;
} WNDCLASSW;

#define S_OK ((HRESULT)0)
#define E_NOTIMPL ((HRESULT)0x80004001L)
#define E_NOINTERFACE ((HRESULT)0x80004002L)
#define E_POINTER ((HRESULT)0x80004003L)
#define E_FAIL ((HRESULT)0x80004005L)
#define E_OUTOFMEMORY ((HRESULT)0x8007000EL)
#define E_INVALIDARG ((HRESULT)0x80070057L)
#define UIA_E_ELEMENTNOTENABLED ((HRESULT)0x80040200L)
#define UIA_E_ELEMENTNOTAVAILABLE ((HRESULT)0x80040201L)
#define UIA_E_NOTSUPPORTED ((HRESULT)0x80040204L)
#define UIA_E_INVALIDOPERATION ((HRESULT)0x80131509L)

#define VT_EMPTY 0
#define VT_I4 3
#define VT_R8 5
#define VT_BSTR 8
#define VT_BOOL 11
#define VT_UNKNOWN 13
#define VT_ARRAY 0x2000

#define WM_NULL 0x0000
#define WM_GETOBJECT 0x003D
#define WM_NCDESTROY 0x0082
#define GWLP_WNDPROC (-4)
#define UIA_ROOT_OBJECT_ID (-25)
#define HEAP_ZERO_MEMORY 0x00000008
#define LOCALE_ALLOW_NEUTRAL_NAMES 0x08000000
#define WS_OVERLAPPEDWINDOW 0x00CF0000
#define CW_USEDEFAULT ((int)0x80000000)

void *GetProcessHeap(void);
void *HeapAlloc(void *heap, uint32_t flags, size_t size);
BOOL HeapFree(void *heap, uint32_t flags, void *memory);
// The Silk toolchain links only the few kernel32 functions its runtime uses, so this file
// avoids the others: a spin lock stands in for SRW locks, `__ImageBase` for
// `GetModuleHandleW(NULL)`, and a table for `LocaleNameToLCID`.
extern char __ImageBase;

static void AcquireSRWLockExclusive(SRWLOCK *lock) {
    while (__atomic_exchange_n((volatile long *)&lock->ptr, 1, __ATOMIC_ACQUIRE)) {
        while (__atomic_load_n((volatile long *)&lock->ptr, __ATOMIC_RELAXED)) __builtin_ia32_pause();
    }
}

static void ReleaseSRWLockExclusive(SRWLOCK *lock) {
    __atomic_store_n((volatile long *)&lock->ptr, 0, __ATOMIC_RELEASE);
}

// The LCID of BCP 47 tag `name` (UTF-16): its language with the default region, or the
// region given for a few common pairs; 0 when unknown.
static int LocaleNameToLCID(const WCHAR *name, uint32_t flags) {
    (void)flags;
    static const struct { char tag[8]; int lcid; } table[] = {
        {"en-gb", 0x0809}, {"en-au", 0x0c09}, {"en-ca", 0x1009}, {"pt-pt", 0x0816},
        {"zh-cn", 0x0804}, {"zh-hans", 0x0804}, {"zh-sg", 0x1004}, {"zh-hk", 0x0c04},
        {"fr-ca", 0x0c0c}, {"es-mx", 0x080a}, {"de-at", 0x0c07}, {"de-ch", 0x0807},
        {"en", 0x0409}, {"fr", 0x040c}, {"de", 0x0407}, {"es", 0x0c0a}, {"it", 0x0410},
        {"pt", 0x0416}, {"nl", 0x0413}, {"sv", 0x041d}, {"da", 0x0406}, {"nb", 0x0414},
        {"no", 0x0414}, {"nn", 0x0814}, {"fi", 0x040b}, {"pl", 0x0415}, {"cs", 0x0405},
        {"sk", 0x041b}, {"hu", 0x040e}, {"ro", 0x0418}, {"ru", 0x0419}, {"uk", 0x0422},
        {"el", 0x0408}, {"tr", 0x041f}, {"he", 0x040d}, {"ar", 0x0401}, {"fa", 0x0429},
        {"hi", 0x0439}, {"th", 0x041e}, {"vi", 0x042a}, {"id", 0x0421}, {"ms", 0x043e},
        {"zh", 0x0404}, {"ja", 0x0411}, {"ko", 0x0412}, {"bg", 0x0402}, {"hr", 0x041a},
        {"sr", 0x081a}, {"sl", 0x0424}, {"lt", 0x0427}, {"lv", 0x0426}, {"et", 0x0425},
        {"ca", 0x0403}, {"eu", 0x042d}, {"gl", 0x0456}, {"is", 0x040f}, {"ga", 0x083c},
        {"cy", 0x0452}, {"af", 0x0436}, {"sw", 0x0441}, {"bn", 0x0445}, {"ta", 0x0449},
        {"te", 0x044a}, {"mr", 0x044e}, {"ur", 0x0420}, {"ka", 0x0437}, {"hy", 0x042b},
        {"kk", 0x043f}, {"uz", 0x0443}, {"az", 0x042c}, {"mk", 0x042f}, {"sq", 0x041c},
    };
    char lower[16];
    size_t n = 0;
    while (name[n] && n < sizeof lower - 1) {
        WCHAR c = name[n];
        if (c >= 'A' && c <= 'Z') c = (WCHAR)(c - 'A' + 'a');
        if (c == '_') c = '-';
        if (c > 127) return 0;
        lower[n++] = (char)c;
    }
    lower[n] = 0;
    // The longest entry that is the tag or a prefix of it ending at a '-'.
    for (size_t pass = 0; pass < 2; pass++) {
        for (size_t i = 0; i < sizeof table / sizeof table[0]; i++) {
            const char *tag = table[i].tag;
            size_t k = 0;
            while (tag[k] && tag[k] == lower[k]) k++;
            if (tag[k]) continue;
            int whole = lower[k] == 0;
            if ((pass == 0 && whole) || (pass == 1 && lower[k] == '-')) return table[i].lcid;
        }
    }
    return 0;
}

LONG_PTR SetWindowLongPtrW(HWND hwnd, int index, LONG_PTR value);
LONG_PTR GetWindowLongPtrW(HWND hwnd, int index);
LRESULT CallWindowProcW(WNDPROC proc, HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);
LRESULT DefWindowProcW(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);
LRESULT SendMessageW(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);
BOOL PostMessageW(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);
BOOL ClientToScreen(HWND hwnd, POINT *point);
int InternalGetWindowText(HWND hwnd, WCHAR *text, int capacity);
uint16_t RegisterClassW(const WNDCLASSW *windowClass);
HWND CreateWindowExW(uint32_t exStyle, const WCHAR *className, const WCHAR *title, uint32_t style,
                     int x, int y, int width, int height, HWND parent, void *menu,
                     HINSTANCE instance, void *parameter);
BOOL DestroyWindow(HWND hwnd);

BSTR SysAllocStringLen(const WCHAR *text, UINT length);
void SysFreeString(BSTR text);
SAFEARRAY *SafeArrayCreateVector(VARTYPE vt, long lowerBound, unsigned long count);
HRESULT SafeArrayPutElement(SAFEARRAY *array, long *indices, void *value);
HRESULT SafeArrayGetElement(SAFEARRAY *array, long *indices, void *value);
HRESULT SafeArrayGetUBound(SAFEARRAY *array, UINT dimension, long *bound);
HRESULT SafeArrayDestroy(SAFEARRAY *array);
HRESULT VariantClear(VARIANT *value);

LRESULT UiaReturnRawElementProvider(HWND hwnd, WPARAM wParam, LPARAM lParam, void *provider);
HRESULT UiaHostProviderFromHwnd(HWND hwnd, void **provider);
HRESULT UiaRaiseAutomationEvent(void *provider, int eventId);
HRESULT UiaRaiseAutomationPropertyChangedEvent(void *provider, int propertyId, VARIANT oldValue,
                                               VARIANT newValue);
BOOL UiaClientsAreListening(void);
HRESULT UiaGetReservedNotSupportedValue(void **value);
HRESULT UiaGetReservedMixedAttributeValue(void **value);
HRESULT UiaDisconnectProvider(void *provider);

void *memcpy(void *destination, const void *source, size_t count);

static const GUID IID_IUnknown = {0x00000000, 0x0000, 0x0000, {0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46}};
static const GUID IID_Simple = {0xd6dd68d1, 0x86fd, 0x4332, {0x86, 0x66, 0x9a, 0xbe, 0xde, 0xa2, 0xd2, 0x4c}};
static const GUID IID_Fragment = {0xf7063da8, 0x8359, 0x439c, {0x92, 0x97, 0xbb, 0xc5, 0x29, 0x9a, 0x7d, 0x87}};
static const GUID IID_FragmentRoot = {0x620ce2a5, 0xab8f, 0x40a9, {0x86, 0xcb, 0xde, 0x3c, 0x75, 0x59, 0x9b, 0x58}};
static const GUID IID_Toggle = {0x56d00bd0, 0xc4f4, 0x433c, {0xa8, 0x36, 0x1a, 0x52, 0xa5, 0x7e, 0x08, 0x92}};
static const GUID IID_Invoke = {0x54fcb24b, 0xe18e, 0x47a2, {0xb4, 0xd3, 0xec, 0xcb, 0xe7, 0x75, 0x99, 0xa2}};
static const GUID IID_Value = {0xc7935180, 0x6fb3, 0x4201, {0xb1, 0x74, 0x7d, 0xf7, 0x3a, 0xdb, 0xf6, 0x4a}};
static const GUID IID_RangeValue = {0x36dc7aef, 0x33e6, 0x4691, {0xaf, 0xe1, 0x2b, 0xe7, 0x27, 0x4b, 0x3d, 0x33}};
static const GUID IID_ScrollItem = {0x2360c714, 0x4bf1, 0x4b26, {0xba, 0x65, 0x9b, 0x21, 0x31, 0x61, 0x27, 0xeb}};
static const GUID IID_SelectionItem = {0x2acad808, 0xb2d4, 0x452d, {0xa4, 0x07, 0x91, 0xff, 0x1a, 0xd1, 0x67, 0xb2}};
static const GUID IID_Selection = {0xfb8b03af, 0x3bdf, 0x48d4, {0xbd, 0x36, 0x1a, 0x65, 0x79, 0x3b, 0xe1, 0x68}};
static const GUID IID_Text = {0x3589c92c, 0x63f3, 0x4367, {0x99, 0xbb, 0xad, 0xa6, 0x53, 0xb7, 0x7c, 0xf2}};
static const GUID IID_ExpandCollapse = {0xd847d3a5, 0xcab0, 0x4a98, {0x8c, 0x32, 0xec, 0xb4, 0x5c, 0x59, 0xad, 0x24}};
static const GUID IID_Window = {0x987df77b, 0xdb06, 0x4d77, {0x8f, 0x8a, 0x86, 0xa9, 0xc3, 0xbb, 0x90, 0xb9}};
static const GUID IID_TextRange = {0x5347ad7b, 0xc355, 0x46f8, {0xaf, 0xf5, 0x90, 0x90, 0x33, 0x58, 0x2f, 0x63}};

// ---------------------------------------------------------------------------------------------
// The record layout (see src/record.silk).

enum {
    TAG_PROPERTY = 1,
    TAG_PATTERNS = 2,
    TAG_BOUNDS = 3,
    TAG_PARENT = 4,
    TAG_CHILDREN = 5,
    TAG_SELECTION_CONTAINER = 6,
    TAG_SELECTED = 7,
    TAG_CONTROLS = 8,
    TAG_FLAGS = 9,
    TAG_TEXT = 10,
};

enum {
    PATTERN_TOGGLE = 1,
    PATTERN_INVOKE = 2,
    PATTERN_VALUE = 4,
    PATTERN_RANGE_VALUE = 8,
    PATTERN_SCROLL_ITEM = 16,
    PATTERN_SELECTION_ITEM = 32,
    PATTERN_SELECTION = 64,
    PATTERN_TEXT = 128,
    PATTERN_EXPAND_COLLAPSE = 256,
    PATTERN_WINDOW = 512,
};

enum {
    FLAG_ROOT = 1,
    FLAG_HAS_PARENT = 2,
    FLAG_HAS_BOUNDS = 4,
    FLAG_DISABLED = 8,
    FLAG_FOCUSABLE = 16,
    FLAG_EXPANDED = 32,
    FLAG_COLLAPSED = 64,
    FLAG_SELECTED = 128,
    FLAG_READ_ONLY = 256,
};

// The action kinds of src/adapter.silk.
enum {
    ACTION_CLICK = 1,
    ACTION_FOCUS = 2,
    ACTION_EXPAND = 3,
    ACTION_COLLAPSE = 4,
    ACTION_SET_TEXT = 5,
    ACTION_SET_NUMBER = 6,
    ACTION_SET_SELECTION = 7,
    ACTION_SCROLL_INTO_VIEW = 8,
    ACTION_SCROLL_TEXT = 9,
};

enum {
    PROPERTY_NAME = 30005,
    PROPERTY_CONTROL_TYPE = 30003,
    PROPERTY_HAS_KEYBOARD_FOCUS = 30008,
    PROPERTY_CULTURE = 30015,
    PROPERTY_NATIVE_WINDOW_HANDLE = 30020,
    PROPERTY_FRAMEWORK_ID = 30024,
    PROPERTY_VALUE_VALUE = 30045,
    PROPERTY_VALUE_IS_READ_ONLY = 30046,
    PROPERTY_RANGE_VALUE = 30047,
    PROPERTY_RANGE_IS_READ_ONLY = 30048,
    PROPERTY_RANGE_MINIMUM = 30049,
    PROPERTY_RANGE_MAXIMUM = 30050,
    PROPERTY_RANGE_LARGE_CHANGE = 30051,
    PROPERTY_RANGE_SMALL_CHANGE = 30052,
    PROPERTY_CAN_SELECT_MULTIPLE = 30060,
    PROPERTY_IS_SELECTION_REQUIRED = 30061,
    PROPERTY_EXPAND_COLLAPSE_STATE = 30070,
    PROPERTY_WINDOW_IS_MODAL = 30077,
    PROPERTY_TOGGLE_STATE = 30086,
    PROPERTY_CONTROLLER_FOR = 30104,
    PROPERTY_PROVIDER_DESCRIPTION = 30107,
};

enum {
    ATTRIBUTE_CULTURE = 40004,
    ATTRIBUTE_IS_READ_ONLY = 40015,
    ATTRIBUTE_CARET_POSITION = 40038,
};

enum {
    PATTERN_ID_INVOKE = 10000,
    PATTERN_ID_SELECTION = 10001,
    PATTERN_ID_VALUE = 10002,
    PATTERN_ID_RANGE_VALUE = 10003,
    PATTERN_ID_EXPAND_COLLAPSE = 10005,
    PATTERN_ID_WINDOW = 10009,
    PATTERN_ID_SELECTION_ITEM = 10010,
    PATTERN_ID_TEXT = 10014,
    PATTERN_ID_TOGGLE = 10015,
    PATTERN_ID_SCROLL_ITEM = 10017,
};

enum {
    UNIT_CHARACTER = 0,
    UNIT_FORMAT = 1,
    UNIT_WORD = 2,
    UNIT_LINE = 3,
    UNIT_PARAGRAPH = 4,
    UNIT_PAGE = 5,
    UNIT_DOCUMENT = 6,
};

// ---------------------------------------------------------------------------------------------
// Memory.

static void *alloc_zeroed(size_t size) {
    return HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, size ? size : 1);
}

static void release(void *memory) {
    if (memory) HeapFree(GetProcessHeap(), 0, memory);
}

static int guid_equal(const GUID *a, const GUID *b) {
    const uint8_t *x = (const uint8_t *)a;
    const uint8_t *y = (const uint8_t *)b;
    for (int i = 0; i < 16; i++) {
        if (x[i] != y[i]) return 0;
    }
    return 1;
}

// ---------------------------------------------------------------------------------------------
// A map from element ids to pointers, with open addressing.

typedef struct {
    uint64_t *keys;
    void **values;
    uint8_t *used;
    size_t capacity;
    size_t count;
} Map;

static size_t map_slot(uint64_t key, size_t capacity) {
    key ^= key >> 33;
    key *= 0xff51afd7ed558ccdULL;
    key ^= key >> 33;
    return (size_t)(key & (capacity - 1));
}

static void *map_get(const Map *map, uint64_t key) {
    if (!map->capacity) return NULL;
    size_t i = map_slot(key, map->capacity);
    while (map->used[i]) {
        if (map->keys[i] == key) return map->values[i];
        i = (i + 1) & (map->capacity - 1);
    }
    return NULL;
}

static int map_grow(Map *map) {
    size_t capacity = map->capacity ? map->capacity * 2 : 64;
    Map next = {0};
    next.keys = alloc_zeroed(capacity * sizeof(uint64_t));
    next.values = alloc_zeroed(capacity * sizeof(void *));
    next.used = alloc_zeroed(capacity);
    if (!next.keys || !next.values || !next.used) {
        release(next.keys);
        release(next.values);
        release(next.used);
        return 0;
    }
    next.capacity = capacity;
    for (size_t i = 0; i < map->capacity; i++) {
        if (!map->used[i]) continue;
        size_t j = map_slot(map->keys[i], capacity);
        while (next.used[j]) j = (j + 1) & (capacity - 1);
        next.used[j] = 1;
        next.keys[j] = map->keys[i];
        next.values[j] = map->values[i];
        next.count++;
    }
    release(map->keys);
    release(map->values);
    release(map->used);
    *map = next;
    return 1;
}

// Stores `value` under `key` and returns what was there before.
static void *map_put(Map *map, uint64_t key, void *value) {
    if ((map->count + 1) * 10 >= map->capacity * 7 && !map_grow(map)) return NULL;
    size_t i = map_slot(key, map->capacity);
    while (map->used[i]) {
        if (map->keys[i] == key) {
            void *old = map->values[i];
            map->values[i] = value;
            return old;
        }
        i = (i + 1) & (map->capacity - 1);
    }
    map->used[i] = 1;
    map->keys[i] = key;
    map->values[i] = value;
    map->count++;
    return NULL;
}

// Removes `key` and returns its value.
static void *map_remove(Map *map, uint64_t key) {
    if (!map->capacity) return NULL;
    size_t mask = map->capacity - 1;
    size_t i = map_slot(key, map->capacity);
    while (map->used[i] && map->keys[i] != key) i = (i + 1) & mask;
    if (!map->used[i]) return NULL;
    void *value = map->values[i];
    map->used[i] = 0;
    map->count--;
    // Shift the entries after the hole back, so lookups still find them.
    size_t j = (i + 1) & mask;
    while (map->used[j]) {
        size_t home = map_slot(map->keys[j], map->capacity);
        int between = (i <= j) ? (i < home && home <= j) : (i < home || home <= j);
        if (!between) {
            map->used[i] = 1;
            map->keys[i] = map->keys[j];
            map->values[i] = map->values[j];
            map->used[j] = 0;
            i = j;
        }
        j = (j + 1) & mask;
    }
    return value;
}

static void map_free(Map *map) {
    release(map->keys);
    release(map->values);
    release(map->used);
    map->keys = NULL;
    map->values = NULL;
    map->used = NULL;
    map->capacity = 0;
    map->count = 0;
}

// ---------------------------------------------------------------------------------------------
// Parsed records.

typedef struct {
    uint32_t id;
    uint8_t kind;  // 0 empty, 1 bool, 2 i32, 3 f64, 4 text
    int32_t integer;
    double number;
    const uint8_t *text;
    uint32_t length;
} Value;

typedef struct {
    uint32_t start, end;
} Span;

typedef struct {
    uint32_t start, end;
    double box[4];
} Character;

typedef struct {
    uint32_t start, end;
    Value *attributes;
    uint32_t count;
} Run;

typedef struct {
    WCHAR *units;
    uint32_t length;
    int hasSelection;
    uint32_t anchor, focus;
    Character *characters;
    uint32_t characterCount;
    Span *words;
    uint32_t wordCount;
    Span *lines;
    uint32_t lineCount;
    Span *paragraphs;
    uint32_t paragraphCount;
    Run *runs;
    uint32_t runCount;
} Text;

typedef struct {
    uint64_t id;
    uint8_t *record;
    size_t length;
    Value *properties;
    uint32_t propertyCount;
    uint32_t patterns;
    uint32_t flags;
    double bounds[4];
    uint64_t parent;
    uint64_t *children;
    uint32_t childCount;
    int hasContainer;
    uint64_t container;
    uint64_t *selected;
    uint32_t selectedCount;
    uint64_t *controls;
    uint32_t controlCount;
    Text *text;
} Node;

typedef struct {
    const uint8_t *data;
    size_t length;
    size_t at;
    int failed;
} Reader;

static uint8_t read_byte(Reader *r) {
    if (r->at >= r->length) {
        r->failed = 1;
        return 0;
    }
    return r->data[r->at++];
}

static uint64_t read_little(Reader *r, int count) {
    uint64_t value = 0;
    for (int i = 0; i < count; i++) value |= (uint64_t)read_byte(r) << (8 * i);
    return value;
}

static uint32_t read_u32(Reader *r) {
    return (uint32_t)read_little(r, 4);
}

static uint64_t read_u64(Reader *r) {
    return read_little(r, 8);
}

static double read_f64(Reader *r) {
    uint64_t bits = read_little(r, 8);
    double value;
    memcpy(&value, &bits, sizeof value);
    return value;
}

static void read_text(Reader *r, const uint8_t **text, uint32_t *length) {
    uint32_t n = read_u32(r);
    if (r->at + n > r->length) {
        r->failed = 1;
        n = 0;
    }
    *text = r->data + r->at;
    *length = n;
    r->at += n;
}

static void read_value(Reader *r, Value *value) {
    value->kind = read_byte(r);
    switch (value->kind) {
    case 1:
        value->integer = read_byte(r) != 0;
        break;
    case 2:
        value->integer = (int32_t)read_u32(r);
        break;
    case 3:
        value->number = read_f64(r);
        break;
    case 4:
        read_text(r, &value->text, &value->length);
        break;
    default:
        value->kind = 0;
        break;
    }
}

static uint64_t *read_ids(Reader *r, uint32_t *count) {
    uint32_t n = read_u32(r);
    if (r->failed || (size_t)n * 8 > r->length - r->at) {
        r->failed = 1;
        *count = 0;
        return NULL;
    }
    uint64_t *ids = alloc_zeroed((size_t)n * sizeof(uint64_t));
    if (!ids) {
        r->failed = 1;
        *count = 0;
        return NULL;
    }
    for (uint32_t i = 0; i < n; i++) ids[i] = read_u64(r);
    *count = n;
    return ids;
}

// The number of UTF-16 units of UTF-8 `text`.
static uint32_t utf16_length(const uint8_t *text, uint32_t length) {
    uint32_t units = 0;
    for (uint32_t i = 0; i < length;) {
        uint8_t b = text[i];
        int size = b < 0x80 ? 1 : b < 0xE0 ? 2 : b < 0xF0 ? 3 : 4;
        units += size == 4 ? 2 : 1;
        i += size;
    }
    return units;
}

// Writes UTF-8 `text` as UTF-16 to `out`, which has room for `utf16_length` units.
static uint32_t to_utf16(const uint8_t *text, uint32_t length, WCHAR *out) {
    uint32_t n = 0;
    for (uint32_t i = 0; i < length;) {
        uint8_t b = text[i];
        uint32_t c;
        int size;
        if (b < 0x80) {
            c = b;
            size = 1;
        } else if (b < 0xE0) {
            c = b & 0x1F;
            size = 2;
        } else if (b < 0xF0) {
            c = b & 0x0F;
            size = 3;
        } else {
            c = b & 0x07;
            size = 4;
        }
        for (int k = 1; k < size; k++) c = (c << 6) | (i + k < length ? (text[i + k] & 0x3F) : 0);
        if (c >= 0x10000) {
            c -= 0x10000;
            out[n++] = (WCHAR)(0xD800 + (c >> 10));
            out[n++] = (WCHAR)(0xDC00 + (c & 0x3FF));
        } else {
            out[n++] = (WCHAR)c;
        }
        i += size;
    }
    return n;
}

// Converts UTF-16 `text` to newly allocated UTF-8.
static uint8_t *to_utf8(const WCHAR *text, size_t *length) {
    size_t units = 0;
    while (text && text[units]) units++;
    uint8_t *out = alloc_zeroed(units * 3 + 1);
    if (!out) {
        *length = 0;
        return NULL;
    }
    size_t n = 0;
    for (size_t i = 0; i < units; i++) {
        uint32_t c = text[i];
        if (c >= 0xD800 && c < 0xDC00 && i + 1 < units && text[i + 1] >= 0xDC00 &&
            text[i + 1] < 0xE000) {
            c = 0x10000 + ((c - 0xD800) << 10) + (text[i + 1] - 0xDC00);
            i++;
        }
        if (c < 0x80) {
            out[n++] = (uint8_t)c;
        } else if (c < 0x800) {
            out[n++] = (uint8_t)(0xC0 | (c >> 6));
            out[n++] = (uint8_t)(0x80 | (c & 0x3F));
        } else if (c < 0x10000) {
            out[n++] = (uint8_t)(0xE0 | (c >> 12));
            out[n++] = (uint8_t)(0x80 | ((c >> 6) & 0x3F));
            out[n++] = (uint8_t)(0x80 | (c & 0x3F));
        } else {
            out[n++] = (uint8_t)(0xF0 | (c >> 18));
            out[n++] = (uint8_t)(0x80 | ((c >> 12) & 0x3F));
            out[n++] = (uint8_t)(0x80 | ((c >> 6) & 0x3F));
            out[n++] = (uint8_t)(0x80 | (c & 0x3F));
        }
    }
    *length = n;
    return out;
}

static Span *read_spans(Reader *r, uint32_t *count) {
    uint32_t n = read_u32(r);
    if (r->failed || (size_t)n * 8 > r->length - r->at) {
        r->failed = 1;
        *count = 0;
        return NULL;
    }
    Span *spans = alloc_zeroed((size_t)n * sizeof(Span));
    if (!spans) {
        r->failed = 1;
        *count = 0;
        return NULL;
    }
    for (uint32_t i = 0; i < n; i++) {
        spans[i].start = read_u32(r);
        spans[i].end = read_u32(r);
    }
    *count = n;
    return spans;
}

static void free_text(Text *text) {
    if (!text) return;
    release(text->units);
    release(text->characters);
    release(text->words);
    release(text->lines);
    release(text->paragraphs);
    for (uint32_t i = 0; i < text->runCount; i++) release(text->runs[i].attributes);
    release(text->runs);
    release(text);
}

static Text *read_text_block(Reader *r) {
    Text *text = alloc_zeroed(sizeof(Text));
    if (!text) return NULL;
    const uint8_t *utf8;
    uint32_t length;
    read_text(r, &utf8, &length);
    uint32_t units = utf16_length(utf8, length);
    text->units = alloc_zeroed(((size_t)units + 1) * sizeof(WCHAR));
    if (!text->units) {
        free_text(text);
        return NULL;
    }
    text->length = to_utf16(utf8, length, text->units);
    uint32_t declared = read_u32(r);
    if (declared < text->length) text->length = declared;
    text->hasSelection = read_byte(r) != 0;
    text->anchor = read_u32(r);
    text->focus = read_u32(r);

    uint32_t n = read_u32(r);
    if (r->failed || (size_t)n * 40 > r->length - r->at) {
        free_text(text);
        r->failed = 1;
        return NULL;
    }
    text->characters = alloc_zeroed((size_t)n * sizeof(Character));
    for (uint32_t i = 0; text->characters && i < n; i++) {
        text->characters[i].start = read_u32(r);
        text->characters[i].end = read_u32(r);
        for (int k = 0; k < 4; k++) text->characters[i].box[k] = read_f64(r);
    }
    text->characterCount = text->characters ? n : 0;
    text->words = read_spans(r, &text->wordCount);
    text->lines = read_spans(r, &text->lineCount);
    text->paragraphs = read_spans(r, &text->paragraphCount);

    n = read_u32(r);
    if (r->failed || (size_t)n * 12 > r->length - r->at) {
        free_text(text);
        r->failed = 1;
        return NULL;
    }
    text->runs = alloc_zeroed((size_t)n * sizeof(Run));
    if (!text->runs) {
        free_text(text);
        return NULL;
    }
    text->runCount = n;
    for (uint32_t i = 0; i < n && !r->failed; i++) {
        Run *run = &text->runs[i];
        run->start = read_u32(r);
        run->end = read_u32(r);
        uint32_t count = read_u32(r);
        if ((size_t)count * 5 > r->length - r->at) {
            r->failed = 1;
            break;
        }
        run->attributes = alloc_zeroed((size_t)count * sizeof(Value));
        if (!run->attributes) {
            r->failed = 1;
            break;
        }
        run->count = count;
        for (uint32_t k = 0; k < count; k++) {
            run->attributes[k].id = read_u32(r);
            read_value(r, &run->attributes[k]);
        }
    }
    return text;
}

static void free_node(Node *node) {
    if (!node) return;
    release(node->record);
    release(node->properties);
    release(node->children);
    release(node->selected);
    release(node->controls);
    free_text(node->text);
    release(node);
}

static Node *parse_node(uint64_t id, const uint8_t *record, size_t length) {
    Node *node = alloc_zeroed(sizeof(Node));
    if (!node) return NULL;
    node->id = id;
    node->record = alloc_zeroed(length);
    if (!node->record) {
        release(node);
        return NULL;
    }
    memcpy(node->record, record, length);
    node->length = length;

    // Count the properties first.
    Reader r = {node->record, length, 0, 0};
    uint32_t properties = 0;
    for (size_t i = 0; i < length; i++) {
        if (record[i] == TAG_PROPERTY) properties++;  // An upper bound.
    }
    node->properties = alloc_zeroed((size_t)properties * sizeof(Value));
    if (!node->properties) {
        free_node(node);
        return NULL;
    }
    while (r.at < r.length && !r.failed) {
        uint8_t tag = read_byte(&r);
        switch (tag) {
        case TAG_PROPERTY: {
            Value *value = &node->properties[node->propertyCount++];
            value->id = read_u32(&r);
            read_value(&r, value);
            break;
        }
        case TAG_PATTERNS:
            node->patterns = read_u32(&r);
            break;
        case TAG_FLAGS:
            node->flags = read_u32(&r);
            break;
        case TAG_BOUNDS:
            for (int k = 0; k < 4; k++) node->bounds[k] = read_f64(&r);
            break;
        case TAG_PARENT:
            node->parent = read_u64(&r);
            break;
        case TAG_CHILDREN:
            release(node->children);
            node->children = read_ids(&r, &node->childCount);
            break;
        case TAG_SELECTION_CONTAINER:
            node->hasContainer = 1;
            node->container = read_u64(&r);
            break;
        case TAG_SELECTED:
            release(node->selected);
            node->selected = read_ids(&r, &node->selectedCount);
            break;
        case TAG_CONTROLS:
            release(node->controls);
            node->controls = read_ids(&r, &node->controlCount);
            break;
        case TAG_TEXT:
            free_text(node->text);
            node->text = read_text_block(&r);
            break;
        default:
            r.failed = 1;
            break;
        }
    }
    return node;
}

static const Value *find_property(const Node *node, uint32_t id) {
    for (uint32_t i = 0; i < node->propertyCount; i++) {
        if (node->properties[i].id == id) return &node->properties[i];
    }
    return NULL;
}

// ---------------------------------------------------------------------------------------------
// Adapters, elements and ranges.

typedef struct {
    uint32_t kind;
    uint64_t id;
    double number;
    uint32_t start, end;
    uint8_t *text;
    size_t textLength;
} Action;

typedef struct Adapter {
    volatile long refs;
    SRWLOCK lock;
    HWND hwnd;
    int ownsWindow;
    int detached;
    WNDPROC previous;
    Map nodes;
    Map elements;
    int hasRoot;
    uint64_t root;
    int hasFocus;
    uint64_t focus;
    Action *actions;
    size_t actionCount;
    size_t actionCapacity;
    uint8_t *actionText;
    size_t actionTextLength;
} Adapter;

typedef struct Element {
    void *const *simple;
    void *const *fragment;
    void *const *fragmentRoot;
    void *const *toggle;
    void *const *invoke;
    void *const *value;
    void *const *rangeValue;
    void *const *scrollItem;
    void *const *selectionItem;
    void *const *selection;
    void *const *text;
    void *const *expandCollapse;
    void *const *window;
    volatile long refs;
    Adapter *adapter;
    uint64_t id;
} Element;

typedef struct TextRange {
    void *const *vtbl;
    volatile long refs;
    Adapter *adapter;
    uint64_t id;
    uint32_t start, end;
} TextRange;

static long atomic_increment(volatile long *value) {
    return __atomic_add_fetch(value, 1, __ATOMIC_SEQ_CST);
}

static long atomic_decrement(volatile long *value) {
    return __atomic_sub_fetch(value, 1, __ATOMIC_SEQ_CST);
}

static void lock(Adapter *adapter) {
    AcquireSRWLockExclusive(&adapter->lock);
}

static void unlock(Adapter *adapter) {
    ReleaseSRWLockExclusive(&adapter->lock);
}

static void adapter_retain(Adapter *adapter) {
    atomic_increment(&adapter->refs);
}

static void adapter_release(Adapter *adapter) {
    if (atomic_decrement(&adapter->refs) != 0) return;
    for (size_t i = 0; i < adapter->nodes.capacity; i++) {
        if (adapter->nodes.used[i]) free_node(adapter->nodes.values[i]);
    }
    map_free(&adapter->nodes);
    map_free(&adapter->elements);
    for (size_t i = 0; i < adapter->actionCount; i++) release(adapter->actions[i].text);
    release(adapter->actions);
    release(adapter->actionText);
    release(adapter);
}

// The node behind `id`, while the adapter is locked.
static Node *node_of(Adapter *adapter, uint64_t id) {
    if (adapter->detached) return NULL;
    return map_get(&adapter->nodes, id);
}

static Element *element_new(Adapter *adapter, uint64_t id);

// The element of `id`, with a reference for the caller, while the adapter is locked.
static Element *element_of(Adapter *adapter, uint64_t id) {
    Element *element = map_get(&adapter->elements, id);
    if (!element) {
        element = element_new(adapter, id);
        if (!element) return NULL;
        map_put(&adapter->elements, id, element);
    }
    atomic_increment(&element->refs);
    return element;
}

static void element_release(Element *element) {
    if (atomic_decrement(&element->refs) != 0) return;
    Adapter *adapter = element->adapter;
    release(element);
    adapter_release(adapter);
}

static HRESULT queue_action(Adapter *adapter, uint32_t kind, uint64_t id, double number,
                            uint32_t start, uint32_t end, const WCHAR *text) {
    lock(adapter);
    if (adapter->detached) {
        unlock(adapter);
        return UIA_E_ELEMENTNOTAVAILABLE;
    }
    if (adapter->actionCount == adapter->actionCapacity) {
        size_t capacity = adapter->actionCapacity ? adapter->actionCapacity * 2 : 16;
        Action *grown = alloc_zeroed(capacity * sizeof(Action));
        if (!grown) {
            unlock(adapter);
            return E_OUTOFMEMORY;
        }
        if (adapter->actionCount) memcpy(grown, adapter->actions, adapter->actionCount * sizeof(Action));
        release(adapter->actions);
        adapter->actions = grown;
        adapter->actionCapacity = capacity;
    }
    Action *action = &adapter->actions[adapter->actionCount++];
    action->kind = kind;
    action->id = id;
    action->number = number;
    action->start = start;
    action->end = end;
    action->text = NULL;
    action->textLength = 0;
    if (text) action->text = to_utf8(text, &action->textLength);
    HWND hwnd = adapter->hwnd;
    unlock(adapter);
    // Wake the window's message loop, so the application looks at its queue.
    PostMessageW(hwnd, WM_NULL, 0, 0);
    return S_OK;
}

// ---------------------------------------------------------------------------------------------
// Variants.

static HRESULT variant_text(VARIANT *out, const uint8_t *text, uint32_t length) {
    uint32_t units = utf16_length(text, length);
    WCHAR *wide = alloc_zeroed(((size_t)units + 1) * sizeof(WCHAR));
    if (!wide) return E_OUTOFMEMORY;
    uint32_t n = to_utf16(text, length, wide);
    out->vt = VT_BSTR;
    out->u.bstrVal = SysAllocStringLen(wide, n);
    release(wide);
    if (!out->u.bstrVal) {
        out->vt = VT_EMPTY;
        return E_OUTOFMEMORY;
    }
    return S_OK;
}

static void variant_locale(VARIANT *out, const uint8_t *text, uint32_t length) {
    uint32_t units = utf16_length(text, length);
    WCHAR *wide = alloc_zeroed(((size_t)units + 1) * sizeof(WCHAR));
    if (!wide) return;
    to_utf16(text, length, wide);
    int lcid = LocaleNameToLCID(wide, LOCALE_ALLOW_NEUTRAL_NAMES);
    release(wide);
    if (lcid != 0) {
        out->vt = VT_I4;
        out->u.lVal = lcid;
    }
}

// `value` as a variant; a locale name is given as its LCID when `locale` is set.
static HRESULT variant_of(VARIANT *out, const Value *value, int locale) {
    out->vt = VT_EMPTY;
    out->u.llVal = 0;
    if (!value) return S_OK;
    switch (value->kind) {
    case 1:
        out->vt = VT_BOOL;
        out->u.boolVal = value->integer ? -1 : 0;
        return S_OK;
    case 2:
        out->vt = VT_I4;
        out->u.lVal = value->integer;
        return S_OK;
    case 3:
        out->vt = VT_R8;
        out->u.dblVal = value->number;
        return S_OK;
    case 4:
        if (locale) {
            variant_locale(out, value->text, value->length);
            return S_OK;
        }
        return variant_text(out, value->text, value->length);
    default:
        return S_OK;
    }
}

static int value_equal(const Value *a, const Value *b) {
    if (!a || !b) return a == b;
    if (a->kind != b->kind) return 0;
    switch (a->kind) {
    case 1:
    case 2:
        return a->integer == b->integer;
    case 3:
        return a->number == b->number;
    case 4:
        if (a->length != b->length) return 0;
        for (uint32_t i = 0; i < a->length; i++) {
            if (a->text[i] != b->text[i]) return 0;
        }
        return 1;
    default:
        return 1;
    }
}

// A SAFEARRAY of the elements of `ids` that exist, as `IUnknown` pointers.
static SAFEARRAY *element_array(Adapter *adapter, const uint64_t *ids, uint32_t count) {
    uint32_t present = 0;
    for (uint32_t i = 0; i < count; i++) {
        if (node_of(adapter, ids[i])) present++;
    }
    SAFEARRAY *array = SafeArrayCreateVector(VT_UNKNOWN, 0, present);
    if (!array) return NULL;
    long index = 0;
    for (uint32_t i = 0; i < count; i++) {
        if (!node_of(adapter, ids[i])) continue;
        Element *element = element_of(adapter, ids[i]);
        if (!element) continue;
        SafeArrayPutElement(array, &index, &element->simple);
        element_release(element);
        index++;
    }
    return array;
}

// ---------------------------------------------------------------------------------------------
// The element's interfaces.

#define ELEMENT(pointer, field) ((Element *)((char *)(pointer) - offsetof(Element, field)))

static HRESULT element_query(Element *element, const GUID *iid, void **out) {
    if (!out) return E_POINTER;
    void *found = NULL;
    if (guid_equal(iid, &IID_IUnknown) || guid_equal(iid, &IID_Simple)) found = &element->simple;
    else if (guid_equal(iid, &IID_Fragment)) found = &element->fragment;
    else if (guid_equal(iid, &IID_FragmentRoot)) found = &element->fragmentRoot;
    else if (guid_equal(iid, &IID_Toggle)) found = &element->toggle;
    else if (guid_equal(iid, &IID_Invoke)) found = &element->invoke;
    else if (guid_equal(iid, &IID_Value)) found = &element->value;
    else if (guid_equal(iid, &IID_RangeValue)) found = &element->rangeValue;
    else if (guid_equal(iid, &IID_ScrollItem)) found = &element->scrollItem;
    else if (guid_equal(iid, &IID_SelectionItem)) found = &element->selectionItem;
    else if (guid_equal(iid, &IID_Selection)) found = &element->selection;
    else if (guid_equal(iid, &IID_Text)) found = &element->text;
    else if (guid_equal(iid, &IID_ExpandCollapse)) found = &element->expandCollapse;
    else if (guid_equal(iid, &IID_Window)) found = &element->window;
    *out = found;
    if (!found) return E_NOINTERFACE;
    atomic_increment(&element->refs);
    return S_OK;
}

#define UNKNOWN_METHODS(field)                                                                    \
    static HRESULT field##_query(void *self, const GUID *iid, void **out) {                      \
        return element_query(ELEMENT(self, field), iid, out);                                     \
    }                                                                                             \
    static unsigned long field##_add_ref(void *self) {                                           \
        return (unsigned long)atomic_increment(&ELEMENT(self, field)->refs);                      \
    }                                                                                             \
    static unsigned long field##_release(void *self) {                                           \
        Element *element = ELEMENT(self, field);                                                  \
        long left = atomic_decrement(&element->refs);                                             \
        if (left == 0) {                                                                          \
            Adapter *adapter = element->adapter;                                                  \
            release(element);                                                                     \
            adapter_release(adapter);                                                             \
        }                                                                                         \
        return (unsigned long)left;                                                               \
    }

UNKNOWN_METHODS(simple)
UNKNOWN_METHODS(fragment)
UNKNOWN_METHODS(fragmentRoot)
UNKNOWN_METHODS(toggle)
UNKNOWN_METHODS(invoke)
UNKNOWN_METHODS(value)
UNKNOWN_METHODS(rangeValue)
UNKNOWN_METHODS(scrollItem)
UNKNOWN_METHODS(selectionItem)
UNKNOWN_METHODS(selection)
UNKNOWN_METHODS(text)
UNKNOWN_METHODS(expandCollapse)
UNKNOWN_METHODS(window)

#define UNKNOWN_ENTRIES(field) (void *)field##_query, (void *)field##_add_ref, (void *)field##_release

// Looks up the node of `element` and holds the lock, or fails with the element gone.
#define RESOLVE(element, node)                                                                    \
    Adapter *adapter = (element)->adapter;                                                       \
    lock(adapter);                                                                                \
    Node *node = node_of(adapter, (element)->id);                                                 \
    if (!node) {                                                                                  \
        unlock(adapter);                                                                          \
        return UIA_E_ELEMENTNOTAVAILABLE;                                                         \
    }

static const Value *property_of(Node *node, uint32_t id) {
    return find_property(node, id);
}

// --- IRawElementProviderSimple

static HRESULT simple_get_options(void *self, int *out) {
    if (!out) return E_POINTER;
    *out = 1;  // ProviderOptions_ServerSideProvider
    return S_OK;
}

static HRESULT simple_get_pattern(void *self, int pattern, void **out) {
    if (!out) return E_POINTER;
    *out = NULL;
    Element *element = ELEMENT(self, simple);
    RESOLVE(element, node)
    void *found = NULL;
    uint32_t bits = node->patterns;
    switch (pattern) {
    case PATTERN_ID_TOGGLE:
        if (bits & PATTERN_TOGGLE) found = &element->toggle;
        break;
    case PATTERN_ID_INVOKE:
        if (bits & PATTERN_INVOKE) found = &element->invoke;
        break;
    case PATTERN_ID_VALUE:
        if (bits & PATTERN_VALUE) found = &element->value;
        break;
    case PATTERN_ID_RANGE_VALUE:
        if (bits & PATTERN_RANGE_VALUE) found = &element->rangeValue;
        break;
    case PATTERN_ID_SCROLL_ITEM:
        if (bits & PATTERN_SCROLL_ITEM) found = &element->scrollItem;
        break;
    case PATTERN_ID_SELECTION_ITEM:
        if (bits & PATTERN_SELECTION_ITEM) found = &element->selectionItem;
        break;
    case PATTERN_ID_SELECTION:
        if (bits & PATTERN_SELECTION) found = &element->selection;
        break;
    case PATTERN_ID_TEXT:
        if (bits & PATTERN_TEXT) found = &element->text;
        break;
    case PATTERN_ID_EXPAND_COLLAPSE:
        if (bits & PATTERN_EXPAND_COLLAPSE) found = &element->expandCollapse;
        break;
    case PATTERN_ID_WINDOW:
        if (bits & PATTERN_WINDOW) found = &element->window;
        break;
    default:
        break;
    }
    if (found) atomic_increment(&element->refs);
    unlock(adapter);
    *out = found;
    return S_OK;
}

static HRESULT window_title(HWND hwnd, VARIANT *out) {
    WCHAR *buffer = alloc_zeroed(1024 * sizeof(WCHAR));
    if (!buffer) return E_OUTOFMEMORY;
    // InternalGetWindowText never sends a message to the window, so it cannot wait on its
    // thread.
    int length = InternalGetWindowText(hwnd, buffer, 1024);
    if (length > 0) {
        out->vt = VT_BSTR;
        out->u.bstrVal = SysAllocStringLen(buffer, (UINT)length);
        if (!out->u.bstrVal) out->vt = VT_EMPTY;
    }
    release(buffer);
    return S_OK;
}

static HRESULT simple_get_property(void *self, int id, VARIANT *out) {
    if (!out) return E_POINTER;
    out->vt = VT_EMPTY;
    out->u.llVal = 0;
    Element *element = ELEMENT(self, simple);
    RESOLVE(element, node)
    HRESULT result = S_OK;
    const Value *value = property_of(node, (uint32_t)id);
    if (value) {
        result = variant_of(out, value, id == PROPERTY_CULTURE);
    } else if (id == PROPERTY_CONTROLLER_FOR) {
        if (node->controlCount) {
            SAFEARRAY *array = element_array(adapter, node->controls, node->controlCount);
            if (array) {
                out->vt = VT_ARRAY | VT_UNKNOWN;
                out->u.parray = array;
            }
        }
    } else if (id == PROPERTY_FRAMEWORK_ID || id == PROPERTY_PROVIDER_DESCRIPTION) {
        Node *root = adapter->hasRoot ? node_of(adapter, adapter->root) : NULL;
        if (root) result = variant_of(out, property_of(root, (uint32_t)id), 0);
    } else if (node->flags & FLAG_ROOT) {
        if (id == PROPERTY_NAME) {
            result = window_title(adapter->hwnd, out);
        } else if (id == PROPERTY_NATIVE_WINDOW_HANDLE) {
            out->vt = VT_I4;
            out->u.lVal = (long)(intptr_t)adapter->hwnd;
        }
    }
    unlock(adapter);
    return result;
}

static HRESULT simple_get_host(void *self, void **out) {
    if (!out) return E_POINTER;
    *out = NULL;
    Element *element = ELEMENT(self, simple);
    RESOLVE(element, node)
    int root = (node->flags & FLAG_ROOT) != 0;
    HWND hwnd = adapter->hwnd;
    unlock(adapter);
    if (!root) return S_OK;
    return UiaHostProviderFromHwnd(hwnd, out);
}

static void *const simple_vtbl[] = {
    UNKNOWN_ENTRIES(simple),
    (void *)simple_get_options,
    (void *)simple_get_pattern,
    (void *)simple_get_property,
    (void *)simple_get_host,
};

// --- IRawElementProviderFragment

static int sibling_index(Node *parent, uint64_t id) {
    for (uint32_t i = 0; i < parent->childCount; i++) {
        if (parent->children[i] == id) return (int)i;
    }
    return -1;
}

static HRESULT fragment_navigate(void *self, int direction, void **out) {
    if (!out) return E_POINTER;
    *out = NULL;
    Element *element = ELEMENT(self, fragment);
    RESOLVE(element, node)
    int found = 0;
    uint64_t target = 0;
    if (direction == 0) {
        if (node->flags & FLAG_HAS_PARENT) {
            found = node_of(adapter, node->parent) != NULL;
            target = node->parent;
        }
    } else if (direction == 1 || direction == 2) {
        Node *parent = (node->flags & FLAG_HAS_PARENT) ? node_of(adapter, node->parent) : NULL;
        int at = parent ? sibling_index(parent, node->id) : -1;
        if (at >= 0) {
            int next = direction == 1 ? at + 1 : at - 1;
            if (next >= 0 && (uint32_t)next < parent->childCount) {
                target = parent->children[next];
                found = node_of(adapter, target) != NULL;
            }
        }
    } else if (direction == 3 || direction == 4) {
        if (node->childCount) {
            target = direction == 3 ? node->children[0] : node->children[node->childCount - 1];
            found = node_of(adapter, target) != NULL;
        }
    }
    if (found) {
        Element *result = element_of(adapter, target);
        if (result) *out = &result->fragment;
    }
    unlock(adapter);
    return S_OK;
}

static HRESULT fragment_runtime_id(void *self, SAFEARRAY **out) {
    if (!out) return E_POINTER;
    *out = NULL;
    Element *element = ELEMENT(self, fragment);
    RESOLVE(element, node)
    int root = (node->flags & FLAG_ROOT) != 0;
    uint64_t id = element->id;
    unlock(adapter);
    // UI Automation takes the runtime id of a fragment root from its window.
    if (root) return S_OK;
    long parts[5] = {3, 0, 0, (long)(uint32_t)(id >> 32), (long)(uint32_t)id};  // UiaAppendRuntimeId
    SAFEARRAY *array = SafeArrayCreateVector(VT_I4, 0, 5);
    if (!array) return E_OUTOFMEMORY;
    for (long i = 0; i < 5; i++) SafeArrayPutElement(array, &i, &parts[i]);
    *out = array;
    return S_OK;
}

static POINT client_origin(HWND hwnd) {
    POINT origin = {0, 0};
    ClientToScreen(hwnd, &origin);
    return origin;
}

static HRESULT fragment_bounds(void *self, UiaRect *out) {
    if (!out) return E_POINTER;
    out->left = out->top = out->width = out->height = 0;
    Element *element = ELEMENT(self, fragment);
    RESOLVE(element, node)
    int has = (node->flags & FLAG_HAS_BOUNDS) != 0;
    double box[4] = {node->bounds[0], node->bounds[1], node->bounds[2], node->bounds[3]};
    HWND hwnd = adapter->hwnd;
    unlock(adapter);
    if (has) {
        POINT origin = client_origin(hwnd);
        out->left = box[0] + origin.x;
        out->top = box[1] + origin.y;
        out->width = box[2] - box[0];
        out->height = box[3] - box[1];
    }
    return S_OK;
}

static HRESULT fragment_embedded_roots(void *self, SAFEARRAY **out) {
    if (!out) return E_POINTER;
    *out = NULL;
    return S_OK;
}

// Queues an action on an enabled element.
static HRESULT act(Element *element, uint32_t kind, int checkEnabled) {
    Adapter *adapter = element->adapter;
    lock(adapter);
    Node *node = node_of(adapter, element->id);
    if (!node) {
        unlock(adapter);
        return UIA_E_ELEMENTNOTAVAILABLE;
    }
    int disabled = (node->flags & FLAG_DISABLED) != 0;
    unlock(adapter);
    if (checkEnabled && disabled) return UIA_E_ELEMENTNOTENABLED;
    return queue_action(adapter, kind, element->id, 0, 0, 0, NULL);
}

static HRESULT fragment_set_focus(void *self) {
    return act(ELEMENT(self, fragment), ACTION_FOCUS, 1);
}

static HRESULT fragment_get_root(void *self, void **out) {
    if (!out) return E_POINTER;
    *out = NULL;
    Element *element = ELEMENT(self, fragment);
    RESOLVE(element, node)
    if (adapter->hasRoot && node_of(adapter, adapter->root)) {
        Element *root = element_of(adapter, adapter->root);
        if (root) *out = &root->fragmentRoot;
    }
    unlock(adapter);
    return S_OK;
}

static void *const fragment_vtbl[] = {
    UNKNOWN_ENTRIES(fragment),
    (void *)fragment_navigate,
    (void *)fragment_runtime_id,
    (void *)fragment_bounds,
    (void *)fragment_embedded_roots,
    (void *)fragment_set_focus,
    (void *)fragment_get_root,
};

// --- IRawElementProviderFragmentRoot

static int contains(const Node *node, double x, double y) {
    return (node->flags & FLAG_HAS_BOUNDS) && x >= node->bounds[0] && x < node->bounds[2] &&
           y >= node->bounds[1] && y < node->bounds[3];
}

// The deepest element under `node` at the point, last children first, as hit tests go.
static uint64_t hit(Adapter *adapter, Node *node, double x, double y, int depth) {
    if (depth > 256) return node->id;
    for (uint32_t i = node->childCount; i > 0; i--) {
        Node *child = node_of(adapter, node->children[i - 1]);
        if (child && contains(child, x, y)) return hit(adapter, child, x, y, depth + 1);
    }
    return node->id;
}

static HRESULT root_from_point(void *self, double x, double y, void **out) {
    if (!out) return E_POINTER;
    *out = NULL;
    Element *element = ELEMENT(self, fragmentRoot);
    Adapter *adapter = element->adapter;
    POINT origin = client_origin(adapter->hwnd);
    lock(adapter);
    Node *node = node_of(adapter, element->id);
    if (!node) {
        unlock(adapter);
        return UIA_E_ELEMENTNOTAVAILABLE;
    }
    uint64_t found = hit(adapter, node, x - origin.x, y - origin.y, 0);
    Element *result = element_of(adapter, found);
    if (result) *out = &result->fragment;
    unlock(adapter);
    return S_OK;
}

static HRESULT root_get_focus(void *self, void **out) {
    if (!out) return E_POINTER;
    *out = NULL;
    Element *element = ELEMENT(self, fragmentRoot);
    RESOLVE(element, node)
    (void)node;
    if (adapter->hasFocus && adapter->focus != element->id && node_of(adapter, adapter->focus)) {
        Element *focus = element_of(adapter, adapter->focus);
        if (focus) *out = &focus->fragment;
    }
    unlock(adapter);
    return S_OK;
}

static void *const fragment_root_vtbl[] = {
    UNKNOWN_ENTRIES(fragmentRoot),
    (void *)root_from_point,
    (void *)root_get_focus,
};

// --- Pattern property getters

static HRESULT get_int(Element *element, uint32_t id, int *out) {
    if (!out) return E_POINTER;
    *out = 0;
    RESOLVE(element, node)
    const Value *value = property_of(node, id);
    if (value && value->kind == 2) *out = value->integer;
    unlock(adapter);
    return S_OK;
}

static HRESULT get_bool(Element *element, uint32_t id, BOOL *out) {
    if (!out) return E_POINTER;
    *out = 0;
    RESOLVE(element, node)
    const Value *value = property_of(node, id);
    if (value && value->kind == 1) *out = value->integer != 0;
    unlock(adapter);
    return S_OK;
}

static HRESULT get_double(Element *element, uint32_t id, double *out) {
    if (!out) return E_POINTER;
    *out = 0;
    RESOLVE(element, node)
    const Value *value = property_of(node, id);
    if (value && value->kind == 3) *out = value->number;
    unlock(adapter);
    return S_OK;
}

// --- IToggleProvider

static HRESULT toggle_toggle(void *self) {
    return act(ELEMENT(self, toggle), ACTION_CLICK, 1);
}

static HRESULT toggle_state(void *self, int *out) {
    return get_int(ELEMENT(self, toggle), PROPERTY_TOGGLE_STATE, out);
}

static void *const toggle_vtbl[] = {
    UNKNOWN_ENTRIES(toggle),
    (void *)toggle_toggle,
    (void *)toggle_state,
};

// --- IInvokeProvider

static HRESULT invoke_invoke(void *self) {
    return act(ELEMENT(self, invoke), ACTION_CLICK, 1);
}

static void *const invoke_vtbl[] = {
    UNKNOWN_ENTRIES(invoke),
    (void *)invoke_invoke,
};

// --- IValueProvider

static HRESULT value_set(void *self, const WCHAR *text) {
    Element *element = ELEMENT(self, value);
    Adapter *adapter = element->adapter;
    lock(adapter);
    Node *node = node_of(adapter, element->id);
    int disabled = node ? (node->flags & FLAG_DISABLED) != 0 : 0;
    unlock(adapter);
    if (!node) return UIA_E_ELEMENTNOTAVAILABLE;
    if (disabled) return UIA_E_ELEMENTNOTENABLED;
    static const WCHAR empty[1] = {0};
    return queue_action(adapter, ACTION_SET_TEXT, element->id, 0, 0, 0, text ? text : empty);
}

static HRESULT value_get(void *self, BSTR *out) {
    if (!out) return E_POINTER;
    *out = NULL;
    Element *element = ELEMENT(self, value);
    RESOLVE(element, node)
    VARIANT v = {0};
    HRESULT result = variant_of(&v, property_of(node, PROPERTY_VALUE_VALUE), 0);
    unlock(adapter);
    if (v.vt == VT_BSTR) *out = v.u.bstrVal;
    else *out = SysAllocStringLen(NULL, 0);
    return result;
}

static HRESULT value_read_only(void *self, BOOL *out) {
    return get_bool(ELEMENT(self, value), PROPERTY_VALUE_IS_READ_ONLY, out);
}

static void *const value_vtbl[] = {
    UNKNOWN_ENTRIES(value),
    (void *)value_set,
    (void *)value_get,
    (void *)value_read_only,
};

// --- IRangeValueProvider

static HRESULT range_set(void *self, double number) {
    Element *element = ELEMENT(self, rangeValue);
    Adapter *adapter = element->adapter;
    lock(adapter);
    Node *node = node_of(adapter, element->id);
    int disabled = node ? (node->flags & FLAG_DISABLED) != 0 : 0;
    unlock(adapter);
    if (!node) return UIA_E_ELEMENTNOTAVAILABLE;
    if (disabled) return UIA_E_ELEMENTNOTENABLED;
    return queue_action(adapter, ACTION_SET_NUMBER, element->id, number, 0, 0, NULL);
}

static HRESULT range_value(void *self, double *out) {
    return get_double(ELEMENT(self, rangeValue), PROPERTY_RANGE_VALUE, out);
}

static HRESULT range_read_only(void *self, BOOL *out) {
    return get_bool(ELEMENT(self, rangeValue), PROPERTY_RANGE_IS_READ_ONLY, out);
}

static HRESULT range_maximum(void *self, double *out) {
    return get_double(ELEMENT(self, rangeValue), PROPERTY_RANGE_MAXIMUM, out);
}

static HRESULT range_minimum(void *self, double *out) {
    return get_double(ELEMENT(self, rangeValue), PROPERTY_RANGE_MINIMUM, out);
}

static HRESULT range_large(void *self, double *out) {
    return get_double(ELEMENT(self, rangeValue), PROPERTY_RANGE_LARGE_CHANGE, out);
}

static HRESULT range_small(void *self, double *out) {
    return get_double(ELEMENT(self, rangeValue), PROPERTY_RANGE_SMALL_CHANGE, out);
}

static void *const range_value_vtbl[] = {
    UNKNOWN_ENTRIES(rangeValue),
    (void *)range_set,
    (void *)range_value,
    (void *)range_read_only,
    (void *)range_maximum,
    (void *)range_minimum,
    (void *)range_large,
    (void *)range_small,
};

// --- IScrollItemProvider

static HRESULT scroll_into_view(void *self) {
    return act(ELEMENT(self, scrollItem), ACTION_SCROLL_INTO_VIEW, 0);
}

static void *const scroll_item_vtbl[] = {
    UNKNOWN_ENTRIES(scrollItem),
    (void *)scroll_into_view,
};

// --- ISelectionItemProvider

static HRESULT set_selected(Element *element, int selected) {
    Adapter *adapter = element->adapter;
    lock(adapter);
    Node *node = node_of(adapter, element->id);
    uint32_t flags = node ? node->flags : 0;
    unlock(adapter);
    if (!node) return UIA_E_ELEMENTNOTAVAILABLE;
    if (flags & FLAG_DISABLED) return UIA_E_ELEMENTNOTENABLED;
    if (((flags & FLAG_SELECTED) != 0) == (selected != 0)) return S_OK;
    return queue_action(adapter, ACTION_CLICK, element->id, 0, 0, 0, NULL);
}

static HRESULT item_select(void *self) {
    return set_selected(ELEMENT(self, selectionItem), 1);
}

static HRESULT item_add(void *self) {
    return set_selected(ELEMENT(self, selectionItem), 1);
}

static HRESULT item_remove(void *self) {
    return set_selected(ELEMENT(self, selectionItem), 0);
}

static HRESULT item_is_selected(void *self, BOOL *out) {
    if (!out) return E_POINTER;
    Element *element = ELEMENT(self, selectionItem);
    RESOLVE(element, node)
    *out = (node->flags & FLAG_SELECTED) != 0;
    unlock(adapter);
    return S_OK;
}

static HRESULT item_container(void *self, void **out) {
    if (!out) return E_POINTER;
    *out = NULL;
    Element *element = ELEMENT(self, selectionItem);
    RESOLVE(element, node)
    HRESULT result = E_FAIL;
    if (node->hasContainer && node_of(adapter, node->container)) {
        Element *container = element_of(adapter, node->container);
        if (container) {
            *out = &container->simple;
            result = S_OK;
        }
    }
    unlock(adapter);
    return result;
}

static void *const selection_item_vtbl[] = {
    UNKNOWN_ENTRIES(selectionItem),
    (void *)item_select,
    (void *)item_add,
    (void *)item_remove,
    (void *)item_is_selected,
    (void *)item_container,
};

// --- ISelectionProvider

static HRESULT selection_get(void *self, SAFEARRAY **out) {
    if (!out) return E_POINTER;
    *out = NULL;
    Element *element = ELEMENT(self, selection);
    RESOLVE(element, node)
    *out = element_array(adapter, node->selected, node->selectedCount);
    unlock(adapter);
    return *out ? S_OK : E_OUTOFMEMORY;
}

static HRESULT selection_multiple(void *self, BOOL *out) {
    return get_bool(ELEMENT(self, selection), PROPERTY_CAN_SELECT_MULTIPLE, out);
}

static HRESULT selection_required(void *self, BOOL *out) {
    return get_bool(ELEMENT(self, selection), PROPERTY_IS_SELECTION_REQUIRED, out);
}

static void *const selection_vtbl[] = {
    UNKNOWN_ENTRIES(selection),
    (void *)selection_get,
    (void *)selection_multiple,
    (void *)selection_required,
};

// --- IExpandCollapseProvider

static HRESULT set_expanded(Element *element, int expand) {
    Adapter *adapter = element->adapter;
    lock(adapter);
    Node *node = node_of(adapter, element->id);
    uint32_t flags = node ? node->flags : 0;
    unlock(adapter);
    if (!node) return UIA_E_ELEMENTNOTAVAILABLE;
    if (flags & FLAG_DISABLED) return UIA_E_ELEMENTNOTENABLED;
    if (!(flags & (FLAG_EXPANDED | FLAG_COLLAPSED))) return UIA_E_INVALIDOPERATION;
    if (((flags & FLAG_EXPANDED) != 0) == (expand != 0)) return UIA_E_INVALIDOPERATION;
    return queue_action(adapter, expand ? ACTION_EXPAND : ACTION_COLLAPSE, element->id, 0, 0, 0,
                        NULL);
}

static HRESULT expand_expand(void *self) {
    return set_expanded(ELEMENT(self, expandCollapse), 1);
}

static HRESULT expand_collapse(void *self) {
    return set_expanded(ELEMENT(self, expandCollapse), 0);
}

static HRESULT expand_state(void *self, int *out) {
    return get_int(ELEMENT(self, expandCollapse), PROPERTY_EXPAND_COLLAPSE_STATE, out);
}

static void *const expand_collapse_vtbl[] = {
    UNKNOWN_ENTRIES(expandCollapse),
    (void *)expand_expand,
    (void *)expand_collapse,
    (void *)expand_state,
};

// --- IWindowProvider

static HRESULT window_set_visual_state(void *self, int state) {
    return UIA_E_INVALIDOPERATION;
}

static HRESULT window_close(void *self) {
    return UIA_E_NOTSUPPORTED;
}

static HRESULT window_wait(void *self, int milliseconds, BOOL *out) {
    return UIA_E_NOTSUPPORTED;
}

static HRESULT window_not_supported_bool(void *self, BOOL *out) {
    return UIA_E_NOTSUPPORTED;
}

static HRESULT window_is_modal(void *self, BOOL *out) {
    return get_bool(ELEMENT(self, window), PROPERTY_WINDOW_IS_MODAL, out);
}

static HRESULT window_visual_state(void *self, int *out) {
    return UIA_E_NOTSUPPORTED;
}

static HRESULT window_interaction_state(void *self, int *out) {
    if (!out) return E_POINTER;
    *out = 2;  // WindowInteractionState_ReadyForUserInteraction
    return S_OK;
}

static void *const window_vtbl[] = {
    UNKNOWN_ENTRIES(window),
    (void *)window_set_visual_state,
    (void *)window_close,
    (void *)window_wait,
    (void *)window_not_supported_bool,
    (void *)window_not_supported_bool,
    (void *)window_is_modal,
    (void *)window_visual_state,
    (void *)window_interaction_state,
    (void *)window_not_supported_bool,
};

// ---------------------------------------------------------------------------------------------
// Text ranges, on UTF-16 offsets into the element's text.

static void *const *range_vtable(void);

static TextRange *range_new(Adapter *adapter, uint64_t id, uint32_t start, uint32_t end) {
    TextRange *range = alloc_zeroed(sizeof(TextRange));
    if (!range) return NULL;
    range->vtbl = range_vtable();
    range->refs = 1;
    range->adapter = adapter;
    range->id = id;
    range->start = start;
    range->end = end;
    adapter_retain(adapter);
    return range;
}

static TextRange *as_range(void *pointer) {
    TextRange *range = pointer;
    if (!range || range->vtbl != range_vtable()) return NULL;
    return range;
}

static HRESULT range_query(void *self, const GUID *iid, void **out) {
    if (!out) return E_POINTER;
    if (guid_equal(iid, &IID_IUnknown) || guid_equal(iid, &IID_TextRange)) {
        *out = self;
        atomic_increment(&((TextRange *)self)->refs);
        return S_OK;
    }
    *out = NULL;
    return E_NOINTERFACE;
}

static unsigned long range_add_ref(void *self) {
    return (unsigned long)atomic_increment(&((TextRange *)self)->refs);
}

static unsigned long range_release(void *self) {
    TextRange *range = self;
    long left = atomic_decrement(&range->refs);
    if (left == 0) {
        Adapter *adapter = range->adapter;
        release(range);
        adapter_release(adapter);
    }
    return (unsigned long)left;
}

// The text of the range's element, with the lock held; the range is clamped to it.
#define RESOLVE_TEXT(range, text)                                                                 \
    Adapter *adapter = (range)->adapter;                                                         \
    lock(adapter);                                                                                \
    Node *textNode = node_of(adapter, (range)->id);                                               \
    Text *text = textNode ? textNode->text : NULL;                                                \
    if (!text) {                                                                                  \
        unlock(adapter);                                                                          \
        return UIA_E_ELEMENTNOTAVAILABLE;                                                         \
    }                                                                                             \
    if ((range)->end > text->length) (range)->end = text->length;                                 \
    if ((range)->start > (range)->end) (range)->start = (range)->end;

typedef struct {
    const uint32_t *starts;  // stride-separated
    const uint32_t *ends;
    size_t stride;           // in uint32_t
    uint32_t count;
} Units;

static Units units_of(const Text *text, int unit) {
    Units u = {0};
    switch (unit) {
    case UNIT_CHARACTER:
        if (text->characterCount) {
            u.starts = &text->characters[0].start;
            u.ends = &text->characters[0].end;
            u.stride = sizeof(Character) / sizeof(uint32_t);
            u.count = text->characterCount;
        }
        break;
    case UNIT_FORMAT:
        if (text->runCount) {
            u.starts = &text->runs[0].start;
            u.ends = &text->runs[0].end;
            u.stride = sizeof(Run) / sizeof(uint32_t);
            u.count = text->runCount;
        }
        break;
    case UNIT_WORD:
    case UNIT_LINE:
    case UNIT_PARAGRAPH: {
        const Span *spans = unit == UNIT_WORD ? text->words : unit == UNIT_LINE ? text->lines : text->paragraphs;
        uint32_t count = unit == UNIT_WORD ? text->wordCount : unit == UNIT_LINE ? text->lineCount : text->paragraphCount;
        if (count) {
            u.starts = &spans[0].start;
            u.ends = &spans[0].end;
            u.stride = sizeof(Span) / sizeof(uint32_t);
            u.count = count;
        }
        break;
    }
    default:
        break;
    }
    return u;
}

static int valid_unit(int unit) {
    return unit >= UNIT_CHARACTER && unit <= UNIT_DOCUMENT;
}

static uint32_t unit_start(const Units *u, uint32_t i) {
    return u->starts[i * u->stride];
}

static uint32_t unit_end(const Units *u, uint32_t i) {
    return u->ends[i * u->stride];
}

static int is_unit_start(const Text *text, int unit, uint32_t pos) {
    if (unit == UNIT_PAGE || unit == UNIT_DOCUMENT) return pos == 0;
    Units u = units_of(text, unit);
    for (uint32_t i = 0; i < u.count; i++) {
        if (unit_start(&u, i) == pos) return 1;
    }
    return pos == 0;
}

static uint32_t forward_to_start(const Text *text, int unit, uint32_t pos) {
    if (unit == UNIT_PAGE || unit == UNIT_DOCUMENT) return text->length;
    Units u = units_of(text, unit);
    for (uint32_t i = 0; i < u.count; i++) {
        if (unit_start(&u, i) > pos) return unit_start(&u, i);
    }
    return text->length;
}

static uint32_t forward_to_end(const Text *text, int unit, uint32_t pos) {
    if (unit == UNIT_PAGE || unit == UNIT_DOCUMENT) return text->length;
    Units u = units_of(text, unit);
    for (uint32_t i = 0; i < u.count; i++) {
        if (unit_end(&u, i) > pos) return unit_end(&u, i);
    }
    return text->length;
}

static uint32_t backward(const Text *text, int unit, uint32_t pos) {
    if (unit == UNIT_PAGE || unit == UNIT_DOCUMENT) return 0;
    Units u = units_of(text, unit);
    uint32_t found = 0;
    for (uint32_t i = 0; i < u.count; i++) {
        if (unit_start(&u, i) < pos && unit_start(&u, i) >= found) found = unit_start(&u, i);
    }
    return found;
}

static uint32_t back_to_unit_start(const Text *text, int unit, uint32_t pos) {
    return is_unit_start(text, unit, pos) ? pos : backward(text, unit, pos);
}

static uint32_t move_position(const Text *text, uint32_t pos, int unit, int toEnd, int count, int *moved) {
    int forward = count > 0;
    int steps = count < 0 ? -count : count;
    int done = 0;
    for (int i = 0; i < steps; i++) {
        if (forward ? pos >= text->length : pos == 0) break;
        if (forward) pos = toEnd ? forward_to_end(text, unit, pos) : forward_to_start(text, unit, pos);
        else pos = backward(text, unit, pos);
        done++;
    }
    *moved = forward ? done : -done;
    return pos;
}

static void set_start(TextRange *range, uint32_t pos) {
    range->start = pos;
    if (range->end < pos) range->end = pos;
}

static void set_end(TextRange *range, uint32_t pos) {
    range->end = pos;
    if (range->start > pos) range->start = pos;
}

static HRESULT text_range_clone(void *self, void **out) {
    if (!out) return E_POINTER;
    TextRange *range = self;
    TextRange *copy = range_new(range->adapter, range->id, range->start, range->end);
    *out = copy;
    return copy ? S_OK : E_OUTOFMEMORY;
}

static HRESULT text_range_compare(void *self, void *other, BOOL *out) {
    if (!out) return E_POINTER;
    TextRange *range = self;
    TextRange *theirs = as_range(other);
    if (!theirs) return E_INVALIDARG;
    *out = theirs->adapter == range->adapter && theirs->id == range->id &&
           theirs->start == range->start && theirs->end == range->end;
    return S_OK;
}

static HRESULT text_range_compare_endpoints(void *self, int endpoint, void *other, int otherEndpoint, int *out) {
    if (!out) return E_POINTER;
    TextRange *range = self;
    TextRange *theirs = as_range(other);
    if (!theirs || (endpoint != 0 && endpoint != 1) || (otherEndpoint != 0 && otherEndpoint != 1)) {
        return E_INVALIDARG;
    }
    if (theirs != range && (theirs->adapter != range->adapter || theirs->id != range->id)) {
        return E_INVALIDARG;
    }
    uint32_t mine = endpoint == 0 ? range->start : range->end;
    uint32_t that = otherEndpoint == 0 ? theirs->start : theirs->end;
    *out = mine < that ? -1 : mine > that ? 1 : 0;
    return S_OK;
}

static HRESULT text_range_expand(void *self, int unit) {
    TextRange *range = self;
    if (!valid_unit(unit)) return E_INVALIDARG;
    RESOLVE_TEXT(range, text)
    if (unit == UNIT_DOCUMENT) {
        range->start = 0;
        range->end = text->length;
    } else if (!(unit == UNIT_CHARACTER && range->start >= text->length)) {
        uint32_t start = back_to_unit_start(text, unit, range->start);
        set_start(range, start);
        if (start < text->length) set_end(range, forward_to_end(text, unit, start));
    }
    unlock(adapter);
    return S_OK;
}

static HRESULT text_range_find(void *self, int id, VARIANT value, BOOL backward_, void **out) {
    if (!out) return E_POINTER;
    *out = NULL;
    return S_OK;
}

static HRESULT text_range_find_text(void *self, BSTR text, BOOL backward_, BOOL ignoreCase, void **out) {
    if (!out) return E_POINTER;
    *out = NULL;
    return S_OK;
}

static int is_line_end(const Text *text, uint32_t pos) {
    if (pos == text->length) return 1;
    for (uint32_t i = 0; i < text->lineCount; i++) {
        if (text->lines[i].end == pos) return 1;
    }
    return 0;
}

static int is_line_start(const Text *text, uint32_t pos) {
    if (pos == 0) return 1;
    for (uint32_t i = 0; i < text->lineCount; i++) {
        if (text->lines[i].start == pos) return 1;
    }
    return 0;
}

static int supported_attribute(int id) {
    switch (id) {
    case 40001:
    case 40004:
    case 40005:
    case 40006:
    case 40007:
    case 40008:
    case 40009:
    case 40014:
    case 40016:
    case 40017:
    case 40023:
    case 40024:
    case 40025:
    case 40026:
    case 40029:
    case 40030:
        return 1;
    default:
        return 0;
    }
}

static const Value *run_attribute(const Run *run, int id) {
    for (uint32_t i = 0; i < run->count; i++) {
        if (run->attributes[i].id == (uint32_t)id) return &run->attributes[i];
    }
    return NULL;
}

static HRESULT reserved(VARIANT *out, int mixed) {
    void *value = NULL;
    HRESULT result = mixed ? UiaGetReservedMixedAttributeValue(&value) : UiaGetReservedNotSupportedValue(&value);
    if (result == S_OK) {
        out->vt = VT_UNKNOWN;
        out->u.punkVal = value;
    }
    return result;
}

static HRESULT text_range_attribute(void *self, int id, VARIANT *out) {
    if (!out) return E_POINTER;
    out->vt = VT_EMPTY;
    out->u.llVal = 0;
    TextRange *range = self;
    RESOLVE_TEXT(range, text)
    HRESULT result = S_OK;
    int mixed = 0;
    int unsupported = 0;
    if (id == ATTRIBUTE_IS_READ_ONLY) {
        out->vt = VT_BOOL;
        out->u.boolVal = (textNode->flags & FLAG_READ_ONLY) ? -1 : 0;
    } else if (id == ATTRIBUTE_CARET_POSITION) {
        int position = 0;  // CaretPosition_Unknown
        if (range->start == range->end) {
            if (is_line_start(text, range->start)) position = 2;  // BeginningOfLine
            else if (is_line_end(text, range->start)) position = 1;  // EndOfLine
        }
        out->vt = VT_I4;
        out->u.lVal = position;
    } else if (supported_attribute(id)) {
        const Value *first = NULL;
        int seen = 0;
        for (uint32_t i = 0; i < text->runCount; i++) {
            const Run *run = &text->runs[i];
            int overlaps = range->start == range->end
                               ? (run->start <= range->start && (range->start < run->end || i + 1 == text->runCount))
                               : (run->start < range->end && run->end > range->start);
            if (!overlaps) continue;
            const Value *value = run_attribute(run, id);
            if (!seen) {
                first = value;
                seen = 1;
            } else if (!value_equal(first, value)) {
                mixed = 1;
                break;
            }
        }
        if (!mixed && first) result = variant_of(out, first, id == ATTRIBUTE_CULTURE);
    } else {
        unsupported = 1;
    }
    unlock(adapter);
    if (mixed) return reserved(out, 1);
    if (unsupported) return reserved(out, 0);
    return result;
}

static HRESULT text_range_rectangles(void *self, SAFEARRAY **out) {
    if (!out) return E_POINTER;
    *out = NULL;
    TextRange *range = self;
    HWND hwnd = range->adapter->hwnd;
    POINT origin = client_origin(hwnd);
    RESOLVE_TEXT(range, text)
    uint32_t lines = text->lineCount;
    double *rects = alloc_zeroed(((size_t)lines + 1) * 4 * sizeof(double));
    uint32_t count = 0;
    for (uint32_t l = 0; rects && l < lines && range->start < range->end; l++) {
        uint32_t from = text->lines[l].start > range->start ? text->lines[l].start : range->start;
        uint32_t to = text->lines[l].end < range->end ? text->lines[l].end : range->end;
        if (from >= to) continue;
        int any = 0;
        double box[4] = {0, 0, 0, 0};
        for (uint32_t c = 0; c < text->characterCount; c++) {
            const Character *ch = &text->characters[c];
            if (ch->start < from || ch->end > to) continue;
            if (!any) {
                for (int k = 0; k < 4; k++) box[k] = ch->box[k];
                any = 1;
            } else {
                if (ch->box[0] < box[0]) box[0] = ch->box[0];
                if (ch->box[1] < box[1]) box[1] = ch->box[1];
                if (ch->box[2] > box[2]) box[2] = ch->box[2];
                if (ch->box[3] > box[3]) box[3] = ch->box[3];
            }
        }
        if (!any) continue;
        rects[count * 4 + 0] = box[0] + origin.x;
        rects[count * 4 + 1] = box[1] + origin.y;
        rects[count * 4 + 2] = box[2] - box[0];
        rects[count * 4 + 3] = box[3] - box[1];
        count++;
    }
    unlock(adapter);
    if (count) {
        SAFEARRAY *array = SafeArrayCreateVector(VT_R8, 0, count * 4);
        for (long i = 0; array && i < (long)(count * 4); i++) SafeArrayPutElement(array, &i, &rects[i]);
        *out = array;
    }
    release(rects);
    return S_OK;
}

static HRESULT text_range_enclosing(void *self, void **out) {
    if (!out) return E_POINTER;
    *out = NULL;
    TextRange *range = self;
    Adapter *adapter = range->adapter;
    lock(adapter);
    HRESULT result = UIA_E_ELEMENTNOTAVAILABLE;
    if (node_of(adapter, range->id)) {
        Element *element = element_of(adapter, range->id);
        if (element) {
            *out = &element->simple;
            result = S_OK;
        }
    }
    unlock(adapter);
    return result;
}

static HRESULT text_range_text(void *self, int maxLength, BSTR *out) {
    if (!out) return E_POINTER;
    *out = NULL;
    TextRange *range = self;
    RESOLVE_TEXT(range, text)
    // UI Automation lets providers return more than `maxLength`, as AccessKit does.
    *out = SysAllocStringLen(text->units + range->start, range->end - range->start);
    unlock(adapter);
    return *out ? S_OK : E_OUTOFMEMORY;
}

static HRESULT text_range_move(void *self, int unit, int count, int *out) {
    if (!out) return E_POINTER;
    *out = 0;
    TextRange *range = self;
    if (!valid_unit(unit)) return E_INVALIDARG;
    RESOLVE_TEXT(range, text)
    int degenerate = range->start == range->end;
    uint32_t start = degenerate ? range->start : back_to_unit_start(text, unit, range->start);
    int moved = 0;
    start = move_position(text, start, unit, 0, count, &moved);
    if (moved != 0) {
        range->start = start;
        range->end = (degenerate || start >= text->length) ? start : forward_to_end(text, unit, start);
    }
    unlock(adapter);
    *out = moved;
    return S_OK;
}

static HRESULT text_range_move_endpoint(void *self, int endpoint, int unit, int count, int *out) {
    if (!out) return E_POINTER;
    *out = 0;
    TextRange *range = self;
    if (!valid_unit(unit) || (endpoint != 0 && endpoint != 1)) return E_INVALIDARG;
    RESOLVE_TEXT(range, text)
    int moved = 0;
    uint32_t pos = move_position(text, endpoint == 0 ? range->start : range->end, unit, endpoint == 1, count, &moved);
    if (endpoint == 0) set_start(range, pos);
    else set_end(range, pos);
    unlock(adapter);
    *out = moved;
    return S_OK;
}

static HRESULT text_range_move_by_range(void *self, int endpoint, void *other, int otherEndpoint) {
    TextRange *range = self;
    TextRange *theirs = as_range(other);
    if (!theirs || theirs->adapter != range->adapter || theirs->id != range->id) return E_INVALIDARG;
    if ((endpoint != 0 && endpoint != 1) || (otherEndpoint != 0 && otherEndpoint != 1)) return E_INVALIDARG;
    uint32_t pos = otherEndpoint == 0 ? theirs->start : theirs->end;
    if (endpoint == 0) set_start(range, pos);
    else set_end(range, pos);
    return S_OK;
}

static HRESULT text_range_select(void *self) {
    TextRange *range = self;
    Adapter *adapter = range->adapter;
    lock(adapter);
    int present = node_of(adapter, range->id) != NULL;
    unlock(adapter);
    if (!present) return UIA_E_ELEMENTNOTAVAILABLE;
    return queue_action(adapter, ACTION_SET_SELECTION, range->id, 0, range->start, range->end, NULL);
}

static HRESULT text_range_invalid(void *self) {
    // AccessKit supports a single text selection.
    return UIA_E_INVALIDOPERATION;
}

static HRESULT text_range_scroll(void *self, BOOL alignToTop) {
    TextRange *range = self;
    Adapter *adapter = range->adapter;
    lock(adapter);
    int present = node_of(adapter, range->id) != NULL;
    unlock(adapter);
    if (!present) return UIA_E_ELEMENTNOTAVAILABLE;
    uint32_t pos = alignToTop ? range->start : range->end;
    return queue_action(adapter, ACTION_SCROLL_TEXT, range->id, alignToTop ? 1.0 : 0.0, pos, pos, NULL);
}

static HRESULT text_range_children(void *self, SAFEARRAY **out) {
    if (!out) return E_POINTER;
    // Text holds no embedded objects.
    *out = SafeArrayCreateVector(VT_UNKNOWN, 0, 0);
    return *out ? S_OK : E_OUTOFMEMORY;
}

static void *const text_range_vtbl[] = {
    (void *)range_query,
    (void *)range_add_ref,
    (void *)range_release,
    (void *)text_range_clone,
    (void *)text_range_compare,
    (void *)text_range_compare_endpoints,
    (void *)text_range_expand,
    (void *)text_range_find,
    (void *)text_range_find_text,
    (void *)text_range_attribute,
    (void *)text_range_rectangles,
    (void *)text_range_enclosing,
    (void *)text_range_text,
    (void *)text_range_move,
    (void *)text_range_move_endpoint,
    (void *)text_range_move_by_range,
    (void *)text_range_select,
    (void *)text_range_invalid,
    (void *)text_range_invalid,
    (void *)text_range_scroll,
    (void *)text_range_children,
};

static void *const *range_vtable(void) {
    return text_range_vtbl;
}

// --- ITextProvider

static HRESULT text_selection(void *self, SAFEARRAY **out) {
    if (!out) return E_POINTER;
    *out = NULL;
    Element *element = ELEMENT(self, text);
    RESOLVE(element, node)
    Text *text = node->text;
    if (!text) {
        unlock(adapter);
        return UIA_E_ELEMENTNOTAVAILABLE;
    }
    int has = text->hasSelection;
    uint32_t start = text->anchor < text->focus ? text->anchor : text->focus;
    uint32_t end = text->anchor < text->focus ? text->focus : text->anchor;
    unlock(adapter);
    if (!has) return S_OK;
    TextRange *range = range_new(adapter, element->id, start, end);
    if (!range) return E_OUTOFMEMORY;
    SAFEARRAY *array = SafeArrayCreateVector(VT_UNKNOWN, 0, 1);
    if (array) {
        long index = 0;
        SafeArrayPutElement(array, &index, range);
    }
    range_release(range);
    *out = array;
    return array ? S_OK : E_OUTOFMEMORY;
}

static HRESULT text_visible_ranges(void *self, SAFEARRAY **out) {
    if (!out) return E_POINTER;
    *out = NULL;
    return S_OK;
}

static HRESULT text_range_from_child(void *self, void *child, void **out) {
    if (!out) return E_POINTER;
    *out = NULL;
    return E_NOTIMPL;
}

static HRESULT text_range_from_point(void *self, UiaPoint point, void **out) {
    if (!out) return E_POINTER;
    *out = NULL;
    Element *element = ELEMENT(self, text);
    POINT origin = client_origin(element->adapter->hwnd);
    RESOLVE(element, node)
    Text *text = node->text;
    if (!text) {
        unlock(adapter);
        return UIA_E_ELEMENTNOTAVAILABLE;
    }
    double x = point.x - origin.x;
    double y = point.y - origin.y;
    // The nearest character, and its side.
    uint32_t pos = text->length;
    double best = -1;
    for (uint32_t i = 0; i < text->characterCount; i++) {
        const Character *ch = &text->characters[i];
        double dx = x < ch->box[0] ? ch->box[0] - x : x > ch->box[2] ? x - ch->box[2] : 0;
        double dy = y < ch->box[1] ? ch->box[1] - y : y > ch->box[3] ? y - ch->box[3] : 0;
        double distance = dx * dx + dy * dy * 4;
        if (best < 0 || distance < best) {
            best = distance;
            pos = x > (ch->box[0] + ch->box[2]) / 2 ? ch->end : ch->start;
        }
    }
    unlock(adapter);
    TextRange *range = range_new(adapter, element->id, pos, pos);
    *out = range;
    return range ? S_OK : E_OUTOFMEMORY;
}

static HRESULT text_document_range(void *self, void **out) {
    if (!out) return E_POINTER;
    *out = NULL;
    Element *element = ELEMENT(self, text);
    RESOLVE(element, node)
    uint32_t length = node->text ? node->text->length : 0;
    int has = node->text != NULL;
    unlock(adapter);
    if (!has) return UIA_E_ELEMENTNOTAVAILABLE;
    TextRange *range = range_new(adapter, element->id, 0, length);
    *out = range;
    return range ? S_OK : E_OUTOFMEMORY;
}

static HRESULT text_supported_selection(void *self, int *out) {
    if (!out) return E_POINTER;
    Element *element = ELEMENT(self, text);
    RESOLVE(element, node)
    *out = node->text && node->text->hasSelection ? 1 : 0;
    unlock(adapter);
    return S_OK;
}

static void *const text_vtbl[] = {
    UNKNOWN_ENTRIES(text),
    (void *)text_selection,
    (void *)text_visible_ranges,
    (void *)text_range_from_child,
    (void *)text_range_from_point,
    (void *)text_document_range,
    (void *)text_supported_selection,
};

static Element *element_new(Adapter *adapter, uint64_t id) {
    Element *element = alloc_zeroed(sizeof(Element));
    if (!element) return NULL;
    element->simple = simple_vtbl;
    element->fragment = fragment_vtbl;
    element->fragmentRoot = fragment_root_vtbl;
    element->toggle = toggle_vtbl;
    element->invoke = invoke_vtbl;
    element->value = value_vtbl;
    element->rangeValue = range_value_vtbl;
    element->scrollItem = scroll_item_vtbl;
    element->selectionItem = selection_item_vtbl;
    element->selection = selection_vtbl;
    element->text = text_vtbl;
    element->expandCollapse = expand_collapse_vtbl;
    element->window = window_vtbl;
    element->refs = 1;  // The adapter's.
    element->adapter = adapter;
    element->id = id;
    adapter_retain(adapter);
    return element;
}

// ---------------------------------------------------------------------------------------------
// Windows and their adapters.

#define MAX_WINDOWS 64

static SRWLOCK windows_lock;
static Adapter *windows[MAX_WINDOWS];

static Adapter *adapter_for_window(HWND hwnd) {
    Adapter *found = NULL;
    AcquireSRWLockExclusive(&windows_lock);
    for (int i = 0; i < MAX_WINDOWS; i++) {
        if (windows[i] && windows[i]->hwnd == hwnd) {
            found = windows[i];
            adapter_retain(found);
            break;
        }
    }
    ReleaseSRWLockExclusive(&windows_lock);
    return found;
}

static LRESULT subclass_proc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    Adapter *adapter = adapter_for_window(hwnd);
    if (!adapter) return DefWindowProcW(hwnd, message, wParam, lParam);
    WNDPROC previous = adapter->previous;
    if (message == WM_GETOBJECT && (long)lParam == UIA_ROOT_OBJECT_ID) {
        lock(adapter);
        Element *root = NULL;
        if (adapter->hasRoot && node_of(adapter, adapter->root)) root = element_of(adapter, adapter->root);
        unlock(adapter);
        if (root) {
            LRESULT result = UiaReturnRawElementProvider(hwnd, wParam, lParam, &root->simple);
            element_release(root);
            adapter_release(adapter);
            return result;
        }
    }
    if (message == WM_NCDESTROY) {
        // Disconnect the providers from the window that goes away.
        UiaReturnRawElementProvider(hwnd, 0, 0, NULL);
    }
    adapter_release(adapter);
    return previous ? CallWindowProcW(previous, hwnd, message, wParam, lParam)
                    : DefWindowProcW(hwnd, message, wParam, lParam);
}

static uint64_t attach(HWND hwnd, int ownsWindow) {
    if (!hwnd) return 0;
    Adapter *adapter = alloc_zeroed(sizeof(Adapter));
    if (!adapter) return 0;
    adapter->refs = 1;  // The handle's.
    adapter->hwnd = hwnd;
    adapter->ownsWindow = ownsWindow;
    AcquireSRWLockExclusive(&windows_lock);
    int slot = -1;
    for (int i = 0; i < MAX_WINDOWS; i++) {
        if (!windows[i]) {
            slot = i;
            break;
        }
    }
    if (slot >= 0) windows[slot] = adapter;
    ReleaseSRWLockExclusive(&windows_lock);
    if (slot < 0) {
        release(adapter);
        return 0;
    }
    adapter->previous = (WNDPROC)GetWindowLongPtrW(hwnd, GWLP_WNDPROC);
    SetWindowLongPtrW(hwnd, GWLP_WNDPROC, (LONG_PTR)subclass_proc);
    return (uint64_t)(uintptr_t)adapter;
}

static Adapter *from_handle(uint64_t handle) {
    return (Adapter *)(uintptr_t)handle;
}

uint64_t silk_ak_win_attach(uint64_t hwnd) {
    return attach((HWND)(uintptr_t)hwnd, 0);
}

static const WCHAR test_class[] = {'S', 'i', 'l', 'k', 'A', 'K', 'T', 'e', 's', 't', 0};
static const WCHAR test_title[] = {'S', 'i', 'l', 'k', ' ', 'A', 'c', 'c', 'e', 's', 's', 'K', 'i', 't', 0};

uint64_t silk_ak_win_attach_test(void) {
    static int registered;
    HINSTANCE instance = (HINSTANCE)&__ImageBase;
    if (!registered) {
        WNDCLASSW windowClass = {0};
        windowClass.proc = DefWindowProcW;
        windowClass.instance = instance;
        windowClass.className = test_class;
        registered = RegisterClassW(&windowClass) != 0;
    }
    HWND hwnd = CreateWindowExW(0, test_class, test_title, WS_OVERLAPPEDWINDOW, CW_USEDEFAULT,
                                CW_USEDEFAULT, 400, 300, NULL, NULL, instance, NULL);
    return attach(hwnd, 1);
}

void silk_ak_win_detach(uint64_t handle) {
    Adapter *adapter = from_handle(handle);
    if (!adapter) return;
    AcquireSRWLockExclusive(&windows_lock);
    for (int i = 0; i < MAX_WINDOWS; i++) {
        if (windows[i] == adapter) windows[i] = NULL;
    }
    ReleaseSRWLockExclusive(&windows_lock);
    if ((WNDPROC)GetWindowLongPtrW(adapter->hwnd, GWLP_WNDPROC) == subclass_proc) {
        SetWindowLongPtrW(adapter->hwnd, GWLP_WNDPROC, (LONG_PTR)adapter->previous);
    }
    // Take the elements out under the lock, then disconnect them without it.
    lock(adapter);
    adapter->detached = 1;
    size_t count = adapter->elements.count;
    Element **elements = alloc_zeroed((count + 1) * sizeof(Element *));
    size_t n = 0;
    for (size_t i = 0; i < adapter->elements.capacity; i++) {
        if (!adapter->elements.used[i]) continue;
        if (elements) elements[n++] = adapter->elements.values[i];
    }
    map_free(&adapter->elements);
    unlock(adapter);
    for (size_t i = 0; i < n; i++) {
        UiaDisconnectProvider(&elements[i]->simple);
        element_release(elements[i]);
    }
    release(elements);
    if (adapter->ownsWindow) DestroyWindow(adapter->hwnd);
    adapter_release(adapter);
}

void silk_ak_win_set_node(uint64_t handle, uint64_t id, const uint8_t *record, size_t length) {
    Adapter *adapter = from_handle(handle);
    Node *node = parse_node(id, record, length);
    if (!node) return;
    lock(adapter);
    Node *old = map_put(&adapter->nodes, id, node);
    unlock(adapter);
    free_node(old);
}

void silk_ak_win_remove_node(uint64_t handle, uint64_t id) {
    Adapter *adapter = from_handle(handle);
    lock(adapter);
    Node *node = map_remove(&adapter->nodes, id);
    Element *element = map_remove(&adapter->elements, id);
    unlock(adapter);
    free_node(node);
    if (element) {
        UiaDisconnectProvider(&element->simple);
        element_release(element);
    }
}

void silk_ak_win_set_root(uint64_t handle, uint64_t id) {
    Adapter *adapter = from_handle(handle);
    lock(adapter);
    adapter->hasRoot = 1;
    adapter->root = id;
    unlock(adapter);
}

void silk_ak_win_set_focus(uint64_t handle, uint32_t has, uint64_t id) {
    Adapter *adapter = from_handle(handle);
    lock(adapter);
    adapter->hasFocus = has != 0;
    adapter->focus = id;
    unlock(adapter);
}

// The element of `id` for an event; a removed node gets an element of its own, which answers
// that it is gone, as AccessKit's do.
static Element *event_element(Adapter *adapter, uint64_t id) {
    lock(adapter);
    Element *element = node_of(adapter, id) ? element_of(adapter, id) : element_new(adapter, id);
    unlock(adapter);
    return element;
}

void silk_ak_win_raise_event(uint64_t handle, uint64_t id, int event) {
    Adapter *adapter = from_handle(handle);
    if (!UiaClientsAreListening()) return;
    Element *element = event_element(adapter, id);
    if (!element) return;
    UiaRaiseAutomationEvent(&element->simple, event);
    element_release(element);
}

static void read_event_value(const uint8_t *bytes, size_t length, Value *value) {
    Reader r = {bytes, length, 0, 0};
    value->id = 0;
    read_value(&r, value);
}

void silk_ak_win_raise_property(uint64_t handle, uint64_t id, int property, const uint8_t *old,
                                size_t oldLength, const uint8_t *new, size_t newLength) {
    Adapter *adapter = from_handle(handle);
    if (!UiaClientsAreListening()) return;
    Element *element = event_element(adapter, id);
    if (!element) return;
    VARIANT before = {0};
    VARIANT after = {0};
    if (property == PROPERTY_CONTROLLER_FOR) {
        // The controlled elements as the record has them now.
        lock(adapter);
        Node *node = node_of(adapter, id);
        if (node && node->controlCount) {
            SAFEARRAY *array = element_array(adapter, node->controls, node->controlCount);
            if (array) {
                after.vt = VT_ARRAY | VT_UNKNOWN;
                after.u.parray = array;
            }
        }
        unlock(adapter);
    } else {
        Value value;
        read_event_value(old, oldLength, &value);
        variant_of(&before, &value, property == PROPERTY_CULTURE);
        read_event_value(new, newLength, &value);
        variant_of(&after, &value, property == PROPERTY_CULTURE);
    }
    UiaRaiseAutomationPropertyChangedEvent(&element->simple, property, before, after);
    VariantClear(&before);
    VariantClear(&after);
    element_release(element);
}

uint32_t silk_ak_win_poll(uint64_t handle, uint64_t *id, double *number, uint32_t *start, uint32_t *end) {
    Adapter *adapter = from_handle(handle);
    lock(adapter);
    if (!adapter->actionCount) {
        unlock(adapter);
        return 0;
    }
    Action action = adapter->actions[0];
    for (size_t i = 1; i < adapter->actionCount; i++) adapter->actions[i - 1] = adapter->actions[i];
    adapter->actionCount--;
    release(adapter->actionText);
    adapter->actionText = action.text;
    adapter->actionTextLength = action.textLength;
    unlock(adapter);
    *id = action.id;
    *number = action.number;
    *start = action.start;
    *end = action.end;
    return action.kind;
}

static size_t copy_out(const uint8_t *bytes, size_t length, uint8_t *output, size_t capacity) {
    if (output && capacity >= length && length) memcpy(output, bytes, length);
    return length;
}

size_t silk_ak_win_action_text(uint64_t handle, uint8_t *output, size_t capacity) {
    Adapter *adapter = from_handle(handle);
    lock(adapter);
    size_t length = copy_out(adapter->actionText, adapter->actionTextLength, output, capacity);
    unlock(adapter);
    return length;
}

// ---------------------------------------------------------------------------------------------
// Test helpers: what the providers report, through their own COM interfaces.

typedef struct {
    uint8_t *bytes;
    size_t length;
    size_t capacity;
} Out;

static void out_bytes(Out *out, const uint8_t *bytes, size_t length) {
    if (out->length + length > out->capacity) {
        size_t capacity = (out->capacity + length) * 2 + 64;
        uint8_t *grown = alloc_zeroed(capacity);
        if (!grown) return;
        if (out->length) memcpy(grown, out->bytes, out->length);
        release(out->bytes);
        out->bytes = grown;
        out->capacity = capacity;
    }
    memcpy(out->bytes + out->length, bytes, length);
    out->length += length;
}

static void out_text(Out *out, const char *text) {
    size_t n = 0;
    while (text[n]) n++;
    out_bytes(out, (const uint8_t *)text, n);
}

static void out_number(Out *out, uint64_t value) {
    char digits[24];
    int n = 0;
    do {
        digits[n++] = (char)('0' + value % 10);
        value /= 10;
    } while (value);
    char ordered[24];
    for (int i = 0; i < n; i++) ordered[i] = digits[n - 1 - i];
    out_bytes(out, (const uint8_t *)ordered, (size_t)n);
}

static void out_wide(Out *out, const WCHAR *text, size_t units) {
    WCHAR *copy = alloc_zeroed((units + 1) * sizeof(WCHAR));
    if (!copy) return;
    for (size_t i = 0; i < units; i++) copy[i] = text[i];
    size_t length = 0;
    uint8_t *utf8 = to_utf8(copy, &length);
    release(copy);
    if (utf8) out_bytes(out, utf8, length);
    release(utf8);
}

static size_t bstr_length(BSTR text) {
    // A BSTR has its byte length just before it.
    return text ? ((const uint32_t *)text)[-1] / sizeof(WCHAR) : 0;
}

static void out_line_bstr(Out *out, const char *name, BSTR text) {
    out_text(out, name);
    out_text(out, ": ");
    out_wide(out, text, bstr_length(text));
    out_text(out, "\n");
}

static void out_line_number(Out *out, const char *name, uint64_t value) {
    out_text(out, name);
    out_text(out, ": ");
    out_number(out, value);
    out_text(out, "\n");
}

typedef HRESULT (*UnknownRelease)(void *);
typedef HRESULT (*GetPropertyFn)(void *, int, VARIANT *);
typedef HRESULT (*GetPatternFn)(void *, int, void **);
typedef HRESULT (*NavigateFn)(void *, int, void **);
typedef HRESULT (*GetPointerFn)(void *, void **);
typedef HRESULT (*GetBstrFn)(void *, BSTR *);
typedef HRESULT (*NoArgumentFn)(void *);
typedef HRESULT (*MoveByRangeFn)(void *, int, void *, int);
typedef HRESULT (*ExpandFn)(void *, int);
typedef HRESULT (*GetTextFn)(void *, int, BSTR *);

static void *method(void *object, int index) {
    return (*(void *const *const *)object)[index];
}

static void com_release(void *object) {
    if (object) ((UnknownRelease)method(object, 2))(object);
}

// The id of the element behind interface pointer `fragment` of ours.
static uint64_t fragment_id(void *fragment) {
    return ELEMENT(fragment, fragment)->id;
}

static void describe_element(Adapter *adapter, uint64_t id, Out *out) {
    lock(adapter);
    Element *element = node_of(adapter, id) ? element_of(adapter, id) : NULL;
    unlock(adapter);
    if (!element) return;
    void *simple = &element->simple;
    VARIANT v = {0};
    if (((GetPropertyFn)method(simple, 5))(simple, PROPERTY_CONTROL_TYPE, &v) == S_OK && v.vt == VT_I4) {
        out_line_number(out, "control type", (uint64_t)(uint32_t)v.u.lVal);
    }
    VariantClear(&v);
    if (((GetPropertyFn)method(simple, 5))(simple, PROPERTY_NAME, &v) == S_OK && v.vt == VT_BSTR) {
        out_line_bstr(out, "name", v.u.bstrVal);
    }
    VariantClear(&v);
    if (((GetPropertyFn)method(simple, 5))(simple, PROPERTY_HAS_KEYBOARD_FOCUS, &v) == S_OK && v.vt == VT_BOOL) {
        out_line_number(out, "focused", v.u.boolVal ? 1 : 0);
    }
    VariantClear(&v);

    void *pattern = NULL;
    ((GetPatternFn)method(simple, 4))(simple, PATTERN_ID_INVOKE, &pattern);
    out_line_number(out, "invoke", pattern != NULL);
    com_release(pattern);

    pattern = NULL;
    ((GetPatternFn)method(simple, 4))(simple, PATTERN_ID_VALUE, &pattern);
    if (pattern) {
        BSTR text = NULL;
        if (((GetBstrFn)method(pattern, 4))(pattern, &text) == S_OK) out_line_bstr(out, "value", text);
        SysFreeString(text);
        com_release(pattern);
    }

    pattern = NULL;
    ((GetPatternFn)method(simple, 4))(simple, PATTERN_ID_TEXT, &pattern);
    if (pattern) {
        void *document = NULL;
        if (((GetPointerFn)method(pattern, 7))(pattern, &document) == S_OK && document) {
            BSTR text = NULL;
            ((GetTextFn)method(document, 12))(document, -1, &text);
            out_line_bstr(out, "document", text);
            SysFreeString(text);
            // The first word: collapse to the start and expand.
            ((MoveByRangeFn)method(document, 15))(document, 1, document, 0);
            ((ExpandFn)method(document, 6))(document, UNIT_WORD);
            text = NULL;
            ((GetTextFn)method(document, 12))(document, -1, &text);
            out_line_bstr(out, "word 1", text);
            SysFreeString(text);
            com_release(document);
        }
        com_release(pattern);
    }

    void *fragment = &element->fragment;
    void *found = NULL;
    ((NavigateFn)method(fragment, 3))(fragment, 0, &found);
    if (found) {
        out_line_number(out, "parent", fragment_id(found));
        com_release(found);
    }
    found = NULL;
    ((NavigateFn)method(fragment, 3))(fragment, 3, &found);
    if (found) {
        out_line_number(out, "first child", fragment_id(found));
        com_release(found);
    }
    void *root = &element->fragmentRoot;
    found = NULL;
    ((GetPointerFn)method(root, 4))(root, &found);
    if (found) {
        out_line_number(out, "focus", fragment_id(found));
        com_release(found);
    }
    element_release(element);
}

size_t silk_ak_win_describe(uint64_t handle, uint64_t id, uint8_t *output, size_t capacity) {
    Adapter *adapter = from_handle(handle);
    Out out = {0};
    if (id == UINT64_MAX) {
        LRESULT result = SendMessageW(adapter->hwnd, WM_GETOBJECT, 0, UIA_ROOT_OBJECT_ID);
        out_line_number(&out, "provider", result != 0);
    } else {
        describe_element(adapter, id, &out);
    }
    size_t length = copy_out(out.bytes, out.length, output, capacity);
    release(out.bytes);
    return length;
}

uint32_t silk_ak_win_perform(uint64_t handle, uint64_t id, uint32_t kind) {
    Adapter *adapter = from_handle(handle);
    lock(adapter);
    Element *element = node_of(adapter, id) ? element_of(adapter, id) : NULL;
    unlock(adapter);
    if (!element) return 0;
    void *simple = &element->simple;
    HRESULT result = E_FAIL;
    void *pattern = NULL;
    switch (kind) {
    case ACTION_CLICK:
        ((GetPatternFn)method(simple, 4))(simple, PATTERN_ID_INVOKE, &pattern);
        if (pattern) {
            result = ((NoArgumentFn)method(pattern, 3))(pattern);
            break;
        }
        ((GetPatternFn)method(simple, 4))(simple, PATTERN_ID_TOGGLE, &pattern);
        if (pattern) {
            result = ((NoArgumentFn)method(pattern, 3))(pattern);
            break;
        }
        ((GetPatternFn)method(simple, 4))(simple, PATTERN_ID_SELECTION_ITEM, &pattern);
        if (pattern) result = ((NoArgumentFn)method(pattern, 3))(pattern);
        break;
    case ACTION_FOCUS:
        result = ((NoArgumentFn)method(&element->fragment, 7))(&element->fragment);
        break;
    case ACTION_EXPAND:
    case ACTION_COLLAPSE:
        ((GetPatternFn)method(simple, 4))(simple, PATTERN_ID_EXPAND_COLLAPSE, &pattern);
        if (pattern) result = ((NoArgumentFn)method(pattern, kind == ACTION_EXPAND ? 3 : 4))(pattern);
        break;
    case ACTION_SCROLL_INTO_VIEW:
        ((GetPatternFn)method(simple, 4))(simple, PATTERN_ID_SCROLL_ITEM, &pattern);
        if (pattern) result = ((NoArgumentFn)method(pattern, 3))(pattern);
        break;
    default:
        break;
    }
    com_release(pattern);
    element_release(element);
    return result == S_OK;
}
