#!/usr/bin/env python3
"""Carish first ADMIN bootstrap. Python 3 + configured AWS CLI v2 required.
Usage: python3 create-root-user.py "+919876543210"

Defaults match the uploaded identity-service/serverless.yml (dev).
Optional environment overrides: AWS_REGION, COGNITO_USER_POOL_ID,
DYNAMODB_TABLE_NAME, EXPECTED_AWS_ACCOUNT_ID. AWS_PROFILE is honored by AWS CLI.

Creates Cognito identity + identity-table META, PROFILE, lookup, ADMIN,
bootstrap marker and audit records. User-service provisioning is asynchronous
through the existing PROFILE stream. No password is printed; use OTP login.
Phone ownership is NOT marked verified by this administrative operation.
Required Cognito email/name are supplied as an unverified placeholder address
and Root Admin. The placeholder is not a contact or recovery email and is not
stored as an application email. Existing Cognito attributes are preserved.
Cognito and DynamoDB cannot share a transaction. A Cognito identity can remain
after a DB failure; rerun the same command to finish. No automatic deletion.
"""
import datetime
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import uuid

REGION = os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "ap-south-1"))
POOL = os.getenv("COGNITO_USER_POOL_ID", "ap-south-1_yA23QvbVx")
TABLE = os.getenv("DYNAMODB_TABLE_NAME", "identity-table-dev")
MARKER = {"PK": "SYSTEM#FIRST_ADMIN_BOOTSTRAP", "SK": "META"}

def require(ok, message):
    if not ok:
        raise RuntimeError(message)

def aws(service, operation, payload):
    # Private input file keeps generated passwords out of process arguments.
    with tempfile.TemporaryDirectory(prefix="carish-bootstrap-") as directory:
        path = os.path.join(directory, "request.json")
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump(payload, stream)
        result = subprocess.run(
            ["aws", service, operation, "--region", REGION, "--output", "json",
             "--no-cli-pager", "--cli-input-json", "file://" + path],
            capture_output=True, text=True,
            env={**os.environ, "AWS_PAGER": "", "AWS_CLI_AUTO_PROMPT": "off"})
    if result.returncode:
        raise RuntimeError(service + " " + operation + ": " + result.stderr.strip())
    return json.loads(result.stdout or "{}")

def encode(value):
    if isinstance(value, bool): return {"BOOL": value}
    if isinstance(value, str): return {"S": value}
    if isinstance(value, (int, float)): return {"N": str(value)}
    if isinstance(value, dict): return {"M": {k: encode(v) for k, v in value.items()}}
    raise TypeError(type(value).__name__)

def item(value):
    return {k: encode(v) for k, v in value.items()}

def decode(value):
    if "S" in value: return value["S"]
    if "N" in value: return int(value["N"])
    if "BOOL" in value: return value["BOOL"]
    if "M" in value: return {k: decode(v) for k, v in value["M"].items()}
    if "L" in value: return [decode(v) for v in value["L"]]
    if "NULL" in value: return None
    return value

def get(key):
    raw = aws("dynamodb", "get-item",
              {"TableName": TABLE, "Key": item(key), "ConsistentRead": True}).get("Item")
    return {k: decode(v) for k, v in raw.items()} if raw else None

def put(record):
    return {"Put": {"TableName": TABLE, "Item": item(record),
                    "ConditionExpression": "attribute_not_exists(PK)"}}

def check(record):
    # Compare the whole observed record to prevent overwriting concurrent changes.
    names, values, parts = {}, {}, []
    for index, (key, value) in enumerate(record.items()):
        n, v = "#f" + str(index), ":v" + str(index)
        names[n], values[v] = key, encode(value)
        parts.append(n + " = " + v)
    return {"ConditionCheck": {
        "TableName": TABLE, "Key": item({k: record[k] for k in ("PK", "SK")}),
        "ConditionExpression": " AND ".join(parts),
        "ExpressionAttributeNames": names, "ExpressionAttributeValues": values}}

def normalize(value):
    value = re.sub(r"[\s()-]", "", value)
    if re.fullmatch(r"[6-9][0-9]{9}", value):
        value = "+91" + value
    require(bool(re.fullmatch(r"\+[1-9][0-9]{7,14}", value)),
            "Use an E.164 number, for example +919876543210.")
    return value

def main():
    require(len(sys.argv) == 2, 'Usage: python3 create-root-user.py "+919876543210"')
    phone = normalize(sys.argv[1])
    require(shutil.which("aws"), "Install AWS CLI v2 and configure AWS credentials first.")
    require(POOL.startswith(REGION + "_"), "Cognito pool and AWS region do not match.")
    caller = aws("sts", "get-caller-identity", {})
    expected = os.getenv("EXPECTED_AWS_ACCOUNT_ID")
    require(not expected or caller["Account"] == expected, "AWS account mismatch.")
    print("Target:", caller["Account"], REGION, TABLE, POOL, flush=True)
    pool = aws("cognito-idp", "describe-user-pool", {"UserPoolId": POOL})["UserPool"]
    require(pool["Arn"].split(":")[4] == caller["Account"], "Pool account mismatch.")
    required = {x["Name"] for x in pool.get("SchemaAttributes", []) if x.get("Required")}
    table = aws("dynamodb", "describe-table", {"TableName": TABLE})["Table"]
    require(table["TableStatus"] == "ACTIVE", "Identity table is not ACTIVE.")
    require({(x["AttributeName"], x["KeyType"]) for x in table["KeySchema"]}
            == {("PK", "HASH"), ("SK", "RANGE")}, "Unexpected identity table schema.")
    role = get({"PK": "ROLE#ADMIN", "SK": "METADATA"})
    require(role and role.get("roleId") == "ADMIN",
            "ADMIN role metadata missing. Run your existing role seed first.")
    phone_lookup = get({"PK": "PHONE#" + phone, "SK": "LOOKUP"})
    marker = get(MARKER)
    if marker:
        require(phone_lookup and marker.get("targetUserId") == phone_lookup.get("userId"),
                "First ADMIN already bootstrapped for another user. Use the role API.")

    # Read every page: stop if any other ADMIN exists.
    cursor = None
    while True:
        request = {"TableName": TABLE, "ConsistentRead": True,
                   "FilterExpression": "#e = :e AND roleId = :r",
                   "ExpressionAttributeNames": {"#e": "entityType"},
                   "ExpressionAttributeValues": item({":e": "UserRole", ":r": "ADMIN"})}
        if cursor: request["ExclusiveStartKey"] = cursor
        page = aws("dynamodb", "scan", request)
        for raw in page.get("Items", []):
            uid = raw.get("userId", {}).get("S")
            require(phone_lookup and uid == phone_lookup.get("userId"),
                    "Another ADMIN exists. Use the normal admin role API.")
        cursor = page.get("LastEvaluatedKey")
        if not cursor: break

    users, cursor = [], None
    while True:
        request = {"UserPoolId": POOL, "Filter": 'phone_number = "' + phone + '"'}
        if cursor: request["PaginationToken"] = cursor
        page = aws("cognito-idp", "list-users", request)
        users.extend(page.get("Users", []))
        cursor = page.get("PaginationToken")
        if not cursor: break
    require(len(users) <= 1, "Multiple Cognito identities have this phone; resolve manually.")
    # Pool uses phone_number as AliasAttributes, so Username must not be E.164.
    # Match authentication-core: bow_<uuid>; retries recover via list-users by phone.
    if users:
        username = users[0]["Username"]
    else:
        unsupported = required - {"sub", "phone_number", "email", "name"}
        require(not unsupported,
                "Unsupported required Cognito attributes: " + ", ".join(sorted(unsupported)))
        username = "bow_" + uuid.uuid4().hex
        attributes = [{"Name": "phone_number", "Value": phone}]
        if "email" in required:
            # Reserved .test domain: never imply a deliverable or verified email.
            attributes.extend([
                {"Name": "email", "Value": "dev+bow_" + uuid.uuid4().hex + "@beautyonwheels.test"},
                {"Name": "email_verified", "Value": "false"},
            ])
        if "name" in required:
            attributes.append({"Name": "name", "Value": "Root Admin"})
        try:
            created = aws("cognito-idp", "admin-create-user", {
                "UserPoolId": POOL, "Username": username, "MessageAction": "SUPPRESS",
                "TemporaryPassword": "Aa1!" + secrets.token_hex(32),
                "UserAttributes": attributes})
            username = created.get("User", {}).get("Username") or username
        except RuntimeError as error:
            # Concurrent create with same phone alias: re-resolve by phone.
            if "UsernameExistsException" not in str(error) and "AliasExistsException" not in str(error):
                raise
            page = aws("cognito-idp", "list-users", {
                "UserPoolId": POOL, "Filter": 'phone_number = "' + phone + '"'})
            found = page.get("Users") or []
            require(len(found) == 1, "Could not recover Cognito identity after create conflict.")
            username = found[0]["Username"]
    cognito = aws("cognito-idp", "admin-get-user",
                  {"UserPoolId": POOL, "Username": username})
    attrs = {x["Name"]: x["Value"] for x in cognito["UserAttributes"]}
    require(attrs.get("phone_number") == phone, "Cognito username belongs to another phone.")
    require(cognito.get("Enabled"), "Cognito identity is disabled; refusing to enable it.")
    status = cognito.get("UserStatus")
    if status == "FORCE_CHANGE_PASSWORD":
        require(not users, "Existing Cognito account needs a password change; resolve first.")
        aws("cognito-idp", "admin-set-user-password", {
            "UserPoolId": POOL, "Username": cognito["Username"],
            "Password": "Aa1!" + secrets.token_hex(32), "Permanent": True})
    else:
        require(status == "CONFIRMED", "Unexpected Cognito status: " + str(status))

    sub = attrs["sub"]
    identity_lookup = get({"PK": "IDENTITY#" + sub, "SK": "LOOKUP"})
    candidates = {x["userId"] for x in (phone_lookup, identity_lookup) if x}
    require(len(candidates) <= 1, "Phone and Cognito lookup point to different users.")
    user_id = next(iter(candidates), "u-" + str(uuid.uuid4()))
    meta = get({"PK": "USER#" + user_id, "SK": "META"})
    require(not candidates or meta, "Dangling identity lookup; repair before bootstrap.")
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    tx = [check(role)]
    if meta:
        require(meta.get("status", "").upper() == "ACTIVE", "Existing identity is not active.")
        require(meta.get("phoneNumber") == phone and meta.get("identityId") == sub
                and meta.get("cognitoUsername") == cognito["Username"],
                "Existing identity link does not match Cognito. Resolve through the service.")
        tx.append(check(meta))
    else:
        salt = secrets.token_hex(16)
        password_hash = hashlib.pbkdf2_hmac(
            "sha512", secrets.token_bytes(32), salt.encode(), 10000, 64).hex()
        meta = {"PK": "USER#" + user_id, "SK": "META", "entityType": "User",
                "userId": user_id, "email": "", "username": phone, "phoneNumber": phone,
                "passwordHash": salt + ":" + password_hash, "roleId": "user",
                "status": "ACTIVE", "emailVerified": False,
                "phoneVerified": attrs.get("phone_number_verified") == "true",
                "version": 1, "identityId": sub, "cognitoUsername": cognito["Username"],
                "userType": "ADMIN", "createdAt": now, "updatedAt": now}
        tx.append(put(meta))
    for prefix, field, value, kind in [
        ("PHONE#", "phoneNumber", phone, "PhoneLookup"),
        ("USERNAME#", "username", meta["username"], "UsernameLookup"),
        ("IDENTITY#", "identityId", sub, "IdentityLookup")]:
        key = {"PK": prefix + value, "SK": "LOOKUP"}
        existing = get(key)
        if existing:
            require(existing.get("userId") == user_id, "Conflicting " + kind)
            tx.append(check(existing))
        else:
            tx.append(put({**key, "entityType": kind, "userId": user_id, field: value,
                           "GSI1PK": key["PK"], "GSI1SK": "USER#" + user_id,
                           "createdAt": now, "updatedAt": now}))
    profile = get({"PK": "USER#" + user_id, "SK": "PROFILE"})
    if not profile:
        tx.append(put({"PK": "USER#" + user_id, "SK": "PROFILE", "entityType": "Profile",
                       "userId": user_id, "firstName": "Root", "lastName": "Admin",
                       "identityId": sub, "userType": meta.get("userType", "ADMIN"),
                       "userProvisioning": {"status": "PENDING", "requestedAt": now},
                       "createdAt": now, "updatedAt": now}))
    else:
        require(profile.get("identityId") == sub, "Profile identity link mismatch.")
        require(profile.get("userProvisioning", {}).get("status") in ("PENDING", "LINKED"),
                "Existing profile needs user-service provisioning repair.")
        tx.append(check(profile))
    admin = get({"PK": "USER#" + user_id, "SK": "ROLE#ADMIN"})
    if admin:
        require(admin.get("roleId") == "ADMIN" and admin.get("userId") == user_id,
                "Malformed ADMIN mapping.")
        tx.append(check(admin))
    else:
        tx.append(put({"PK": "USER#" + user_id, "SK": "ROLE#ADMIN", "entityType": "UserRole",
                       "userId": user_id, "roleId": "ADMIN", "createdAt": now, "updatedAt": now}))
    if marker:
        require(marker.get("targetUserId") == user_id, "Bootstrap target mismatch.")
        tx.append(check(marker))
    else:
        tx.append(put({**MARKER, "entityType": "AdminBootstrap", "targetUserId": user_id,
                       "executedBy": caller["Arn"], "method": "mobile-bootstrap",
                       "createdAt": now, "updatedAt": now}))
    audit_id = str(uuid.uuid4())
    tx.append(put({"PK": "AUDIT#" + audit_id, "SK": "METADATA", "entityType": "AuditLog",
                   "auditId": audit_id, "userId": user_id, "action": "first_admin_bootstrapped",
                   "details": json.dumps({"executedBy": caller["Arn"], "method": "mobile-bootstrap",
                                          "phoneOwnershipVerifiedByScript": False}),
                   "timestamp": now, "createdAt": now, "updatedAt": now,
                   "GSI1PK": "USER#" + user_id, "GSI1SK": "AUDIT#" + now}))
    aws("dynamodb", "transact-write-items",
        {"TransactItems": tx, "ClientRequestToken": str(uuid.uuid4())})
    require(get({"PK": "USER#" + user_id, "SK": "ROLE#ADMIN"}).get("roleId") == "ADMIN",
            "ADMIN verification failed.")
    print(json.dumps({"result": "ADMIN ready in identity table", "identityUserId": user_id,
                      "cognitoSub": sub, "table": TABLE,
                      "next": "Sign in using phone OTP. User-service linking runs asynchronously."}, indent=2))

if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, KeyError, ValueError) as error:
        print("Stopped: " + str(error), file=sys.stderr)
        print("No automatic deletion was attempted. Inspect any Cognito identity left by a partial run.",
              file=sys.stderr)
        sys.exit(1)
