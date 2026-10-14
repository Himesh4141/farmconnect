export type AdminProduct={saleMode?:string;id:string;name:string;unit:string;pricePaise:number;bulkPricePaise:number;bulkMin:number;stock:number;active:number;revision:number};
export async function adminRequest<T>(path:string,body?:unknown):Promise<T>{
 let response:Response;
 try{response=await fetch('/api/admin'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});}catch{throw new Error('Connection interrupted. Refresh to check whether your change was saved before trying again.');}
 let result;
 try{result=await response.json();}catch{throw new Error('Unable to read the response. Check that the backend is running.');}
 if(!response.ok)throw new Error(result.error?.message??'The request failed.');
 return result as T;
}
