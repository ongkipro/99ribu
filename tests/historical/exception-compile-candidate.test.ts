import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import type {Sql} from 'postgres';
import {connectDatabase} from '../../src/db/client.ts';

// Explicit definition-only candidate. Never add this file to a runtime selector.
// The admission value binds reviewed inputs; it is not independent approval.
// Actual source/executor/command review is required before each changed input.
const inputsDigest='0cd800543585de02edfcc3ae934882587d1897ac4ab518bc075138ec192027d5';
const draftDigest='e323108664060b3dd5b8af36f0ec631a19b0c24c59d0df964aa2d543565888c7';
const prefixDigest='f332edff2698ffe686bce5878616e0093f2e6d7bf1f53cf32e6a0f50073e86fd';
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
type Journal={entries:{idx:number;tag:string}[]};

async function catalog(sql:Sql){
 const tables=await sql`select tablename from pg_tables where schemaname='app' order by tablename`;
 const migrations=await sql`select hash from drizzle.__drizzle_migrations order by id`;
 const functions=await sql`select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' order by signature`;
 const rights=await sql`select grantee,table_name,privilege_type from information_schema.role_table_grants
  where table_schema='app' order by grantee,table_name,privilege_type`;
 return {tables:tables.map(row=>String(row.tablename)),migrations:migrations.map(row=>String(row.hash)),functions:digest(JSON.stringify(functions)),rights:digest(JSON.stringify(rights))};
}
async function installedCatalogs(){
 const results=[];
 for(const target of ['test','local'] as const){
  const {sql}=connectDatabase(target,'owner');
  try{const state=await catalog(sql);assert.equal(state.tables.length,140);assert.equal(state.migrations.length,23);results.push({target,...state});}
  finally{await sql.end();}
 }
 return results;
}

test('S33 definition-only candidate proves STOP then rolls back draft definitions exclusively on a fresh owned cluster',{timeout:180000},async()=>{
 // Fail before any cluster or temporary data is created when selected by accident.
 assert.equal(process.env.N99_S33_DEFINITION_ONLY,inputsDigest,'Explicit reviewed definition-only input digest is required; no executor approval is implied.');
 const source=resolve('.');
 assert.equal(execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim(),source);
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),'8b17eee844ba9715581959fc0821af25ce1b99ef');
 const journal=JSON.parse(readFileSync('migrations/meta/_journal.json','utf8')) as Journal;
 assert.equal(journal.entries.length,24);assert.equal(journal.entries[23].tag,'0023_commerce_exceptions');
 const prefix={...journal,entries:journal.entries.slice(0,23)};
 const prefixText=JSON.stringify(prefix,null,2);assert.equal(digest(prefixText),prefixDigest);
 const applied=prefix.entries.flatMap(entry=>[`migrations/${entry.tag}.sql`,`migrations/meta/${String(entry.idx).padStart(4,'0')}_snapshot.json`]);
 assert.equal(applied.length,46);
 const paths=[...applied,'.env.example','compose.yaml','src/config/local.ts','src/db/client.ts','src/db/bootstrap.sql','scripts/database.ts','scripts/migrate.ts','package.json','package-lock.json','migrations/meta/_journal.json','migrations/0023_commerce_exceptions.sql','migrations/meta/0023_snapshot.json'].sort();
 const fingerprint=()=>digest(paths.map(path=>`${path}:${digest(readFileSync(join(source,path)))}\n`).join(''));
 assert.equal(paths.length,58);assert.equal(fingerprint(),inputsDigest);
 const draft=readFileSync('migrations/0023_commerce_exceptions.sql','utf8');assert.equal(digest(draft),draftDigest);
 const statements=draft.split('--> statement-breakpoint');
 assert.match(statements[0],/RAISE EXCEPTION 'S33_STOP:/);assert.doesNotMatch(statements[0],/CREATE TABLE/);
 const snapshot=JSON.parse(readFileSync('migrations/meta/0023_snapshot.json','utf8')) as {tables:Record<string,{name:string}>};
 const expectedTables=Object.values(snapshot.tables).map(table=>table.name).sort();assert.equal(expectedTables.length,160);
 const expectedFunctions=[...draft.matchAll(/CREATE (?:OR REPLACE )?FUNCTION app\.([a-z_0-9]+)\(/g)].map(match=>match[1]).sort();
 assert.equal(expectedFunctions.length,53);assert.equal(new Set(expectedFunctions).size,53);
 const sharedBefore=await installedCatalogs();
 const root=mkdtempSync(join(tmpdir(),'99ribu-exception-definition-'));
 const project=`99ribu-${digest(root).slice(0,10)}`;
 console.log(JSON.stringify({phase:'owned_cluster_allocated',root,project}));
 assert.notEqual(root,source);
 const execute=(script:string,...args:string[])=>execFileSync(process.execPath,[`--env-file=${join(source,'.env.example')}`,join(source,script),...args],{cwd:root,stdio:'pipe',timeout:75000});
 const rollback=new Error('Expected rollback of owned S33 definition transaction');
 const cleanupErrors:unknown[]=[];
 let started=false,failed=false,stage='owned workspace preparation',owner:ReturnType<typeof connectDatabase>|undefined,failure:unknown;
 try{
 mkdirSync(join(root,'src/db'),{recursive:true});mkdirSync(join(root,'migrations/meta'),{recursive:true});
 for(const path of ['compose.yaml','src/db/bootstrap.sql',...applied])copyFileSync(join(source,path),join(root,path));
 writeFileSync(join(root,'migrations/meta/_journal.json'),prefixText);

  process.chdir(root);assert.equal(resolve('.local/pgsocket'),join(root,'.local/pgsocket'));
  stage='owned cluster start';started=true;execute('scripts/database.ts','up');stage='owned immutable prefix23 installation';execute('scripts/migrate.ts','test');
  owner=connectDatabase('test','owner');
  const [server]=await owner.sql`select current_database() name,current_user role,current_setting('server_version_num')::int version`;
  assert.equal(server.name,'99ribu_test');assert.equal(server.role,'99ribu_test_owner');assert.equal(server.version,180006);
  const [role]=await owner.sql`select rolsuper,rolcreatedb,rolcreaterole from pg_roles where rolname=current_user`;
  assert.deepEqual(role,{rolsuper:false,rolcreatedb:false,rolcreaterole:false});
  const baseline=await catalog(owner.sql);assert.equal(baseline.tables.length,140);
  assert.deepEqual(baseline.migrations,prefix.entries.map(entry=>digest(readFileSync(join(source,`migrations/${entry.tag}.sql`)))));
  stage='intact original STOP proof';
  await assert.rejects(owner.sql.begin(tx=>tx.unsafe(statements[0])),{code:'55000'});
  assert.deepEqual(await catalog(owner.sql),baseline);
  stage='owned rollback-only definitions';
  await assert.rejects(owner.sql.begin(async tx=>{
   await tx`set local check_function_bodies=on`;
   await tx`set local lock_timeout='2s'`;
   assert.equal((await tx`show check_function_bodies`)[0].check_function_bodies,'on');
   // This exact first-statement omission is the separately reviewed exception.
   // The repository draft stays stopped; no draft migration entry is inserted.
   for(const [index,statement] of statements.entries())if(index>0&&statement.trim()){
    stage=`owned draft statement ${index+1}`;await tx.unsafe(statement);
   }
   stage='owned definition catalog assertions';
   const tables=await tx`select tablename from pg_tables where schemaname='app' order by tablename`;
   assert.deepEqual(tables.map(row=>String(row.tablename)),expectedTables);
   const functions=await tx`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname=any(${expectedFunctions}::text[]) order by proname`;
   assert.deepEqual(functions.map(row=>String(row.proname)),expectedFunctions);
   assert.equal((await tx`show check_function_bodies`)[0].check_function_bodies,'on');
   assert.equal((await tx`select count(*)::int n from drizzle.__drizzle_migrations`)[0].n,23);
   await tx`set constraints all immediate`;
   throw rollback;
  }),error=>{
   if(error===rollback)return true;
   const code=error&&typeof error==='object'&&'code' in error?String(error.code):'ASSERTION';
   throw new Error(`S33 definition stage ${stage}; safe code ${code}; ${error instanceof Error?error.message.slice(0,300):'unknown failure'}`);
  });
  stage='owned rollback verification';assert.deepEqual(await catalog(owner.sql),baseline);
 }catch(error){failed=true;failure=error;}
 finally{
  let stopAttempted=false,stopSucceeded=false,cwdRestored=false,sourceVerified=false,sharedVerified=false;
  try{if(owner)await owner.sql.end();}catch(error){cleanupErrors.push(error);}
  try{if(started){stopAttempted=true;execute('scripts/database.ts','stop');stopSucceeded=true;}}catch(error){cleanupErrors.push(error);}
  try{process.chdir(source);assert.equal(process.cwd(),source);cwdRestored=true;}catch(error){cleanupErrors.push(error);}
  if(cwdRestored){
   try{assert.equal(fingerprint(),inputsDigest);sourceVerified=true;}catch(error){cleanupErrors.push(error);}
   try{assert.deepEqual(await installedCatalogs(),sharedBefore);sharedVerified=true;}catch(error){cleanupErrors.push(error);}
  }
  console.log(JSON.stringify({phase:'owned_cluster_finally',root,project,stopAttempted,stopSucceeded,cwdRestored,sourceVerified,sharedVerified,hadFailure:failed,cleanupErrors:cleanupErrors.length,ownedDataRetained:true}));
 }

 if(cleanupErrors.length)throw new AggregateError(failed?[failure,...cleanupErrors]:cleanupErrors,`Owned definition cleanup failed; retained data at ${root}`);
 if(failed)throw failure;
 console.log(JSON.stringify({definitionOnly:true,draft:draftDigest,inputs:inputsDigest,root,stopProven:true,rolledBack:true,definedRelations:160,definedFunctions:53,installedTargetsUnchanged:true,sourceArtifactsUnchanged:true,ownedDataRetained:true,businessRuntimeAccepted:false}));
});
