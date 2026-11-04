// Ishga tushirish: node tests/phase4.test.js
const fs=require('fs'),assert=require('assert');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const seg=(a,b)=>html.split(a)[1].split(b)[0];
const code=seg('/*PARSER_START*/','/*PARSER_END*/')+seg('/*LEARN_START*/','/*LEARN_END*/')+seg('/*P4_START*/','/*P4_END*/');
const X=new Function(code+';return {buildTest,validQ,typedOk,analytics,makePlan,achievements,sbCheck,tutorLocal,qFor,dstr,addDays,cardFacts}')();
const {buildTest,validQ,typedOk,analytics,makePlan,achievements,sbCheck,tutorLocal}=X;
let n=0;const t=(m,f)=>{f();n++;console.log('ok -',m)};
let seed=7;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647};
const mk=(id,o)=>({id,de:'',uz:'',type:'',article:'',plural:'',ex:'',exUz:'',praet:'',part2:'',hist:[],art:{n:0,wrong:0},...o});
const col={id:'c1'};
const K=[mk('1',{de:'Tisch',uz:'stol',type:'Nomen',article:'der',plural:'Tische',ex:'Der Tisch ist groß.',exUz:'Stol katta.'}),
 mk('2',{de:'Lampe',uz:'chiroq',type:'Nomen',article:'die',plural:'Lampen',ex:'Die Lampe ist neu.'}),
 mk('3',{de:'Buch',uz:'kitob',type:'Nomen',article:'das',plural:'Bücher',ex:'Ich lese ein Buch.'}),
 mk('4',{de:'Haus',uz:'uy',type:'Nomen',article:'das',plural:'Häuser',ex:'Das Haus ist alt.'}),
 mk('5',{de:'machen',uz:'qilmoq',type:'Verb',part2:'gemacht',praet:'machte',ex:'Ich mache Hausaufgaben.'}),
 mk('6',{de:'gehen',uz:'bormoq',type:'Verb',part2:'gegangen',praet:'ging'})];
const cards=K.map(k=>({c:col,k}));
const all=buildTest(cards,{n:40,diff:'medium',types:['mcq','de-uz','uz-de','article','plural','verb','fill','complete','recog']},rnd);
t('test real so‘zlardan tuziladi va hamma savol yaroqli',()=>{assert.ok(all.length>=15);assert.ok(all.every(validQ));assert.ok(all.every(q=>K.some(k=>k.id===q.card)))});
t('bir xil savol takrorlanmaydi',()=>{const s=new Set(all.map(q=>q.type+'|'+q.card));assert.strictEqual(s.size,all.length)});
t('har bir turdan savol bor',()=>{['mcq','de-uz','uz-de','article','plural','verb','fill','complete','recog'].forEach(ty=>assert.ok(all.some(q=>q.type===ty),ty))});
t('artikl savoli faqat artiklli otlardan',()=>all.filter(q=>q.type==='article').forEach(q=>{const k=K.find(x=>x.id===q.card);assert.strictEqual(q.answer,k.article);assert.strictEqual(k.type,'Nomen')}));
t('fe’l savoli faqat fe’llardan',()=>all.filter(q=>q.type==='verb').forEach(q=>assert.strictEqual(K.find(x=>x.id===q.card).type,'Verb')));
t('tanlov javoblarida to‘g‘ri javob bor, takror yo‘q',()=>all.filter(q=>q.kind==='choice').forEach(q=>{assert.ok(q.options.includes(q.answer));assert.strictEqual(new Set(q.options.map(o=>o.toLowerCase())).size,q.options.length)}));
t('bo‘sh joy savolida javob gapdan olinadi',()=>all.filter(q=>q.type==='fill').forEach(q=>{const k=K.find(x=>x.id===q.card);assert.ok(q.prompt.includes('____'));assert.ok(k.ex.toLowerCase().includes(q.answer.toLowerCase()))}));
t('tarjimasiz so‘zdan tarjima savoli chiqmaydi',()=>{const r=buildTest([{c:col,k:mk('9',{de:'Ding'})}],{n:5,diff:'easy',types:['mcq','de-uz','uz-de']},rnd);assert.strictEqual(r.length,0)});
t('yetarli distraktor bo‘lmasa MCQ chiqmaydi',()=>{const r=buildTest(cards.slice(0,2),{n:5,diff:'easy',types:['mcq']},rnd);assert.strictEqual(r.length,0)});
t('yozma javob: tarjima muqobillari',()=>{const q={kind:'type',alts:['bormoq','ketmoq'],answer:'bormoq, ketmoq'};assert.ok(typedOk(q,'Ketmoq').ok);assert.ok(!typedOk(q,'kelmoq').ok)});
t('yozma javob: ko‘plik "die" bilan ham qabul',()=>{const q={kind:'type',answer:'Tische',nt:'Nomen',art:'die'};assert.ok(typedOk(q,'die Tische').ok);assert.ok(typedOk(q,'Tische').ok);assert.ok(!typedOk(q,'der Tische').ok)});
t('gap tuzish: to‘g‘ri va muqobil tartib',()=>{const S={de:'Er trinkt jeden Morgen Kaffee.',alts:['Jeden Morgen trinkt er Kaffee.']};assert.ok(sbCheck('Er trinkt jeden Morgen Kaffee.'.split(' '),S).ok);assert.ok(sbCheck('Jeden Morgen trinkt er Kaffee.'.split(' '),S).ok)});
t('gap tuzish: xato tartib tushuntiriladi',()=>{const r=sbCheck('Ich Deutsch lerne.'.split(' '),{de:'Ich lerne Deutsch.'});assert.ok(!r.ok);assert.ok(r.msg.includes('2-o‘rinda')&&r.msg.includes('lerne'))});
t('gap tuzish: so‘zlar soni mos emas',()=>assert.ok(sbCheck(['Ich','lerne'],{de:'Ich lerne Deutsch.'}).msg.includes('soni')));
const T='2026-11-10';
const tests=[{id:'a',d:addDays(T,-1),kind:'test',n:10,score:4,qs:[{ok:true,kind:'type'},{ok:false,kind:'choice'}]},{id:'b',d:addDays(T,-2),kind:'test',n:10,score:6,qs:[]},{id:'c',d:addDays(T,-3),kind:'test',n:10,score:8,qs:[]},{id:'d',d:T,kind:'test',n:10,score:9,qs:[]},{id:'e',d:T,kind:'builder',n:8,score:5,qs:[]}];
function addDays(s,n){return X.addDays(s,n)}
const cs2=[mk('1',{type:'Nomen',art:{n:10,wrong:4}}),mk('2',{type:'Verb',art:{n:0,wrong:0}})];
const log=[];for(let i=0;i<6;i++)log.push({d:T,k:'1',ok:i<2?1:0,m:'write'});for(let i=0;i<5;i++)log.push({d:T,k:'2',ok:1,m:'srs'});
const A=analytics(tests,log,cs2,T);
t('analitika: testlar soni va o‘rtacha ball haqiqiy',()=>{assert.strictEqual(A.tests,5);assert.strictEqual(A.avg,Math.round((40+60+80+90+63)/5))});
t('analitika: artikl aniqligi kartalardan',()=>assert.strictEqual(A.artAcc,60));
t('analitika: yozish aniqligi (test + write)',()=>{assert.strictEqual(A.writeN,7);assert.strictEqual(A.writeAcc,Math.round((1+2)/7*100))});
t('analitika: eng zaif/kuchli tur va ko‘p xato so‘z',()=>{assert.strictEqual(A.strong[0].name,'Verb');assert.strictEqual(A.weak[0].name,'Nomen');assert.deepStrictEqual(A.wrong.map(w=>w.n),[4])});
t('analitika: rivojlanish (yaxshilanish)',()=>assert.ok(A.delta>0));
t('analitika: ma’lumot bo‘lmasa null',()=>{const E=analytics([],[],[],T);assert.strictEqual(E.avg,null);assert.strictEqual(E.artAcc,null);assert.strictEqual(E.delta,null)});
t('reja: aniq zaifliklardan tuziladi',()=>{const p=makePlan({cards:20,due:5,fresh:0,weak:3,artN:20,artAcc:50,writeN:10,writeAcc:40,builderN:1,testsWeek:2});assert.deepStrictEqual(p.map(x=>x.id),['srs','weak','article','write'])});
t('reja: ma’lumot bo‘lmasa bo‘sh',()=>assert.deepStrictEqual(makePlan({cards:0}),[]));
t('reja: yaxshi natijada artikl mashqi tavsiya qilinmaydi',()=>assert.ok(!makePlan({cards:10,due:0,fresh:0,weak:0,artN:30,artAcc:95,writeN:0,builderN:1,testsWeek:1}).some(x=>x.id==='article')));
t('yutuqlar: faqat haqiqiy faoliyatdan ochiladi',()=>{
  const z=achievements({tests:0,reviewed:0,learned:0,artN:0,artAcc:null,best:0,masterCols:0,active7:0});assert.ok(z.every(a=>!a.done));
  const o=achievements({tests:5,reviewed:20,learned:3,artN:25,artAcc:85,best:3,masterCols:0,active7:5}).filter(a=>a.done).map(a=>a.id);
  assert.deepStrictEqual(o,['first','five','words20','art','streak3','week']);
});
const ctx={level:'A1',cards:K,weak:[mk('x',{de:'schwierig',uz:'qiyin',hist:[0,0,0,1]})],errors:[],plan:[],artWrong:[]};
t('tutor: foydalanuvchi so‘zini tushuntiradi',()=>{const r=tutorLocal('Tisch nima?',ctx);assert.ok(r.text.includes('der Tisch')&&r.text.includes('stol')&&r.text.includes('Tische'))});
t('tutor: daraja A1 da fe’l shakllarini ham beradi, ot uchun murakkablarni emas',()=>{const r=tutorLocal('machen',ctx);assert.ok(r.text.includes('gemacht'));assert.ok(!tutorLocal('Tisch',ctx).text.includes('Sinonimlar'))});
t('tutor: o‘zining ma’lumotida bo‘lmagan so‘zni o‘ylab topmaydi',()=>{const r=tutorLocal('Kühlschrank misol',ctx);assert.ok(!r.text.includes('Kühlschrank:')&&r.text.includes('AI tutor ulanmagan'))});
t('tutor: qiyin so‘zlar ro‘yxati',()=>{const r=tutorLocal('qiyin so‘zlarim',ctx);assert.ok(r.text.includes('schwierig')&&r.act==='weak')});
t('tutor: xato tushuntirish kontekstdan',()=>{const r=tutorLocal('x',{...ctx,focus:{k:K[0],prompt:'Artikl?',user:'die',answer:'der'}});assert.ok(r.text.includes('der')&&r.text.includes('die'))});
console.log(n+' ta test o‘tdi');
