export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
 const expected=process.env.GATEWAY_WEBHOOK_TOKEN;
 if(expected){const supplied=req.headers["x-webhook-token"]||req.headers["authorization"];if(!supplied||!String(supplied).includes(expected))return res.status(401).json({error:"Unauthorized"})}
 return res.status(200).json({received:true});
}