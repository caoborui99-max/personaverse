import {DatabaseSync,backup} from 'node:sqlite';
import {mkdir,lstat,open,chmod,readFile,copyFile,mkdtemp,rm,stat} from 'node:fs/promises';
import {createReadStream,constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
async function regular(path){const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink())throw new Error('Expected regular file');}
async function digest(path){const hash=createHash('sha256');for await(const block of createReadStream(path))hash.update(block);return hash.digest('hex');}
export async function integrity(path){await regular(path);const db=new DatabaseSync(path,{readOnly:true});try{const rows=db.prepare('PRAGMA integrity_check').all();if(rows.length!==1||Object.values(rows[0])[0]!=='ok')throw new Error('SQLite integrity check failed');}finally{db.close();}}
export async function backupDatabase(source,directory){
 source=resolve(source);directory=resolve(directory);await regular(source);await mkdir(directory,{recursive:true,mode:0o700});
 if((await lstat(directory)).isSymbolicLink())throw new Error('Backup directory cannot be a symlink');
 const target=join(directory,'personaverse-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.sqlite');
 const handle=await open(target,'wx',0o600);await handle.close();const db=new DatabaseSync(source,{readOnly:true});
 try{await backup(db,target);}catch(error){await rm(target,{force:true});throw error;}finally{db.close();}
 await chmod(target,0o600);await integrity(target);
 const manifest={version:1,file:target.split('/').pop(),createdAt:new Date().toISOString(),bytes:(await stat(target)).size,sha256:await digest(target)};
 const out=await open(target+'.json','wx',0o600);try{await out.writeFile(JSON.stringify(manifest,null,2)+'\n');}finally{await out.close();}
 return target;
}
export async function validateBackup(source){await regular(source);await regular(source+'.json');const manifest=JSON.parse(await readFile(source+'.json','utf8'));if(manifest.version!==1||manifest.sha256!==await digest(source)||manifest.bytes!==(await stat(source)).size)throw new Error('Backup checksum/size mismatch');await integrity(source);return manifest;}
export async function restoreNewFile(source,target){
 source=resolve(source);target=resolve(target);await validateBackup(source);
 await mkdir(dirname(target),{recursive:true,mode:0o700});
 // COPYFILE_EXCL refuses an existing database or symlink. Never overwrite live data.
 await copyFile(source,target,constants.COPYFILE_EXCL);await chmod(target,0o600);await integrity(target);return target;
}
export async function verifyRestore(source){
 await validateBackup(source);const temp=await mkdtemp(join(dirname(resolve(source)),'.verify-'));
 try{const restored=await restoreNewFile(source,join(temp,'restored.sqlite'));await integrity(restored);return true;}finally{await rm(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const [command,source,target]=process.argv.slice(2);
 try{
  if(command==='backup'){if(!process.env.SQLITE_PATH||!process.env.BACKUP_DIR)throw new Error('Set SQLITE_PATH and BACKUP_DIR');const file=await backupDatabase(process.env.SQLITE_PATH,process.env.BACKUP_DIR);await verifyRestore(file);console.log('Backup and restore verification passed:',file);}
  else if(command==='verify'&&source){await verifyRestore(source);console.log('Checksum, integrity and isolated restore passed');}
  else if(command==='restore'&&source&&target){await restoreNewFile(source,target);console.log('Restored to a new file:',target);}
  else throw new Error('Usage: backup | verify BACKUP | restore BACKUP NEW_TARGET');
 }catch{console.error('SQLite maintenance failed. Check permissions, paths, checksum and free disk. Existing data was not overwritten.');process.exitCode=1;}
}
