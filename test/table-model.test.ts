import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mergeRectangleInMarkdown,
  parseMarkdownTables,
  parseMarker,
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
