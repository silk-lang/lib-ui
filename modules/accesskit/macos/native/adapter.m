// The AppKit side of AccessKit's macOS adapter in Silk.
//
// Ported from AccessKit (accesskit_macos: node.rs, adapter.rs, subclass.rs, event.rs and
// util.rs), Copyright 2022 The AccessKit Authors, under the MIT or Apache-2.0 license.
//
// AccessKit's elements ask the tree on every call. Here the Silk side (src/adapter.silk) sends a
// record per element whenever it changes (src/record.silk describes the layout), and these
// elements answer AppKit from it. The view's class is swapped for a subclass, as AccessKit's
// SubclassingAdapter does, so that its accessibility children are these elements. What
// VoiceOver asks the application to do is queued for the Silk side to poll.

#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>
#include <stdint.h>
#include <string.h>

// Record tags and flags: keep in step with src/record.silk.
enum {
    TAG_ROLE = 1,
    TAG_SUBROLE = 2,
    TAG_ROLE_DESCRIPTION = 3,
    TAG_IDENTIFIER = 4,
    TAG_TITLE = 5,
    TAG_HELP = 6,
    TAG_PLACEHOLDER = 7,
    TAG_VALUE_BOOL = 8,
    TAG_VALUE_NUMBER = 9,
    TAG_VALUE_TEXT = 10,
    TAG_MIN_VALUE = 11,
    TAG_MAX_VALUE = 12,
    TAG_URL = 13,
    TAG_ORIENTATION = 14,
    TAG_FLAGS = 15,
    TAG_FRAME = 16,
    TAG_PARENT = 17,
    TAG_CHILDREN = 18,
    TAG_SELECTED_CHILDREN = 19,
    TAG_LINKED = 20,
    TAG_TABS = 21,
    TAG_BRAILLE_LABEL = 22,
    TAG_BRAILLE_ROLE_DESCRIPTION = 23,
    TAG_DOM_IDENTIFIER = 24,
    TAG_ROWS = 25,
    TAG_TEXT = 26,
};

enum {
    FLAG_FOCUSED = 1u << 0,
    FLAG_ENABLED = 1u << 1,
    FLAG_REQUIRED = 1u << 2,
    FLAG_SELECTED = 1u << 3,
    FLAG_MODAL = 1u << 4,
    FLAG_FOCUSABLE = 1u << 5,
    FLAG_CLICKABLE = 1u << 6,
    FLAG_INCREMENT = 1u << 7,
    FLAG_DECREMENT = 1u << 8,
    FLAG_TEXT = 1u << 9,
    FLAG_ITEM_LIKE = 1u << 10,
    FLAG_PICKABLE = 1u << 11,
    FLAG_SELECTABLE_CONTAINER = 1u << 12,
    FLAG_TAB_LIST = 1u << 13,
    FLAG_DIALOG = 1u << 14,
    FLAG_SCROLL = 1u << 15,
    FLAG_URL = 1u << 16,
    FLAG_SET_VALUE = 1u << 17,
    FLAG_HAS_FRAME = 1u << 18,
    FLAG_IS_SELECTED = 1u << 19,
    FLAG_IS_UNSELECTED = 1u << 20,
    FLAG_ATTRIBUTES = 1u << 21,
    FLAG_ROOT = 1u << 22,
    FLAG_HAS_PARENT = 1u << 23,
};

// Action kinds: keep in step with the ACTION_ functions of src/adapter.silk.
enum {
    ACTION_CLICK = 1,
    ACTION_FOCUS = 2,
    ACTION_BLUR = 3,
    ACTION_INCREMENT = 4,
    ACTION_DECREMENT = 5,
    ACTION_SET_TEXT = 6,
    ACTION_SET_NUMBER = 7,
    ACTION_SET_SELECTION = 8,
    ACTION_SCROLL_INTO_VIEW = 9,
};

// Notification codes: keep in step with Notification.code in src/events.silk.
enum {
    NOTIFY_FOCUS = 1,
    NOTIFY_VALUE = 2,
    NOTIFY_TITLE = 3,
    NOTIFY_SELECTED_TEXT = 4,
    NOTIFY_SELECTED_ROWS = 5,
};

static const uint64_t VIEW_ID = UINT64_MAX;
static NSString *const SCROLL_TO_VISIBLE_ACTION = @"AXScrollToVisible";

typedef struct {
    double x0, y0, x1, y1;
} SilkAKBox;

typedef struct {
    uint32_t start, end;
} SilkAKSpan;

typedef struct {
    uint32_t start, end;
    SilkAKBox box;
} SilkAKCharacter;

// Record reading -------------------------------------------------------------------------------

typedef struct {
    const uint8_t *data;
    size_t length;
    size_t at;
} SilkAKReader;

static uint8_t read_u8(SilkAKReader *r) {
    if (r->at >= r->length) return 0;
    return r->data[r->at++];
}

static uint64_t read_little(SilkAKReader *r, size_t count) {
    uint64_t value = 0;
    for (size_t i = 0; i < count; i++) value |= ((uint64_t)read_u8(r)) << (8 * i);
    return value;
}

static uint32_t read_u32(SilkAKReader *r) { return (uint32_t)read_little(r, 4); }
static uint64_t read_u64(SilkAKReader *r) { return read_little(r, 8); }

static double read_f64(SilkAKReader *r) {
    uint64_t bits = read_little(r, 8);
    double value;
    memcpy(&value, &bits, sizeof value);
    return value;
}

static NSString *read_text(SilkAKReader *r) {
    size_t length = read_u32(r);
    if (length > r->length - r->at) length = r->length - r->at;
    NSString *text = [[NSString alloc] initWithBytes:r->data + r->at length:length encoding:NSUTF8StringEncoding];
    r->at += length;
    return text ?: @"";
}

static NSArray<NSNumber *> *read_ids(SilkAKReader *r) {
    uint32_t count = read_u32(r);
    NSMutableArray<NSNumber *> *ids = [NSMutableArray arrayWithCapacity:count];
    for (uint32_t i = 0; i < count && r->at < r->length; i++) [ids addObject:@(read_u64(r))];
    return ids;
}

static SilkAKBox read_box(SilkAKReader *r) {
    SilkAKBox box;
    box.x0 = read_f64(r);
    box.y0 = read_f64(r);
    box.x1 = read_f64(r);
    box.y1 = read_f64(r);
    return box;
}

static id read_color(SilkAKReader *r) {
    double red = read_u8(r) / 255.0, green = read_u8(r) / 255.0, blue = read_u8(r) / 255.0;
    double alpha = read_u8(r) / 255.0;
    NSColor *color = [NSColor colorWithSRGBRed:red green:green blue:blue alpha:alpha];
    return CFBridgingRelease(CGColorRetain(color.CGColor));
}

// Elements ------------------------------------------------------------------------------------

@class SilkAKAdapter;

@interface SilkAKRun : NSObject
@property(nonatomic) uint32_t start, end;
@property(nonatomic, strong) NSDictionary<NSAttributedStringKey, id> *attributes;
@end

@implementation SilkAKRun
@end

@interface SilkAKNode : NSAccessibilityElement
@property(nonatomic, weak) SilkAKAdapter *adapter;
@property(nonatomic) uint64_t nodeId, parentId;
@property(nonatomic, copy) NSString *roleName, *subroleName, *roleDescriptionText, *identifierText;
@property(nonatomic, copy) NSString *titleText, *helpText, *placeholderText, *urlText;
@property(nonatomic, copy) NSString *brailleLabel, *brailleRoleDescription, *domIdentifier;
@property(nonatomic, strong) id valueObject;
@property(nonatomic, strong) NSNumber *minValue, *maxValue;
@property(nonatomic) NSAccessibilityOrientation orientationValue;
@property(nonatomic) uint32_t flags;
@property(nonatomic) SilkAKBox box;
@property(nonatomic, copy) NSArray<NSNumber *> *childIds, *selectedIds, *linkedIds, *tabIds, *rowIds;
@property(nonatomic, copy) NSString *text;
@property(nonatomic) NSUInteger textLength;
@property(nonatomic) BOOL hasSelection;
@property(nonatomic) NSRange selection;
@property(nonatomic) NSInteger insertionLine;
@property(nonatomic, strong) NSData *lines, *characters;
@property(nonatomic, copy) NSArray<SilkAKRun *> *runs;
- (void)load:(const uint8_t *)record length:(size_t)length;
@end

@interface SilkAKAction : NSObject
@property(nonatomic) uint32_t kind;
@property(nonatomic) uint64_t nodeId;
@property(nonatomic) double number;
@property(nonatomic) uint32_t start, end;
@property(nonatomic, copy) NSString *text;
@end

@implementation SilkAKAction
@end

@interface SilkAKAdapter : NSObject
@property(nonatomic, weak) NSView *view;
@property(nonatomic, strong) NSView *ownedView;
@property(nonatomic) Class originalClass;
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, SilkAKNode *> *nodes;
@property(nonatomic, copy) NSArray<NSNumber *> *rootIds;
@property(nonatomic) BOOL hasFocus;
@property(nonatomic) uint64_t focusId;
@property(nonatomic, strong) NSMutableArray<SilkAKAction *> *queue;
@property(nonatomic, strong) SilkAKAction *current;
// Set once assistive technology has asked the view for its elements.
@property(nonatomic) BOOL requested;
@end

@implementation SilkAKAdapter

- (instancetype)init {
    if ((self = [super init])) {
        _nodes = [NSMutableDictionary new];
        _rootIds = @[];
        _queue = [NSMutableArray new];
    }
    return self;
}

- (NSArray *)elements:(NSArray<NSNumber *> *)ids {
    NSMutableArray *out = [NSMutableArray arrayWithCapacity:ids.count];
    for (NSNumber *one in ids) {
        SilkAKNode *node = self.nodes[one];
        if (node) [out addObject:node];
    }
    return out;
}

- (void)enqueue:(uint32_t)kind node:(uint64_t)nodeId {
    SilkAKAction *action = [SilkAKAction new];
    action.kind = kind;
    action.nodeId = nodeId;
    action.text = @"";
    [self.queue addObject:action];
}

// AccessKit coordinates are physical pixels from the view's top left; AppKit wants logical
// screen coordinates.
- (NSRect)screenRect:(SilkAKBox)box {
    NSView *view = self.view;
    if (!view) return NSZeroRect;
    NSWindow *window = view.window;
    double factor = window ? window.backingScaleFactor : 1.0;
    if (factor <= 0) factor = 1.0;
    NSRect rect;
    rect.origin.x = box.x0 / factor;
    rect.origin.y = view.isFlipped ? box.y0 / factor : view.bounds.size.height - box.y1 / factor;
    rect.size.width = (box.x1 - box.x0) / factor;
    rect.size.height = (box.y1 - box.y0) / factor;
    if (!window) return rect;
    rect = [view convertRect:rect toView:nil];
    return [window convertRectToScreen:rect];
}

- (NSPoint)treePoint:(NSPoint)point {
    NSView *view = self.view;
    if (!view) return point;
    NSWindow *window = view.window;
    double factor = window ? window.backingScaleFactor : 1.0;
    if (factor <= 0) factor = 1.0;
    if (window) {
        point = [window convertPointFromScreen:point];
        point = [view convertPoint:point fromView:nil];
    }
    double y = view.isFlipped ? point.y : view.bounds.size.height - point.y;
    return NSMakePoint(point.x * factor, y * factor);
}

static BOOL box_contains(SilkAKBox box, NSPoint point) {
    return point.x >= box.x0 && point.x < box.x1 && point.y >= box.y0 && point.y < box.y1;
}

- (SilkAKNode *)hit:(SilkAKNode *)node at:(NSPoint)point depth:(int)depth {
    if (depth > 512) return nil;
    for (NSNumber *child in [node.childIds reverseObjectEnumerator]) {
        SilkAKNode *found = [self hit:self.nodes[child] at:point depth:depth + 1];
        if (found) return found;
    }
    if ((node.flags & FLAG_HAS_FRAME) && box_contains(node.box, point)) return node;
    return nil;
}

- (id)hitTest:(NSPoint)screenPoint {
    NSPoint point = [self treePoint:screenPoint];
    for (NSNumber *root in [self.rootIds reverseObjectEnumerator]) {
        SilkAKNode *node = self.nodes[root];
        if (!node) continue;
        SilkAKNode *found = [self hit:node at:point depth:0];
        if (found) return found;
    }
    SilkAKNode *first = self.rootIds.count ? self.nodes[self.rootIds[0]] : nil;
    return first ?: self.view;
}

- (id)focusedElement {
    if (!self.hasFocus) return nil;
    return self.nodes[@(self.focusId)];
}

@end

@implementation SilkAKNode

- (void)load:(const uint8_t *)record length:(size_t)length {
    self.roleName = NSAccessibilityUnknownRole;
    self.subroleName = nil;
    self.roleDescriptionText = nil;
    self.identifierText = nil;
    self.titleText = nil;
    self.helpText = nil;
    self.placeholderText = nil;
    self.urlText = nil;
    self.brailleLabel = nil;
    self.brailleRoleDescription = nil;
    self.domIdentifier = nil;
    self.valueObject = nil;
    self.minValue = nil;
    self.maxValue = nil;
    self.orientationValue = NSAccessibilityOrientationUnknown;
    self.flags = 0;
    self.box = (SilkAKBox){0, 0, 0, 0};
    self.parentId = 0;
    self.childIds = @[];
    self.selectedIds = nil;
    self.linkedIds = nil;
    self.tabIds = nil;
    self.rowIds = nil;
    self.text = nil;
    self.textLength = 0;
    self.hasSelection = NO;
    self.selection = NSMakeRange(0, 0);
    self.insertionLine = 0;
    self.lines = nil;
    self.characters = nil;
    self.runs = nil;
    SilkAKReader reader = {record, length, 0};
    SilkAKReader *r = &reader;
    while (r->at < r->length) {
        uint8_t tag = read_u8(r);
        switch (tag) {
        case TAG_ROLE: self.roleName = read_text(r); break;
        case TAG_SUBROLE: self.subroleName = read_text(r); break;
        case TAG_ROLE_DESCRIPTION: self.roleDescriptionText = read_text(r); break;
        case TAG_IDENTIFIER: self.identifierText = read_text(r); break;
        case TAG_TITLE: self.titleText = read_text(r); break;
        case TAG_HELP: self.helpText = read_text(r); break;
        case TAG_PLACEHOLDER: self.placeholderText = read_text(r); break;
        case TAG_VALUE_BOOL: self.valueObject = @(read_u8(r) != 0); break;
        case TAG_VALUE_NUMBER: self.valueObject = @(read_f64(r)); break;
        case TAG_VALUE_TEXT: self.valueObject = read_text(r); break;
        case TAG_MIN_VALUE: self.minValue = @(read_f64(r)); break;
        case TAG_MAX_VALUE: self.maxValue = @(read_f64(r)); break;
        case TAG_URL: self.urlText = read_text(r); break;
        case TAG_ORIENTATION: {
            uint8_t value = read_u8(r);
            self.orientationValue = value == 1 ? NSAccessibilityOrientationVertical
                : value == 2 ? NSAccessibilityOrientationHorizontal : NSAccessibilityOrientationUnknown;
            break;
        }
        case TAG_FLAGS: self.flags = read_u32(r); break;
        case TAG_FRAME: self.box = read_box(r); break;
        case TAG_PARENT: self.parentId = read_u64(r); break;
        case TAG_CHILDREN: self.childIds = read_ids(r); break;
        case TAG_SELECTED_CHILDREN: self.selectedIds = read_ids(r); break;
        case TAG_LINKED: self.linkedIds = read_ids(r); break;
        case TAG_TABS: self.tabIds = read_ids(r); break;
        case TAG_BRAILLE_LABEL: self.brailleLabel = read_text(r); break;
        case TAG_BRAILLE_ROLE_DESCRIPTION: self.brailleRoleDescription = read_text(r); break;
        case TAG_DOM_IDENTIFIER: self.domIdentifier = read_text(r); break;
        case TAG_ROWS: self.rowIds = read_ids(r); break;
        case TAG_TEXT: [self loadText:r]; break;
        default: r->at = r->length; break;
        }
    }
}

- (void)loadText:(SilkAKReader *)r {
    self.text = read_text(r);
    self.textLength = read_u32(r);
    self.hasSelection = read_u8(r) != 0;
    uint32_t start = read_u32(r), end = read_u32(r);
    self.selection = NSMakeRange(start, end >= start ? end - start : 0);
    self.insertionLine = read_u32(r);
    uint32_t count = read_u32(r);
    NSMutableData *lines = [NSMutableData dataWithLength:count * sizeof(SilkAKSpan)];
    SilkAKSpan *line = lines.mutableBytes;
    for (uint32_t i = 0; i < count; i++) {
        line[i].start = read_u32(r);
        line[i].end = read_u32(r);
    }
    self.lines = lines;
    count = read_u32(r);
    NSMutableData *characters = [NSMutableData dataWithLength:count * sizeof(SilkAKCharacter)];
    SilkAKCharacter *character = characters.mutableBytes;
    for (uint32_t i = 0; i < count; i++) {
        character[i].start = read_u32(r);
        character[i].end = read_u32(r);
        character[i].box = read_box(r);
    }
    self.characters = characters;
    count = read_u32(r);
    NSMutableArray<SilkAKRun *> *runs = [NSMutableArray arrayWithCapacity:count];
    for (uint32_t i = 0; i < count && r->at < r->length; i++) {
        SilkAKRun *run = [SilkAKRun new];
        run.start = read_u32(r);
        run.end = read_u32(r);
        NSMutableDictionary *attributes = [NSMutableDictionary new];
        NSMutableDictionary *font = [NSMutableDictionary new];
        BOOL more = YES;
        while (more && r->at < r->length) {
            uint8_t tag = read_u8(r);
            switch (tag) {
            case 0: more = NO; break;
            case 1: font[NSAccessibilityFontFamilyKey] = read_text(r); break;
            case 2: font[NSAccessibilityFontSizeKey] = @(read_f64(r)); break;
            case 3: font[@"AXFontBold"] = @YES; break;
            case 4: font[@"AXFontItalic"] = @YES; break;
            case 5:
                attributes[NSAccessibilityUnderlineTextAttribute] = @YES;
                attributes[NSAccessibilityUnderlineColorTextAttribute] = read_color(r);
                break;
            case 6:
                attributes[NSAccessibilityStrikethroughTextAttribute] = @YES;
                attributes[NSAccessibilityStrikethroughColorTextAttribute] = read_color(r);
                break;
            case 7: attributes[NSAccessibilityBackgroundColorTextAttribute] = read_color(r); break;
            case 8: attributes[NSAccessibilityForegroundColorTextAttribute] = read_color(r); break;
            case 9: attributes[NSAccessibilityLanguageTextAttribute] = read_text(r); break;
            case 10: {
                uint8_t align = read_u8(r);
                NSTextAlignment value = align == 1 ? NSTextAlignmentCenter
                    : align == 2 ? NSTextAlignmentRight
                    : align == 3 ? NSTextAlignmentJustified : NSTextAlignmentLeft;
                attributes[NSAccessibilityTextAlignmentAttribute] = @(value);
                break;
            }
            default: more = NO; r->at = r->length; break;
            }
        }
        if (font.count) attributes[NSAccessibilityFontTextAttribute] = font;
        run.attributes = attributes;
        [runs addObject:run];
    }
    self.runs = runs;
}

- (BOOL)has:(uint32_t)flag { return (self.flags & flag) != 0; }

- (NSUInteger)lineCount { return self.lines.length / sizeof(SilkAKSpan); }
- (const SilkAKSpan *)lineAt:(NSUInteger)i { return ((const SilkAKSpan *)self.lines.bytes) + i; }
- (NSUInteger)characterCount { return self.characters.length / sizeof(SilkAKCharacter); }
- (const SilkAKCharacter *)characterAt:(NSUInteger)i {
    return ((const SilkAKCharacter *)self.characters.bytes) + i;
}

// The character holding UTF-16 index `index`, or NSNotFound.
- (NSUInteger)characterIndexFor:(NSUInteger)index {
    NSUInteger count = [self characterCount];
    for (NSUInteger i = 0; i < count; i++) {
        const SilkAKCharacter *one = [self characterAt:i];
        if (index >= one->start && index < one->end) return i;
    }
    return NSNotFound;
}

// The NSRange AccessKit gives for the character at `index`: empty at the end of the text.
- (NSRange)characterRangeFor:(NSUInteger)index {
    NSUInteger found = [self characterIndexFor:index];
    if (found == NSNotFound) return NSMakeRange(MIN(index, self.textLength), 0);
    const SilkAKCharacter *one = [self characterAt:found];
    return NSMakeRange(one->start, one->end - one->start);
}

- (NSRange)clamped:(NSRange)range {
    NSUInteger length = self.text.length;
    NSUInteger start = MIN(range.location, length);
    NSUInteger end = MIN(range.location + range.length, length);
    if (range.location > length || range.length > length) end = length;
    return NSMakeRange(start, end >= start ? end - start : 0);
}

// NSAccessibility ------------------------------------------------------------------------------

- (BOOL)isAccessibilityElement { return YES; }

- (id)accessibilityParent {
    SilkAKAdapter *adapter = self.adapter;
    if ([self has:FLAG_HAS_PARENT]) {
        SilkAKNode *parent = adapter.nodes[@(self.parentId)];
        if (parent) return parent;
    }
    return adapter.view.accessibilityParent;
}

- (id)accessibilityWindow { return self.adapter.view.accessibilityParent; }
- (id)accessibilityTopLevelUIElement { return self.adapter.view.accessibilityParent; }

- (NSArray *)accessibilityChildren { return [self.adapter elements:self.childIds]; }
- (NSArray *)accessibilityChildrenInNavigationOrder { return [self accessibilityChildren]; }

- (NSArray *)accessibilitySelectedChildren {
    if (![self has:FLAG_SELECTABLE_CONTAINER]) return nil;
    return [self.adapter elements:self.selectedIds ?: @[]];
}

- (NSRect)accessibilityFrame {
    SilkAKAdapter *adapter = self.adapter;
    if (![self has:FLAG_HAS_FRAME]) {
        if ([self has:FLAG_ROOT] && adapter.view) return adapter.view.accessibilityFrame;
        return NSZeroRect;
    }
    return [adapter screenRect:self.box];
}

- (NSAccessibilityRole)accessibilityRole { return self.roleName ?: NSAccessibilityUnknownRole; }
- (NSAccessibilitySubrole)accessibilitySubrole { return self.subroleName; }

- (NSString *)accessibilityRoleDescription {
    if (self.roleDescriptionText) return self.roleDescriptionText;
    return [super accessibilityRoleDescription];
}

- (NSString *)accessibilityIdentifier { return self.identifierText; }
- (NSString *)accessibilityTitle { return self.titleText; }
- (NSString *)accessibilityHelp { return self.helpText; }
- (NSString *)accessibilityPlaceholderValue { return self.placeholderText; }
- (id)accessibilityValue { return self.valueObject; }

- (void)setAccessibilityValue:(id)value {
    SilkAKAction *action = [SilkAKAction new];
    action.nodeId = self.nodeId;
    action.text = @"";
    if ([value isKindOfClass:[NSString class]]) {
        action.kind = ACTION_SET_TEXT;
        action.text = value;
    } else if ([value isKindOfClass:[NSNumber class]]) {
        action.kind = ACTION_SET_NUMBER;
        action.number = [value doubleValue];
    } else {
        return;
    }
    [self.adapter.queue addObject:action];
}

- (id)accessibilityMinValue { return self.minValue; }
- (id)accessibilityMaxValue { return self.maxValue; }

- (NSURL *)accessibilityURL {
    if (![self has:FLAG_URL] || !self.urlText) return nil;
    return [NSURL URLWithString:self.urlText];
}

- (NSAccessibilityOrientation)accessibilityOrientation { return self.orientationValue; }
- (BOOL)isAccessibilityFocused { return [self has:FLAG_FOCUSED]; }
- (BOOL)isAccessibilityEnabled { return [self has:FLAG_ENABLED]; }

- (void)setAccessibilityFocused:(BOOL)focused {
    if (focused) {
        if ([self has:FLAG_FOCUSABLE]) [self.adapter enqueue:ACTION_FOCUS node:self.nodeId];
    } else {
        [self.adapter enqueue:ACTION_BLUR node:self.nodeId];
    }
}

- (BOOL)accessibilityPerformPress {
    BOOL clickable = [self has:FLAG_CLICKABLE];
    if (clickable) [self.adapter enqueue:ACTION_CLICK node:self.nodeId];
    return clickable;
}

- (BOOL)accessibilityPerformIncrement {
    BOOL supported = [self has:FLAG_INCREMENT];
    if (supported) [self.adapter enqueue:ACTION_INCREMENT node:self.nodeId];
    return supported;
}

- (BOOL)accessibilityPerformDecrement {
    BOOL supported = [self has:FLAG_DECREMENT];
    if (supported) [self.adapter enqueue:ACTION_DECREMENT node:self.nodeId];
    return supported;
}

- (BOOL)accessibilityNotifiesWhenDestroyed { return YES; }

- (NSInteger)accessibilityNumberOfCharacters { return [self has:FLAG_TEXT] ? (NSInteger)self.textLength : 0; }

- (NSString *)accessibilitySelectedText {
    if (![self has:FLAG_TEXT] || !self.hasSelection) return nil;
    return [self.text substringWithRange:[self clamped:self.selection]];
}

- (NSRange)accessibilitySelectedTextRange {
    if (![self has:FLAG_TEXT] || !self.hasSelection) return NSMakeRange(0, 0);
    return self.selection;
}

- (NSInteger)accessibilityInsertionPointLineNumber {
    if (![self has:FLAG_TEXT] || !self.hasSelection) return 0;
    return self.insertionLine;
}

- (NSRange)accessibilityRangeForLine:(NSInteger)line {
    if (![self has:FLAG_TEXT] || line < 0 || (NSUInteger)line >= [self lineCount]) return NSMakeRange(0, 0);
    const SilkAKSpan *span = [self lineAt:(NSUInteger)line];
    return NSMakeRange(span->start, span->end >= span->start ? span->end - span->start : 0);
}

- (NSRange)accessibilityRangeForPosition:(NSPoint)screenPoint {
    if (![self has:FLAG_TEXT]) return NSMakeRange(0, 0);
    NSPoint point = [self.adapter treePoint:screenPoint];
    NSUInteger count = [self characterCount];
    NSUInteger best = NSNotFound;
    double bestDistance = 0;
    for (NSUInteger i = 0; i < count; i++) {
        const SilkAKCharacter *one = [self characterAt:i];
        if (box_contains(one->box, point)) {
            best = i;
            break;
        }
        // Rows count before columns: the nearest line, then the nearest character on it.
        double dy = point.y < one->box.y0 ? one->box.y0 - point.y : point.y > one->box.y1 ? point.y - one->box.y1 : 0;
        double dx = point.x < one->box.x0 ? one->box.x0 - point.x : point.x > one->box.x1 ? point.x - one->box.x1 : 0;
        double distance = dy * 1e6 + dx;
        if (best == NSNotFound || distance < bestDistance) {
            best = i;
            bestDistance = distance;
        }
    }
    if (best == NSNotFound) return NSMakeRange(self.textLength, 0);
    const SilkAKCharacter *one = [self characterAt:best];
    return NSMakeRange(one->start, one->end - one->start);
}

- (NSString *)accessibilityStringForRange:(NSRange)range {
    if (![self has:FLAG_TEXT] || !self.text) return nil;
    return [self.text substringWithRange:[self clamped:range]];
}

- (NSAttributedString *)accessibilityAttributedStringForRange:(NSRange)range {
    if (![self has:FLAG_TEXT] || !self.text) return nil;
    NSRange wanted = [self clamped:range];
    NSMutableAttributedString *result = [NSMutableAttributedString new];
    [result beginEditing];
    NSUInteger end = wanted.location + wanted.length;
    for (SilkAKRun *run in self.runs) {
        NSUInteger from = MAX(wanted.location, (NSUInteger)run.start);
        NSUInteger to = MIN(end, (NSUInteger)run.end);
        if (to <= from) continue;
        NSRange part = [self clamped:NSMakeRange(from, to - from)];
        NSString *piece = [self.text substringWithRange:part];
        [result appendAttributedString:[[NSAttributedString alloc] initWithString:piece attributes:run.attributes]];
    }
    if (result.length == 0 && wanted.length > 0) {
        [result appendAttributedString:[[NSAttributedString alloc] initWithString:[self.text substringWithRange:wanted]]];
    }
    [result endEditing];
    return result;
}

- (NSRect)accessibilityFrameForRange:(NSRange)range {
    if (![self has:FLAG_TEXT]) return NSZeroRect;
    NSUInteger count = [self characterCount];
    NSUInteger end = range.location + range.length;
    BOOL found = NO;
    SilkAKBox all = {0, 0, 0, 0};
    for (NSUInteger i = 0; i < count; i++) {
        const SilkAKCharacter *one = [self characterAt:i];
        BOOL inside = range.length == 0 ? (range.location >= one->start && range.location < one->end)
                                        : (one->end > range.location && one->start < end);
        if (!inside) continue;
        SilkAKBox box = one->box;
        if (range.length == 0) box.x1 = box.x0;
        if (!found) {
            all = box;
            found = YES;
        } else {
            all.x0 = MIN(all.x0, box.x0);
            all.y0 = MIN(all.y0, box.y0);
            all.x1 = MAX(all.x1, box.x1);
            all.y1 = MAX(all.y1, box.y1);
        }
    }
    if (!found && range.length == 0 && count > 0 && range.location >= [self characterAt:count - 1]->end) {
        // The caret after the last character.
        all = [self characterAt:count - 1]->box;
        all.x0 = all.x1;
        found = YES;
    }
    if (!found) return NSZeroRect;
    return [self.adapter screenRect:all];
}

- (NSInteger)accessibilityLineForIndex:(NSInteger)index {
    if (![self has:FLAG_TEXT] || index < 0) return 0;
    NSUInteger count = [self lineCount];
    for (NSUInteger i = 0; i < count; i++) {
        const SilkAKSpan *span = [self lineAt:i];
        if ((NSUInteger)index >= span->start && ((NSUInteger)index < span->end || i + 1 == count)) return (NSInteger)i;
    }
    return 0;
}

- (NSRange)accessibilityRangeForIndex:(NSInteger)index {
    if (![self has:FLAG_TEXT] || index < 0) return NSMakeRange(0, 0);
    return [self characterRangeFor:(NSUInteger)index];
}

- (NSRange)accessibilityStyleRangeForIndex:(NSInteger)index {
    if (![self has:FLAG_TEXT] || index < 0) return NSMakeRange(0, 0);
    for (SilkAKRun *run in self.runs) {
        if ((NSUInteger)index >= run.start && (NSUInteger)index < run.end) {
            return NSMakeRange(run.start, run.end - run.start);
        }
    }
    SilkAKRun *last = self.runs.lastObject;
    if (last && (NSUInteger)index >= last.start) return NSMakeRange(last.start, last.end - last.start);
    return NSMakeRange(0, 0);
}

- (void)setAccessibilitySelectedTextRange:(NSRange)range {
    if (![self has:FLAG_TEXT]) return;
    NSRange clamped = [self clamped:range];
    SilkAKAction *action = [SilkAKAction new];
    action.kind = ACTION_SET_SELECTION;
    action.nodeId = self.nodeId;
    action.start = (uint32_t)clamped.location;
    action.end = (uint32_t)(clamped.location + clamped.length);
    action.text = @"";
    [self.adapter.queue addObject:action];
}

- (BOOL)isAccessibilityRequired { return [self has:FLAG_REQUIRED]; }
- (BOOL)isAccessibilitySelected { return [self has:FLAG_SELECTED]; }

- (void)setAccessibilitySelected:(BOOL)selected {
    if (![self has:FLAG_PICKABLE]) return;
    if (selected ? [self has:FLAG_IS_SELECTED] : [self has:FLAG_IS_UNSELECTED]) return;
    [self.adapter enqueue:ACTION_CLICK node:self.nodeId];
}

- (id)accessibilityAttributeValue:(NSAccessibilityAttributeName)attribute {
    if ([attribute isEqualToString:@"AXBrailleLabel"] && self.brailleLabel) return self.brailleLabel;
    if ([attribute isEqualToString:@"AXBrailleRoleDescription"] && self.brailleRoleDescription) {
        return self.brailleRoleDescription;
    }
    if ([attribute isEqualToString:@"AXDOMIdentifier"] && self.domIdentifier) return self.domIdentifier;
    return nil;
}

- (NSArray *)accessibilityRows {
    if (![self has:FLAG_SELECTABLE_CONTAINER]) return nil;
    return [self.adapter elements:self.rowIds ?: @[]];
}

- (NSArray *)accessibilitySelectedRows { return [self accessibilitySelectedChildren]; }

- (BOOL)accessibilityPerformPick {
    BOOL pickable = [self has:FLAG_PICKABLE];
    if (pickable) [self.adapter enqueue:ACTION_CLICK node:self.nodeId];
    return pickable;
}

- (NSArray *)accessibilityLinkedUIElements {
    if (!self.linkedIds.count) return nil;
    return [self.adapter elements:self.linkedIds];
}

- (NSArray *)accessibilityTabs {
    if (![self has:FLAG_TAB_LIST]) return nil;
    return [self.adapter elements:self.tabIds ?: @[]];
}

- (BOOL)isAccessibilityModal { return [self has:FLAG_MODAL]; }

// The older informal protocol only needs to cover the actions the newer methods do not.
- (NSArray<NSString *> *)accessibilityActionNames {
    return [self has:FLAG_SCROLL] ? @[ SCROLL_TO_VISIBLE_ACTION ] : @[];
}

- (void)accessibilityPerformAction:(NSString *)action {
    if ([action isEqualToString:SCROLL_TO_VISIBLE_ACTION]) {
        [self.adapter enqueue:ACTION_SCROLL_INTO_VIEW node:self.nodeId];
    }
}

- (BOOL)isAccessibilitySelectorAllowed:(SEL)selector {
    if (selector == @selector(setAccessibilityFocused:)) return [self has:FLAG_FOCUSABLE];
    if (selector == @selector(accessibilityPerformPress)) return [self has:FLAG_CLICKABLE];
    if (selector == @selector(accessibilityPerformIncrement)) return [self has:FLAG_INCREMENT];
    if (selector == @selector(accessibilityPerformDecrement)) return [self has:FLAG_DECREMENT];
    if (selector == @selector(accessibilityNumberOfCharacters) || selector == @selector(accessibilitySelectedText)
        || selector == @selector(accessibilitySelectedTextRange)
        || selector == @selector(accessibilityInsertionPointLineNumber)
        || selector == @selector(accessibilityRangeForLine:) || selector == @selector(accessibilityRangeForPosition:)
        || selector == @selector(accessibilityStringForRange:)
        || selector == @selector(accessibilityAttributedStringForRange:)
        || selector == @selector(accessibilityFrameForRange:) || selector == @selector(accessibilityLineForIndex:)
        || selector == @selector(accessibilityRangeForIndex:)
        || selector == @selector(accessibilityStyleRangeForIndex:)
        || selector == @selector(setAccessibilitySelectedTextRange:)) {
        return [self has:FLAG_TEXT];
    }
    if (selector == @selector(setAccessibilityValue:)) return [self has:FLAG_SET_VALUE];
    if (selector == @selector(isAccessibilitySelected)) return [self has:FLAG_ITEM_LIKE];
    if (selector == @selector(accessibilityRows) || selector == @selector(accessibilitySelectedRows)) {
        return [self has:FLAG_SELECTABLE_CONTAINER];
    }
    if (selector == @selector(setAccessibilitySelected:) || selector == @selector(accessibilityPerformPick)) {
        return [self has:FLAG_PICKABLE];
    }
    if (selector == @selector(accessibilityTabs)) return [self has:FLAG_TAB_LIST];
    if (selector == @selector(isAccessibilityModal)) return [self has:FLAG_DIALOG];
    if (selector == @selector(accessibilityAttributeValue:)) return [self has:FLAG_ATTRIBUTES];
    if (selector == @selector(accessibilityURL)) return [self has:FLAG_URL];
    return selector == @selector(accessibilityParent) || selector == @selector(accessibilityChildren)
        || selector == @selector(accessibilityChildrenInNavigationOrder)
        || selector == @selector(accessibilitySelectedChildren) || selector == @selector(accessibilityFrame)
        || selector == @selector(accessibilityRole) || selector == @selector(accessibilitySubrole)
        || selector == @selector(isAccessibilityEnabled) || selector == @selector(accessibilityWindow)
        || selector == @selector(accessibilityTopLevelUIElement)
        || selector == @selector(accessibilityLinkedUIElements)
        || selector == @selector(accessibilityRoleDescription) || selector == @selector(accessibilityIdentifier)
        || selector == @selector(accessibilityTitle) || selector == @selector(accessibilityHelp)
        || selector == @selector(accessibilityPlaceholderValue) || selector == @selector(accessibilityValue)
        || selector == @selector(accessibilityMinValue) || selector == @selector(accessibilityMaxValue)
        || selector == @selector(isAccessibilityRequired) || selector == @selector(accessibilityOrientation)
        || selector == @selector(isAccessibilityElement) || selector == @selector(isAccessibilityFocused)
        || selector == @selector(accessibilityNotifiesWhenDestroyed)
        || selector == @selector(isAccessibilitySelectorAllowed:)
        || selector == @selector(accessibilityActionNames) || selector == @selector(accessibilityPerformAction:);
}

@end

// The view -------------------------------------------------------------------------------------

static char adapter_key;
static NSMutableDictionary<NSNumber *, SilkAKAdapter *> *adapters;
static uint64_t next_handle = 1;

static SilkAKAdapter *adapter_of_view(id view) { return objc_getAssociatedObject(view, &adapter_key); }

static SilkAKAdapter *adapter_for(uint64_t handle) { return adapters[@(handle)]; }

static NSArray *view_children(id self, SEL _cmd) {
    SilkAKAdapter *adapter = adapter_of_view(self);
    if (!adapter) return @[];
    adapter.requested = YES;
    return [adapter elements:adapter.rootIds];
}

static id view_focused(id self, SEL _cmd) {
    SilkAKAdapter *adapter = adapter_of_view(self);
    if (adapter) adapter.requested = YES;
    return adapter ? [adapter focusedElement] : nil;
}

static id view_hit_test(id self, SEL _cmd, NSPoint point) {
    SilkAKAdapter *adapter = adapter_of_view(self);
    if (adapter) adapter.requested = YES;
    return adapter ? [adapter hitTest:point] : self;
}

// A subclass of `base` whose accessibility children are the adapter's elements.
static Class subclass_of(Class base) {
    NSString *name = [NSString stringWithFormat:@"SilkAccessKit_%s", class_getName(base)];
    Class existing = NSClassFromString(name);
    if (existing) return existing;
    Class subclass = objc_allocateClassPair(base, name.UTF8String, 0);
    if (!subclass) return Nil;
    class_addMethod(subclass, @selector(accessibilityChildren), (IMP)view_children, "@@:");
    class_addMethod(subclass, @selector(accessibilityFocusedUIElement), (IMP)view_focused, "@@:");
    NSString *types = [NSString stringWithFormat:@"@@:%s", @encode(NSPoint)];
    class_addMethod(subclass, @selector(accessibilityHitTest:), (IMP)view_hit_test, types.UTF8String);
    objc_registerClassPair(subclass);
    return subclass;
}

static uint64_t attach(NSView *view, NSView *owned) {
    if (!view || adapter_of_view(view)) return 0;
    Class subclass = subclass_of(object_getClass(view));
    if (!subclass) return 0;
    if (!adapters) adapters = [NSMutableDictionary new];
    SilkAKAdapter *adapter = [SilkAKAdapter new];
    adapter.view = view;
    adapter.ownedView = owned;
    adapter.originalClass = object_getClass(view);
    objc_setAssociatedObject(view, &adapter_key, adapter, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    object_setClass(view, subclass);
    uint64_t handle = next_handle++;
    adapters[@(handle)] = adapter;
    return handle;
}

static NSView *find_view(NSView *view, uint32_t window) {
    if ([view respondsToSelector:NSSelectorFromString(@"windowId")]) {
        NSNumber *number = [view valueForKey:@"windowId"];
        if (number && number.unsignedIntValue == window) return view;
    }
    for (NSView *child in view.subviews) {
        NSView *found = find_view(child, window);
        if (found) return found;
    }
    return nil;
}

uint64_t silk_ak_macos_attach_window(uint32_t window) {
    for (NSWindow *one in [NSApp windows]) {
        NSView *view = one.contentView ? find_view(one.contentView, window) : nil;
        if (view) return attach(view, nil);
    }
    return 0;
}

uint64_t silk_ak_macos_attach_view(void *pointer) {
    if (pointer) return attach((__bridge NSView *)pointer, nil);
    NSView *view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 400, 300)];
    return attach(view, view);
}

void silk_ak_macos_detach(uint64_t handle) {
    SilkAKAdapter *adapter = adapter_for(handle);
    if (!adapter) return;
    for (SilkAKNode *node in adapter.nodes.allValues) {
        NSAccessibilityPostNotification(node, NSAccessibilityUIElementDestroyedNotification);
    }
    NSView *view = adapter.view;
    if (view) {
        object_setClass(view, adapter.originalClass);
        objc_setAssociatedObject(view, &adapter_key, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
    [adapter.nodes removeAllObjects];
    [adapters removeObjectForKey:@(handle)];
}

void silk_ak_macos_set_node(uint64_t handle, uint64_t nodeId, const uint8_t *record, size_t length) {
    SilkAKAdapter *adapter = adapter_for(handle);
    if (!adapter) return;
    SilkAKNode *node = adapter.nodes[@(nodeId)];
    if (!node) {
        node = [SilkAKNode new];
        node.adapter = adapter;
        node.nodeId = nodeId;
        adapter.nodes[@(nodeId)] = node;
    }
    [node load:record length:length];
}

void silk_ak_macos_remove_node(uint64_t handle, uint64_t nodeId) {
    SilkAKAdapter *adapter = adapter_for(handle);
    SilkAKNode *node = adapter.nodes[@(nodeId)];
    if (!node) return;
    [adapter.nodes removeObjectForKey:@(nodeId)];
    NSAccessibilityPostNotification(node, NSAccessibilityUIElementDestroyedNotification);
}

void silk_ak_macos_set_roots(uint64_t handle, const uint64_t *ids, size_t count) {
    SilkAKAdapter *adapter = adapter_for(handle);
    if (!adapter) return;
    NSMutableArray<NSNumber *> *roots = [NSMutableArray arrayWithCapacity:count];
    for (size_t i = 0; i < count; i++) [roots addObject:@(ids[i])];
    adapter.rootIds = roots;
}

void silk_ak_macos_set_focus(uint64_t handle, uint32_t has, uint64_t nodeId) {
    SilkAKAdapter *adapter = adapter_for(handle);
    adapter.hasFocus = has != 0;
    adapter.focusId = nodeId;
}

void silk_ak_macos_notify(uint64_t handle, uint64_t nodeId, uint32_t code) {
    SilkAKAdapter *adapter = adapter_for(handle);
    SilkAKNode *node = adapter.nodes[@(nodeId)];
    if (!node) return;
    NSAccessibilityNotificationName name = nil;
    switch (code) {
    case NOTIFY_FOCUS: name = NSAccessibilityFocusedUIElementChangedNotification; break;
    case NOTIFY_VALUE: name = NSAccessibilityValueChangedNotification; break;
    case NOTIFY_TITLE: name = NSAccessibilityTitleChangedNotification; break;
    case NOTIFY_SELECTED_TEXT: name = NSAccessibilitySelectedTextChangedNotification; break;
    case NOTIFY_SELECTED_ROWS: name = NSAccessibilitySelectedRowsChangedNotification; break;
    default: return;
    }
    NSAccessibilityPostNotification(node, name);
}

void silk_ak_macos_announce(uint64_t handle, const uint8_t *text, size_t length, uint32_t assertive) {
    SilkAKAdapter *adapter = adapter_for(handle);
    NSWindow *window = adapter.view.window;
    if (!window) return;
    NSString *announcement = [[NSString alloc] initWithBytes:text length:length encoding:NSUTF8StringEncoding] ?: @"";
    NSDictionary *info = @{
        NSAccessibilityAnnouncementKey : announcement,
        NSAccessibilityPriorityKey : @(assertive ? NSAccessibilityPriorityHigh : NSAccessibilityPriorityMedium),
    };
    NSAccessibilityPostNotificationWithUserInfo(window, NSAccessibilityAnnouncementRequestedNotification, info);
}

uint32_t silk_ak_macos_requested(uint64_t handle) {
    @autoreleasepool {
        SilkAKAdapter *adapter = adapter_for(handle);
        return adapter && adapter.requested ? 1 : 0;
    }
}

uint32_t silk_ak_macos_poll(uint64_t handle, uint64_t *nodeId, double *number, uint32_t *start, uint32_t *end) {
    SilkAKAdapter *adapter = adapter_for(handle);
    if (!adapter || adapter.queue.count == 0) {
        adapter.current = nil;
        return 0;
    }
    SilkAKAction *action = adapter.queue.firstObject;
    [adapter.queue removeObjectAtIndex:0];
    adapter.current = action;
    *nodeId = action.nodeId;
    *number = action.number;
    *start = action.start;
    *end = action.end;
    return action.kind;
}

static size_t copy_text(NSString *text, uint8_t *out, size_t capacity) {
    NSData *bytes = [text ?: @"" dataUsingEncoding:NSUTF8StringEncoding];
    if (out && capacity) memcpy(out, bytes.bytes, MIN(capacity, bytes.length));
    return bytes.length;
}

size_t silk_ak_macos_action_text(uint64_t handle, uint8_t *out, size_t capacity) {
    return copy_text(adapter_for(handle).current.text, out, capacity);
}

// What AppKit reports for an element, for tests: `name: value` lines.
static NSString *describe(SilkAKAdapter *adapter, uint64_t nodeId) {
    NSMutableString *out = [NSMutableString new];
    if (nodeId == VIEW_ID) {
        NSView *view = adapter.view;
        [out appendFormat:@"children: %lu\n", (unsigned long)view.accessibilityChildren.count];
        id focused = view.accessibilityFocusedUIElement;
        if ([focused isKindOfClass:[SilkAKNode class]]) {
            [out appendFormat:@"focused-element: %llu\n", (unsigned long long)((SilkAKNode *)focused).nodeId];
        }
        return out;
    }
    SilkAKNode *node = adapter.nodes[@(nodeId)];
    if (!node) return @"missing\n";
    [out appendFormat:@"role: %@\n", node.accessibilityRole];
    if (node.accessibilitySubrole) [out appendFormat:@"subrole: %@\n", node.accessibilitySubrole];
    if (node.accessibilityTitle) [out appendFormat:@"title: %@\n", node.accessibilityTitle];
    if (node.accessibilityHelp) [out appendFormat:@"help: %@\n", node.accessibilityHelp];
    id value = node.accessibilityValue;
    if (value) [out appendFormat:@"value: %@\n", value];
    [out appendFormat:@"focused: %d\n", node.isAccessibilityFocused ? 1 : 0];
    [out appendFormat:@"enabled: %d\n", node.isAccessibilityEnabled ? 1 : 0];
    [out appendFormat:@"children: %lu\n", (unsigned long)node.accessibilityChildren.count];
    [out appendFormat:@"press: %d\n", [node isAccessibilitySelectorAllowed:@selector(accessibilityPerformPress)] ? 1 : 0];
    if ([node isAccessibilitySelectorAllowed:@selector(accessibilityNumberOfCharacters)]) {
        [out appendFormat:@"characters: %ld\n", (long)node.accessibilityNumberOfCharacters];
        if (node.accessibilityNumberOfCharacters >= 3) {
            [out appendFormat:@"string 1 3: %@\n", [node accessibilityStringForRange:NSMakeRange(1, 2)]];
        }
        [out appendFormat:@"line of 0: %ld\n", (long)[node accessibilityLineForIndex:0]];
    }
    return out;
}

size_t silk_ak_macos_describe(uint64_t handle, uint64_t nodeId, uint8_t *out, size_t capacity) {
    SilkAKAdapter *adapter = adapter_for(handle);
    if (!adapter) return 0;
    return copy_text(describe(adapter, nodeId), out, capacity);
}

// Calls the AppKit method behind action `kind` on element `id`, as VoiceOver would.
uint32_t silk_ak_macos_perform(uint64_t handle, uint64_t nodeId, uint32_t kind) {
    SilkAKNode *node = adapter_for(handle).nodes[@(nodeId)];
    if (!node) return 0;
    switch (kind) {
    case ACTION_CLICK: return [node accessibilityPerformPress] ? 1 : 0;
    case ACTION_FOCUS: [node setAccessibilityFocused:YES]; return 1;
    case ACTION_BLUR: [node setAccessibilityFocused:NO]; return 1;
    case ACTION_INCREMENT: return [node accessibilityPerformIncrement] ? 1 : 0;
    case ACTION_DECREMENT: return [node accessibilityPerformDecrement] ? 1 : 0;
    case ACTION_SCROLL_INTO_VIEW: [node accessibilityPerformAction:SCROLL_TO_VISIBLE_ACTION]; return 1;
    default: return 0;
    }
}
