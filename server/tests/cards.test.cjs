const assert = require('node:assert/strict')
const test = require('node:test')

const { loadCards, rollCategory } = require('../dist/server/cards.js')

function def(category, weight) {
  return {
    cardId: category,
    category,
    title: category,
    code: category,
    action: '',
    target: '',
    scope: '',
    picks: 0,
    stage: 'any',
    unique: false,
    note: '',
    probs: Array(7).fill(weight),
  }
}

test('категории карт обходятся в порядке A -> B -> D -> C', () => {
  const defs = [def('C', 1), def('D', 1), def('B', 1), def('A', 1)]
  assert.equal(rollCategory(defs, 0.5, 'balanced', () => 0.00), 'A')
  assert.equal(rollCategory(defs, 0.5, 'balanced', () => 0.26), 'B')
  assert.equal(rollCategory(defs, 0.5, 'balanced', () => 0.51), 'D')
  assert.equal(rollCategory(defs, 0.5, 'balanced', () => 0.76), 'C')
})

test('вероятности категорий в каждой корзине Excel дают 100%', () => {
  const firstByCategory = new Map()
  for (const card of loadCards()) {
    if (!firstByCategory.has(card.category)) firstByCategory.set(card.category, card)
  }

  for (let bucket = 0; bucket < 7; bucket++) {
    const total = [...firstByCategory.values()]
      .reduce((sum, card) => sum + card.probs[bucket], 0)
    assert.ok(Math.abs(total - 1) < 1e-9, `корзина ${bucket}: сумма ${total}`)
  }

  assert.equal(firstByCategory.get('C').probs[6], 0.75)
})
