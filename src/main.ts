import './style.scss'
import {
  HtmlPostProcessor,
  Notice,
  Plugin,
} from '@typora-community-plugin/core'
import { File, editor } from 'typora'
import {
  clearRectangleInMarkdown,
  deleteTableColumnInMarkdown,
  deleteTableRowInMarkdown,
  extractRectangleFromMarkdown,
  insertTableColumnInMarkdown,
  insertTableRowInMarkdown,
  mergeRectangleInMarkdown,
  parseMarker,
  pasteRectangleInMarkdown,
  plainTextToRectangle,
  rectangleToPlainText,
  unmergeRectangleInMarkdown,
} from './table-model'
import {
  applyMergesToTable,
  restoreMergedTable,
} from './merge-dom'

type CellPoint = {
  table: HTMLTableElement
  row: number
  col: number
}

type TableRange = {
  table: HTMLTableElement
  minRow: number
  maxRow: number
  minCol: number
  maxCol: number
}

type ReloadContent = (
  markdown: string,
  options?: Record<string, unknown>,
) => void

type TyporaTableEdit = {
  copyTable: () => void
  reformatTable: () => void
  deleteTable: () => void
}

type TableClipboard = {
  version: 1
  rows: string[][]
  plainText: string
}

const NATIVE_MENU_EVENT = 'tm-native-menu-action'
const NATIVE_MERGE_ITEM = 'tm.table-merge.merge'
const NATIVE_UNMERGE_ITEM = 'tm.table-merge.unmerge'
const NATIVE_STRUCTURE_ITEM = 'tm.table-merge.structure'
const NATIVE_COPY_ITEM = 'tm.table-merge.copy'
const NATIVE_CUT_ITEM = 'tm.table-merge.cut'
const NATIVE_PASTE_ITEM = 'tm.table-merge.paste'
const TABLE_CLIPBOARD_MIME = 'application/x-typora-table-merge+json'

export default class TableMergePlugin extends Plugin {
  private anchor?: CellPoint
  private focus?: CellPoint
  private selectionComplete = false
  private renderTimer?: number
  private contextCell?: HTMLTableCellElement
  private contextMenu?: HTMLDivElement
  private mergeMenuItem?: HTMLDivElement
  private unmergeMenuItem?: HTMLDivElement
  private copyMenuItem?: HTMLDivElement
  private cutMenuItem?: HTMLDivElement
  private pasteMenuItem?: HTMLDivElement
  private tableClipboard?: TableClipboard

  onload() {
    this.registerMarkdownProcessors()
    this.registerCommands()
    this.observeLiveTables()
    this.registerDocumentEvent('mousedown', this.onDocumentMouseDown)
    this.registerDocumentEvent('contextmenu', this.onDocumentContextMenu)
    this.registerDocumentEvent('click', this.onDocumentClick)
    this.registerDocumentEvent('keydown', this.onDocumentKeyDown)
    this.registerDocumentEvent('copy', this.onDocumentCopy)
    this.registerDocumentEvent('cut', this.onDocumentCut)
    this.registerDocumentEvent('paste', this.onDocumentPaste)
    window.addEventListener(NATIVE_MENU_EVENT, this.onNativeMenuAction)
    window.__TMT_NATIVE_MENU_ACTION__ = this.onNativeMenuDirectAction
    this.register(() => {
      window.removeEventListener(NATIVE_MENU_EVENT, this.onNativeMenuAction)
      if (window.__TMT_NATIVE_MENU_ACTION__ === this.onNativeMenuDirectAction) {
        delete window.__TMT_NATIVE_MENU_ACTION__
      }
    })

    try {
      this.installTableContextMenuItems()
    } catch (error) {
      console.error('[TableCraft] Failed to install table menu', error)
      Notice.warning('Alt/Option 选择可用，但右键菜单加载失败；请使用命令面板完成合并。')
    }
  }

  private registerDocumentEvent(type: string, listener: EventListener) {
    document.addEventListener(type, listener, true)
    this.register(() => document.removeEventListener(type, listener, true))
  }

  onunload() {
    window.clearTimeout(this.renderTimer)
    this.hideTableContextMenu()
    document
      .querySelectorAll<HTMLTableElement>('#write table')
      .forEach(restoreMergedTable)
  }

  private observeLiveTables() {
    const writingArea = document.querySelector('#write')
    if (!writingArea) return

    const observer = new MutationObserver(() => this.scheduleLiveRender())
    observer.observe(writingArea, {
      childList: true,
      characterData: true,
      subtree: true,
    })

    this.register(() => observer.disconnect())
    this.scheduleLiveRender()
  }

  private scheduleLiveRender() {
    window.clearTimeout(this.renderTimer)
    this.renderTimer = window.setTimeout(() => {
      document
        .querySelectorAll<HTMLTableElement>('#write table')
        .forEach(table => applyMergesToTable(table, 'live'))
    })
  }

  private registerMarkdownProcessors() {
    const previewProcessor = HtmlPostProcessor.from({
      selector: 'table',
      process: (element) => {
        const table = element as HTMLTableElement
        applyMergesToTable(table, 'live')
      },
    })

    this.register(
      this.app.features.markdownEditor.postProcessor.register(previewProcessor),
    )

    const exportProcessor = {
      type: 'html' as const,
      process: ({ doc }: { doc: Document }) => {
        doc
          .querySelectorAll<HTMLTableElement>('table')
          .forEach(table => applyMergesToTable(table, 'export'))
      },
    }

    this.register(this.app.features.exporter.register(exportProcessor as never))
  }

  private registerCommands() {
    this.registerCommand({
      id: 'merge-selected-cells',
      title: '表格：合并选中的单元格',
      scope: 'editor',
      callback: () => this.mergeSelectedCells(),
    })

    this.registerCommand({
      id: 'merge-focused-cell-down',
      title: '表格：当前单元格与下方单元格合并',
      scope: 'editor',
      callback: () => this.mergeFocusedCell(1, 0),
    })

    this.registerCommand({
      id: 'merge-focused-cell-right',
      title: '表格：当前单元格与右侧单元格合并',
      scope: 'editor',
      callback: () => this.mergeFocusedCell(0, 1),
    })

    this.registerCommand({
      id: 'unmerge-selected-cells',
      title: '表格：取消选中区域的合并',
      scope: 'editor',
      callback: () => this.unmergeSelectedCells(),
    })

    this.registerCommand({
      id: 'clear-cell-selection',
      title: '表格：清除合并区域选择',
      scope: 'editor',
      callback: () => this.clearSelection(true),
    })

    this.registerCommand({
      id: 'copy-selected-cells',
      title: '表格：复制所选区域（保留合并结构）',
      scope: 'editor',
      callback: () => this.copySelectedCells(),
    })

    this.registerCommand({
      id: 'cut-selected-cells',
      title: '表格：剪切所选区域（保留合并结构）',
      scope: 'editor',
      callback: () => this.cutSelectedCells(),
    })

    this.registerCommand({
      id: 'paste-selected-cells',
      title: '表格：粘贴区域（保留合并结构）',
      scope: 'editor',
      callback: () => this.pasteSelectedCells(),
    })
  }

  private onDocumentMouseDown = (event: Event) => {
    const mouseEvent = event as MouseEvent
    const target = mouseEvent.target as Element | null
    if (target?.closest('.tm-table-context-menu')) return
    this.hideTableContextMenu()

    const cell = this.getCellFromMouseEvent(mouseEvent)

    if (mouseEvent.button === 0 && mouseEvent.altKey && cell) {
      mouseEvent.preventDefault()
      mouseEvent.stopImmediatePropagation()

      const table = cell.closest<HTMLTableElement>('table')
      const startsNewSelection = (
        !this.anchor ||
        this.anchor.table !== table ||
        this.selectionComplete
      )

      if (startsNewSelection) {
        if (cell.dataset.tmOrigin === 'true') {
          this.selectMergedCellRange(cell)
        } else {
          this.beginSelectionAtCell(cell)
          this.selectionComplete = false
        }
      } else {
        this.selectCell(cell)
        const range = this.getSelectionRange()
        if (!range) return

        const rows = range.maxRow - range.minRow + 1
        const cols = range.maxCol - range.minCol + 1
        const count = rows * cols
        this.selectionComplete = count > 1
      }
      return
    }

    // Without Alt/Option, leave clicking and dragging entirely to Typora.
    if (mouseEvent.button === 0 && this.getSelectionRange()) {
      this.clearSelection(true)
    }
  }

  private getCellFromMouseEvent(mouseEvent: MouseEvent) {
    // Typora's contenteditable table can keep mousemove.target pinned to the
    // cell where a drag began. Hit-test coordinates first so crossing a cell
    // boundary is detected reliably.
    const hit = Array.from(
      document.querySelectorAll<HTMLTableCellElement>('#write table td, #write table th'),
    ).find(cell => {
      const rect = cell.getBoundingClientRect()
      return (
        mouseEvent.clientX >= rect.left &&
        mouseEvent.clientX <= rect.right &&
        mouseEvent.clientY >= rect.top &&
        mouseEvent.clientY <= rect.bottom
      )
    })
    if (hit) return hit

    const target = mouseEvent.target
    if (target instanceof Element) {
      const direct = target.closest<HTMLTableCellElement>('#write table td, #write table th')
      if (direct) return direct
    }
  }

  private onDocumentClick = (event: Event) => {
    const target = event.target as Element | null
    const mouseEvent = event as MouseEvent
    if (
      mouseEvent.altKey &&
      target?.closest('#write table td, #write table th')
    ) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }

    if (target?.closest('.context-menu, .tm-table-context-menu')) return

    this.hideTableContextMenu()

    const clickedTable = target?.closest<HTMLTableElement>('#write table')
    if (!clickedTable) {
      this.clearSelection(true)
    }
  }

  private onDocumentKeyDown = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent
    if (keyboardEvent.key === 'Escape' && this.getSelectionRange()) {
      keyboardEvent.preventDefault()
      keyboardEvent.stopImmediatePropagation()
      this.clearSelection(true)
      return
    }

    if (
      !keyboardEvent.altKey ||
      keyboardEvent.metaKey ||
      keyboardEvent.ctrlKey ||
      !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(keyboardEvent.key)
    ) return

    if (!this.getSelectionRange()) {
      const cell = this.getFocusedCell()
      if (!cell) return
      if (cell.dataset.tmOrigin === 'true') this.selectMergedCellRange(cell)
      else this.beginSelectionAtCell(cell)
    }

    const range = this.getSelectionRange()
    const focus = this.focus
    if (!range || !focus) return

    const delta = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    }[keyboardEvent.key]!
    const nextRow = Math.max(
      0,
      Math.min(focus.row + delta[0], range.table.rows.length - 1),
    )
    const nextCol = Math.max(
      0,
      Math.min(focus.col + delta[1], range.table.rows[nextRow].cells.length - 1),
    )

    keyboardEvent.preventDefault()
    keyboardEvent.stopImmediatePropagation()
    this.focus = { table: range.table, row: nextRow, col: nextCol }
    const nextRange = this.getSelectionRange()
    this.selectionComplete = Boolean(
      nextRange && (
        nextRange.minRow !== nextRange.maxRow ||
        nextRange.minCol !== nextRange.maxCol
      )
    )
    this.paintSelection()
  }

  private onDocumentCopy = (event: Event) => {
    const clipboardEvent = event as ClipboardEvent
    const range = this.getSelectionRange()
    if (!range || !this.selectionComplete) return

    try {
      const clipboard = this.captureSelection(range)
      this.tableClipboard = clipboard
      clipboardEvent.preventDefault()
      clipboardEvent.stopImmediatePropagation()
      clipboardEvent.clipboardData?.setData('text/plain', clipboard.plainText)
      try {
        clipboardEvent.clipboardData?.setData(
          TABLE_CLIPBOARD_MIME,
          JSON.stringify(clipboard),
        )
      } catch {
        // Some WebKit builds only allow standard clipboard MIME types.
      }
    } catch (error) {
      clipboardEvent.preventDefault()
      Notice.error(error instanceof Error ? error.message : String(error))
    }
  }

  private onDocumentCut = (event: Event) => {
    const clipboardEvent = event as ClipboardEvent
    const range = this.getSelectionRange()
    if (!range || !this.selectionComplete) return

    try {
      const clipboard = this.captureSelection(range)
      this.tableClipboard = clipboard
      clipboardEvent.preventDefault()
      clipboardEvent.stopImmediatePropagation()
      clipboardEvent.clipboardData?.setData('text/plain', clipboard.plainText)
      try {
        clipboardEvent.clipboardData?.setData(
          TABLE_CLIPBOARD_MIME,
          JSON.stringify(clipboard),
        )
      } catch {
        // Keep the in-memory structured clipboard as the fallback.
      }
      this.clearSelectedCells(range)
    } catch (error) {
      clipboardEvent.preventDefault()
      Notice.error(error instanceof Error ? error.message : String(error))
    }
  }

  private onDocumentPaste = (event: Event) => {
    const clipboardEvent = event as ClipboardEvent
    const range = this.getSelectionRange()
    if (!range) return

    const custom = clipboardEvent.clipboardData?.getData(TABLE_CLIPBOARD_MIME)
    const text = clipboardEvent.clipboardData?.getData('text/plain') ?? ''
    let rows: string[][] | undefined

    if (custom) {
      try {
        const parsed = JSON.parse(custom) as Partial<TableClipboard>
        if (parsed.version === 1 && Array.isArray(parsed.rows)) rows = parsed.rows
      } catch {
        rows = undefined
      }
    }
    if (!rows && this.tableClipboard?.plainText === text) {
      rows = this.tableClipboard.rows
    }
    rows ??= plainTextToRectangle(text)

    clipboardEvent.preventDefault()
    clipboardEvent.stopImmediatePropagation()
    this.pasteRows(rows)
  }

  private onDocumentContextMenu = (event: Event) => {
    const mouseEvent = event as MouseEvent
    const cell = this.getCellFromMouseEvent(mouseEvent)
    if (!cell) return
    const table = cell.closest<HTMLTableElement>('table')
    if (!table) return
    const needsStructureProtection = this.tableHasMergeMarkers(table)

    if (!this.selectionComplete && cell.dataset.tmOrigin === 'true') {
      this.selectMergedCellRange(cell)
    }

    const range = this.getSelectionRange()
    const insideSelection = Boolean(range && this.isCellInsideSelection(cell))
    const needsSelectionMenu = Boolean(
      insideSelection && (this.selectionComplete || this.tableClipboard),
    )
    if (!needsSelectionMenu && !needsStructureProtection) {
      // A normal table right-click must remain completely owned by Typora.
      // The plugin only participates for an explicit selection or when a
      // merged table needs structure-aware row/column edits.
      this.hideTableContextMenu()
      if (range) this.clearSelection(true)
      return
    }

    this.contextCell = cell
    this.focusTyporaCell(cell)
    if (insideSelection && this.selectionComplete) {
      this.clearNativeTextSelection()
    }

    if (this.publishNativeMenuState()) {
      // The optional native bridge appends our commands to Typora's real
      // NSMenu/Electron menu. Do not cancel the event: Typora must still build
      // all of its original context-menu items.
      return
    }

    mouseEvent.preventDefault()
    mouseEvent.stopImmediatePropagation()

    this.updateTableContextMenuItems()
    const { clientX, clientY } = mouseEvent
    window.setTimeout(() => this.showTableContextMenu(clientX, clientY))
  }

  private onNativeMenuAction = (event: Event) => {
    const action = (event as CustomEvent<string>).detail
    this.onNativeMenuDirectAction(action)
  }

  private onNativeMenuDirectAction = (action: string) => {
    const actions: Record<string, () => void> = {
      merge: () => this.mergeSelectedCells(),
      unmerge: () => this.unmergeSelectedCells(),
      copy: () => this.copySelectedCells(),
      cut: () => this.cutSelectedCells(),
      paste: () => this.pasteSelectedCells(),
      'insert-row-before': () => this.insertRow(true),
      'insert-row-after': () => this.insertRow(false),
      'insert-col-before': () => this.insertColumn(true),
      'insert-col-after': () => this.insertColumn(false),
      'delete-row': () => this.deleteRow(),
      'delete-col': () => this.deleteColumn(),
    }
    const callback = actions[action]
    if (!callback) return 'unknown-action'
    callback()
    return `handled-${action}`
  }

  private publishNativeMenuState() {
    const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)
    if (!window.__TMT_NATIVE_MENU_BRIDGE__ && !isMac) return false

    const callSync = window.bridge?.callSync
    const setItems = window.JSBridge?.contextMenu?.setItems
    const range = this.getSelectionRange()
    if (typeof callSync !== 'function' && typeof setItems !== 'function') return false

    const items = ['normal']
    const table = this.contextCell?.closest<HTMLTableElement>('table') ?? range?.table
    if (!table) return false

    if (this.selectionComplete && range) {
      const rows = range.maxRow - range.minRow + 1
      const cols = range.maxCol - range.minCol + 1
      const containsMerge = this.selectionContainsMergeMarker(range)
      if (rows * cols > 1 && !containsMerge) items.push(NATIVE_MERGE_ITEM)
      if (containsMerge) items.push(NATIVE_UNMERGE_ITEM)
      items.push(NATIVE_COPY_ITEM, NATIVE_CUT_ITEM)
    }
    if (this.tableClipboard && range) items.push(NATIVE_PASTE_ITEM)
    if (this.tableHasMergeMarkers(table)) items.push(NATIVE_STRUCTURE_ITEM)
    if (items.length === 1) return false

    try {
      // Typora normally calls setItems again later in this contextmenu event.
      // The native bridge remembers these sentinel keys and combines them
      // with Typora's final menu instead of replacing its menu. On macOS we
      // publish optimistically so startup timing cannot force the HTML menu;
      // without the native bridge Typora simply ignores the sentinel keys and
      // still shows its original context menu.
      if (typeof callSync === 'function') {
        callSync.call(window.bridge, 'contextMenu.setItems', items)
      } else {
        setItems!.call(window.JSBridge!.contextMenu, items)
      }
      return true
    } catch (error) {
      console.error('[TableCraft] Failed to publish native menu state', error)
      return false
    }
  }

  private selectMergedCellRange(cell: HTMLTableCellElement) {
    const table = cell.closest<HTMLTableElement>('table')
    const rowElement = cell.parentElement as HTMLTableRowElement | null
    if (!table || !rowElement) return

    const row = Array.from(table.rows).indexOf(rowElement)
    const col = Array.from(rowElement.cells).indexOf(cell)
    const rowSpan = cell.rowSpan
    const colSpan = cell.colSpan

    this.clearSelection(false)
    this.anchor = { table, row, col }
    this.focus = {
      table,
      row: row + rowSpan - 1,
      col: col + colSpan - 1,
    }
    this.selectionComplete = true
    this.paintSelection()
  }

  private selectCell(cell: HTMLTableCellElement) {
    const table = cell.closest<HTMLTableElement>('table')
    const rowElement = cell.parentElement as HTMLTableRowElement | null
    if (!table || !rowElement) return

    const point: CellPoint = {
      table,
      row: Array.from(table.rows).indexOf(rowElement),
      col: Array.from(rowElement.cells).indexOf(cell),
    }

    if (!this.anchor || this.anchor.table !== table) {
      this.clearSelection(false)
      this.anchor = point
    }

    this.focus = point
    this.paintSelection()
  }

  private beginSelectionAtCell(cell: HTMLTableCellElement) {
    const table = cell.closest<HTMLTableElement>('table')
    if (!table) return

    const previousTable = this.anchor?.table
    this.clearSelection(Boolean(previousTable && previousTable !== table))
    this.selectCell(cell)
  }

  private isCellInsideSelection(cell: HTMLTableCellElement) {
    const range = this.getSelectionRange()
    const table = cell.closest<HTMLTableElement>('table')
    const rowElement = cell.parentElement as HTMLTableRowElement | null
    if (!range || !table || table !== range.table || !rowElement) return false

    const row = Array.from(table.rows).indexOf(rowElement)
    const col = Array.from(rowElement.cells).indexOf(cell)
    return (
      row >= range.minRow &&
      row <= range.maxRow &&
      col >= range.minCol &&
      col <= range.maxCol
    )
  }

  private paintSelection() {
    this.clearNativeTextSelection()
    document
      .querySelectorAll('.tm-cell-selected')
      .forEach(cell => cell.classList.remove('tm-cell-selected'))

    const range = this.getSelectionRange()
    if (!range) return

    for (let row = range.minRow; row <= range.maxRow; row++) {
      for (let col = range.minCol; col <= range.maxCol; col++) {
        range.table.rows[row]?.cells[col]?.classList.add('tm-cell-selected')
      }
    }
  }

  private clearNativeTextSelection() {
    const selection = window.getSelection()
    if (selection?.rangeCount) selection.removeAllRanges()
  }

  private getSelectionRange() {
    if (!this.anchor || !this.focus || this.anchor.table !== this.focus.table) {
      return undefined
    }

    return {
      table: this.anchor.table,
      minRow: Math.min(this.anchor.row, this.focus.row),
      maxRow: Math.max(this.anchor.row, this.focus.row),
      minCol: Math.min(this.anchor.col, this.focus.col),
      maxCol: Math.max(this.anchor.col, this.focus.col),
    }
  }

  private getFocusedCell() {
    const selectionNode = window.getSelection()?.anchorNode
    const selectionElement = selectionNode instanceof Element
      ? selectionNode
      : selectionNode?.parentElement
    const focusedNode = editor?.focusCid
      ? document.querySelector(`[cid="${CSS.escape(editor.focusCid)}"]`)
      : undefined
    return (selectionElement ?? focusedNode)
      ?.closest<HTMLTableCellElement>('#write table td, #write table th')
  }

  private tableHasMergeMarkers(table: HTMLTableElement) {
    if (table.classList.contains('tm-merged-table')) return true
    return Array.from(table.rows).some(row => (
      Array.from(row.cells).some(cell => parseMarker(cell.textContent ?? ''))
    ))
  }

  private captureSelection(range: TableRange): TableClipboard {
    const tableIndex = this.getEditorTableIndex(range.table)
    const markdown = this.app.features.markdownEditor.getMarkdown()
    const rows = extractRectangleFromMarkdown(markdown, tableIndex, range)
    return {
      version: 1,
      rows,
      plainText: rectangleToPlainText(rows),
    }
  }

  private writeClipboardText(text: string) {
    const writeText = navigator.clipboard?.writeText
    if (typeof writeText !== 'function') return
    void writeText.call(navigator.clipboard, text).catch((error: unknown) => {
      console.error('[TableCraft] Failed to write system clipboard', error)
    })
  }

  private copySelectedCells() {
    const range = this.getSelectionRange()
    if (!range || !this.selectionComplete) {
      Notice.warning('请先用 Alt/Option 选择需要复制的完整区域。')
      return
    }

    try {
      const clipboard = this.captureSelection(range)
      this.tableClipboard = clipboard
      this.writeClipboardText(clipboard.plainText)
    } catch (error) {
      Notice.error(error instanceof Error ? error.message : String(error))
    }
  }

  private cutSelectedCells() {
    const range = this.getSelectionRange()
    if (!range || !this.selectionComplete) {
      Notice.warning('请先用 Alt/Option 选择需要剪切的完整区域。')
      return
    }

    try {
      const clipboard = this.captureSelection(range)
      this.tableClipboard = clipboard
      this.writeClipboardText(clipboard.plainText)
      this.clearSelectedCells(range)
    } catch (error) {
      Notice.error(error instanceof Error ? error.message : String(error))
    }
  }

  private clearSelectedCells(range: TableRange) {
    const tableIndex = this.getEditorTableIndex(range.table)
    const markdown = this.app.features.markdownEditor.getMarkdown()
    const next = clearRectangleInMarkdown(markdown, tableIndex, range)
    this.reloadMarkdown(next)
    this.clearSelection(false)
  }

  private pasteSelectedCells() {
    if (!this.tableClipboard) {
      Notice.warning('还没有复制或剪切过表格区域。')
      return
    }
    this.pasteRows(this.tableClipboard.rows)
  }

  private pasteRows(rows: string[][]) {
    const range = this.getSelectionRange()
    if (!range) {
      Notice.warning('请先用 Alt/Option 点击粘贴位置。')
      return
    }

    const selectedRows = range.maxRow - range.minRow + 1
    const selectedCols = range.maxCol - range.minCol + 1
    const sourceRows = rows.length
    const sourceCols = rows[0]?.length ?? 0
    if (
      this.selectionComplete &&
      (selectedRows !== sourceRows || selectedCols !== sourceCols)
    ) {
      Notice.warning(`粘贴区域需要是 ${sourceRows}×${sourceCols}，或只选择左上角起点。`)
      return
    }

    try {
      const tableIndex = this.getEditorTableIndex(range.table)
      const markdown = this.app.features.markdownEditor.getMarkdown()
      const next = pasteRectangleInMarkdown(
        markdown,
        tableIndex,
        range.minRow,
        range.minCol,
        rows,
      )
      this.reloadMarkdown(next)
      this.clearSelection(false)
    } catch (error) {
      Notice.error(error instanceof Error ? error.message : String(error))
    }
  }

  private getContextPoint() {
    const cell = this.contextCell
    const table = cell?.closest<HTMLTableElement>('#write table')
    const rowElement = cell?.parentElement as HTMLTableRowElement | null
    if (!cell || !table || !rowElement) {
      throw new Error('无法定位当前表格单元格。')
    }
    return {
      table,
      row: Array.from(table.rows).indexOf(rowElement),
      col: Array.from(rowElement.cells).indexOf(cell),
    }
  }

  private insertRow(before: boolean) {
    try {
      const point = this.getContextPoint()
      const range = this.getSelectionRange()
      const insertionRow = range && this.isCellInsideSelection(this.contextCell!)
        ? (before ? range.minRow : range.maxRow + 1)
        : point.row + (before ? 0 : 1)
      const tableIndex = this.getEditorTableIndex(point.table)
      const markdown = this.app.features.markdownEditor.getMarkdown()
      this.reloadMarkdown(insertTableRowInMarkdown(markdown, tableIndex, insertionRow))
      this.clearSelection(false)
    } catch (error) {
      Notice.error(error instanceof Error ? error.message : String(error))
    }
  }

  private deleteRow() {
    try {
      const point = this.getContextPoint()
      const tableIndex = this.getEditorTableIndex(point.table)
      const markdown = this.app.features.markdownEditor.getMarkdown()
      this.reloadMarkdown(deleteTableRowInMarkdown(markdown, tableIndex, point.row))
      this.clearSelection(false)
    } catch (error) {
      Notice.error(error instanceof Error ? error.message : String(error))
    }
  }

  private insertColumn(before: boolean) {
    try {
      const point = this.getContextPoint()
      const range = this.getSelectionRange()
      const insertionCol = range && this.isCellInsideSelection(this.contextCell!)
        ? (before ? range.minCol : range.maxCol + 1)
        : point.col + (before ? 0 : 1)
      const tableIndex = this.getEditorTableIndex(point.table)
      const markdown = this.app.features.markdownEditor.getMarkdown()
      this.reloadMarkdown(insertTableColumnInMarkdown(markdown, tableIndex, insertionCol))
      this.clearSelection(false)
    } catch (error) {
      Notice.error(error instanceof Error ? error.message : String(error))
    }
  }

  private deleteColumn() {
    try {
      const point = this.getContextPoint()
      const tableIndex = this.getEditorTableIndex(point.table)
      const markdown = this.app.features.markdownEditor.getMarkdown()
      this.reloadMarkdown(deleteTableColumnInMarkdown(markdown, tableIndex, point.col))
      this.clearSelection(false)
    } catch (error) {
      Notice.error(error instanceof Error ? error.message : String(error))
    }
  }

  private mergeSelectedCells() {
    const range = this.getSelectionRange()
    if (!range) {
      Notice.warning('请按住 Alt/Option，依次点击矩形区域的两个对角单元格。')
      return
    }

    if (range.minRow === range.maxRow && range.minCol === range.maxCol) {
      Notice.warning('至少需要选择两个单元格。')
      return
    }

    try {
      const tableIndex = this.getEditorTableIndex(range.table)
      const markdown = this.app.features.markdownEditor.getMarkdown()
      const next = mergeRectangleInMarkdown(markdown, tableIndex, range)
      this.reloadMarkdown(next)
      this.clearSelection(false)
    } catch (error) {
      Notice.error(error instanceof Error ? error.message : String(error))
    }
  }

  private mergeFocusedCell(rowOffset: number, colOffset: number) {
    const selectionNode = window.getSelection()?.anchorNode
    const selectionElement = selectionNode instanceof Element
      ? selectionNode
      : selectionNode?.parentElement
    const focusedNode = editor?.focusCid
      ? document.querySelector(`[cid="${CSS.escape(editor.focusCid)}"]`)
      : undefined
    const cell = (selectionElement ?? focusedNode)
      ?.closest<HTMLTableCellElement>('#write table td, #write table th')
    const table = cell?.closest<HTMLTableElement>('table')
    const rowElement = cell?.parentElement as HTMLTableRowElement | null

    if (!cell || !table || !rowElement) {
      Notice.warning('请先把光标放入需要合并的原生表格单元格。')
      return
    }

    restoreMergedTable(table)
    const row = Array.from(table.rows).indexOf(rowElement)
    const col = Array.from(rowElement.cells).indexOf(cell)
    const target = table.rows[row + rowOffset]?.cells[col + colOffset]
    if (!target) {
      Notice.warning('指定方向没有可合并的相邻单元格。')
      return
    }

    this.anchor = { table, row, col }
    this.focus = {
      table,
      row: row + rowOffset,
      col: col + colOffset,
    }
    this.mergeSelectedCells()
  }

  private unmergeSelectedCells() {
    const range = this.getSelectionRange()
    if (!range) {
      Notice.warning('请右键需要取消合并的单元格。')
      return
    }

    try {
      const tableIndex = this.getEditorTableIndex(range.table)
      const markdown = this.app.features.markdownEditor.getMarkdown()
      const next = unmergeRectangleInMarkdown(markdown, tableIndex, range)
      this.reloadMarkdown(next)
      this.clearSelection(false)
    } catch (error) {
      Notice.error(error instanceof Error ? error.message : String(error))
    }
  }

  private getEditorTableIndex(table: HTMLTableElement) {
    const tables = Array.from(document.querySelectorAll<HTMLTableElement>('#write table'))
    const index = tables.indexOf(table)
    if (index < 0) throw new Error('无法定位当前表格。')
    return index
  }

  private reloadMarkdown(markdown: string) {
    const reloadContent = (File as unknown as { reloadContent: ReloadContent }).reloadContent
    if (typeof reloadContent !== 'function') {
      throw new Error('当前 Typora 版本不提供可撤销的 reloadContent 接口。')
    }

    reloadContent.call(File, markdown, { delayRefresh: false })
  }

  private installTableContextMenuItems() {
    document.querySelector('#tm-table-context-menu')?.remove()

    const menu = document.createElement('div')
    menu.id = 'tm-table-context-menu'
    menu.className = 'ty-editor-toolbar-menu tm-table-context-menu'
    menu.setAttribute('role', 'menu')

    const mergeItem = this.createTableMenuItem(
      'tm_merge_cells',
      '合并所选单元格',
      () => this.mergeSelectedCells(),
    )
    const unmergeItem = this.createTableMenuItem(
      'tm_unmerge_cells',
      '取消合并',
      () => this.unmergeSelectedCells(),
    )
    const copyItem = this.createTableMenuItem(
      'tm_copy_cells',
      '复制所选区域',
      () => this.copySelectedCells(),
    )
    const cutItem = this.createTableMenuItem(
      'tm_cut_cells',
      '剪切所选区域',
      () => this.cutSelectedCells(),
    )
    const pasteItem = this.createTableMenuItem(
      'tm_paste_cells',
      '粘贴表格区域',
      () => this.pasteSelectedCells(),
    )
    menu.append(
      mergeItem,
      unmergeItem,
      this.createTableMenuDivider(),
      copyItem,
      cutItem,
      pasteItem,
      this.createTableMenuDivider(),
      this.createTableMenuItem('tm_insert_row_before', '上方插入行', () => this.insertRow(true)),
      this.createTableMenuItem('tm_insert_row_after', '下方插入行', () => this.insertRow(false)),
      this.createTableMenuItem('tm_insert_col_before', '左侧插入列', () => this.insertColumn(true)),
      this.createTableMenuItem('tm_insert_col_after', '右侧插入列', () => this.insertColumn(false)),
      this.createTableMenuDivider(),
      this.createTableMenuItem('tm_delete_row', '删除行', () => this.deleteRow()),
      this.createTableMenuItem('tm_delete_col', '删除列', () => this.deleteColumn()),
      this.createTableMenuDivider(),
      this.createNativeTableMenuItem('复制表格', tableEdit => tableEdit.copyTable()),
      this.createNativeTableMenuItem('格式化表格源码', tableEdit => tableEdit.reformatTable()),
      this.createTableMenuDivider(),
      this.createNativeTableMenuItem('删除表格', tableEdit => tableEdit.deleteTable(), true),
    )
    document.body.append(menu)

    this.contextMenu = menu
    this.mergeMenuItem = mergeItem
    this.unmergeMenuItem = unmergeItem
    this.copyMenuItem = copyItem
    this.cutMenuItem = cutItem
    this.pasteMenuItem = pasteItem

    this.register(() => {
      menu.remove()
      this.contextMenu = undefined
      this.mergeMenuItem = undefined
      this.unmergeMenuItem = undefined
      this.copyMenuItem = undefined
      this.cutMenuItem = undefined
      this.pasteMenuItem = undefined
    })
  }

  private createTableMenuItem(
    key: string,
    label: string,
    callback: () => void,
    danger = false,
  ) {
    const item = document.createElement('div')
    item.className = 'ty-editor-toolbar-menu-item tm-table-menu-item'
    if (danger) item.classList.add('tm-danger')
    item.dataset.key = key
    item.setAttribute('role', 'menuitem')
    item.tabIndex = -1
    item.innerHTML = `<span class="tmi-label">${label}</span><span class="tmi-extra"></span>`

    const listener = (event: Event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (item.classList.contains('disabled')) return
      this.hideTableContextMenu()
      callback()
    }
    item.addEventListener('click', listener)
    this.register(() => item.removeEventListener('click', listener))
    return item
  }

  private createTableMenuDivider() {
    const divider = document.createElement('div')
    divider.className = 'ty-editor-toolbar-menu-divider tm-table-menu-divider'
    divider.setAttribute('role', 'separator')
    return divider
  }

  private createNativeTableMenuItem(
    label: string,
    callback: (tableEdit: TyporaTableEdit) => void,
    danger = false,
  ) {
    const key = `tm_native_${label}`
    return this.createTableMenuItem(
      key,
      label,
      () => this.runNativeTableAction(callback),
      danger,
    )
  }

  private runNativeTableAction(callback: (tableEdit: TyporaTableEdit) => void) {
    const tableEdit = (editor as unknown as { tableEdit?: TyporaTableEdit })?.tableEdit
    if (!tableEdit) {
      Notice.warning('当前 Typora 版本未提供表格编辑接口。')
      return
    }

    const cell = this.contextCell
    if (cell?.isConnected) this.focusTyporaCell(cell)

    try {
      callback(tableEdit)
      this.clearSelection(false)
      this.scheduleLiveRender()
    } catch (error) {
      Notice.error(error instanceof Error ? error.message : String(error))
    }
  }

  private updateTableContextMenuItems() {
    const range = this.getSelectionRange()
    if (!this.mergeMenuItem || !this.unmergeMenuItem) return

    const rows = range ? range.maxRow - range.minRow + 1 : 0
    const cols = range ? range.maxCol - range.minCol + 1 : 0
    const containsMerge = this.selectionContainsMergeMarker(range)
    const canUseSelection = Boolean(range && this.selectionComplete)
    const canMerge = canUseSelection && rows * cols > 1 && !containsMerge
    const canUnmerge = canUseSelection && containsMerge
    this.mergeMenuItem.hidden = !canMerge
    this.unmergeMenuItem.hidden = !canUnmerge
    this.setMenuItemEnabled(this.mergeMenuItem, canMerge)
    this.setMenuItemEnabled(this.unmergeMenuItem, canUnmerge)
    if (this.copyMenuItem) this.setMenuItemEnabled(this.copyMenuItem, canUseSelection)
    if (this.cutMenuItem) this.setMenuItemEnabled(this.cutMenuItem, canUseSelection)
    if (this.pasteMenuItem) {
      this.setMenuItemEnabled(this.pasteMenuItem, Boolean(range && this.tableClipboard))
    }

    const label = this.mergeMenuItem.querySelector('.tmi-label')
    if (label) {
      label.textContent = canMerge
        ? `合并所选单元格（${rows}×${cols}，共 ${rows * cols} 个）`
        : '合并所选单元格'
    }
  }

  private selectionContainsMergeMarker(range: ReturnType<TableMergePlugin['getSelectionRange']>) {
    if (!range) return false
    for (let row = range.minRow; row <= range.maxRow; row++) {
      for (let col = range.minCol; col <= range.maxCol; col++) {
        const content = range.table.rows[row]?.cells[col]?.textContent ?? ''
        if (parseMarker(content)) return true
      }
    }
    return false
  }

  private setMenuItemEnabled(item: HTMLElement, enabled: boolean) {
    item.classList.toggle('disabled', !enabled)
    item.setAttribute('aria-disabled', String(!enabled))
  }

  private showTableContextMenu(clientX: number, clientY: number) {
    const menu = this.contextMenu
    if (!menu) return

    document
      .querySelectorAll<HTMLElement>('.context-menu.show')
      .forEach(openMenu => openMenu.classList.remove('show'))

    menu.style.display = 'block'
    const rect = menu.getBoundingClientRect()
    const left = Math.max(0, Math.min(clientX, window.innerWidth - rect.width - 20))
    const top = Math.max(
      0,
      Math.min(clientY + 6, window.innerHeight - rect.height - 20),
    )
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
  }

  private hideTableContextMenu() {
    if (this.contextMenu) this.contextMenu.style.display = 'none'
  }

  private focusTyporaCell(cell: HTMLTableCellElement) {
    const cid = cell.getAttribute('cid') ?? cell.closest<HTMLElement>('[cid]')?.getAttribute('cid')
    const refocus = (editor as unknown as {
      refocus?: (cid?: string) => void
    })?.refocus
    if (cid && typeof refocus === 'function') {
      refocus.call(editor, cid)
    }
  }

  private clearSelection(render: boolean) {
    const table = this.anchor?.table
    document
      .querySelectorAll('.tm-cell-selected')
      .forEach(cell => cell.classList.remove('tm-cell-selected'))

    this.anchor = undefined
    this.focus = undefined
    this.selectionComplete = false

    if (table) {
      if (render) applyMergesToTable(table, 'live')
    }
  }
}
