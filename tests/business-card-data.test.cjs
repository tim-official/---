const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const card = require(path.join(__dirname, '..', 'data', 'business-card-data.js'));

const FORBIDDEN = ['Исходный материал', 'исходника', 'Идеи без авторской', 'Основные тезисы', 'В новом тексте', 'Самостоятельная глава'];

test('business card has chapters for arcana 3-21 only', () => {
    const keys = Object.keys(card.chapters).map(Number).sort((a, b) => a - b);
    assert.deepEqual(keys, Array.from({ length: 19 }, (_, i) => i + 3));
    assert.equal(card.get(1), null);
    assert.equal(card.get(22), null);
    assert.equal(card.get('7').name, 'Воин');
});

test('every chapter has energy, intro and titled non-empty sections', () => {
    for (const [key, chapter] of Object.entries(card.chapters)) {
        assert.equal(chapter.arcana, Number(key));
        assert.ok(chapter.name && chapter.energy, `chapter ${key} meta`);
        assert.ok(chapter.intro.length > 0, `chapter ${key} intro`);
        assert.ok(chapter.sections.length >= 3, `chapter ${key} sections`);
        for (const section of chapter.sections) {
            assert.ok(section.title, `chapter ${key} section title`);
            assert.ok(section.blocks.length > 0, `chapter ${key} ${section.title} blocks`);
            for (const block of section.blocks) {
                assert.ok(['p', 'list', 'h'].includes(block.type));
                if (block.type === 'list') assert.ok(block.items.length > 0 && block.items.every(Boolean));
                else assert.ok(block.text);
            }
        }
    }
});

test('author notes from the source document are not published', () => {
    const text = JSON.stringify(card.chapters);
    for (const phrase of FORBIDDEN) assert.equal(text.includes(phrase), false, phrase);
});
