import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'
import {
  applyMergesToTable,
  restoreMergedTable,
} from '../src/merge-dom.ts'

function makeTable() {
  const window = new Window()
  const document = window.document
  document.body.innerHTML = `
    <table>
      <thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>
      <tbody>
        <tr><td>甲</td><td>::tmc-left:e4b999::</td><td>1</td></tr>
        <tr><td>::tmc-up:e4b899::</td><td>::tmc-up:e4b881::</td><td>2</td></tr>
      </tbody>
    </table>`
  return document.querySelector('table') as unknown as HTMLTableElement
}

test('renders a rectangular merge in the live editor', () => {
  const table = makeTable()
  assert.equal(applyMergesToTable(table, 'live'), 1)

  const bodyRows = table.querySelectorAll<HTMLTableRowElement>('tbody > tr')
  const origin = bodyRows[0].cells[0]
  assert.equal(origin.rowSpan, 2)
  assert.equal(origin.colSpan, 2)
  assert.equal(origin.dataset.tmSize, '2×2')
  assert.match(origin.title, /2×2/)
  assert.doesNotMatch(origin.title, /双击|展开|编辑底层/)
  assert.equal(table.querySelectorAll('.tm-covered-cell').length, 3)

  restoreMergedTable(table)
  assert.equal(origin.getAttribute('rowspan'), null)
  assert.equal(origin.getAttribute('colspan'), null)
  assert.equal(origin.getAttribute('data-tm-size'), null)
  assert.equal(table.querySelectorAll('.tm-covered-cell').length, 0)
})

test('does not touch a normal Typora table without merge markers', () => {
  const window = new Window()
  const document = window.document
  document.body.innerHTML = '<table class="md-table"><tbody><tr><td></td><td>A</td></tr></tbody></table>'
  const table = document.querySelector('table') as unknown as HTMLTableElement
  const before = table.outerHTML

  assert.equal(applyMergesToTable(table, 'live'), 0)
  assert.equal(table.outerHTML, before)
})

test('exports real rowspan/colspan and removes marker cells', () => {
  const table = makeTable()
  assert.equal(applyMergesToTable(table, 'export'), 1)

  const bodyRows = table.querySelectorAll<HTMLTableRowElement>('tbody > tr')
  assert.equal(bodyRows[0].cells.length, 2)
  assert.equal(bodyRows[1].cells.length, 1)
  assert.equal(bodyRows[0].cells[0].getAttribute('rowspan'), '2')
  assert.equal(bodyRows[0].cells[0].getAttribute('colspan'), '2')
  assert.equal(table.textContent?.includes('::tmc-'), false)
})

test('renders a 3 by 2 merge as one cell spanning six cells', () => {
  const window = new Window()
  const document = window.document
  document.body.innerHTML = `
    <table><tbody>
      <tr><td>1</td><td>::tmc-left:32::</td><td>x</td></tr>
      <tr><td>::tmc-up:33::</td><td>::tmc-up:34::</td><td>y</td></tr>
      <tr><td>::tmc-up:35::</td><td>::tmc-up:36::</td><td>z</td></tr>
    </tbody></table>`
  const table = document.querySelector('table') as unknown as HTMLTableElement

  assert.equal(applyMergesToTable(table, 'live'), 1)
  const origin = table.rows[0].cells[0]
  assert.equal(origin.rowSpan, 3)
  assert.equal(origin.colSpan, 2)
  assert.equal(table.querySelectorAll('.tm-covered-cell').length, 5)
})
