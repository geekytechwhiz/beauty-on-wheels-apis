import { DynamoDBStreamEvent} from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb"; 
import { OrdersService } from "../services/orders.service";

function isCreatedOrgOrderImage(img: Record<string, any>): boolean {
  // Minimal check for an org order in our schema in "created" state
  return (
    typeof img?.pk === "string" &&
    img.pk.includes("#ORDERS") &&
    typeof img?.sk === "string" &&
    img.sk.startsWith("ORDER#") &&
    img.status === "created" &&
    typeof img?.paymentMode === "string"
  );
}

export const process = async (event: DynamoDBStreamEvent) => {
  const svc = new OrdersService();
  const tasks: Promise<any>[] = [];
  for (const rec of event.Records) {
    if (rec.eventName !== "INSERT" && rec.eventName !== "MODIFY") continue;
    const img = rec.dynamodb?.NewImage
      ? (unmarshall(rec.dynamodb.NewImage as any) as any)
      : undefined;
    if (!img || !isCreatedOrgOrderImage(img)) continue;
    // Only auto-create payments for Razorpay mode
    if (img.paymentMode !== "razorpay") continue;
    const orderId = img.orderId as string;
    const orgId = img.orgId as string;
    // Use existing service method to request payment creation (idempotent update)
    tasks.push(
      svc.requestPaymentCreation({ orderId, orgId }).catch(() => void 0)
    );
  }
  await Promise.all(tasks);
  return { ok: true };
};
