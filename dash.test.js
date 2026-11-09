// Ishga tushirish: node tests/dash.test.js
const fs=require('fs'),assert=require('assert');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const seg=(a,b)=>html.split(a)[1].split(b)[0];
const code=seg('/*LEARN_START*/','/*LEARN_END*/')+seg('/*DASH_START*/','/*DASH_END*/');
const {wordStatus,validProfile,growthSeries,goalPct,badges,addDays}=new Function(code+';return {wordStatus,validProfile,growthSeries,goalPct,badges,addDays}')();
let n=0;const t=(m,f)=>{f();n++;console.log('ok -',m)};
const T='2026-11-10';
t('so‘z holati: yangi/o‘rganilmoqda/o‘rganilgan/qiyin',()=>{
  assert.strictEqual(wordStatus({}),'new');
  assert.strictEqual(wordStatus({srs:{tries:2,interval:3},hist:[1,1]}),'learning');
  assert.strictEqual(wordStatus({srs:{tries:5,interval:30},hist:[1]}),'learned');
  assert.strictEqual(wordStatus({mk:'learned'}),'learned');
  assert.strictEqual(wordStatus({srs:{tries:6,interval:0,lapses:3},hist:[0,0,0,0]}),'difficult');
});
t('qo‘lda "o‘rganildi" qiyin so‘zdan ustun',()=>assert.strictEqual(wordStatus({mk:'learned',srs:{tries:6,lapses:3},hist:[0,0,0,0]}),'learned'));
const ok={first:'Ali',last:'Vali',username:'ali_v',level:'B1',goal:'B2 ga yetish'};
t('profil: yaroqli',()=>assert.strictEqual(validProfile(ok,[],'x'),''));
t('profil: bo‘sh ism rad',()=>assert.ok(validProfile({...ok,first:''},[],'x')));
t('profil: noto‘g‘ri username rad',()=>{['ab','A!','x'.repeat(21),'a b'].forEach(u=>assert.ok(validProfile({...ok,username:u},[],'x'),u))});
t('profil: username band (o‘zi bundan mustasno)',()=>{const us=[{id:'1',profile:{username:'ali_v'}}];assert.ok(validProfile(ok,us,'2'));assert.strictEqual(validProfile(ok,us,'1'),'')});
t('profil: noto‘g‘ri daraja rad, C2 qabul',()=>{assert.ok(validProfile({...ok,level:'D1'},[],'x'));assert.strictEqual(validProfile({...ok,level:'C2'},[],'x'),'')});
t('profil: uzun maqsad rad',()=>assert.ok(validProfile({...ok,goal:'x'.repeat(121)},[],'x')));
t('lug‘at o‘sishi haqiqiy sanalardan',()=>{
  const cards=[{created:addDays(T,-5)+'T10:00:00Z'},{created:addDays(T,-1)+'T10:00:00Z'},{created:T+'T08:00:00Z'}];
  const g=growthSeries(cards,T,7);assert.strictEqual(g.length,7);
  assert.deepStrictEqual([g[0].n,g[1].n,g[5].n,g[6].n],[0,1,2,3]);
});
t('maqsad foizi: daraja',()=>{assert.strictEqual(goalPct({type:'level',target:'B2'},{level:'B1'}),75);assert.strictEqual(goalPct({type:'level',target:'B2'},{level:'C1'}),100)});
t('maqsad foizi: o‘z maqsadi faqat bugun bajarilsa 100',()=>{assert.strictEqual(goalPct({type:'custom',doneOn:T},{today:T}),100);assert.strictEqual(goalPct({type:'custom',doneOn:addDays(T,-1)},{today:T}),0)});
t('yutuqlar: 0 faoliyatda hech biri ochilmaydi',()=>assert.ok(badges({total:0,best:0,learned:0,tests:0,avg:0}).every(a=>!a.done)));
t('yutuqlar: so‘z soni va seriya bo‘yicha',()=>{const d=badges({total:520,best:7,learned:10,tests:3,avg:90}).filter(a=>a.done).map(a=>a.id);assert.deepStrictEqual(d,['w100','w500','s7'])});
t('Test ustasi: 10 test va 80% dan yuqori ball kerak',()=>{assert.ok(!badges({total:0,best:0,learned:0,tests:10,avg:70}).find(a=>a.id==='tmaster').done);assert.ok(badges({total:0,best:0,learned:0,tests:10,avg:85}).find(a=>a.id==='tmaster').done)});
console.log(n+' ta test o‘tdi');
