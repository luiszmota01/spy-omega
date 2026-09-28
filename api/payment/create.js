export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
 const amount=Number(req.body?.amount??46.74);
 if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:"Valor inválido."});
 if(!process.env.AMPLOPAY_PUBLIC_KEY||!process.env.AMPLOPAY_SECRET_KEY)return res.status(503).json({error:"Pagamento ainda não configurado.",code:"AMPL0PAY_NOT_CONFIGURED"});
 return res.status(501).json({error:"Credenciais encontradas, mas o contrato de criação do Pix da AmploPay ainda precisa ser configurado.",code:"AMPL0PAY_PAYLOAD_PENDING",amount});
}