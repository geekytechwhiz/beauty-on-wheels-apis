import boto3
import csv
from botocore.exceptions import ClientError

AWS_PROFILE = # profile name
AWS_REGION = "us-east-1"

# Number of Lambda functions to process in one run
BATCH_SIZE = 100

# Number of batches to process
MAX_BATCHES = 1

# True = Report only
# False = Actually delete versions
DRY_RUN = False

session = boto3.Session(
    profile_name=AWS_PROFILE,
    region_name=AWS_REGION
)

lambda_client = session.client("lambda")

csv_file = open("lambda_cleanup_report.csv", "w", newline="")
writer = csv.writer(csv_file)

writer.writerow([
    "FunctionName",
    "VersionCount",
    "KeptVersions",
    "DeletedVersions"
])

deleted_total = 0
processed_total = 0
skipped_prod_total = 0

print("=" * 100)
print("AWS Lambda Version Cleanup")
print(f"AWS Profile : {AWS_PROFILE}")
print(f"AWS Region  : {AWS_REGION}")
print(f"Batch Size  : {BATCH_SIZE}")
print(f"Max Batches : {MAX_BATCHES}")
print(f"DRY_RUN     : {DRY_RUN}")
print("=" * 100)

print("\nFetching Lambda Functions...")

paginator = lambda_client.get_paginator("list_functions")

functions = []

for page in paginator.paginate():
    functions.extend(page["Functions"])

print(f"Total Lambda Functions Found: {len(functions)}")

eligible_functions = []

print("\nFiltering Production Lambdas...")

for fn in functions:

    name = fn["FunctionName"]
    name_upper = name.upper()

    #
    # Skip Production Lambdas
    #
    if (
        "PRD" in name_upper
        or "NVPRD" in name_upper
    ):
        skipped_prod_total += 1
        print(f"[SKIP PROD] {name}")
        continue

    eligible_functions.append(name)

print("\n")
print("=" * 100)
print(f"Eligible Functions      : {len(eligible_functions)}")
print(f"Skipped Prod Functions  : {skipped_prod_total}")
print("=" * 100)

print("\nSample Eligible Functions:")

for fn in eligible_functions[:20]:
    print(fn)

batch_counter = 0

for batch_start in range(
        0,
        len(eligible_functions),
        BATCH_SIZE):

    batch_counter += 1

    if batch_counter > MAX_BATCHES:
        print(
            f"\nReached MAX_BATCHES={MAX_BATCHES}. Stopping."
        )
        break

    batch_end = min(
        batch_start + BATCH_SIZE,
        len(eligible_functions)
    )

    print("\n")
    print("=" * 100)
    print(
        f"PROCESSING BATCH {batch_counter}"
    )
    print(
        f"Functions {batch_start + 1} to {batch_end}"
    )
    print("=" * 100)

    batch = eligible_functions[
        batch_start:batch_end
    ]

    for function_name in batch:

        try:

            print("\n")
            print("-" * 100)
            print(
                f"Checking Function: {function_name}"
            )

            versions_response = (
                lambda_client.list_versions_by_function(
                    FunctionName=function_name
                )
            )

            versions = []

            for version in versions_response["Versions"]:

                if version["Version"] == "$LATEST":
                    continue

                versions.append(
                    version["Version"]
                )

            versions = sorted(
                versions,
                key=lambda x: int(x)
            )

            version_count = len(versions)

            #
            # Skip if already <= 2 versions
            #
            if version_count <= 2:

                print(
                    f"Version Count={version_count}. Nothing to delete."
                )

                continue

            processed_total += 1

            keep_versions = versions[-2:]
            delete_versions = versions[:-2]

            print(
                f"Version Count : {version_count}"
            )

            print(
                f"Keep Versions : {keep_versions}"
            )

            print(
                f"Delete Count  : {len(delete_versions)}"
            )

            for version in delete_versions:

                if DRY_RUN:

                    print(
                        f"[DRY RUN] Would Delete Version {version}"
                    )

                else:

                    try:

                        lambda_client.delete_function(
                            FunctionName=function_name,
                            Qualifier=version
                        )

                        deleted_total += 1

                        print(
                            f"[DELETED] Version {version}"
                        )

                    except ClientError as e:

                        print(
                            f"[ERROR] Failed to delete version {version}"
                        )

                        print(str(e))

            writer.writerow([
                function_name,
                version_count,
                ",".join(keep_versions),
                ",".join(delete_versions)
            ])

        except Exception as e:

            print(
                f"[ERROR] Processing Function: {function_name}"
            )

            print(str(e))

print("\n")
print("=" * 100)
print("SUMMARY")
print("=" * 100)

print(
    f"Functions With >2 Versions : {processed_total}"
)

print(
    f"Versions Deleted          : {deleted_total}"
)

print(
    f"Production Lambdas Skipped: {skipped_prod_total}"
)

print(
    "CSV Report                : lambda_cleanup_report.csv"
)

print("=" * 100)

csv_file.close()