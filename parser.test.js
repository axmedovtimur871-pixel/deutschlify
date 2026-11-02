// Ishga tushirish: node tests/parser.test.js
const fs=require('fs'),assert=require('assert');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const code=html.split('/*PARSER_START*/')[1].split('/*PARSER_END*/')[0];
const {parseLine,parseBulk,validateAI,nk}=new Function(code+';return {parseLine,parseBulk,validateAI,nk}')();
let n=0;const t=(name,fn)=>{fn();n++;console.log('ok -',name)};
t('chiziqcha',()=>assert.deepStrictEqual([parseLine('gehen - bormoq').de,parseLine('gehen - bormoq').uz],['gehen','bormoq']));
t('em dash',()=>assert.strictEqual(parseLine('die Entscheidung — qaror').uz,'qaror'));
t('en dash va ibora',()=>{const p=parseLine('auf etwas warten – biror narsani kutmoq');assert.strictEqual(p.de,'auf etwas warten');assert.strictEqual(p.uz,'biror narsani kutmoq')});
t('aralash ajratgichlar',()=>assert.strictEqual(parseBulk('der Tisch = stol\nlernen: o‘rganmoq\n\nhaus; uy').length,3));
t('aniq emas -> asl matn saqlanadi',()=>{const p=parseLine('gehen bormoq');assert.strictEqual(p.ok,false);assert.strictEqual(p.de,'gehen bormoq')});
t('defisli so‘z buzilmaydi',()=>assert.strictEqual(parseLine('E-Mail - elektron pochta').de,'E-Mail'));
t('takror nk',()=>assert.strictEqual(nk('der Tisch'),nk('Tisch')));
t('AI: noun artiklsiz rad etiladi',()=>assert.strictEqual(validateAI({type:'Nomen',uz:'stol'}),null));
t('AI: verbga artikl berilmaydi',()=>{const o=validateAI({type:'Verb',uz:'bormoq',article:'der',aux:'sein'});assert.ok(!('article' in o));assert.strictEqual(o.aux,'sein')});
t('AI: yaroqsiz tur rad etiladi',()=>assert.strictEqual(validateAI({type:'Xyz',uz:'a'}),null));
t('AI: noto‘g‘ri javob',()=>assert.strictEqual(validateAI('matn'),null));
console.log(n+' ta test o‘tdi');
