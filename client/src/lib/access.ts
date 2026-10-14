export async function accessRequest<T>(path:string,body?:unknown):Promise<T>{
 let response;try{response=await fetch('/api'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});}catch{throw new Error('Connection interrupted. Refresh to check the result before retrying.');}
 let data;try{data=await response.json();}catch{throw new Error('Could not read the response. Check the backend terminal.');}
 if(!response.ok)throw new Error(data.error?.message??'Request failed.');return data as T;
}
export type Application={id:string;account_type:string;business_name:string;phone:string;location:string;evidence:string;status:string;review_note:string;revision:number;email?:string;name?:string};
