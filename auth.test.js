// Ishga tushirish: node tests/auth.test.js
const fs=require('fs'),assert=require('assert');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const code=html.split('/*AUTH_START*/')[1].split('/*AUTH_END*/')[0];
const {validateReg,hashPw,makeUser,checkLogin,newSalt,emailOk}=new Function('crypto','TextEncoder',code+';return {validateReg,hashPw,makeUser,checkLogin,newSalt,emailOk}')(require('crypto').webcrypto,TextEncoder);
let n=0;const t=async(m,f)=>{await f();n++;console.log('ok -',m)};
(async()=>{
const ok={name:'Ali',email:'Ali@Mail.uz',pass:'secret1',pass2:'secret1'};
await t('email tekshiruvi',()=>{assert.ok(emailOk('a@b.uz'));assert.ok(!emailOk('a@b'));assert.ok(!emailOk('abc'))});
await t('yaroqli forma',()=>assert.strictEqual(validateReg(ok,[]),''));
await t('qisqa ism rad',()=>assert.ok(validateReg({...ok,name:'A'},[])));
await t('noto‘g‘ri email rad',()=>assert.ok(validateReg({...ok,email:'x'},[])));
await t('qisqa parol rad',()=>assert.ok(validateReg({...ok,pass:'123',pass2:'123'},[])));
await t('parollar mos kelmasa rad',()=>assert.ok(validateReg({...ok,pass2:'other12'},[])));
await t('takroriy email rad (katta-kichik harfga bog‘liq emas)',()=>assert.ok(validateReg(ok,[{email:'ali@mail.uz'}])));
await t('xesh: bir xil parol+tuz bir xil, boshqa tuz yoki parol boshqa',async()=>{const s=newSalt(),a=await hashPw('p1',s);assert.strictEqual(a,await hashPw('p1',s));assert.notStrictEqual(a,await hashPw('p2',s));assert.notStrictEqual(a,await hashPw('p1',newSalt()))});
const u1=await makeUser(ok,[]);
await t('birinchi akkaunt admin, keyingisi oddiy',async()=>{assert.strictEqual(u1.role,'admin');assert.strictEqual((await makeUser({...ok,email:'b@b.uz'},[u1])).role,'user')});
await t('parol ochiq saqlanmaydi',()=>{assert.ok(!JSON.stringify(u1).includes('secret1'));assert.strictEqual(u1.hash.length,64)});
await t('kirish: to‘g‘ri parol',async()=>assert.ok(await checkLogin('ALI@mail.uz','secret1',[u1])));
await t('kirish: noto‘g‘ri parol va yo‘q email',async()=>{assert.strictEqual(await checkLogin('ali@mail.uz','xxx',[u1]),null);assert.strictEqual(await checkLogin('no@mail.uz','secret1',[u1]),null)});
console.log(n+' ta test o‘tdi');
})();
