import {spawn,execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {copyFile,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),homeDir=homedir();
const apk=join(root,'android/app/build/outputs/apk/debug/app-debug.apk');
const env={...process.env};
const sdk=[env.ANDROID_HOME,env.ANDROID_SDK_ROOT,join(root,'../.android-sdk'),join(homeDir,'Library/Android/sdk'),join(homeDir,'Android/Sdk')].find(p=>p&&existsSync(join(p,'platforms')));
const jdk=[env.JAVA_HOME,'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home','/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home','/Applications/Android Studio.app/Contents/jbr/Contents/Home'].find(p=>p&&existsSync(join(p,'bin/java')));
if(sdk)env.ANDROID_HOME=sdk;if(jdk)env.JAVA_HOME=jdk;
function run(command,args,options={}){return new Promise((done,reject)=>{const child=spawn(command,args,{cwd:root,env,stdio:'inherit',...options});child.on('error',reject);child.on('exit',code=>code===0?done():reject(new Error(`${command} exited with ${code}`)));});}
try {
 if(process.argv[2]==='build'){
  if(!sdk)throw new Error('Set ANDROID_HOME to an Android SDK with platform 36 installed.');
  await run(join(root,'android/gradlew'),['assembleDebug'],{cwd:join(root,'android')});
  await mkdir(join(root,'artifacts'),{recursive:true});await copyFile(apk,join(root,'artifacts/Spin-Arena-debug.apk'));
  console.log('Built artifacts/Spin-Arena-debug.apk');
 } else if(process.argv[2]==='install'){
  if(!existsSync(apk))throw new Error('Build the app first with npm run android:build.');
  const adb=sdk&&existsSync(join(sdk,'platform-tools/adb'))?join(sdk,'platform-tools/adb'):'adb';
  const devices=execFileSync(adb,['devices'],{encoding:'utf8'}).split('\n').map(row=>row.trim().split(/\s+/)).filter(row=>row[1]==='device').map(row=>row[0]);
  const serial=process.env.ANDROID_SERIAL??(devices.length===1?devices[0]:undefined);
  if(!serial||!devices.includes(serial))throw new Error('Connect and authorize one Android device, or select it with ANDROID_SERIAL.');
  await run(adb,['-s',serial,'install','-r',apk]);
  await run(adb,['-s',serial,'shell','am','start','-n','com.spencerhenry.spinarena/.MainActivity']);
 } else throw new Error('Use build or install.');
} catch(error){console.error(error.message);process.exitCode=1;}
