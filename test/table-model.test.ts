import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearRectangleInMarkdown,
  deleteTableColumnInMarkdown,
  deleteTableRowInMarkdown,
  extractRectangleFromMarkdown,
  insertTableColumnInMarkdown,
  insertTableRowInMarkdown,
  mergeRectangleInMarkdown,
  parseMarkdownTables,
  parseMarker,
  pasteRectangleInMarkdown,
  plainTextToRectangle,
  rectangleToPlainText,
  splitTableRow,
  unmergeRectangleInMarkdown,
} from '../src/table-model.ts'

test('splits escaped pipes and code spans correctly', () => {
  assert.deepEqual(
    splitTableRow('| a\\|b | `c|d` | e |'),
    ['a\\|b', '`c|d`', 'e'],
  )
})

test('finds tables but ignores fenced code blocks', () => {
  const markdown = [
    '```md',
    '| fake | table |',
    '| --- | --- |',
    '```',
    '',
    '| real | table |',
    '| --- | --- |',
    '| a | b |',
  ].join('\n')

  const tables = parseMarkdownTables(markdown)
  assert.equal(tables.length, 1)
  assert.deepEqual(tables[0].rows, [['real', 'table'], ['a', 'b']])
})

test('merges a rectangle and restores all covered content', () => {
  const markdown = [
    '| A | B | C |',
    '| --- | --- | --- |',
    '| 甲 | 乙 | 1 |',
    '| 丙 | 丁 | 2 |',
  ].join('\n')

  const merged = mergeRectangleInMarkdown(markdown, 0, {
    minRow: 1,
    maxRow: 2,
    minCol: 0,
    maxCol: 1,
  })

  const rows = parseMarkdownTables(merged)[0].rows
  assert.equal(rows[1][0], '甲')
  assert.match(rows[1][1], /^::tmc-left:/)
  assert.match(rows[2][0], /^::tmc-up:/)
  assert.equal(parseMarker(rows[1][1])?.original, '乙')
  assert.equal(parseMarker(rows[2][0])?.original, '丙')
  assert.equal(parseMarker(rows[2][1])?.original, '丁')

  const restored = unmergeRectangleInMarkdown(merged, 0, {
    minRow: 1,
    maxRow: 2,
    minCol: 0,
    maxCol: 1,
  })

  assert.deepEqual(parseMarkdownTables(restored)[0].rows, [
    ['A', 'B', 'C'],
    ['甲', '乙', '1'],
    ['丙', '丁', '2'],
  ])
})

test('merges more than two cells horizontally', () => {
  const markdown = [
    '| A | B | C | D |',
    '| --- | --- | --- | --- |',
    '| 1 | 2 | 3 | 4 |',
  ].join('\n')

  const merged = mergeRectangleInMarkdown(markdown, 0, {
    minRow: 1,
    maxRow: 1,
    minCol: 0,
    maxCol: 2,
  })
  const rows = parseMarkdownTables(merged)[0].rows

  assert.equal(rows[1][0], '1')
  assert.equal(parseMarker(rows[1][1])?.direction, '<')
  assert.equal(parseMarker(rows[1][2])?.direction, '<')
  assert.equal(parseMarker(rows[1][2])?.original, '3')
  assert.equal(rows[1][3], '4')
})

test('merges a 3 by 2 rectangle containing six cells', () => {
  const markdown = [
    '| A | B | C |',
    '| --- | --- | --- |',
    '| 1 | 2 | x |',
    '| 3 | 4 | y |',
    '| 5 | 6 | z |',
  ].join('\n')

  const merged = mergeRectangleInMarkdown(markdown, 0, {
    minRow: 1,
    maxRow: 3,
    minCol: 0,
    maxCol: 1,
  })
  const rows = parseMarkdownTables(merged)[0].rows

  assert.equal(rows[1][0], '1')
  assert.equal(parseMarker(rows[1][1])?.direction, '<')
  assert.equal(parseMarker(rows[2][0])?.direction, '^')
  assert.equal(parseMarker(rows[2][1])?.direction, '^')
  assert.equal(parseMarker(rows[3][0])?.direction, '^')
  assert.equal(parseMarker(rows[3][1])?.original, '6')
})

test('still reads the legacy comment marker format', () => {
  assert.deepEqual(parseMarker('^<!--tmc:e4b999-->'), {
    direction: '^',
    original: '乙',
  })
})

test('rejects vertical merges across header and body', () => {
  const markdown = '| A | B |\n| --- | --- |\n| C | D |'
  assert.throws(
    () => mergeRectangleInMarkdown(markdown, 0, {
      minRow: 0,
      maxRow: 1,
      minCol: 0,
      maxCol: 0,
    }),
    /表头和正文/,
  )
})

test('inserting a row inside a merged area expands the merge', () => {
  const markdown = [
    '| A | B |',
    '| --- | --- |',
    '| 甲 | 1 |',
    '| 乙 | 2 |',
  ].join('\n')
  const merged = mergeRectangleInMarkdown(markdown, 0, {
    minRow: 1,
    maxRow: 2,
    minCol: 0,
    maxCol: 0,
  })
  const inserted = insertTableRowInMarkdown(merged, 0, 2)
  const rows = parseMarkdownTables(inserted)[0].rows

  assert.equal(rows.length, 4)
  assert.equal(rows[1][0], '甲')
  assert.equal(parseMarker(rows[2][0])?.original, '')
  assert.equal(parseMarker(rows[3][0])?.original, '乙')
})

test('inserting a row before a merged area shifts it without expanding it', () => {
  const markdown = [
    '| A | B |',
    '| --- | --- |',
    '| 甲 | 1 |',
    '| 乙 | 2 |',
  ].join('\n')
  const merged = mergeRectangleInMarkdown(markdown, 0, {
    minRow: 1,
    maxRow: 2,
    minCol: 0,
    maxCol: 0,
  })
  const inserted = insertTableRowInMarkdown(merged, 0, 1)
  const rows = parseMarkdownTables(inserted)[0].rows

  assert.equal(rows[1][0], '')
  assert.equal(rows[2][0], '甲')
  assert.equal(parseMarker(rows[3][0])?.original, '乙')
})

test('deleting a row through a merged area shrinks the merge', () => {
  const markdown = [
    '| A | B |',
    '| --- | --- |',
    '| 甲 | 1 |',
    '| 乙 | 2 |',
    '| 丙 | 3 |',
  ].join('\n')
  const merged = mergeRectangleInMarkdown(markdown, 0, {
    minRow: 1,
    maxRow: 3,
    minCol: 0,
    maxCol: 0,
  })
  const deleted = deleteTableRowInMarkdown(merged, 0, 2)
  const rows = parseMarkdownTables(deleted)[0].rows

  assert.equal(rows[1][0], '甲')
  assert.equal(parseMarker(rows[2][0])?.original, '丙')
})

test('deleting the origin row promotes the next row into the merge origin', () => {
  const markdown = [
    '| A | B |',
    '| --- | --- |',
    '| 甲 | 1 |',
    '| 乙 | 2 |',
    '| 丙 | 3 |',
  ].join('\n')
  const merged = mergeRectangleInMarkdown(markdown, 0, {
    minRow: 1,
    maxRow: 3,
    minCol: 0,
    maxCol: 0,
  })
  const deleted = deleteTableRowInMarkdown(merged, 0, 1)
  const rows = parseMarkdownTables(deleted)[0].rows

  assert.equal(rows[1][0], '乙')
  assert.equal(parseMarker(rows[2][0])?.original, '丙')
})

test('inserting and deleting a column maintains horizontal merges', () => {
  const markdown = [
    '| A | B | C |',
    '| --- | --- | --- |',
    '| 1 | 2 | 3 |',
  ].join('\n')
  const merged = mergeRectangleInMarkdown(markdown, 0, {
    minRow: 1,
    maxRow: 1,
    minCol: 0,
    maxCol: 1,
  })
  const inserted = insertTableColumnInMarkdown(merged, 0, 1)
  let table = parseMarkdownTables(inserted)[0]
  assert.equal(table.rows[1].length, 4)
  assert.equal(table.delimiter.length, 4)
  assert.equal(parseMarker(table.rows[1][1])?.original, '')
  assert.equal(parseMarker(table.rows[1][2])?.original, '2')

  const deleted = deleteTableColumnInMarkdown(inserted, 0, 1)
  table = parseMarkdownTables(deleted)[0]
  assert.equal(table.rows[1].length, 3)
  assert.equal(parseMarker(table.rows[1][1])?.original, '2')
})

test('deleting the origin column promotes the next column into the merge origin', () => {
  const markdown = [
    '| A | B | C | D |',
    '| --- | --- | --- | --- |',
    '| 1 | 2 | 3 | 4 |',
  ].join('\n')
  const merged = mergeRectangleInMarkdown(markdown, 0, {
    minRow: 1,
    maxRow: 1,
    minCol: 0,
    maxCol: 2,
  })
  const deleted = deleteTableColumnInMarkdown(merged, 0, 0)
  const table = parseMarkdownTables(deleted)[0]

  assert.equal(table.rows[1][0], '2')
  assert.equal(parseMarker(table.rows[1][1])?.original, '3')
  assert.equal(table.delimiter.length, 3)
})

test('copy and paste preserve a complete merged region', () => {
  const markdown = [
    '| A | B | C | D |',
    '| --- | --- | --- | --- |',
    '| 甲 | 乙 | x | y |',
    '| 丙 | 丁 | z | w |',
  ].join('\n')
  const merged = mergeRectangleInMarkdown(markdown, 0, {
    minRow: 1,
    maxRow: 2,
    minCol: 0,
    maxCol: 1,
  })
  const copied = extractRectangleFromMarkdown(merged, 0, {
    minRow: 1,
    maxRow: 2,
    minCol: 0,
    maxCol: 1,
  })
  const pasted = pasteRectangleInMarkdown(merged, 0, 1, 2, copied)
  const rows = parseMarkdownTables(pasted)[0].rows

  assert.equal(rows[1][2], '甲')
  assert.equal(parseMarker(rows[1][3])?.original, '乙')
  assert.equal(parseMarker(rows[2][2])?.original, '丙')
  assert.equal(parseMarker(rows[2][3])?.original, '丁')
})

test('copy rejects a partial merged region', () => {
  const markdown = mergeRectangleInMarkdown(
    '| A | B |\n| --- | --- |\n| 甲 | 乙 |\n| 丙 | 丁 |',
    0,
    { minRow: 1, maxRow: 2, minCol: 0, maxCol: 1 },
  )
  assert.throws(
    () => extractRectangleFromMarkdown(markdown, 0, {
      minRow: 1,
      maxRow: 2,
      minCol: 0,
      maxCol: 0,
    }),
    /完整选择/,
  )
})

test('cut clears the selected merge and leaves other cells intact', () => {
  const markdown = mergeRectangleInMarkdown(
    '| A | B | C |\n| --- | --- | --- |\n| 甲 | 乙 | 1 |\n| 丙 | 丁 | 2 |',
    0,
    { minRow: 1, maxRow: 2, minCol: 0, maxCol: 1 },
  )
  const cleared = clearRectangleInMarkdown(markdown, 0, {
    minRow: 1,
    maxRow: 2,
    minCol: 0,
    maxCol: 1,
  })
  assert.deepEqual(parseMarkdownTables(cleared)[0].rows, [
    ['A', 'B', 'C'],
    ['', '', '1'],
    ['', '', '2'],
  ])
})

test('plain-text clipboard conversion hides merge markers', () => {
  const rows = [
    ['甲', '::tmc-left:e4b999::'],
    ['::tmc-up:e4b899::', '::tmc-up:e4b881::'],
  ]
  const text = rectangleToPlainText(rows)
  assert.equal(text, '甲\t\n\t')
  assert.deepEqual(plainTextToRectangle('1\t2\n3\t4'), [
    ['1', '2'],
    ['3', '4'],
  ])
})
