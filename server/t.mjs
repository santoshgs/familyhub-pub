import { Agent } from 'undici';
let called = 0;
const lookup = (h, o, cb) => { called++; import('node:dns').then(d => d.lookup(h, o, cb)); };
const r = await fetch('https://registry.npmjs.org/undici', { dispatcher: new Agent({ connect: { lookup } }) });
console.log(r.status, called);
