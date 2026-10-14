import type { CartItem } from './api';
export type Address = {name:string;phone:string;line:string;city:string;pincode:string};
export type Order = {id:string;farmerManaged:boolean;purchaseKind:string;businessName:string;fulfillments:{farmId:string;farmName:string;status:string;rejectionReason:string}[]; address:Address; subtotalPaise:number;deliveryFeePaise:number;totalPaise:number;originalTotalPaise:number;cancelledPaise:number;deliveryMode:'unconnected'|'demo';status:'in_transit'|'partially_delivered'|'placed'|'confirmed'|'packed'|'out_for_delivery'|'delivered'|'cancelled';payment?:{state:string;isTest:boolean;expiresAt:number;refundPaise:number;refundedPaise:number;refunds:{amountPaise:number;state:string}[]}|null;paymentMethod:'cod'|'razorpay';paymentStatus:'pending'|'paid'|'cancelled';createdAt:number;items:{productId:string;farmId:string;farmName:string;name:string;unit:string;quantity:number;saleMode?:string;lineTotalPaise?:number;unitPricePaise:number}[]};
export type CheckoutRequest = {paymentMethod?:'cod'|'razorpay';requestKey:string;address:Address;items:CartItem[];expectedSubtotalPaise:number};
export class OrderError extends Error {status:number;constructor(message:string,status:number){super(message);this.status=status;}}
export async function orderRequest<T>(path:string,body?:CheckoutRequest | {expectedStatus:string}):Promise<T>{
 let response:Response;
 try {response=await fetch('/api/orders'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});}
 catch {throw new OrderError(path ? 'Connection interrupted. Refresh order history to check the latest status.' : 'Connection interrupted. Your order may have been saved. Retry this same checkout to check safely.',0);}
 let result;
 try {result=await response.json();} catch {throw new OrderError('The server returned an unreadable response. Retry this same checkout safely.',0);}
 if(!response.ok)throw new OrderError(result.error?.message??'Unable to load orders.',response.status);
 return result as T;
}


