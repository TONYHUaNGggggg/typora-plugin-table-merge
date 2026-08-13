import './style.scss'
import {
  HtmlPostProcessor,
  Notice,
  Plugin,
} from '@typora-community-plugin/core'
import { File, editor } from 'typora'
import {
  mergeRectangleInMarkdown,
  parseMarker,
  unmergeRectangleInMarkdown,
} from './table-model'
import {
  applyMergesToTable,
  maskMergeMarkerCells,
  restoreMergedTable,
} from './merge-dom'

type CellPoint = {
  table: HTMLTableElement
  row: number
  col: number
}

type ReloadContent = (
  markdown: string,
  options?: Record<string, unknown>,
) => void

type TyporaTableEdit = {
  addRow: (before: boolean) => void
  addCol: (before: boolean) => void
  deleteRow: (fromMenu?: boolean) => void
  deleteCol: () => void
  copyTable: () => void
  reformatTable: () => void
  deleteTable: () => void
}

export default class TableMergePlugin extends Plugin {
  private anchor?: CellPoint
  private focus?: CellPoint
  private selectionComplete = false
  private renderTimer?: number
  private contextCell?: HTMLTableCellElement
  private contextMenu?: HTMLDivElement
  private mergeMenuItem?: HTMLDivElement
  private unmergeMenuItem?: HTMLDivElement

  onload() {
    this.registerMarkdownProcessors()
    this.registerCommands()
    this.observeLiveTables()
    this.registerDocumentEvent('mousedown', this.onDocumentMouseDown)
    this.registerDocumentEvent('contextmenu', this.onDocumentContextMenu)
    this.registerDocumentEvent('click', this.onDocumentClick)
    this.registerDocumentEvent('dblclick', this.onDocumentDoubleClick)

    try {
      this.installTableContextMenuItems()
    } catch (error) {
      console.error('[Table Merge] Failed to install table menu', error)
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

    const observer = new MutationObserver(() => {
      document
        .querySelectorAll<HTMLTableElement>('#write table[data-tm-selecting="true"]')
        .forEach(maskMergeMarkerCells)
      this.scheduleLiveRender()
    })
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
        .querySelectorAll<HTMLTableElement>('#write table:not([data-tm-editing="true"])')
        .forEach(table => applyMergesToTable(table, 'live'))
    })
  }

  private registerMarkdownProcessors() {
    const previewProcessor = HtmlPostProcessor.from({
      selector: 'table',
      process: (element) => {
        const table = element as HTMLTableElement
        if (table.matches('[data-tm-editing="true"]')) return
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
      id: 'toggle-current-table-edit-mode',
      title: '表格：切换合并预览/原始编辑',
      scope: 'editor',
      callback: () => this.toggleEditMode(),
    })

    this.registerCommand({
      id: 'clear-cell-selection',
      title: '表格：清除合并区域选择',
      scope: 'editor',
      callback: () => this.clearSelection(true),
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
        this.beginSelectionAtCell(cell)
        this.selectionComplete = false
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
      document
        .querySelectorAll<HTMLTableElement>('#write table[data-tm-editing="true"]')
        .forEach(table => {
          table.removeAttribute('data-tm-editing')
          applyMergesToTable(table, 'live')
        })
    }
  }

  private onDocumentContextMenu = (event: Event) => {
    const mouseEvent = event as MouseEvent
    const cell = this.getCellFromMouseEvent(mouseEvent)
    if (!cell) return

    if (!this.selectionComplete && cell.dataset.tmOrigin === 'true') {
      this.selectMergedCellRange(cell)
    }

    const range = this.getSelectionRange()
    if (
      !this.selectionComplete ||
      !range ||
      !this.isCellInsideSelection(cell)
    ) {
      // A normal table right-click must remain completely owned by Typora.
      // The plugin menu is only used for an explicit blue Alt/Option selection.
      this.hideTableContextMenu()
      if (range) this.clearSelection(true)
      return
    }

    mouseEvent.preventDefault()
    mouseEvent.stopImmediatePropagation()

    this.contextCell = cell
    this.focusTyporaCell(cell)
    this.updateTableContextMenuItems()
    const { clientX, clientY } = mouseEvent
    window.setTimeout(() => this.showTableContextMenu(clientX, clientY))
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
    table.dataset.tmSelecting = 'true'
    restoreMergedTable(table)
    table.dataset.tmEditing = 'true'
    maskMergeMarkerCells(table)
    this.anchor = { table, row, col }
    this.focus = {
      table,
      row: row + rowSpan - 1,
      col: col + colSpan - 1,
    }
    this.selectionComplete = true
    this.paintSelection()
  }

  private onDocumentDoubleClick = (event: Event) => {
    const target = event.target as Element | null
    const table = target?.closest<HTMLTableElement>('#write table.tm-merged-table')
    if (!table) return

    table.dataset.tmEditing = 'true'
    table.removeAttribute('data-tm-selecting')
    restoreMergedTable(table)
  }

  private selectCell(cell: HTMLTableCellElement) {
    const table = cell.closest<HTMLTableElement>('table')
    const rowElement = cell.parentElement as HTMLTableRowElement | null
    if (!table || !rowElement) return

    table.dataset.tmSelecting = 'true'
    restoreMergedTable(table)
    table.dataset.tmEditing = 'true'
    maskMergeMarkerCells(table)

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

  private toggleEditMode() {
    const table = this.anchor?.table
    if (!table) {
      Notice.warning('请先选择表格中的一个单元格。')
      return
    }

    if (table.dataset.tmEditing === 'true') {
      table.removeAttribute('data-tm-editing')
      this.clearSelection(false)
      applyMergesToTable(table, 'live')
    } else {
      restoreMergedTable(table)
      table.dataset.tmEditing = 'true'
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
    menu.append(
      mergeItem,
      unmergeItem,
      this.createTableMenuDivider(),
      this.createNativeTableMenuItem('上方插入行', tableEdit => tableEdit.addRow(true)),
      this.createNativeTableMenuItem('下方插入行', tableEdit => tableEdit.addRow(false)),
      this.createNativeTableMenuItem('左侧插入列', tableEdit => tableEdit.addCol(true)),
      this.createNativeTableMenuItem('右侧插入列', tableEdit => tableEdit.addCol(false)),
      this.createTableMenuDivider(),
      this.createNativeTableMenuItem('删除行', tableEdit => tableEdit.deleteRow(false)),
      this.createNativeTableMenuItem('删除列', tableEdit => tableEdit.deleteCol()),
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

    this.register(() => {
      menu.remove()
      this.contextMenu = undefined
      this.mergeMenuItem = undefined
      this.unmergeMenuItem = undefined
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
    if (!range || !this.mergeMenuItem || !this.unmergeMenuItem) return

    const rows = range.maxRow - range.minRow + 1
    const cols = range.maxCol - range.minCol + 1
    const containsMerge = this.selectionContainsMergeMarker(range)
    const canMerge = rows * cols > 1 && !containsMerge
    this.setMenuItemEnabled(this.mergeMenuItem, canMerge)
    this.setMenuItemEnabled(this.unmergeMenuItem, containsMerge)

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
      table.removeAttribute('data-tm-selecting')
      table.removeAttribute('data-tm-editing')
      if (render) applyMergesToTable(table, 'live')
    }
  }
}
