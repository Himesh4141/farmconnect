import type { Product } from '../data/products';
import type { Address } from './orders';
export type FarmerProduct=Omit<Product,'farmName'> & {active:number;revision:number;archived:number;moderationBlocked?:number;moderationReason?:string;publishedOnce:number};
export type FarmerOrder={id:string;address:Address;purchaseKind:string;businessName:string;createdAt:number;status:string;preparationStatus?:string;deliveryMode?:'unconnected'|'demo';orderStatus:string;rejectionReason:string;totalPaise:number;items:{productId:string;name:string;unit:string;quantity:number;saleMode?:string;lineTotalPaise?:number;unitPricePaise:number}[]};
export async function marketplaceRequest<T>(path:string,body?:unknown,method?:'DELETE'):Promise<T>{
 let response;
 try{response=await fetch('/api/farmer'+path,{method:method??(body?'POST':'GET'),credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});}catch{throw new Error('Connection interrupted. Refresh your products or orders to check whether the change was saved before retrying.');}
 let result;try{result=await response.json();}catch{throw new Error('Could not read the server response. Check the backend terminal.');}
 if(!response.ok)throw new Error(result.error?.message??'Request failed.');return result as T;
}
