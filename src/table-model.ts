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

type MergeGroup = Rectangle

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

function rewriteParsedTable(
  markdown: string,
  tableIndex: number,
  transform: (table: ParsedTable) => ParsedTable,
) {
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n'
  const trailingNewline = markdown.endsWith('\n')
  const lines = markdown.split(/\r?\n/)
  if (trailingNewline) lines.pop()

  const tables = parseMarkdownTables(markdown)
  const table = tables[tableIndex]
  if (!table) throw new Error('无法把当前 Typora 表格映射到 Markdown 源码。')

  const editable = {
    ...table,
    rows: table.rows.map(row => [...row]),
    delimiter: [...table.delimiter],
  }
  const nextTable = transform(editable)
  lines.splice(
    table.startLine,
    table.endLine - table.startLine + 1,
    ...serializeTable(nextTable),
  )

  return lines.join(newline) + (trailingNewline ? newline : '')
}

function rewriteTable(
  markdown: string,
  tableIndex: number,
  transform: (rows: string[][]) => string[][],
) {
  return rewriteParsedTable(markdown, tableIndex, table => ({
    ...table,
    rows: transform(table.rows),
  }))
}

function assertBounds(rows: string[][], rectangle: Rectangle) {
  if (
    rectangle.minRow < 0 ||
    rectangle.minCol < 0 ||
    rectangle.maxRow >= rows.length ||
    rectangle.maxCol >= rows[0].length
  ) {
    throw new Error('所选矩形超出表格范围。')
  }
}

function assertRectangle(rows: string[][], rectangle: Rectangle) {
  assertBounds(rows, rectangle)

  if (rectangle.minRow === 0 && rectangle.maxRow > 0) {
    throw new Error('不能跨越表头和正文进行纵向合并。')
  }
}

function buildOrigins(rows: string[][], enforceHeaderBoundary = true) {
  const refs: Array<Array<Origin | undefined>> = rows.map(row => new Array(row.length))

  for (let row = 0; row < rows.length; row++) {
    for (let col = 0; col < rows[row].length; col++) {
      const marker = parseMarker(rows[row][col])
      let origin: Origin | undefined

      if (marker?.direction === MERGE_LEFT && col > 0) {
        origin = refs[row][col - 1]
      } else if (
        marker?.direction === MERGE_UP &&
        row > 0 &&
        (!enforceHeaderBoundary || row !== 1)
      ) {
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

function containsRectangle(outer: Rectangle, inner: Rectangle) {
  return (
    inner.minRow >= outer.minRow &&
    inner.maxRow <= outer.maxRow &&
    inner.minCol >= outer.minCol &&
    inner.maxCol <= outer.maxCol
  )
}

function rectanglesIntersect(a: Rectangle, b: Rectangle) {
  return !(
    a.maxRow < b.minRow ||
    a.minRow > b.maxRow ||
    a.maxCol < b.minCol ||
    a.minCol > b.maxCol
  )
}

function analyzeStructure(rows: string[][], enforceHeaderBoundary = true) {
  if (!rows.length || !rows[0]?.length) throw new Error('表格不能为空。')
  const width = rows[0].length
  if (rows.some(row => row.length !== width)) {
    throw new Error('表格各行的列数不一致。')
  }

  const refs = buildOrigins(rows, enforceHeaderBoundary)
  const origins = new Set<Origin>()
  refs.forEach(row => row.forEach(origin => origin && origins.add(origin)))
  const groups: MergeGroup[] = []

  for (const origin of origins) {
    const positions = groupPositions(refs, origin)
    const originSource = rows[origin.row]?.[origin.col] ?? ''
    if (positions.length === 1) {
      if (parseMarker(originSource)) {
        throw new Error(`发现无法定位来源的合并标记（第 ${origin.row + 1} 行，第 ${origin.col + 1} 列）。`)
      }
      continue
    }

    const rowIndexes = positions.map(([row]) => row)
    const colIndexes = positions.map(([, col]) => col)
    const group: MergeGroup = {
      minRow: Math.min(...rowIndexes),
      maxRow: Math.max(...rowIndexes),
      minCol: Math.min(...colIndexes),
      maxCol: Math.max(...colIndexes),
    }
    const expected = (
      (group.maxRow - group.minRow + 1) *
      (group.maxCol - group.minCol + 1)
    )
    const valid = (
      origin.row === group.minRow &&
      origin.col === group.minCol &&
      positions.length === expected &&
      positions.every(([row, col]) => refs[row]?.[col] === origin)
    )
    if (!valid) throw new Error('发现不完整或相互重叠的合并区域。')
    groups.push(group)
  }

  const values = rows.map(row => row.map(cell => parseMarker(cell)?.original ?? cell))
  return { values, groups }
}

function encodeStructure(values: string[][], groups: MergeGroup[]) {
  const rows = values.map(row => [...row])
  groups.forEach(group => {
    for (let row = group.minRow; row <= group.maxRow; row++) {
      for (let col = group.minCol; col <= group.maxCol; col++) {
        if (row === group.minRow && col === group.minCol) continue
        const direction = row === group.minRow ? MERGE_LEFT : MERGE_UP
        rows[row][col] = makeMarker(direction, values[row][col])
      }
    }
  })
  return rows
}

function assertCompleteMergeCoverage(groups: MergeGroup[], rectangle: Rectangle) {
  groups.forEach(group => {
    if (
      rectanglesIntersect(group, rectangle) &&
      !containsRectangle(rectangle, group)
    ) {
      throw new Error('所选区域只包含了合并单元格的一部分；请完整选择该合并区域。')
    }
  })
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

export function insertTableRowInMarkdown(
  markdown: string,
  tableIndex: number,
  rowIndex: number,
) {
  return rewriteParsedTable(markdown, tableIndex, table => {
    if (rowIndex < 0 || rowIndex > table.rows.length) {
      throw new Error('插入行的位置超出表格范围。')
    }

    const { values, groups } = analyzeStructure(table.rows)
    values.splice(rowIndex, 0, new Array(values[0].length).fill(''))
    const nextGroups = groups.map(group => {
      if (rowIndex <= group.minRow) {
        return {
          ...group,
          minRow: group.minRow + 1,
          maxRow: group.maxRow + 1,
        }
      }
      if (rowIndex <= group.maxRow) {
        return { ...group, maxRow: group.maxRow + 1 }
      }
      return group
    })

    return { ...table, rows: encodeStructure(values, nextGroups) }
  })
}

export function deleteTableRowInMarkdown(
  markdown: string,
  tableIndex: number,
  rowIndex: number,
) {
  return rewriteParsedTable(markdown, tableIndex, table => {
    if (table.rows.length <= 1) throw new Error('表格至少需要保留一行。')
    if (rowIndex < 0 || rowIndex >= table.rows.length) {
      throw new Error('删除行的位置超出表格范围。')
    }

    const { values, groups } = analyzeStructure(table.rows)
    values.splice(rowIndex, 1)
    const nextGroups = groups.flatMap(group => {
      if (rowIndex < group.minRow) {
        return [{
          ...group,
          minRow: group.minRow - 1,
          maxRow: group.maxRow - 1,
        }]
      }
      if (rowIndex > group.maxRow) return [group]
      if (group.minRow === group.maxRow) return []
      return [{ ...group, maxRow: group.maxRow - 1 }]
    })

    return { ...table, rows: encodeStructure(values, nextGroups) }
  })
}

export function insertTableColumnInMarkdown(
  markdown: string,
  tableIndex: number,
  colIndex: number,
) {
  return rewriteParsedTable(markdown, tableIndex, table => {
    const width = table.rows[0].length
    if (colIndex < 0 || colIndex > width) {
      throw new Error('插入列的位置超出表格范围。')
    }

    const { values, groups } = analyzeStructure(table.rows)
    values.forEach(row => row.splice(colIndex, 0, ''))
    table.delimiter.splice(colIndex, 0, '---')
    const nextGroups = groups.map(group => {
      if (colIndex <= group.minCol) {
        return {
          ...group,
          minCol: group.minCol + 1,
          maxCol: group.maxCol + 1,
        }
      }
      if (colIndex <= group.maxCol) {
        return { ...group, maxCol: group.maxCol + 1 }
      }
      return group
    })

    return { ...table, rows: encodeStructure(values, nextGroups) }
  })
}

export function deleteTableColumnInMarkdown(
  markdown: string,
  tableIndex: number,
  colIndex: number,
) {
  return rewriteParsedTable(markdown, tableIndex, table => {
    const width = table.rows[0].length
    if (width <= 1) throw new Error('表格至少需要保留一列。')
    if (colIndex < 0 || colIndex >= width) {
      throw new Error('删除列的位置超出表格范围。')
    }

    const { values, groups } = analyzeStructure(table.rows)
    values.forEach(row => row.splice(colIndex, 1))
    table.delimiter.splice(colIndex, 1)
    const nextGroups = groups.flatMap(group => {
      if (colIndex < group.minCol) {
        return [{
          ...group,
          minCol: group.minCol - 1,
          maxCol: group.maxCol - 1,
        }]
      }
      if (colIndex > group.maxCol) return [group]
      if (group.minCol === group.maxCol) return []
      return [{ ...group, maxCol: group.maxCol - 1 }]
    })

    return { ...table, rows: encodeStructure(values, nextGroups) }
  })
}

export function extractRectangleFromMarkdown(
  markdown: string,
  tableIndex: number,
  rectangle: Rectangle,
) {
  const table = parseMarkdownTables(markdown)[tableIndex]
  if (!table) throw new Error('无法把当前 Typora 表格映射到 Markdown 源码。')
  assertBounds(table.rows, rectangle)
  const { groups } = analyzeStructure(table.rows)
  assertCompleteMergeCoverage(groups, rectangle)
  return table.rows
    .slice(rectangle.minRow, rectangle.maxRow + 1)
    .map(row => row.slice(rectangle.minCol, rectangle.maxCol + 1))
}

export function clearRectangleInMarkdown(
  markdown: string,
  tableIndex: number,
  rectangle: Rectangle,
) {
  return rewriteTable(markdown, tableIndex, rows => {
    assertBounds(rows, rectangle)
    const { groups } = analyzeStructure(rows)
    assertCompleteMergeCoverage(groups, rectangle)
    for (let row = rectangle.minRow; row <= rectangle.maxRow; row++) {
      for (let col = rectangle.minCol; col <= rectangle.maxCol; col++) {
        rows[row][col] = ''
      }
    }
    return rows
  })
}

export function pasteRectangleInMarkdown(
  markdown: string,
  tableIndex: number,
  destinationRow: number,
  destinationCol: number,
  sourceRows: string[][],
) {
  if (!sourceRows.length || !sourceRows[0]?.length) {
    throw new Error('剪贴板中没有可粘贴的表格区域。')
  }
  const sourceWidth = sourceRows[0].length
  if (sourceRows.some(row => row.length !== sourceWidth)) {
    throw new Error('剪贴板中的表格区域不是规则矩形。')
  }
  const source = sourceRows.map(row => [...row])
  const sourceStructure = analyzeStructure(source, false)

  return rewriteTable(markdown, tableIndex, rows => {
    const destination: Rectangle = {
      minRow: destinationRow,
      maxRow: destinationRow + source.length - 1,
      minCol: destinationCol,
      maxCol: destinationCol + sourceWidth - 1,
    }
    assertBounds(rows, destination)

    const destinationStructure = analyzeStructure(rows)
    assertCompleteMergeCoverage(destinationStructure.groups, destination)

    const crossesHeader = sourceStructure.groups.some(group => (
      destinationRow + group.minRow === 0 && group.maxRow > group.minRow
    ))
    if (crossesHeader) throw new Error('不能把纵向合并区域粘贴到跨越表头和正文的位置。')

    source.forEach((row, rowOffset) => {
      row.forEach((cell, colOffset) => {
        rows[destinationRow + rowOffset][destinationCol + colOffset] = cell
      })
    })
    analyzeStructure(rows)
    return rows
  })
}

export function rectangleToPlainText(rows: string[][]) {
  return rows
    .map(row => row.map(cell => parseMarker(cell) ? '' : cell).join('\t'))
    .join('\n')
}

export function plainTextToRectangle(text: string) {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  if (!normalized) return [['']]
  const rows = normalized.split('\n').map(row => row.split('\t'))
  const width = Math.max(...rows.map(row => row.length))
  rows.forEach(row => {
    while (row.length < width) row.push('')
  })
  return rows
}
