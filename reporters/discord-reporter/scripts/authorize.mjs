import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const dir = resolve(process.env.DISCORD_OAUTH_DIR || 'data');
const client = JSON.parse(await readFile(resolve(dir, 'oauth-client.json'), 'utf8'));
const expectedUserId = process.env.DISCORD_USER_ID;
if (!expectedUserId) throw Error('DISCORD_USER_ID is required');
const redirect = 'http://127.0.0.1:3236/callback';
const state = randomBytes(32).toString('hex');
const url = new URL('https://discord.com/oauth2/authorize');
url.search = new URLSearchParams({client_id:client.clientId,redirect_uri:redirect,response_type:'code',scope:'identify connections',state,prompt:'consent'}).toString();
let busy = false;
const server = createServer(async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Referrer-Policy','no-referrer');
  const callback = new URL(req.url,redirect);
  const incoming = Buffer.from(callback.searchParams.get('state') || '');
  if (callback.pathname !== '/callback' || incoming.length !== state.length || !timingSafeEqual(incoming,Buffer.from(state))) {
    res.writeHead(400);res.end('Invalid authorization state.');return;
  }
  if(busy){res.writeHead(409);res.end('Authorization already in progress.');return;}
  const code=callback.searchParams.get('code');
  if(!code){res.writeHead(400);res.end('Authorization was not granted.');return;}
  busy=true;
  try {
    const response=await fetch('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:client.clientId,client_secret:client.clientSecret,grant_type:'authorization_code',code,redirect_uri:redirect}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error(`Token exchange failed (${response.status})`);
    const token=await response.json();
    const userResponse=await fetch('https://discord.com/api/v10/users/@me',{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(15000)});
    if(!userResponse.ok)throw Error(`Identity check failed (${userResponse.status})`);
    const user=await userResponse.json();
    if(user.id!==expectedUserId)throw Error('Authorized account does not match DISCORD_USER_ID');
    if(!token.refresh_token || !token.scope?.split(' ').includes('connections'))throw Error('Missing required authorization');
    await mkdir(dir,{recursive:true,mode:0o700});
    const path=resolve(dir,'oauth-token.json');
    await writeFile(path+'.tmp',JSON.stringify({accessToken:token.access_token,refreshToken:token.refresh_token,expiresAt:Date.now()+token.expires_in*1000,userId:user.id}),{mode:0o600});
    await rename(path+'.tmp',path);
    res.end('Discord authorization complete. You can close this tab.');
    console.log('Authorization saved for configured Discord account.');
    server.close();
  }catch(error){console.error(error.message);res.writeHead(400);res.end('Authorization failed. Check the local terminal.');busy=false;}
});
server.listen(3236,'127.0.0.1',async()=>{await writeFile(resolve(dir,'authorize-url.txt'),url.href,{mode:0o600});console.log('Authorization callback ready on 127.0.0.1:3236');});
setTimeout(()=>server.close(),15*60*1000).unref();
