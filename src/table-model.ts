export const MERGE_LEFT = '<'
export const MERGE_UP = '^'

export type MergeDirection = typeof MERGE_LEFT | typeof MERGE_UP

export type Rectangle = {
  minRow: number
  maxRow: number
  minCol: number
  maxCol: number
}

export type ParsedTable = {
  startLine: number
  endLine: number
  rows: string[][]
  delimiter: string[]
}

export type Marker = {
  direction: MergeDirection
  original: string
}

type Origin = {
  row: number
  col: number
}

const MARKER_PATTERN = /^::tmc-(left|up):([0-9a-fA-F]*)::$/
const LEGACY_MARKER_PATTERN = /^([<^])(?:<!--tmc:([0-9a-fA-F]*)-->)?$/

export function encodeCellContent(content: string) {
  const bytes = new TextEncoder().encode(content)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function decodeCellContent(encoded: string) {
  if (!encoded) return ''
  if (encoded.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(encoded)) {
    throw new Error('合并标记中的备份内容已损坏。')
  }

  const bytes = new Uint8Array(
    encoded.match(/../g)!.map(pair => Number.parseInt(pair, 16)),
  )
  return new TextDecoder().decode(bytes)
}

export function makeMarker(direction: MergeDirection, original: string) {
  const name = direction === MERGE_LEFT ? 'left' : 'up'
  return `::tmc-${name}:${encodeCellContent(original)}::`
}

export function parseMarker(source: string): Marker | undefined {
  const normalized = source.trim()
  const match = normalized.match(MARKER_PATTERN)
  if (match) {
    return {
      direction: match[1] === 'left' ? MERGE_LEFT : MERGE_UP,
      original: decodeCellContent(match[2] ?? ''),
    }
  }

  const legacy = normalized.match(LEGACY_MARKER_PATTERN)
  if (!legacy) return undefined
  return {
    direction: legacy[1] as MergeDirection,
    original: decodeCellContent(legacy[2] ?? ''),
  }
}

export function splitTableRow(line: string) {
  let source = line.trim()
  if (source.startsWith('|')) source = source.slice(1)
  if (source.endsWith('|') && !isEscaped(source, source.length - 1)) {
    source = source.slice(0, -1)
  }

  const cells: string[] = []
  let current = ''
  let codeFenceLength = 0

  for (let index = 0; index < source.length; index++) {
    const char = source[index]

    if (char === '`' && !isEscaped(source, index)) {
      let runLength = 1
      while (source[index + runLength] === '`') runLength++

      if (codeFenceLength === 0) codeFenceLength = runLength
      else if (codeFenceLength === runLength) codeFenceLength = 0

      current += source.slice(index, index + runLength)
      index += runLength - 1
      continue
    }

    if (char === '|' && codeFenceLength === 0 && !isEscaped(source, index)) {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  cells.push(current.trim())
  return cells
}

function isEscaped(source: string, index: number) {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor--) {
    slashCount++
  }
  return slashCount % 2 === 1
}

function isDelimiterRow(cells: string[]) {
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()))
}

function isFence(line: string) {
  return line.match(/^ {0,3}(`{3,}|~{3,})/)
}

export function parseMarkdownTables(markdown: string): ParsedTable[] {
  const lines = markdown.split(/\r?\n/)
  const tables: ParsedTable[] = []
  let openFence: { char: string; length: number } | undefined

  for (let index = 0; index < lines.length - 1; index++) {
    const fence = isFence(lines[index])
    if (fence) {
      const token = fence[1]
      if (!openFence) {
        openFence = { char: token[0], length: token.length }
      } else if (token[0] === openFence.char && token.length >= openFence.length) {
        openFence = undefined
      }
      continue
    }
    if (openFence) continue

    if (!lines[index].includes('|') || !lines[index + 1].includes('-')) continue

    const header = splitTableRow(lines[index])
    const delimiter = splitTableRow(lines[index + 1])
    if (header.length < 1 || delimiter.length !== header.length || !isDelimiterRow(delimiter)) {
      continue
    }

    const rows = [normalizeRow(header, header.length)]
    let endLine = index + 1

    for (let cursor = index + 2; cursor < lines.length; cursor++) {
      const line = lines[cursor]
      if (!line.trim() || !line.includes('|') || isFence(line)) break
      const cells = splitTableRow(line)
      rows.push(normalizeRow(cells, header.length))
      endLine = cursor
    }

    tables.push({
      startLine: index,
      endLine,
      rows,
      delimiter,
    })
    index = endLine
  }

  return tables
}

function normalizeRow(cells: string[], width: number) {
  const normalized = cells.slice(0, width)
  while (normalized.length < width) normalized.push('')
  return normalized
}

function serializeTable(table: ParsedTable) {
  const serializeRow = (row: string[]) => `| ${row.join(' | ')} |`
  return [
    serializeRow(table.rows[0]),
    serializeRow(table.delimiter),
    ...table.rows.slice(1).map(serializeRow),
  ]
}

function rewriteTable(
  markdown: string,
  tableIndex: number,
  transform: (rows: string[][]) => string[][],
) {
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n'
  const trailingNewline = markdown.endsWith('\n')
  const lines = markdown.split(/\r?\n/)
  if (trailingNewline) lines.pop()

  const tables = parseMarkdownTables(markdown)
  const table = tables[tableIndex]
  if (!table) throw new Error('无法把当前 Typora 表格映射到 Markdown 源码。')

  const nextTable = { ...table, rows: transform(table.rows.map(row => [...row])) }
  lines.splice(
    table.startLine,
    table.endLine - table.startLine + 1,
    ...serializeTable(nextTable),
  )

  return lines.join(newline) + (trailingNewline ? newline : '')
}

function assertRectangle(rows: string[][], rectangle: Rectangle) {
  if (
    rectangle.minRow < 0 ||
    rectangle.minCol < 0 ||
    rectangle.maxRow >= rows.length ||
    rectangle.maxCol >= rows[0].length
  ) {
    throw new Error('所选矩形超出表格范围。')
  }

  if (rectangle.minRow === 0 && rectangle.maxRow > 0) {
    throw new Error('不能跨越表头和正文进行纵向合并。')
  }
}

function buildOrigins(rows: string[][]) {
  const refs: Array<Array<Origin | undefined>> = rows.map(row => new Array(row.length))

  for (let row = 0; row < rows.length; row++) {
    for (let col = 0; col < rows[row].length; col++) {
      const marker = parseMarker(rows[row][col])
      let origin: Origin | undefined

      if (marker?.direction === MERGE_LEFT && col > 0) {
        origin = refs[row][col - 1]
      } else if (marker?.direction === MERGE_UP && row > 0 && row !== 1) {
        origin = refs[row - 1]?.[col]
      }

      refs[row][col] = origin ?? { row, col }
    }
  }

  return refs
}

function groupPositions(refs: Array<Array<Origin | undefined>>, origin: Origin) {
  const positions: Array<[number, number]> = []
  refs.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      if (value === origin) positions.push([rowIndex, colIndex])
    })
  })
  return positions
}

export function mergeRectangle(rows: string[][], rectangle: Rectangle) {
  assertRectangle(rows, rectangle)
  const refs = buildOrigins(rows)

  for (let row = rectangle.minRow; row <= rectangle.maxRow; row++) {
    for (let col = rectangle.minCol; col <= rectangle.maxCol; col++) {
      const origin = refs[row][col]!
      if (groupPositions(refs, origin).length > 1 || parseMarker(rows[row][col])) {
        throw new Error('所选区域包含已有合并，请先取消该区域的合并。')
      }
    }
  }

  for (let row = rectangle.minRow; row <= rectangle.maxRow; row++) {
    for (let col = rectangle.minCol; col <= rectangle.maxCol; col++) {
      if (row === rectangle.minRow && col === rectangle.minCol) continue
      const direction = row === rectangle.minRow ? MERGE_LEFT : MERGE_UP
      rows[row][col] = makeMarker(direction, rows[row][col])
    }
  }

  return rows
}

export function unmergeRectangle(rows: string[][], rectangle: Rectangle) {
  assertRectangle(rows, rectangle)
  const refs = buildOrigins(rows)
  const origins = new Set<Origin>()

  for (let row = rectangle.minRow; row <= rectangle.maxRow; row++) {
    for (let col = rectangle.minCol; col <= rectangle.maxCol; col++) {
      origins.add(refs[row][col]!)
    }
  }

  let changed = false
  for (const origin of origins) {
    const positions = groupPositions(refs, origin)
    if (positions.length <= 1) continue

    positions.forEach(([row, col]) => {
      if (row === origin.row && col === origin.col) return
      const marker = parseMarker(rows[row][col])
      if (marker) {
        rows[row][col] = marker.original
        changed = true
      }
    })
  }

  if (!changed) throw new Error('所选区域内没有可取消的合并单元格。')
  return rows
}

export function mergeRectangleInMarkdown(
  markdown: string,
  tableIndex: number,
  rectangle: Rectangle,
) {
  return rewriteTable(markdown, tableIndex, rows => mergeRectangle(rows, rectangle))
}

export function unmergeRectangleInMarkdown(
  markdown: string,
  tableIndex: number,
  rectangle: Rectangle,
) {
  return rewriteTable(markdown, tableIndex, rows => unmergeRectangle(rows, rectangle))
}
