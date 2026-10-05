#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <objc/message.h>
#import <objc/runtime.h>

static NSString *const TMMergeKey = @"tm.table-merge.merge";
static NSString *const TMUnmergeKey = @"tm.table-merge.unmerge";
static NSString *const TMStructureKey = @"tm.table-merge.structure";
static NSString *const TMCopyKey = @"tm.table-merge.copy";
static NSString *const TMCutKey = @"tm.table-merge.cut";
static NSString *const TMPasteKey = @"tm.table-merge.paste";
static NSString *const TMBridgeVersion = @"0.2.1";

static IMP TMOriginalSetItems = NULL;
static IMP TMOriginalMenuItemsWithDefault = NULL;
static BOOL TMPendingMerge = NO;
static BOOL TMPendingUnmerge = NO;
static BOOL TMPendingStructure = NO;
static BOOL TMPendingCopy = NO;
static BOOL TMPendingCut = NO;
static BOOL TMPendingPaste = NO;
static CFAbsoluteTime TMPendingAt = 0;

static BOOL TMEvaluateJavaScript(id webView, NSString *script) {
  if (!webView || !script) return NO;

  SEL asynchronous = NSSelectorFromString(@"evaluateJavaScript:completionHandler:");
  if ([webView respondsToSelector:asynchronous]) {
    void (*send)(id, SEL, id, id) = (void *)objc_msgSend;
    void (^completion)(id, NSError *) = ^(id result, NSError *error) {
      if (error) {
        NSLog(@"[Table Merge Native] JavaScript failed in %@: %@",
              NSStringFromClass([webView class]), error);
      } else if ([result isKindOfClass:[NSString class]]) {
        NSLog(@"[Table Merge Native] JavaScript result: %@", result);
      }
    };
    send(webView, asynchronous, script, completion);
    return YES;
  }

  // Typora has shipped both WKWebView-backed and legacy/custom DocWebView
  // implementations. The latter exposes a one-argument evaluator.
  SEL direct = NSSelectorFromString(@"evaluateJavaScript:");
  if ([webView respondsToSelector:direct]) {
    void (*send)(id, SEL, id) = (void *)objc_msgSend;
    send(webView, direct, script);
    return YES;
  }

  SEL synchronous = NSSelectorFromString(@"evaluateJavaScriptSync:");
  if ([webView respondsToSelector:synchronous]) {
    void (*send)(id, SEL, id) = (void *)objc_msgSend;
    send(webView, synchronous, script);
    return YES;
  }

  SEL legacy = NSSelectorFromString(@"stringByEvaluatingJavaScriptFromString:");
  if ([webView respondsToSelector:legacy]) {
    void (*send)(id, SEL, id) = (void *)objc_msgSend;
    send(webView, legacy, script);
    return YES;
  }

  return NO;
}

@interface TMTableMergeMenuTarget : NSObject
@property(nonatomic, weak) id contextCommands;
+ (instancetype)sharedTarget;
- (void)mergeSelectedCells:(id)sender;
- (void)unmergeSelectedCells:(id)sender;
- (void)copySelectedCells:(id)sender;
- (void)cutSelectedCells:(id)sender;
- (void)pasteSelectedCells:(id)sender;
- (void)insertRowBefore:(id)sender;
- (void)insertRowAfter:(id)sender;
- (void)insertColBefore:(id)sender;
- (void)insertColAfter:(id)sender;
- (void)deleteRow:(id)sender;
- (void)deleteCol:(id)sender;
@end

static id TMGetWebView(id contextCommands) {
  SEL selector = NSSelectorFromString(@"webView");
  if (!contextCommands || ![contextCommands respondsToSelector:selector]) return nil;
  id (*send)(id, SEL) = (void *)objc_msgSend;
  return send(contextCommands, selector);
}

static void TMSendAction(id contextCommands, NSString *action) {
  id webView = TMGetWebView(contextCommands);
  NSString *script = [NSString stringWithFormat:
      @"(function(){"
       "var fn=window.__TMT_NATIVE_MENU_ACTION__;"
       "if(typeof fn==='function'){return fn('%@');}"
       "window.dispatchEvent(new CustomEvent('tm-native-menu-action',{detail:'%@'}));"
       "return 'tm-native-menu-event-dispatched';"
       "})()",
      action,
      action];
  NSLog(@"[Table Merge Native] Dispatching %@ via %@ -> %@", action,
        NSStringFromClass([contextCommands class]), NSStringFromClass([webView class]));
  if (!TMEvaluateJavaScript(webView, script)) {
    NSLog(@"[Table Merge Native] Unable to find Typora's web view");
    return;
  }
}

@implementation TMTableMergeMenuTarget
+ (instancetype)sharedTarget {
  static TMTableMergeMenuTarget *target;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    target = [TMTableMergeMenuTarget new];
  });
  return target;
}

- (void)mergeSelectedCells:(id)sender {
  TMSendAction(self.contextCommands, @"merge");
}

- (void)unmergeSelectedCells:(id)sender {
  TMSendAction(self.contextCommands, @"unmerge");
}

- (void)copySelectedCells:(id)sender {
  TMSendAction(self.contextCommands, @"copy");
}

- (void)cutSelectedCells:(id)sender {
  TMSendAction(self.contextCommands, @"cut");
}

- (void)pasteSelectedCells:(id)sender {
  TMSendAction(self.contextCommands, @"paste");
}

- (void)insertRowBefore:(id)sender {
  TMSendAction(self.contextCommands, @"insert-row-before");
}

- (void)insertRowAfter:(id)sender {
  TMSendAction(self.contextCommands, @"insert-row-after");
}

- (void)insertColBefore:(id)sender {
  TMSendAction(self.contextCommands, @"insert-col-before");
}

- (void)insertColAfter:(id)sender {
  TMSendAction(self.contextCommands, @"insert-col-after");
}

- (void)deleteRow:(id)sender {
  TMSendAction(self.contextCommands, @"delete-row");
}

- (void)deleteCol:(id)sender {
  TMSendAction(self.contextCommands, @"delete-col");
}
@end

static id TMSetItems(id self, SEL _cmd, NSArray *items) {
  BOOL merge = [items containsObject:TMMergeKey];
  BOOL unmerge = [items containsObject:TMUnmergeKey];
  BOOL structure = [items containsObject:TMStructureKey];
  BOOL copy = [items containsObject:TMCopyKey];
  BOOL cut = [items containsObject:TMCutKey];
  BOOL paste = [items containsObject:TMPasteKey];
  if (merge || unmerge || structure || copy || cut || paste) {
    TMPendingMerge = merge;
    TMPendingUnmerge = unmerge;
    TMPendingStructure = structure;
    TMPendingCopy = copy;
    TMPendingCut = cut;
    TMPendingPaste = paste;
    TMPendingAt = CFAbsoluteTimeGetCurrent();
  }

  id (*original)(id, SEL, NSArray *) = (void *)TMOriginalSetItems;
  return original(self, _cmd, items);
}

static BOOL TMMenuContainsTitle(NSArray *items, NSString *title) {
  for (id item in items) {
    if ([item respondsToSelector:@selector(title)] && [[item title] isEqualToString:title]) {
      return YES;
    }
  }
  return NO;
}

static NSMenuItem *TMFindTableMenuItem(NSArray *items) {
  for (id item in items) {
    if (![item isKindOfClass:[NSMenuItem class]]) continue;
    NSString *title = [item title];
    if (([title isEqualToString:@"表格"] || [title isEqualToString:@"Table"]) &&
        [item submenu]) {
      return item;
    }
  }
  return nil;
}

static void TMAppendSeparatorIfNeeded(NSMutableArray<NSMenuItem *> *items) {
  if (items.count > 0 && ![[items lastObject] isSeparatorItem]) {
    [items addObject:[NSMenuItem separatorItem]];
  }
}

static BOOL TMRemovePluginActions(NSMutableArray<NSMenuItem *> *items) {
  TMTableMergeMenuTarget *target = [TMTableMergeMenuTarget sharedTarget];
  NSSet<NSString *> *selectors = [NSSet setWithArray:@[
    @"mergeSelectedCells:",
    @"unmergeSelectedCells:",
    @"copySelectedCells:",
    @"cutSelectedCells:",
    @"pasteSelectedCells:",
  ]];
  NSInteger firstRemoved = NSNotFound;

  for (NSInteger index = (NSInteger)items.count - 1; index >= 0; index--) {
    NSMenuItem *item = items[(NSUInteger)index];
    if (![item isKindOfClass:[NSMenuItem class]] || item.target != target || !item.action) {
      continue;
    }
    if (![selectors containsObject:NSStringFromSelector(item.action)]) continue;
    [items removeObjectAtIndex:(NSUInteger)index];
    firstRemoved = index;
  }

  // Older bridge versions inserted one separator immediately before their
  // action block. Remove that separator together with the stale actions.
  if (firstRemoved != NSNotFound && firstRemoved > 0) {
    NSUInteger separatorIndex = (NSUInteger)firstRemoved - 1;
    if ([items[separatorIndex] isSeparatorItem]) {
      [items removeObjectAtIndex:separatorIndex];
    }
  }
  return firstRemoved != NSNotFound;
}

static BOOL TMRestoreStructureActions(
    NSMutableArray<NSMenuItem *> *items,
    id contextCommands) {
  TMTableMergeMenuTarget *target = [TMTableMergeMenuTarget sharedTarget];
  NSDictionary<NSString *, NSString *> *mapping = @{
    @"insertRowBefore:": @"addRowBefore:",
    @"insertRowAfter:": @"addRowAfter:",
    @"insertColBefore:": @"addColBefore:",
    @"insertColAfter:": @"addColAfter:",
    @"deleteRow:": @"deleteRow:",
    @"deleteCol:": @"deleteCol:",
  };
  BOOL restored = NO;
  for (NSMenuItem *item in items) {
    if (![item isKindOfClass:[NSMenuItem class]] || item.target != target || !item.action) {
      continue;
    }
    NSString *original = mapping[NSStringFromSelector(item.action)];
    if (!original) continue;
    item.target = contextCommands;
    item.action = NSSelectorFromString(original);
    restored = YES;
  }
  return restored;
}

static void TMRetargetStructureActions(
    NSArray<NSMenuItem *> *items,
    TMTableMergeMenuTarget *target) {
  NSDictionary<NSString *, NSString *> *mapping = @{
    @"addRowBefore:": @"insertRowBefore:",
    @"addRowAfter:": @"insertRowAfter:",
    @"addColBefore:": @"insertColBefore:",
    @"addColAfter:": @"insertColAfter:",
    @"deleteRow:": @"deleteRow:",
    @"deleteCol:": @"deleteCol:",
  };
  for (NSMenuItem *item in items) {
    if (![item isKindOfClass:[NSMenuItem class]] || !item.action) continue;
    NSString *replacement = mapping[NSStringFromSelector(item.action)];
    if (!replacement) continue;
    item.target = target;
    item.action = NSSelectorFromString(replacement);
  }
}

static void TMAppendAction(
    NSMutableArray<NSMenuItem *> *items,
    NSString *title,
    SEL action,
    TMTableMergeMenuTarget *target) {
  if (TMMenuContainsTitle(items, title)) return;
  NSMenuItem *item = [[NSMenuItem alloc]
      initWithTitle:title action:action keyEquivalent:@""];
  item.target = target;
  [items addObject:item];
}

static id TMMenuItemsWithDefault(id self, SEL _cmd, NSArray *defaults) {
  id (*original)(id, SEL, NSArray *) = (void *)TMOriginalMenuItemsWithDefault;
  NSArray *baseItems = original(self, _cmd, defaults);

  BOOL fresh = TMPendingAt > 0 && CFAbsoluteTimeGetCurrent() - TMPendingAt < 1.5;
  BOOL addMerge = fresh && TMPendingMerge;
  BOOL addUnmerge = fresh && TMPendingUnmerge;
  BOOL protectStructure = fresh && TMPendingStructure;
  BOOL addCopy = fresh && TMPendingCopy;
  BOOL addCut = fresh && TMPendingCut;
  BOOL addPaste = fresh && TMPendingPaste;
  TMPendingMerge = NO;
  TMPendingUnmerge = NO;
  TMPendingStructure = NO;
  TMPendingCopy = NO;
  TMPendingCut = NO;
  TMPendingPaste = NO;
  TMPendingAt = 0;

  if (![baseItems isKindOfClass:[NSArray class]]) return baseItems;

  NSMutableArray *items = [baseItems mutableCopy];
  TMTableMergeMenuTarget *target = [TMTableMergeMenuTarget sharedTarget];
  target.contextCommands = self;

  NSMenuItem *tableMenuItem = TMFindTableMenuItem(items);
  NSMenu *tableMenu = tableMenuItem.submenu;
  NSMutableArray<NSMenuItem *> *destination = tableMenu
      ? [tableMenu.itemArray mutableCopy]
      : items;

  // Typora can reuse the same NSMenu and NSMenuItem instances across right
  // clicks. Always remove our previous action block and undo any previous
  // structure retargeting before applying the state for this click.
  BOOL cleanedActions = TMRemovePluginActions(destination);
  BOOL restoredStructure = TMRestoreStructureActions(destination, self);

  if (!addMerge && !addUnmerge && !protectStructure &&
      !addCopy && !addCut && !addPaste) {
    if (tableMenu && (cleanedActions || restoredStructure)) {
      [tableMenu removeAllItems];
      for (NSMenuItem *item in destination) [tableMenu addItem:item];
      return items;
    }
    return (cleanedActions || restoredStructure) ? items : baseItems;
  }

  if (protectStructure) TMRetargetStructureActions(destination, target);

  if (addMerge || addUnmerge || addCopy || addCut || addPaste) {
    TMAppendSeparatorIfNeeded(destination);
  }

  if (addMerge) TMAppendAction(
      destination, @"合并所选单元格", @selector(mergeSelectedCells:), target);

  if (addUnmerge) TMAppendAction(
      destination, @"取消合并单元格", @selector(unmergeSelectedCells:), target);
  if (addCopy) TMAppendAction(
      destination, @"复制所选区域", @selector(copySelectedCells:), target);
  if (addCut) TMAppendAction(
      destination, @"剪切所选区域", @selector(cutSelectedCells:), target);
  if (addPaste) TMAppendAction(
      destination, @"粘贴表格区域", @selector(pasteSelectedCells:), target);

  if (tableMenu) {
    [tableMenu removeAllItems];
    for (NSMenuItem *item in destination) [tableMenu addItem:item];
  }

  NSLog(@"[Table Merge Native] Added native table menu items to %@",
        tableMenu ? @"Table submenu" : @"context menu root");
  return items;
}

static void TMMarkWebView(NSView *view) {
  NSString *script = [NSString stringWithFormat:
      @"window.__TMT_NATIVE_MENU_BRIDGE__='%@';"
       "window.dispatchEvent(new Event('tm-native-bridge-ready'));",
      TMBridgeVersion];
  TMEvaluateJavaScript(view, script);

  for (NSView *subview in view.subviews) TMMarkWebView(subview);
}

static void TMMarkAllWebViews(void) {
  for (NSWindow *window in NSApp.windows) {
    if (window.contentView) TMMarkWebView(window.contentView);
  }
}

static void TMScheduleWebViewMarkers(NSUInteger remaining) {
  TMMarkAllWebViews();
  if (remaining == 0) return;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1 * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
    TMScheduleWebViewMarkers(remaining - 1);
  });
}

static void TMInstallBridge(NSUInteger remaining) {
  Class contextMenuClass = objc_getClass("ContextMenuCommands");
  Method setItems = class_getInstanceMethod(contextMenuClass, NSSelectorFromString(@"setItems:"));
  Method menuItems = class_getInstanceMethod(
      contextMenuClass, NSSelectorFromString(@"menuItemsWithDefault:"));

  if (!contextMenuClass || !setItems || !menuItems) {
    if (remaining > 0) {
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(250 * NSEC_PER_MSEC)),
                     dispatch_get_main_queue(), ^{
        TMInstallBridge(remaining - 1);
      });
    } else {
      NSLog(@"[Table Merge Native] Typora context-menu class was not found");
    }
    return;
  }

  TMOriginalSetItems = method_setImplementation(setItems, (IMP)TMSetItems);
  TMOriginalMenuItemsWithDefault = method_setImplementation(
      menuItems, (IMP)TMMenuItemsWithDefault);
  NSLog(@"[Table Merge Native] Installed bridge %@", TMBridgeVersion);
  TMScheduleWebViewMarkers(30);
}

__attribute__((constructor)) static void TMNativeMenuBridgeLoad(void) {
  dispatch_async(dispatch_get_main_queue(), ^{
    TMInstallBridge(40);
  });
}
