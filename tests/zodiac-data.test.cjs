const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadZodiac() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'data', 'zodiac-data.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.MatrixZodiac;
}

const zodiac = loadZodiac();
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

test('contains 12 complete signs', () => {
  assert.equal(zodiac.signs.length, 12);
  const textFields = ['id', 'name', 'symbol', 'rangeLabel', 'element', 'modality', 'ruler', 'opposite', 'motto', 'essence', 'love', 'career', 'money', 'growth'];
  const listFields = ['keywords', 'character', 'strengths', 'shadow', 'resources'];
  for (const sign of zodiac.signs) {
    for (const field of textFields) assert.ok(String(sign[field] || '').trim(), `${sign.id}.${field}`);
    for (const field of listFields) assert.ok(Array.isArray(sign[field]) && sign[field].length, `${sign.id}.${field}`);
    assert.ok(sign.compatibility && sign.compatibility.harmonious.length && sign.compatibility.growth.length && sign.compatibility.note);
  }
  assert.equal(new Set(zodiac.signs.map((s) => s.id)).size, 12);
});

test('every calendar day maps to exactly one sign', () => {
  const counts = new Map();
  for (let month = 1; month <= 12; month++) {
    for (let day = 1; day <= DAYS_IN_MONTH[month - 1]; day++) {
      const sign = zodiac.getSign(day, month);
      assert.ok(sign, `${day}.${month}`);
      counts.set(sign.id, (counts.get(sign.id) || 0) + 1);
    }
  }
  assert.equal(counts.size, 12);
});

test('boundary dates and cusps are correct', () => {
  const cases = [
    [20, 3, 'Рыбы'], [21, 3, 'Овен'],
    [22, 12, 'Козерог'], [31, 12, 'Козерог'], [1, 1, 'Козерог'],
    [1, 11, 'Скорпион'], [23, 8, 'Дева'], [22, 8, 'Лев']
  ];
  for (const [day, month, name] of cases) assert.equal(zodiac.getSign(day, month).name, name, `${day}.${month}`);
  assert.equal(zodiac.isCusp(21, 3), true);
  assert.equal(zodiac.isCusp(10, 7), false);
  assert.equal(zodiac.getSign(0, 1), null);
  assert.equal(zodiac.getSign(32, 1), null);
});

test('texts stay symbolic without promises', () => {
  const all = JSON.stringify(zodiac.signs).toLowerCase();
  assert.ok(!all.includes('гарантир'));
});
