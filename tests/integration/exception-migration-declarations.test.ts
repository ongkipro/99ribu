import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

// Source artifact check only. Native syntax, dynamic DDL and all business
// behavior still require their separately reviewed owned-cluster execution.
test('exception draft declares no bare function or trigger already supplied by migration history',()=>{
 const journal=JSON.parse(readFileSync('migrations/meta/_journal.json','utf8')) as {entries:{tag:string}[]};
 assert.ok(journal.entries.some(e=>e.tag==='0023_commerce_exceptions'));
 const functions=new Set<string>(),triggers=new Set<string>(),collisions:string[]=[];
 for(const entry of journal.entries){
  const source=readFileSync(`migrations/${entry.tag}.sql`,'utf8');
  for(const part of source.split(/^--> statement-breakpoint\s*$/m)){
   const statement=part.replace(/^(?:\s*--[^\n]*(?:\n|$))+/,'').trim();
   const fn=/^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(app\.[a-z_][a-z0-9_]*)\s*\(/i.exec(statement);
   if(fn){
    // This repository's native guard functions have distinct names, without
    // overloads. Replacements must say OR REPLACE rather than copying helpers.
    if(entry.tag==='0023_commerce_exceptions'&&!fn[1]&&functions.has(fn[2]))collisions.push(`function ${fn[2]}`);
    functions.add(fn[2]);
   }
   const trigger=/^CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+([a-z_][a-z0-9_]*)\b[\s\S]*?\bON\s+(app\.[a-z_][a-z0-9_]*)\b/i.exec(statement);
   if(trigger){
    const identity=`${trigger[2]}.${trigger[1]}`;
    if(entry.tag==='0023_commerce_exceptions'&&triggers.has(identity))collisions.push(`trigger ${identity}`);
    triggers.add(identity);
   }
  }
 }
 assert.ok(functions.size>100&&triggers.size>100,'Scan the actual migration history, including native guards');
 assert.deepEqual(collisions,[],'New bare DDL must not re-create installed function or trigger identities');
});
