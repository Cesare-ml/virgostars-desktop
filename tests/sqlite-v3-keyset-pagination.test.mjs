import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const MAX=9_007_199_254_740_991;
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE local_outbox(sequence INTEGER PRIMARY KEY AUTOINCREMENT,profile_id TEXT NOT NULL,mutation_id TEXT NOT NULL,entity_id TEXT NOT NULL,state TEXT NOT NULL);`);
 const add=(profile,id,entity=id,state='conflict')=>db.prepare('INSERT INTO local_outbox(profile_id,mutation_id,entity_id,state) VALUES (?,?,?,?)').run(profile,id,entity,state);
 return {db,add};
}
function page(db,profile,after=null,limit=2){
 if(!/^synthetic-[A-Za-z0-9_-]+$/.test(profile)||profile.length>128||!Number.isInteger(limit)||limit<1||limit>100||after!==null&&(!Number.isSafeInteger(after)||after<0||after>MAX))throw Error('bad pagination input');
 const cursor=after??0;
 const records=db.prepare("SELECT sequence,mutation_id,entity_id FROM local_outbox WHERE profile_id=? AND state='conflict' AND sequence>? ORDER BY sequence LIMIT ?").all(profile,cursor,limit+1);
 const items=records.slice(0,limit).map(({mutation_id,entity_id})=>({mutation_id,entity_id}));
 return {items,next_after_sequence:records.length>limit?records[limit-1].sequence:null};
}
test('three conflicts paginate 2+1, with non-overlapping FIFO IDs',()=>{const {db,add}=fixture();try{for(let i=1;i<=3;i++)add('synthetic-a',`synthetic-m${i}`);const first=page(db,'synthetic-a',null,2),second=page(db,'synthetic-a',first.next_after_sequence,2);assert.deepEqual(first.items.map(x=>x.mutation_id),['synthetic-m1','synthetic-m2']);assert.equal(first.next_after_sequence,2);assert.deepEqual(second.items.map(x=>x.mutation_id),['synthetic-m3']);assert.equal(second.next_after_sequence,null);}finally{db.close();}});
test('exactly full final page does not invent another page',()=>{const {db,add}=fixture();try{add('synthetic-a','synthetic-m1');add('synthetic-a','synthetic-m2');assert.equal(page(db,'synthetic-a',null,2).next_after_sequence,null);}finally{db.close();}});
test('deleting a previous FIFO row never duplicates following page',()=>{const {db,add}=fixture();try{for(let i=1;i<=4;i++)add('synthetic-a',`synthetic-m${i}`);const first=page(db,'synthetic-a',null,2);db.prepare('DELETE FROM local_outbox WHERE sequence=?').run(1);const second=page(db,'synthetic-a',first.next_after_sequence,2);assert.deepEqual(second.items.map(x=>x.mutation_id),['synthetic-m3','synthetic-m4']);assert.equal(second.next_after_sequence,null);}finally{db.close();}});
test('other profile rows and pending edits cannot contaminate pages',()=>{const {db,add}=fixture();try{add('synthetic-a','synthetic-m1');add('synthetic-b','synthetic-m2');add('synthetic-a','synthetic-pending','synthetic-e3','pending');add('synthetic-a','synthetic-m3');assert.deepEqual(page(db,'synthetic-a').items.map(x=>x.mutation_id),['synthetic-m1','synthetic-m3']);assert.deepEqual(page(db,'synthetic-b').items.map(x=>x.mutation_id),['synthetic-m2']);}finally{db.close();}});
test('invalid profile, unsafe sequence, negative cursor and invalid limits fail',()=>{const {db}=fixture();try{for(const [p,c,l] of [['account',null,1],['synthetic-a',-1,1],['synthetic-a',MAX+1,1],['synthetic-a',1.5,1],['synthetic-a',null,0],['synthetic-a',null,101]])assert.throws(()=>page(db,p,c,l));}finally{db.close();}});
test('after last sequence and empty profile return no rows or next cursor',()=>{const {db,add}=fixture();try{add('synthetic-a','synthetic-m1');assert.deepEqual(page(db,'synthetic-a',MAX,1),{items:[],next_after_sequence:null});assert.deepEqual(page(db,'synthetic-b'),{items:[],next_after_sequence:null});}finally{db.close();}});
