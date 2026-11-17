const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MatrixNames = require(path.join(__dirname, '..', 'data', 'name-data.js'));

const { names, aliases, numbers, letterValues, normalizeName, findName, getNameNumber, getNameArcana } = MatrixNames;
const entries = Object.values(names);

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

test('модуль экспортирует ожидаемый API', () => {
    assert.equal(typeof names, 'object');
    assert.equal(typeof aliases, 'object');
    assert.equal(typeof numbers, 'object');
    assert.equal(typeof letterValues, 'object');
    for (const fn of [normalizeName, findName, getNameNumber, getNameArcana]) {
        assert.equal(typeof fn, 'function');
    }
    assert.ok(Object.isFrozen(MatrixNames));
    assert.ok(Object.isFrozen(names));
    assert.ok(Object.isFrozen(aliases));
});

test('в справочнике не меньше 240 имён', () => {
    assert.ok(entries.length >= 240, `имён: ${entries.length}`);
});

test('каждая запись имеет корректные поля', () => {
    for (const [key, entry] of Object.entries(names)) {
        assert.equal(entry.key, key);
        assert.equal(normalizeName(entry.name), key, `ключ ${key} не совпадает с именем ${entry.name}`);
        for (const field of ['name', 'origin', 'meaning', 'essence']) {
            assert.ok(isNonEmptyString(entry[field]), `${key}: пустое поле ${field}`);
        }
        assert.ok(['m', 'f', 'u'].includes(entry.gender), `${key}: пол ${entry.gender}`);
        assert.ok(Array.isArray(entry.traits), `${key}: traits не массив`);
        assert.ok(entry.traits.length >= 4 && entry.traits.length <= 6, `${key}: traits ${entry.traits.length}`);
        assert.ok(entry.traits.every(isNonEmptyString), `${key}: пустая черта`);
        assert.ok(Array.isArray(entry.forms), `${key}: forms не массив`);
        assert.ok(entry.forms.every(isNonEmptyString), `${key}: пустая форма`);
        assert.ok(Object.isFrozen(entry), `${key}: запись не заморожена`);
    }
});

test('мужских и женских имён не меньше чем по 100', () => {
    const male = entries.filter((entry) => entry.gender === 'm').length;
    const female = entries.filter((entry) => entry.gender === 'f').length;
    assert.ok(male >= 100, `мужских: ${male}`);
    assert.ok(female >= 100, `женских: ${female}`);
});

test('все псевдонимы ведут на существующие имена и не совпадают с основными ключами', () => {
    const aliasKeys = Object.keys(aliases);
    assert.ok(aliasKeys.length > 0);
    for (const alias of aliasKeys) {
        assert.ok(Object.prototype.hasOwnProperty.call(names, aliases[alias]), `${alias} -> ${aliases[alias]}`);
        assert.ok(!Object.prototype.hasOwnProperty.call(names, alias), `псевдоним совпадает с ключом: ${alias}`);
        assert.equal(normalizeName(alias), alias, `псевдоним не нормализован: ${alias}`);
    }
});

test('описания чисел 1..9 заполнены', () => {
    assert.deepEqual(Object.keys(numbers).sort(), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    for (const [num, item] of Object.entries(numbers)) {
        assert.ok(isNonEmptyString(item.title), `${num}: title`);
        assert.ok(isNonEmptyString(item.desc), `${num}: desc`);
        assert.ok(isNonEmptyString(item.advice), `${num}: advice`);
        assert.ok(Array.isArray(item.keywords) && item.keywords.length >= 3 && item.keywords.length <= 5, `${num}: keywords`);
        assert.ok(Array.isArray(item.strengths) && item.strengths.length >= 3 && item.strengths.length <= 5, `${num}: strengths`);
        assert.ok(Array.isArray(item.shadow) && item.shadow.length >= 3 && item.shadow.length <= 4, `${num}: shadow`);
    }
});

test('таблица букв соответствует пифагорейской системе', () => {
    const rows = ['абвгдеёжз', 'ийклмнопр', 'стуфхцчшщ', 'ъыьэюя'];
    for (const row of rows) {
        [...row].forEach((letter, index) => assert.equal(letterValues[letter], index + 1, letter));
    }
    const kazakh = { 'ә': 1, 'ғ': 4, 'қ': 3, 'ң': 6, 'ө': 7, 'ұ': 3, 'ү': 3, 'һ': 5, 'і': 1 };
    for (const [letter, value] of Object.entries(kazakh)) {
        assert.equal(letterValues[letter], value, letter);
    }
});

test('normalizeName обрабатывает граничные случаи', () => {
    assert.equal(normalizeName(null), '');
    assert.equal(normalizeName(undefined), '');
    assert.equal(normalizeName(''), '');
    assert.equal(normalizeName('   '), '');
    assert.equal(normalizeName(42), '');
    assert.equal(normalizeName({}), '');
    assert.equal(normalizeName('  ТИМУР  '), 'тимур');
    assert.equal(normalizeName('Тимур Абдраманов'), 'тимур');
    assert.equal(normalizeName('Алёна'), 'алена');
    assert.equal(normalizeName('Мөлдір'), 'мөлдір');
    assert.equal(normalizeName('Анна-Мария'), 'анна-мария');
});

test('findName находит имена, псевдонимы и возвращает null для неизвестных', () => {
    const timur = findName('Тимур');
    assert.ok(timur && !Array.isArray(timur));
    assert.equal(timur.name, 'Тимур');
    assert.equal(timur.key, 'тимур');
    assert.equal(findName('  тимур Абдраманов ').name, 'Тимур');

    const sasha = findName('саша');
    assert.ok(sasha);
    assert.ok(Object.prototype.hasOwnProperty.call(names, sasha.key));

    assert.equal(findName('Настя').key, 'анастасия');
    assert.equal(findName('Наталия').key, 'наталья');
    assert.equal(findName('Артём').key, 'артем');
    assert.equal(findName('Мөлдір').key, 'молдир');
    assert.equal(findName('Әсем').key, 'асем');
    assert.equal(findName('Чингиз').key, 'шынгыс');
    assert.equal(findName('Нұрсұлтан').key, 'нурсултан');

    assert.equal(findName('Несуществующее'), null);
    assert.equal(findName(null), null);
    assert.equal(findName(undefined), null);
    assert.equal(findName(''), null);
});

test('число и аркан имени Тимур', () => {
    assert.equal(getNameNumber('Тимур'), 2);
    assert.equal(getNameArcana('Тимур'), 20);
});

test('неизвестные символы не превращают ввод в другое имя', () => {
    for (const raw of ['Timur', 'Timur Иванов', 'Алeна', 'Анна123', 'Тимур💫', '123 Анна']) {
        assert.equal(normalizeName(raw), '', raw);
        assert.equal(findName(raw), null, raw);
        assert.equal(getNameNumber(raw), null, raw);
        assert.equal(getNameArcana(raw), null, raw);
    }
    assert.equal(normalizeName('Аи\u0306герим'), 'айгерим');
    assert.equal(normalizeName('«Анна-Мария» Иванова'), 'анна-мария');
});

test('для пустого ввода число и аркан не вычисляются', () => {
    assert.equal(getNameNumber(''), null);
    assert.equal(getNameNumber(null), null);
    assert.equal(getNameArcana(''), null);
    assert.equal(getNameArcana('123'), null);
});

test('число и аркан всех имён лежат в допустимых диапазонах', () => {
    for (const entry of entries) {
        const number = getNameNumber(entry.name);
        const arcana = getNameArcana(entry.name);
        assert.ok(Number.isInteger(number) && number >= 1 && number <= 9, `${entry.name}: число ${number}`);
        assert.ok(Number.isInteger(arcana) && arcana >= 1 && arcana <= 22, `${entry.name}: аркан ${arcana}`);
    }
});

test('тексты не содержат категоричных обещаний', () => {
    const banned = /гарантир|обязательно/i;
    for (const entry of entries) {
        assert.ok(!banned.test(JSON.stringify(entry)), `${entry.name}: недопустимая формулировка`);
    }
    assert.ok(!banned.test(JSON.stringify(numbers)), 'numbers: недопустимая формулировка');
});
