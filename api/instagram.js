const USER_AGENT="Mozilla/5.0 (compatible; PublicProfileLookup/1.0)";
const clean=v=>String(v||"").trim().replace(/^@+/,"").toLowerCase();
function num(v){if(!v)return 0;const m=String(v).replace(/,/g,".").match(/([\d.]+)\s*([kKmM])?/);if(!m)return 0;const n=Number(m[1]);return !Number.isFinite(n)?0:m[2]?.toLowerCase()==="k"?Math.round(n*1e3):m[2]?.toLowerCase()==="m"?Math.round(n*1e6):Math.round(n)}
function meta(html,p){const r=new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)["']`,"i");return html.match(r)?.[1]?.replace(/&amp;/g,"&").replace(/&quot;/g,'"')||""}
export default async function handler(req,res){
 if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
 const username=clean(req.query?.username);
 if(!/^[a-z0-9._]{1,30}$/.test(username))return res.status(400).json({error:"Usuário do Instagram inválido"});
 try{
  const r=await fetch(`https://www.instagram.com/${encodeURIComponent(username)}/`,{headers:{"User-Agent":USER_AGENT,"Accept-Language":"pt-BR,pt;q=0.9,en;q=0.8"}});
  if(!r.ok)return res.status(r.status===404?404:502).json({error:"Não foi possível consultar o perfil público agora."});
  const html=await r.text(),title=meta(html,"og:title"),desc=meta(html,"og:description"),image=meta(html,"og:image");
  if(!title&&!desc&&!image)return res.status(502).json({error:"O Instagram não disponibilizou os dados públicos deste perfil neste momento."});
  const followers=desc.match(/([\d.,]+[kKmM]?)\s+Followers/i)?.[1],following=desc.match(/([\d.,]+[kKmM]?)\s+Following/i)?.[1],posts=desc.match(/([\d.,]+[kKmM]?)\s+Posts/i)?.[1];
  const fullName=title.replace(/\s*\(@[^)]+\).*$/i,"").replace(/\s*•\s*Instagram.*$/i,"").trim();
  res.status(200).json({profile:{username,fullName:fullName||username,profilePic:image||"",followers:num(followers),following:num(following),posts:num(posts),isVerified:/verified|verificado/i.test(title+" "+desc),isPrivate:/private|privado/i.test(desc),related:[]}});
 }catch(e){res.status(502).json({error:"Falha ao consultar o perfil público."})}
}