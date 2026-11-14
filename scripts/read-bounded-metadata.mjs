/** Bounded, read-only snapshot of a local npm metadata file. Never follow a
 * final-component symlink on platforms supporting O_NOFOLLOW. */
import {constants,closeSync,fstatSync,lstatSync,openSync,readSync} from 'node:fs';

export function readBoundedMetadata(path,limit){
  if(!Number.isSafeInteger(limit)||limit<2||limit>16*1024*1024)
    throw new Error('Invalid metadata byte limit');
  const before=lstatSync(path);
  if(!before.isFile()||before.isSymbolicLink()||before.size>=limit)
    throw new Error('Unsafe or oversized npm metadata');
  // O_NONBLOCK prevents a replaced FIFO from hanging on POSIX. O_NOFOLLOW
  // rejects a last-moment symlink replacement where the platform supports it.
  const flags=process.platform==='win32' ? constants.O_RDONLY :
    constants.O_RDONLY | (constants.O_NOFOLLOW??0) | (constants.O_NONBLOCK??0);
  const fd=openSync(path,flags);
  try{
    const opened=fstatSync(fd);
    if(!opened.isFile()||opened.size>=limit||opened.size!==before.size||
      opened.dev!==before.dev||opened.ino!==before.ino)
      throw new Error('Npm metadata changed before read');
    const buffer=Buffer.alloc(opened.size+1);
    let length=0;
    while(length<buffer.length){
      const count=readSync(fd,buffer,length,buffer.length-length,length);
      if(count===0)break;
      length+=count;
    }
    const after=fstatSync(fd);
    if(length!==opened.size||after.size!==opened.size||
      after.mtimeMs!==opened.mtimeMs||after.ctimeMs!==opened.ctimeMs)
      throw new Error('Npm metadata changed during read');
    return buffer.subarray(0,length);
  }finally{closeSync(fd);}
}
