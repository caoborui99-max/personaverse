import {readFile,writeFile} from 'node:fs/promises';
import {getDatabase,assertDatabaseReady,closeDatabases} from '../server/database.js';
import {planPersonaNames,applyPersonaNames} from '../server/persona-names.js';
try{
 const args=process.argv.slice(2),mode=args[0],file=args[1];
 if(!['--plan','--apply'].includes(mode)||!file||args.slice(2).some(x=>x!=='--confirm-production'))throw Object.assign(Error(),{code:'INVALID_ARGUMENTS'});
 if(mode==='--apply'&&(process.env.NODE_ENV==='production'||process.env.VERCEL)&&!args.includes('--confirm-production'))throw Object.assign(Error(),{code:'PRODUCTION_CONFIRMATION_REQUIRED'});
 const db=await getDatabase(process.env,{mustExist:true});await assertDatabaseReady(db);
 if(mode==='--plan'){
  const plan=await planPersonaNames(db);await writeFile(file,JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});console.log('Name plan created: '+plan.items.length+' eligible, '+plan.skipped.length+' skipped. Review before applying.');
 }else{const result=await applyPersonaNames(db,JSON.parse(await readFile(file,'utf8')));console.log('Name plan applied: '+result.applied.length+' records.');}
}catch(error){
 const safe=['INVALID_ARGUMENTS','PRODUCTION_CONFIRMATION_REQUIRED','INVALID_NAME_PLAN','NAME_PLAN_STALE','MIGRATION_REQUIRED','MIGRATION_MISMATCH','EEXIST'];
 console.error('Name migration stopped: '+(safe.includes(error.code)?error.code:'NAME_MIGRATION_FAILED')+'. No credentials or profile content logged.');process.exitCode=1;
}finally{await closeDatabases();}
