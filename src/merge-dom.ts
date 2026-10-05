import { MERGE_LEFT, MERGE_UP, parseMarker } from './table-model'

type RenderMode = 'live' | 'export'

type Origin = {
  row: number
  col: number
  cell: HTMLTableCellElement
}

export function restoreMergedTable(table: HTMLTableElement) {
  table.classList.remove('tm-merged-table')

  table
    .querySelectorAll<HTMLTableCellElement>('[data-tm-origin="true"]')
    .forEach(cell => {
      cell.removeAttribute('rowspan')
      cell.removeAttribute('colspan')
      cell.removeAttribute('data-tm-origin')
      cell.removeAttribute('data-tm-size')
      cell.removeAttribute('title')
    })

  table
    .querySelectorAll<HTMLTableCellElement>('.tm-covered-cell')
    .forEach(cell => {
      cell.classList.remove('tm-covered-cell')
      cell.removeAttribute('aria-hidden')
    })

}

export function applyMergesToTable(table: HTMLTableElement, mode: RenderMode) {
  const hasMarkers = Array.from(table.rows).some(row => (
    Array.from(row.cells).some(cell => parseMarker(cell.textContent ?? ''))
  ))

  if (!hasMarkers && !table.classList.contains('tm-merged-table')) {
    return 0
  }

  if (mode === 'live') restoreMergedTable(table)

  const rowGroups = Array.from(table.children)
    .filter(section => ['THEAD', 'TBODY', 'TFOOT'].includes(section.tagName))
    .map(section => (
      Array.from(section.children)
        .filter(row => row.tagName === 'TR') as HTMLTableRowElement[]
    ))

  const directRows = Array.from(table.children)
    .filter(row => row.tagName === 'TR') as HTMLTableRowElement[]
  if (directRows.length) rowGroups.push(directRows)

  let mergeCount = 0
  rowGroups.forEach(rows => {
    mergeCount += applyMergesToRowGroup(rows, mode)
  })

  if (mode === 'live' && mergeCount > 0) {
    table.classList.add('tm-merged-table')
  }

  return mergeCount
}

function applyMergesToRowGroup(rows: HTMLTableRowElement[], mode: RenderMode) {
  const cells = rows.map(row => Array.from(row.cells) as HTMLTableCellElement[])
  const refs: Array<Array<Origin | undefined>> = cells.map(row => new Array(row.length))

  for (let row = 0; row < cells.length; row++) {
    for (let col = 0; col < cells[row].length; col++) {
      const cell = cells[row][col]
      const marker = parseMarker(cell.textContent ?? '')
      let origin: Origin | undefined

      if (marker?.direction === MERGE_LEFT && col > 0) {
        origin = refs[row][col - 1]
      } else if (marker?.direction === MERGE_UP && row > 0) {
        origin = refs[row - 1]?.[col]
      }

      refs[row][col] = origin ?? { row, col, cell }
    }
  }

  const origins = new Set<Origin>()
  refs.forEach(row => row.forEach(origin => origin && origins.add(origin)))

  let mergeCount = 0
  const cellsToRemove: HTMLTableCellElement[] = []

  for (const origin of origins) {
    const positions: Array<[number, number]> = []
    refs.forEach((row, rowIndex) => {
      row.forEach((value, colIndex) => {
        if (value === origin) positions.push([rowIndex, colIndex])
      })
    })

    if (positions.length <= 1) continue

    const rowIndexes = positions.map(([row]) => row)
    const colIndexes = positions.map(([, col]) => col)
    const minRow = Math.min(...rowIndexes)
    const maxRow = Math.max(...rowIndexes)
    const minCol = Math.min(...colIndexes)
    const maxCol = Math.max(...colIndexes)
    const rowSpan = maxRow - minRow + 1
    const colSpan = maxCol - minCol + 1

    let valid =
      origin.row === minRow &&
      origin.col === minCol &&
      positions.length === rowSpan * colSpan

    for (let row = minRow; valid && row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        if (refs[row]?.[col] !== origin) {
          valid = false
          break
        }
      }
    }

    if (!valid) continue

    origin.cell.rowSpan = rowSpan
    origin.cell.colSpan = colSpan
    mergeCount++

    if (mode === 'live') {
      origin.cell.dataset.tmOrigin = 'true'
      origin.cell.dataset.tmSize = `${rowSpan}×${colSpan}`
      origin.cell.title = `合并区域 ${rowSpan}×${colSpan}（${positions.length} 个单元格）`
    }

    positions.forEach(([row, col]) => {
      const cell = cells[row][col]
      if (cell === origin.cell) return

      if (mode === 'export') {
        cellsToRemove.push(cell)
      } else {
        cell.classList.add('tm-covered-cell')
        cell.setAttribute('aria-hidden', 'true')
      }
    })
  }

  cellsToRemove.forEach(cell => cell.remove())
  return mergeCount
}
