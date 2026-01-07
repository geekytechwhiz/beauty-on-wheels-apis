import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { DynamoDBStreamEvent } from "aws-lambda";
import { randomUUID } from "crypto";
import { ProductTypeEnum, InvoiceEntity } from "../libs/dtos/orders";
import { fetchUserProductRecord } from "../libs/module/package";
import { organizationDetails, fetchUserBasicDetails } from "../libs/module/user";
import { OrdersRepository } from "../repositories/orders.repository";
import { CURRENCY, CURRENCY_SYMBOL, ORDER_TABLE } from "../utils/constants";

 
// DynamoDB client
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const ordersRepo = new OrdersRepository();

export const handler = async (event: DynamoDBStreamEvent) => {
  for (const rec of event.Records) {
    try {
      // Handle REMOVE event: just log and continue
      if (rec.eventName === "REMOVE") {
        console.log("REMOVE event detected, skipping record", { record: rec });
        continue;
      }
      const newImage = rec.dynamodb?.NewImage;
      if (!newImage) continue;
      const item = unmarshall(newImage as any) as Record<string, any>;
      const pk = item.pk;
      const sk = item.sk;

      // Only process actual order records
      if (
        pk.startsWith("ORDERS#") &&
        pk.endsWith("#ORDERS") &&
        sk.startsWith("ORDER#")
      ) {
        // INSERT: append product info to services
        if (rec.eventName === "INSERT") {
          const userId = item?.userId || "";
          const productId = item?.productId;
          const isAddon = item?.productType === ProductTypeEnum.enum.addon
          const productRecord: any = await fetchUserProductRecord(
            isAddon
              ? { userId, userAddonId: productId }
              : { userId, userPackageId: productId }
          );
          const subtotal = productRecord?.charges?.offerPrice;
          const discount = productRecord?.discount;
          const tax = 0;
          const totalBeforeTax = productRecord?.charges?.offerPrice;
          const finalAmount = totalBeforeTax + tax;
          const productObj = {
            title: productRecord?.title,
            type: isAddon
              ? ProductTypeEnum.enum.addon
              : ProductTypeEnum.enum.package,
            quantity: productRecord?.limit?.unit || 1,
            discount: discount,
            unitPrice: productRecord?.charges?.price,
            subtotal,
            tax,
            taxInfo: "",
            totalBeforeTax,
            finalAmount,
            currency: CURRENCY,
            currencySymbol: CURRENCY_SYMBOL,
            description: productRecord.description,
          };

          const orgRecord = await organizationDetails(item.orgId);
          const orgInfo = {
            address: orgRecord?.organizationInfo?.address?.address || "",
            businessTaxId: orgRecord?.businessTaxId || "",
            city: orgRecord?.organizationInfo?.address?.city || "",
            country: orgRecord?.organizationInfo?.address?.country || "",
            email: orgRecord?.organizationInfo?.emailAddress || "",
            logoUrl: orgRecord?.organizationInfo?.hospitalImage || "",
            name: orgRecord?.organizationInfo?.organizationName || "",
            phone: orgRecord?.organizationInfo?.phoneNumber || "",
            state: orgRecord?.organizationInfo?.address?.state || "",
            website: orgRecord?.organizationInfo?.website || "",
          };


          // Append productObj into services array for this exact pk + sk
          await docClient.send(
            new UpdateCommand({
              TableName: ORDER_TABLE,
              Key: { pk, sk },
              UpdateExpression: `
                    SET services = list_append(if_not_exists(services, :empty), :newService),
                        orgDetails = :orgDetails
                  `,
              ExpressionAttributeValues: {
                ":newService": [productObj], // your new service to append
                ":empty": [], // default empty list if services doesn't exist
                ":orgDetails": orgInfo, // the orgDetails object you want to set
              },
              ReturnValues: "UPDATED_NEW",
            })
          );
          console.log("Appended product to services", {
            orderKey: pk + "#" + sk,
            added: productObj,
            updated: orgInfo,
          });
        }
        // MODIFY: create invoice on status change to completed
        if (rec.eventName === "MODIFY") {
          const oldStatus = rec.dynamodb?.OldImage?.status?.S;
          const newStatus = rec.dynamodb?.NewImage?.status?.S || "";
          const transactionType = rec.dynamodb?.NewImage?.transactionType?.S;
          // if (oldStatus !== newStatus && transactionType === "cash") {
          //   try {
          //     let packageUrl = process.env.PACKAGE_BASE_URL;
          //     console.debug("PACKAGE_BASE_URL:", packageUrl);

          //     if (!packageUrl) {
          //       console.debug("PACKAGE_BASE_URL is missing");
          //       return { success: false, error: "MISSING_PACKAGE_BASE_URL" };
          //     }
          //     const payload = {
          //       userId: item?.userId,
          //       paymentStatus:
          //         OrderToPaymentStatusMap[newStatus as orderStatus],
          //       productId: item?.productId,
          //       productType: item?.productType,
          //       orderId : item?.orderId,
          //       orgId: item?.orgId,
          //       paymentId: item?.metadata?.paymentId || "",
          //       entityId : item?.metadata?.entityId || "",
          //     };
          //     packageUrl = `${packageUrl}/services/update-payment-status`;
          //     console.debug("Final packageUrl:", packageUrl);

          //     await axios.post(packageUrl, payload);
          //     console.log("package api called successfully:", payload);
          //   } catch (err) {
          //     console.error("Error in invoice creation", {
          //       error: err,
          //       orderId: item.orderId,
          //     });
          //   }
          // }
          // Handle PRIMARY invoice on completed
          if (oldStatus !== "completed" && newStatus === "completed") {
            const invoiceId = randomUUID();
            const invoiceType = "PRIMARY";
            const createdAtEpoch = Math.floor(
              new Date(item.updatedAt || item.createdAt).getTime() / 1000
            );
            const invoicePk = `ORDER#${item.orderId}#INVOICES`;
            const invoiceSk = `INV#${invoiceType}#TS#${createdAtEpoch}#INVOICE#${invoiceId}`;
            const userDetails = await fetchUserBasicDetails(item.userId);
            const billedTo = {
              email: userDetails?.emailAddress || "",
              name: userDetails?.fullName || "",
              address: userDetails?.street || "",
              phone: userDetails?.phoneNumber || "",
              city: userDetails?.city || "",
              country: userDetails?.country || "",
              state: userDetails?.state || "",
              businessTaxId: userDetails?.businessTaxId || "",
              website: userDetails?.taxInfo || "",
            };

            const invoice: InvoiceEntity = {
              pk: invoicePk,
              sk: invoiceSk,
              invoiceId,
              orderId: item.orderId,
              orgId: item.orgId,
              invoiceType,
              status: item.status,
              mode: item.transactionType,
              invoiceDate: item.updatedAt || item.createdAt,
              billedTo,
              orgInfo: item.orgDetails,
              products: [
                {
                  amount: item.amount,
                  discount: item.services[0]?.discount || {},
                  metadata: {
                    productId: item.productId,
                    productType: item.productType,
                  },
                  quantity: 1,
                  title: item.services[0]?.title || "",
                  type: item.services[0]?.type || "",
                  unitPrice: item.amount,
                },
              ],
              summary: {
                amount: item.amount,
                currency: item.currency,
                currencySymbol: item.currencySymbol || "₹",
                discount: item.services[0]?.discount || {},
                shipping: 0,
                subtotal: item.amount,
                tax: 0,
                taxInfo: "",
                totalBeforeTax: item.amount,
              },
            };
            await docClient.send(
              new PutCommand({
                TableName: ORDER_TABLE,
                Item: invoice,
              })
            );
            console.log("Invoice created for completed order", {
              invoicePk,
              invoiceSk,
            });
          }
          // Handle REFUND invoice on refunded
          if (oldStatus !== "refunded" && newStatus === "refunded") {
            const invoiceId = randomUUID();
            const invoiceType = "REFUND";
            const createdAtEpoch = Math.floor(
              new Date(item.updatedAt || item.createdAt).getTime() / 1000
            );
            const invoicePk = `ORDER#${item.orderId}#INVOICES`;
            const invoiceSk = `INV#${invoiceType}#TS#${createdAtEpoch}#INVOICE#${invoiceId}`;
            const userDetails = await fetchUserBasicDetails(item.userId);
            const billedTo = {
              email: userDetails?.emailAddress || "",
              name: userDetails?.fullName || "",
              address: userDetails?.street || "",
              phone: userDetails?.phoneNumber || "",
              city: userDetails?.city || "",
              country: userDetails?.country || "",
              state: userDetails?.state || "",
              businessTaxId: userDetails?.businessTaxId || "",
              website: userDetails?.taxInfo || "",
            };

            const invoice: InvoiceEntity = {
              pk: invoicePk,
              sk: invoiceSk,
              invoiceId,
              orderId: item.orderId,
              orgId: item.orgId,
              invoiceType,
              status: item.status,
              mode: item.transactionType,
              invoiceDate: item.updatedAt || item.createdAt,
              billedTo,
              orgInfo: item.orgDetails,
              products: [
                {
                  amount: item.amount,
                  discount: item.services[0]?.discount || {},
                  metadata: {
                    productId: item.productId,
                    productType: item.productType,
                  },
                  quantity: 1,
                  title: item.services[0]?.title || "",
                  type: item.services[0]?.type || "",
                  unitPrice: item.amount,
                },
              ],
              summary: {
                amount: item.amount,
                currency: item.currency,
                currencySymbol: item.currencySymbol || "₹",
                discount: item.services[0]?.discount || {},
                shipping: 0,
                subtotal: item.amount,
                tax: 0,
                taxInfo: "",
                totalBeforeTax: item.amount,
              },
            };
            await docClient.send(
              new PutCommand({
                TableName: ORDER_TABLE,
                Item: invoice,
              })
            );
            console.log("Refund invoice created for refunded order", {
              invoicePk,
              invoiceSk,
            });
          }
        }
      }
      if (
        pk.startsWith("USER#") &&
        pk.endsWith("#ORDERS") &&
        sk.startsWith("ORDER#")
      ) {
        if (rec.eventName === "INSERT") {
          const userDetails = await fetchUserBasicDetails(item.userId);
          console.log("userDetails --", JSON.stringify(userDetails));
          const userObj = {
            email: userDetails?.emailAddress ?? "",
            name: userDetails?.fullName ?? userDetails?.firstName ?? "",
            address: userDetails?.address ?? "",
            phone: userDetails?.phoneNumber ?? "",
            city: userDetails?.city ?? "",
            country: userDetails?.country || "",
            state: userDetails?.state ?? "",
          };
          console.log("userObj --", JSON.stringify(userObj));
          await docClient.send(
            new UpdateCommand({
              TableName: ORDER_TABLE,
              Key: { pk, sk },
              UpdateExpression: "SET userDetails = :userDetails",
              ExpressionAttributeValues: {
                ":userDetails": userObj,
              },
              ReturnValues: "UPDATED_NEW",
            })
          );
        }
      }
    } catch (err) {
      console.error("Error processing stream record", {
        record: rec,
        error: err,
      });
    }
  }

  return { statusCode: 200, message: "processed" };
};
