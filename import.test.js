// Ishga tushirish: node tests/import.test.js
const fs=require('fs'),assert=require('assert');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const seg=(a,b)=>html.split(a)[1].split(b)[0];
const code=seg('/*PARSER_START*/','/*PARSER_END*/')+seg('/*IMPORT_START*/','/*IMPORT_END*/');
const {extractWords,checkFile}=new Function(code+';return {extractWords,checkFile}')();
let n=0;const t=(m,f)=>{f();n++;console.log('ok -',m)};
const de=(txt)=>extractWords(txt).map(x=>x.de);
t('matndan otlar topiladi',()=>{const d=de('Ich habe einen Termin beim Arzt. Der Arzt hilft mir. Das Wetter ist schön.');['Termin','Arzt','Wetter'].forEach(w=>assert.ok(d.includes(w),w))});
t('stop so‘zlar tanlanmaydi',()=>{const x=extractWords('Ich habe einen Termin beim Arzt.');assert.ok(!x.some(i=>i.sel&&['Ich','habe','einen'].includes(i.de)))});
t('ro‘yxatdagi artikl saqlanadi',()=>{const x=extractWords('der Tisch\ndie Lampe');assert.deepStrictEqual(x.map(i=>i.de),['der Tisch','die Lampe'])});
t('gapdagi artikl o‘ylab topilmaydi',()=>{const x=extractWords('Ich spreche mit der Frau.');const f=x.find(i=>i.de==='Frau');assert.ok(f&&f.kind==='noun')});
t('tarjimali juftlik',()=>{const x=extractWords('gehen - bormoq');assert.strictEqual(x[0].kind,'pair');assert.strictEqual(x[0].uz,'bormoq')});
t('sahifa raqamlari tashlanadi',()=>assert.strictEqual(extractWords('12\nSeite 3\nhttps://example.com').length,0));
t('takrorlar birlashadi',()=>assert.strictEqual(de('Hier steht der Tisch und dort steht ein Tisch.').filter(w=>w==='Tisch').length,1));
t('150 tadan oshmaydi',()=>{const w=Array.from({length:400},(_,i)=>'Wort'+String.fromCharCode(97+i%26)+String.fromCharCode(97+(i/26|0)%26)+'x').join(' ');assert.ok(extractWords('Das ist '+w).length<=150)});
t('fayl turi va hajmi',()=>{
  assert.strictEqual(checkFile({name:'a.jpg',type:'image/jpeg',size:1e6}),'');
  assert.ok(checkFile({name:'a.pdf',type:'application/pdf',size:20e6}));
  assert.ok(checkFile({name:'a.heic',type:'image/heic',size:1e6}));
  assert.ok(checkFile({name:'a.txt',type:'text/plain',size:10}));
});
console.log(n+' ta test o‘tdi');
