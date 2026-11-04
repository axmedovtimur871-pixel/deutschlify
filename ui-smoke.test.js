// DOM stub bilan interfeys oqimlarini tekshiradi (haqiqiy brauzer emas). Ishga tushirish: node tests/ui-smoke.test.js
const fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const code=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
class El{constructor(t){this.tag=t;this.nodeType=1;this.children=[];this.style={};this.attrs={};this.className='';this.value='';this.textContent='';this.hidden=false;this.classList={add(){},remove(){},toggle(){},contains(){return false}};this.dataset={}}
 append(...k){k.forEach(c=>this.children.push(c))} appendChild(c){this.children.push(c);return c} setAttribute(k,v){this.attrs[k]=v} addEventListener(){} remove(){} focus(){} click(){} querySelectorAll(){return[]} querySelector(){return new El('x')}
 set innerHTML(v){this.children=[]} get innerHTML(){return''}}
const byId={};
const document={createElement:t=>new El(t),createTextNode:t=>({nodeType:3,text:t}),getElementById:id=>byId[id]||(byId[id]=new El('div')),querySelectorAll:()=>[],addEventListener(){},head:new El('head'),body:new El('body')};
const mem={};const localStorage={getItem:k=>k in mem?mem[k]:null,setItem:(k,v)=>{mem[k]=String(v)},removeItem:k=>{delete mem[k]}};
const errors=[];
const sandbox={console,window:{},localStorage,document,location:{hash:''},scrollTo(){},addEventListener(){},alert(){},confirm:()=>true,prompt:()=>'',fetch:()=>Promise.reject(new Error('net')),navigator:{},setTimeout:()=>0,URL:{createObjectURL:()=>''},Blob:class{},Date,Math,JSON,Array,Object,Set,Map,RegExp,String,Number,Promise,Error,Boolean,parseInt,isNaN,Infinity};
const walk=(n,f)=>{if(!n||n.nodeType!==1)return;f(n);n.children.forEach(c=>walk(c,f))};
const test=`
const root=()=>$('fc');
const find=(pred)=>{let r=[];walk(root(),n=>{if(pred(n))r.push(n)});return r};
const btn=t=>find(n=>n.tag==='button'&&n.textContent===t)[0];
const cls=c=>find(n=>(n.attrs.class||'').split(' ').includes(c));
const step=(name,fn)=>{try{fn();console.log('ok -',name)}catch(e){console.log('FAIL -',name,e.message);process.exitCode=1}};
const mkc=(de,uz,o)=>Object.assign(mk(de,uz),o||{});
fd.cols=[{id:'c1',name:'Test to‘plam',desc:'',owner:'local',created:now(),updated:now(),cards:[
 mkc('Tisch','stol',{type:'Nomen',article:'der',plural:'Tische',ex:'Der Tisch ist groß.',exUz:'Stol katta.'}),
 mkc('Lampe','chiroq',{type:'Nomen',article:'die',plural:'Lampen',ex:'Die Lampe ist neu.'}),
 mkc('Buch','kitob',{type:'Nomen',article:'das',plural:'Bücher',ex:'Ich lese ein Buch.'}),
 mkc('Haus','uy',{type:'Nomen',article:'das',plural:'Häuser',ex:'Das Haus ist alt.'}),
 mkc('machen','qilmoq',{type:'Verb',part2:'gemacht',praet:'machte',aux:'haben',ex:'Ich mache Hausaufgaben.'}),
 mkc('gehen','bormoq',{type:'Verb',part2:'gegangen',praet:'ging',aux:'sein'})]}];
fsave();
step('vList',()=>vList());step('vCol',()=>vCol('c1'));step('vSmart',()=>vSmart());step('vTestSetup',()=>vTestSetup('c1'));
step('vLearn',()=>vLearn(null));step('vStats',()=>vStats(null));
step('vStudy',()=>vStudy('c1'));step('vEdit',()=>vEdit('c1',fd.cols[0].cards[0].id));step('vImport',()=>vImport());
let started='';
step('startTest',()=>{started=startTest('all',12,'medium',QT);if(started)throw new Error(started)});
step('runTest: barcha savollarga javob berish',()=>{
  const t=JSON.parse(localStorage.getItem('dl_tcur'));if(!t)throw new Error('tcur yo‘q');
  for(let i=0;i<t.qs.length;i++){
    const cur=JSON.parse(localStorage.getItem('dl_tcur')),q=cur.qs[cur.pos];
    const opts=cls('opt');
    if(opts.length){const b=opts.find(o=>o.textContent===q.answer)||opts[0];b.onclick()}
    else{const inp=find(n=>n.tag==='input'&&n.attrs.type==='text')[0];inp.value=i%2?q.answer:'xxx';btn('Tekshirish').onclick()}
    const nx=btn('Keyingi →');if(nx)nx.onclick();
  }
  btn('Yakunlash').onclick();
  const tests=JSON.parse(localStorage.getItem('dl_tests'));if(tests.length!==1)throw new Error('test saqlanmadi');
  if(!tests[0].qs.every(q=>q.ok===true||q.ok===false))throw new Error('ok qiymati yo‘q');
  console.log('   natija',tests[0].score+'/'+tests[0].n);
});
step('xatolarni qayta urinish',()=>{const b=find(n=>n.tag==='button'&&n.textContent.startsWith('Xatolarni qayta'))[0];if(!b)throw new Error('tugma yo‘q');b.onclick();
  const cur=JSON.parse(localStorage.getItem('dl_tcur'));if(!cur||!cur.retryOf)throw new Error('retry test yo‘q');
  if(cur.qs.some(q=>q.kind==='choice'&&!(q.options&&q.options.length)))throw new Error('retry: options yo‘q');
  cur.qs.forEach(q=>{if(q.user!==undefined)throw new Error('retry: eski javob qolgan')})});
const tests=JSON.parse(localStorage.getItem('dl_tests'));
step('vResult',()=>vResult(tests[0]));step('vTestDetail',()=>vTestDetail(tests[0].id));
step('vDash',()=>vDash());step('vPlan',()=>vPlan());step('vAch',()=>vAch());
step('vTutor',()=>vTutor());step('vTutor(focus)',()=>vTutor({k:fd.cols[0].cards[0],prompt:'Artikl?',user:'die',answer:'der'}));
step('vBuilderHub',()=>vBuilderHub());
step('vBuilder(1) to‘liq',()=>{vBuilder(1);for(let i=0;i<8;i++){
  const bank=cls('chip2').filter(n=>!(n.attrs.class||'').includes('on'));
  while(find(n=>n.tag==='button'&&(n.attrs.class||'')==='chip2').length){find(n=>n.tag==='button'&&(n.attrs.class||'')==='chip2')[0].onclick()}
  btn('Tekshirish').onclick();
  const nx=btn('Keyingi')||btn('Yakunlash');nx.onclick();}
  const t=JSON.parse(localStorage.getItem('dl_tests'));if(t.length<2||t[t.length-1].kind!=='builder')throw new Error('builder saqlanmadi')});
step('vBuilder(3)',()=>vBuilder(3));
['srs','write','article','listen'].forEach(m=>step('session '+m,()=>{const p=poolFor(m,allCards(null),dstr());if(!p.length)throw new Error('pool bo‘sh');session(p,m,()=>{})}));
step('vDash (testlardan keyin)',()=>vDash());
`;
try{vm.runInNewContext('const walk='+walk.toString()+';\n'+code+'\n'+test,sandbox)}catch(e){console.log('XATO',e.stack.split('\n').slice(0,4).join('\n'));process.exitCode=1}
