const assert = require('node:assert/strict')
const test = require('node:test')

const { loadCharacteristics } = require('../dist/server/data.js')

test('характеристики не содержат служебные четвёрки', () => {
  const rows = loadCharacteristics()
  assert.equal(rows.some((row) => String(row.Название).trim() === '4'), false)
  assert.equal(rows.some((row) => String(row.Подсказка).trim() === '4'), false)
})
