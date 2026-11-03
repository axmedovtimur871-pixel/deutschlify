// Ishga tushirish: node tests/content.test.js
const fs=require('fs'),assert=require('assert');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const code=html.split('/*ADMIN_START*/')[1].split('/*ADMIN_END*/')[0];
const {ytId,validContent}=new Function(code+';return {ytId,validContent}')();
const ok={A1:{name:'x',desc:'y',lessons:[{t:'a',v:'',q:[{q:'?',o:['1','2'],a:1}]}]}};
let n=0;const t=(m,f)=>{f();n++;console.log('ok -',m)};
t('YouTube ID',()=>assert.strictEqual(ytId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),'dQw4w9WgXcQ'));
t('youtu.be',()=>assert.strictEqual(ytId('https://youtu.be/dQw4w9WgXcQ'),'dQw4w9WgXcQ'));
t('bo‘sh video',()=>assert.strictEqual(ytId(''),''));
t('mp4',()=>assert.strictEqual(ytId('videos/dars1.mp4'),'videos/dars1.mp4'));
t('noto‘g‘ri video',()=>assert.strictEqual(ytId('salom dunyo'),null));
t('yaroqli kontent',()=>assert.ok(validContent(ok)));
t('bo‘sh kontent rad',()=>assert.ok(!validContent({})));
t('javob indeksi chegarasi',()=>assert.ok(!validContent({A1:{name:'x',desc:'y',lessons:[{t:'a',v:'',q:[{q:'?',o:['1','2'],a:5}]}]}})));
t('dars nomisiz rad',()=>assert.ok(!validContent({A1:{name:'x',desc:'y',lessons:[{t:'',v:'',q:[]}]}})));
console.log(n+' ta test o‘tdi');
