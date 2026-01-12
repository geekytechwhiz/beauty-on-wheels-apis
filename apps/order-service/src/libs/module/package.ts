import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb"; 
import { USER, PURCHASED, PKG, ADDON, PACKAGE_TABLE } from "../../utils/constants";
import { docClient } from "../../utils/db.config";
/**
 * Fetch user package or addon record.
 * Either userPackageId or userAddonId must be provided (mutually exclusive).
 */
export type UserProductArgs =
  | { userId: string; userPackageId: string; userAddonId?: never }
  | { userId: string; userAddonId: string; userPackageId?: never };

export async function fetchUserProductRecord(args: UserProductArgs) {
  const { userId, userPackageId, userAddonId } = args;

  const pk = `${USER}#${userId}`;
  let sk: string;

  if (userPackageId) {
    sk = `${PURCHASED}#${PKG}#${userPackageId}`;
  } else if (userAddonId) {
    sk = `${PURCHASED}#${ADDON}#${userAddonId}`;
  } else {
    throw new Error("Either userPackageId or userAddonId must be provided");
  }

  const result = await docClient.send(
    new GetItemCommand({
      TableName: PACKAGE_TABLE,
      Key: {
        pk: { S: pk },
        sk: { S: sk },
      },
    })
  );

  return result.Item ? unmarshall(result.Item) : null;
}
