import fs from "node:fs";
const env=Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const end=new Date();end.setUTCDate(end.getUTCDate()-1);const start=new Date(end);start.setUTCDate(start.getUTCDate()-56);
const ymd=d=>d.toISOString().slice(0,10);
const r=await fetch("https://openapi.naver.com/v1/datalab/search",{method:"POST",headers:{"Content-Type":"application/json","X-Naver-Client-Id":env.NAVER_OPENAPI_CLIENT_ID,"X-Naver-Client-Secret":env.NAVER_OPENAPI_CLIENT_SECRET},body:JSON.stringify({startDate:ymd(start),endDate:ymd(end),timeUnit:"week",keywordGroups:[{groupName:"추석선물세트",keywords:["추석선물세트"]}]})});
console.log("status",r.status);const t=await r.text();console.log(t.slice(0,700));
