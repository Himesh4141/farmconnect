export const deliverySteps = [
  { status: 'pickup_requested', label: 'Pickup requested' },
  { status: 'picked_up', label: 'Picked up' },
  { status: 'in_transit', label: 'On the way' },
  { status: 'out_for_delivery', label: 'Out for delivery' },
  { status: 'delivered', label: 'Delivered' },
];
export type DemoShipment = {
  id: string; orderId: string; farmId: string; farmName: string;
  trackingNumber: string; status: string; revision: number; isDemo: boolean; provider?:string; providerStatus?:string;
  createdAt: number; updatedAt: number;
  events: { status: string; createdAt: number }[];
  destination?: { city: string; pincode: string };
};
export type TrackingResponse = { demoAvailable: boolean; shipments: DemoShipment[] };
