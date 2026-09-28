const clean=v=>String(v||"").trim().replace(/^@+/,"").toLowerCase();
const API_VERSION=process.env.INSTAGRAM_API_VERSION||"v26.0";
const GRAPH_HOST="https://graph.facebook.com";

export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({error:"Method not allowed"});
  const username=clean(req.query?.username);
  if(!/^[a-z0-9._]{1,30}$/.test(username)) return res.status(400).json({error:"Usuário do Instagram inválido"});
  const token=process.env.INSTAGRAM_ACCESS_TOKEN;
  const igUserId=process.env.INSTAGRAM_USER_ID;
  if(!token||!igUserId) return res.status(503).json({error:"Instagram API não configurada. Defina INSTAGRAM_ACCESS_TOKEN e INSTAGRAM_USER_ID na Vercel."});
  try{
    const fields=[
      "username","name","biography","profile_picture_url","followers_count","follows_count","media_count",
      "business_discovery.username("+username+"){username,name,biography,profile_picture_url,followers_count,follows_count,media_count}"
    ].join(",");
    const url=new URL(GRAPH_HOST+"/"+API_VERSION+"/"+encodeURIComponent(igUserId));
    url.searchParams.set("fields",fields);
    url.searchParams.set("access_token",token);
    const r=await fetch(url,{headers:{"Accept":"application/json"}});
    const data=await r.json().catch(()=>({}));
    if(!r.ok){
      const msg=data?.error?.message||"Falha na API do Instagram";
      return res.status(r.status===400?400:502).json({error:"instagram_api_error",message:msg});
    }
    const p=data?.business_discovery;
    if(!p) return res.status(404).json({error:"Perfil não encontrado ou não é uma conta profissional acessível pela API oficial."});
    return res.status(200).json({profile:{
      username:p.username||username,
      fullName:p.name||p.username||username,
      profilePic:p.profile_picture_url||"",
      followers:Number(p.followers_count||0),
      following:Number(p.follows_count||0),
      posts:Number(p.media_count||0),
      biography:p.biography||"",
      isVerified:false,
      isPrivate:false,
      related:[]
    }});
  }catch(e){
    console.error("instagram_profile_lookup_failed",e);
    return res.status(502).json({error:"instagram_api_unavailable",message:"Não foi possível consultar o Instagram agora."});
  }
}